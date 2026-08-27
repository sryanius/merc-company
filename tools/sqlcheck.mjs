/**
 * SQL 함수 정적 검사 — 「부르면 죽는 함수」를 배포 전에 잡는다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 상설 도구인가 — **`gold_send()` 가 내놓은 날부터 부를 때마다 죽고 있었다** (§109).
 *
 *     select count(*) into cnt from … for update;
 *     → ERR 0A000 : FOR UPDATE is not allowed with aggregate functions
 *
 *   plpgsql 은 문장을 **처음 실행할 때** 계획한다. 그래서 `create function` 은 멀쩡히
 *   통과하고 **부를 때만** 터진다. 「만들어졌다」 는 아무 증거가 아니다.
 *   프로덕션 확인: 부탁 4건 전부 `pending`, 보내진 적 **0건**.
 *
 *   근본 원인은 정규식이 아니라 **SQL 함수를 한 번도 실행해 본 적이 없다는 것**이었다.
 *   로컬에 Postgres 가 없고(도커가 안 뜬다 §102.5) 실행 검사가 없었다.
 *
 * ★★ 그래서 **`plpgsql_check`** 를 쓴다. 함수 본문의 **모든 문장을 계획해 본다** —
 *   실행하지 않고, 데이터를 한 줄도 안 건드리고.
 *   메타 검사로 확인했다 (심어서 물리는지):
 *     · 집계 + `for update`  → error: FOR UPDATE is not allowed with aggregate functions
 *     · 없는 컬럼            → error: column … does not exist
 *     · 없는 표              → error: relation … does not exist
 *     · 고친 형태(`perform … for update` + `get diagnostics`) → 조용
 *
 * ★ `tools/lib/sqllock.mjs` 는 **글자로** 같은 부류를 잡는다 (오프라인, 스모크가 굴린다).
 *   이 도구는 **DB 에 물어본다** — 더 넓게 잡지만 네트워크가 필요하다. 둘 다 둔다.
 *
 * ★ 이 도구는 **아무것도 안 고친다.** 판단만 한다.
 *
 * 사용: node tools/sqlcheck.mjs
 *   (`npx supabase link` 가 되어 있어야 한다. `rlscheck.mjs` 와 같은 전제다.)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/* ════════════════════════════════════════════════════════════════════════════
 * 조회 SQL
 *
 * ★ 트리거 함수는 **대상 표를 같이 줘야** 검사할 수 있다 (없으면
 *   `missing trigger relation` 으로 조회 전체가 죽는다 — 실제로 겪었다).
 *   그래서 `pg_trigger` 로 그 표를 찾아 붙여 준다.
 * ★ 트리거인데 어디에도 안 걸린 함수는 검사할 수 없다 — 그 사실을 따로 알려 준다.
 * ════════════════════════════════════════════════════════════════════════════ */
const SQL = `
create extension if not exists plpgsql_check with schema extensions;

with fns as (
  select p.oid, p.proname as name,
         pg_get_function_identity_arguments(p.oid) as args,
         p.prorettype = 'trigger'::regtype as is_trigger,
         (select t.tgrelid from pg_trigger t where t.tgfoid = p.oid limit 1) as relid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and l.lanname = 'plpgsql'
), checked as (
  select f.name, f.args, f.is_trigger, f.relid,
         case
           when not f.is_trigger then
             (select jsonb_agg(jsonb_build_object('lv', m.level, 'msg', m.message, 'line', m.lineno, 'q', m.query))
                from extensions.plpgsql_check_function_tb(f.oid) m)
           when f.relid is not null then
             (select jsonb_agg(jsonb_build_object('lv', m.level, 'msg', m.message, 'line', m.lineno, 'q', m.query))
                from extensions.plpgsql_check_function_tb(f.oid, f.relid) m)
           else null
         end as issues
    from fns f
)
select jsonb_pretty(jsonb_build_object(
  'total', (select count(*) from fns),
  'skipped', (select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from checked
               where is_trigger and relid is null),
  'rows', (select coalesce(jsonb_agg(jsonb_build_object(
             'name', name, 'args', args, 'issues', coalesce(issues, '[]'::jsonb)) order by name), '[]'::jsonb)
           from checked where not (is_trigger and relid is null))
)) as data;
`;

function ask() {
  const dir = mkdtempSync(join(tmpdir(), 'sqlcheck-'));
  const f = join(dir, 'q.sql');
  writeFileSync(f, SQL, 'utf8');
  let out = '';
  try {
    out = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '-f', f],
      { encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024 });
  } finally {
    try { unlinkSync(f); } catch { /* 지워지든 말든 */ }
  }
  const at = out.indexOf('{');
  if (at < 0) throw new Error(`조회 결과를 못 읽었다: ${out.slice(0, 300)}`);
  const res = JSON.parse(out.slice(at));
  if (res._tag === 'Error') throw new Error(`조회 실패: ${JSON.stringify(res.error).slice(0, 400)}`);
  const row = Array.isArray(res.rows) ? res.rows[0] : null;
  const d = row && (typeof row.data === 'string' ? JSON.parse(row.data) : row.data);
  if (!d) throw new Error('조회 결과에 data 가 없다');
  return d;
}

const data = ask();
const rows = data.rows || [];
const errs = [];
const warns = [];

process.stdout.write(`plpgsql 함수 ${data.total}개 — 검사 ${rows.length}개\n\n`);

for (const r of rows) {
  for (const m of r.issues || []) {
    const where = `${r.name}(${r.args})${m.line ? ` :${m.line}` : ''}`;
    const line = `${where}\n      ${m.msg}${m.q ? `\n      ${String(m.q).replace(/\s+/g, ' ').slice(0, 140)}` : ''}`;
    if (String(m.lv) === 'error') errs.push(line); else warns.push(line);
  }
}

if (warns.length) {
  process.stdout.write(`⚠ 경고 ${warns.length}건\n`);
  for (const w of warns) process.stdout.write(`  ${w}\n`);
  process.stdout.write('\n');
}

const skipped = data.skipped || [];
if (skipped.length) {
  /* ★ 조용히 건너뛰지 않는다 — 「검사했다」 와 「검사 못 했다」 는 다르다 */
  process.stdout.write(`ℹ 검사 못 한 트리거 함수 ${skipped.length}개 (어느 표에도 안 걸려 있다): ${skipped.join(', ')}\n\n`);
}

if (errs.length) {
  process.stdout.write(`❌ 오류 ${errs.length}건 — **부르면 죽는다**\n\n`);
  for (const e of errs) process.stdout.write(`  ${e}\n`);
  process.stdout.write('\n   plpgsql 은 문장을 처음 실행할 때 계획한다 — 「만들어졌다」 는 증거가 아니다 (§109).\n');
  process.exit(1);
}

process.stdout.write(`✅ 부르면 죽는 함수가 없다 — 함수 ${rows.length}개 전부 계획이 선다\n`);
process.exit(0);
