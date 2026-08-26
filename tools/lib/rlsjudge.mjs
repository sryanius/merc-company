/**
 * RLS 전수 판정 — 「공개 키로 읽히는 테이블이 있나」
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 이 프로젝트는 **다른 앱과 Supabase 를 공유한다** (침묵의 기록자, `tsa_*`).
 *   그 말은 **anon 키도 공유한다**는 뜻이다. 이 게임의 anon 키는 저장소에 공개돼 있으므로
 *   (설계상 그렇다 — RLS 가 방어선이다), **어느 쪽이든 RLS 없는 테이블을 하나 만들면
 *   양쪽 모두에게 열린다.** 새 테이블은 두 프로젝트 공동의 위험이다.
 *
 * ★ 판정을 **순수 함수로** 떼어 놓은 이유: 스모크가 DB 없이 굴려 볼 수 있어야 한다.
 *   «명령을 문서에 적어 둔다» 는 결국 안 돌린다 — 그래서 검사로 만든다.
 *   실제 조회는 `tools/rlscheck.mjs` 가 한다.
 *
 * @module tools/lib/rlsjudge
 */

/** 용병단 게임이 주인인 테이블 */
export const GAME_TABLES = [
  'saves', 'saves_archive', 'scores', 'scores_history', 'ledger', 'rejections',
  'pvp_defense', 'pvp_ratings', 'pvp_matches', 'pvp_cooldowns', 'pvp_desync',
];

/** 남의 것이지만 **알고 있는** 테이블 (접두어 → 주인) */
export const KNOWN_FOREIGN = [
  { prefix: 'tsa_', owner: '침묵의 기록자' },
];

/** 공개 키가 곧 손에 들어오는 역할들 — 여기에 열린 것은 «누구나» 와 같다 */
const PUBLIC_ROLES = ['anon', 'public'];

const isTrue = (x) => {
  const s = String(x == null ? '' : x).trim().toLowerCase();
  return s === 'true' || s === '(true)';
};

const rolesOf = (r) => String(r == null ? '' : r)
  .replace(/[{}"]/g, '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * 테이블·정책 목록을 보고 문제를 낸다.
 *
 * @param {Array<{tbl:string, rls_on:boolean, policies:number}>} tables
 * @param {Array<{tablename:string, policyname:string, cmd:string, roles:string, qual:string, with_check:string}>} policies
 * @returns {{fatal:string[], warn:string[], seen:{game:number, foreign:number, unknown:string[]}}}
 */
export function judgeTables(tables, policies = []) {
  const fatal = [];
  const warn = [];
  const seen = { game: 0, foreign: 0, unknown: [] };

  const list = Array.isArray(tables) ? tables : [];
  if (!list.length) {
    fatal.push('테이블을 하나도 못 읽었다 — 조회가 실패했거나 판이 안 차려졌다');
    return { fatal, warn, seen };
  }

  for (const t of list) {
    const name = String(t && t.tbl || '');
    if (!name) continue;

    /* ① RLS 자체 — 꺼져 있으면 공개 키로 통째로 읽힌다 */
    if (!t.rls_on) {
      fatal.push(`${name}: RLS 가 꺼져 있다 — 공개 anon 키로 통째로 읽힌다`);
    }

    /* ② 주인이 누구인가 — 모르는 테이블이 생기면 알려 준다 */
    if (GAME_TABLES.includes(name)) seen.game++;
    else if (KNOWN_FOREIGN.some((f) => name.startsWith(f.prefix))) seen.foreign++;
    else seen.unknown.push(name);
  }

  /* ③ 정책이 열려 있는가.
   *   RLS 를 켜 놓고 `using (true)` 를 걸면 **켠 의미가 없다.** 이게 더 흔한 실수다. */
  for (const p of (Array.isArray(policies) ? policies : [])) {
    const tbl = String(p && p.tablename || '');
    const roles = rolesOf(p && p.roles);
    const openRead = isTrue(p && p.qual);
    const openWrite = isTrue(p && p.with_check);
    const toPublic = roles.some((r) => PUBLIC_ROLES.includes(r)) || !roles.length;
    const cmd = String(p && p.cmd || '').toUpperCase();

    if (!openRead && !openWrite) continue;
    const who = roles.join(',') || '(전체)';
    if (toPublic) {
      fatal.push(`${tbl}.${p.policyname}: ${cmd} 가 ${who} 에게 조건 없이 열려 있다 (using true) — RLS 를 켠 의미가 없다`);
    } else {
      warn.push(`${tbl}.${p.policyname}: ${cmd} 가 ${who} 에게 조건 없이 열려 있다 — 로그인한 누구나 남의 것을 본다`);
    }
  }

  for (const u of seen.unknown) {
    warn.push(`${u}: 처음 보는 테이블이다 — 주인이 누구인지 확인하고 rlsjudge.mjs 의 목록에 적어라`);
  }

  return { fatal, warn, seen };
}

/** 조회에 쓰는 SQL (도구와 검사가 **같은 것**을 본다) */
export const RLS_SQL = `select json_build_object(
  'tables', coalesce((select json_agg(x) from (
     select c.relname as tbl, c.relrowsecurity as rls_on,
            (select count(*) from pg_policies p
               where p.schemaname='public' and p.tablename=c.relname) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relkind='r'
      order by c.relname) x), '[]'::json),
  'policies', coalesce((select json_agg(y) from (
     select tablename, policyname, cmd, roles::text as roles, qual, with_check
       from pg_policies where schemaname='public'
      order by tablename, policyname) y), '[]'::json)
) as data;`;
