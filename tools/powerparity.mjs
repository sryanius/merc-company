/**
 * 「서버가 센 전력 == 클라가 센 전력」 을 **잰다** (§104 1단계의 0번 관문)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 이게 먼저인가
 *   1단계는 「S용병 수·부대 전력을 서버가 스스로 센다」 다. 그런데 서버가 센 값이
 *   클라 값과 **다르면** 정상 플레이어가 통째로 거절되거나(§94 가 「가장 나쁜 사고」로
 *   못 박은 것) 순위가 조용히 뒤집힌다. 여기서 막히면 1·2·4번이 전부 무의미하다.
 *
 * ★★ 세 값을 잰다. 셋이 **정확히** 같아야 한다.
 *
 *     P1  클라 경로   — `src/` 원본,  node
 *     P2  서버 경로   — `supabase/functions/submit-score/_power/` 사본,  **Deno**
 *     P3  서버 + 표   — 같은 사본·같은 Deno 인데, state 를 **`run_*` 표로 갔다 돌려받은 것**
 *
 *   P1≠P2 면 «런타임·평탄화» 가 범인이다 (Deno 에서 안 되는 것을 썼거나 사본이 썩었다).
 *   P2≠P3 면 «013 스키마가 전력에 필요한 것을 잃는다» 는 뜻이다 — 그게 진짜 위험이다.
 *
 * ★★ **0 을 통과로 세지 않는다.** 전에 0 대 0 을 비교해 놓고 통과라고 한 적이 있다.
 *   판이 실하지 않으면(전력이 0 이거나 전부 같으면) **그 자체로 실패**다.
 *
 * 실행: node tools/powerparity.mjs
 *       node tools/powerparity.mjs --keep   (중간 JSON 을 지우지 않는다)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { toRows, fromRows } from './lib/runrows.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KEEP = process.argv.includes('--keep');

const State = await import('../src/game/state.js');
const Merc = await import('../src/game/merc.js');
const Gear = await import('../src/game/gear.js');
const Squad = await import('../src/game/squad.js');
const Sets = await import('../src/data/sets.js');
const RngMod = await import('../src/core/rng.js');

/* ───────────────────────── 판을 짓는다 ───────────────────────── */

/** 클래스 하나를 고른다 (결정론) */
const CLASSES = ['shieldman', 'swordsman', 'spearman', 'rogue', 'archer', 'apprentice', 'acolyte'];

/**
 * 한 판을 짓는다. **게임 자기 API 로만** 짓는다 — 손으로 지으면 모양이 틀려
 * 전부 0 이 나오고, 0 대 0 비교는 아무것도 증명 못 한다 (§108 에서 실제로 겪었다).
 */
function build({ seed, name, grades, levels, gearIlvl, setId, formationId, holes }) {
  State.newGame(seed, name);
  const st = State.state;
  const rng = new RngMod.RNG(seed ^ 0x5bf03635);

  st.roster = [];
  st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  if (formationId) sq.formationId = formationId;

  for (let i = 0; i < 7; i++) {
    if ((holes || []).includes(i)) continue;                 // 빈 자리를 일부러 남긴다
    const m = Merc.createMerc({
      classId: CLASSES[i % CLASSES.length],
      grade: grades[i % grades.length],
      level: levels[i % levels.length],
      rng,
      day: 2,
    });
    m.hiredDay = 2;
    st.roster.push(m);
    sq.memberUids[i] = m.uid;
    m.squadId = sq.id; m.slotIndex = i;

    /* 장비 — 세트를 주면 세트로, 아니면 일반으로. gearIlvl 이 null 이면 **정말로 맨몸** */
    if (gearIlvl == null) continue;
    for (const slot of ['weapon', 'body', 'head', 'ring1', 'ring2']) {
      const want = slot === 'ring1' || slot === 'ring2' ? 'ring' : slot;
      const it = setId
        ? Gear.rollSetItem({ setId, slot: want, ilvl: gearIlvl, rng })
        : Gear.rollItem({ ilvl: gearIlvl, rarity: 3, slot: want, rng });
      if (!it) continue;
      st.items.push(it);
      const r = Gear.equipItem(st, m, it.uid, slot);
      if (!r || !r.ok) { /* 클래스가 못 드는 무기 등 — 가방에 남는다. 그것도 판의 일부다 */ }
    }
  }
  return st;
}

/** 세트 id 를 하나 고른다 (있으면) */
function someSetId() {
  const all = (Sets.SETS && Object.keys(Sets.SETS)) || [];
  return all.length ? all[0] : null;
}

const SET_ID = someSetId();

const RECIPES = [
  { seed: 1001, name: '기본7명', grades: ['C'], levels: [20], gearIlvl: 20, formationId: 'basic' },
  { seed: 1002, name: '등급섞임', grades: ['S', 'A', 'B', 'C', 'D'], levels: [40, 35, 30], gearIlvl: 40 },
  { seed: 1003, name: '만렙80', grades: ['S'], levels: [80], gearIlvl: 80 },
  { seed: 1004, name: '빈자리셋', grades: ['A'], levels: [50], gearIlvl: 50, holes: [1, 3, 5] },
  { seed: 1005, name: '두명만', grades: ['S'], levels: [70], gearIlvl: 70, holes: [1, 2, 3, 4, 5] },
  { seed: 1006, name: '맨몸', grades: ['B'], levels: [30], gearIlvl: null },

  /* ★★ 「빈 칸 + 자리가 걸린 진형」 — **이게 없어서 메타 검사가 안 물었다.**
   *   `basic` 은 자리별 보정이 전부 `{}` 라 자리를 바꿔도 전력이 안 변한다.
   *   그래서 「memberUids 의 null 을 걸러내는」 대표적 실수를 못 잡았다.
   *   crescent(0-1 / 2-3 / 4-6)·ambush(0 / 1-2 / 3-6)·crane(0-2 / 3-4 / 5-6) 은
   *   자리마다 값이 다르다 — 자리가 밀리면 반드시 숫자가 달라진다. */
  { seed: 1009, name: '초승달+빈칸', grades: ['A'], levels: [45], gearIlvl: 45, formationId: 'crescent', holes: [1, 4] },
  { seed: 1010, name: '매복+빈칸', grades: ['S', 'B'], levels: [65, 40], gearIlvl: 65, formationId: 'ambush', holes: [0, 3] },
  { seed: 1011, name: '학익+뒤쪽만', grades: ['A'], levels: [50], gearIlvl: 50, formationId: 'crane', holes: [0, 1, 2] },
  ...(SET_ID ? [{ seed: 1007, name: `세트(${SET_ID})`, grades: ['A'], levels: [60], gearIlvl: 60, setId: SET_ID }] : []),
];

/* 진형을 바꾼 판을 하나 더 (진형 보정이 전력에 들어가므로) */
const FORMS = ['basic'];
try {
  const F = await import('../src/data/formations.js');
  const ids = Object.keys(F.FORMATIONS || {});
  if (ids.length > 1) FORMS.push(ids[1]);
} catch { /* 없으면 basic 만 */ }
if (FORMS.length > 1) {
  RECIPES.push({ seed: 1008, name: `진형(${FORMS[1]})`, grades: ['A'], levels: [55], gearIlvl: 55, formationId: FORMS[1] });
}

/* ───────────────────────── P1 — 클라 경로 ───────────────────────── */

const cases = [];
const p1 = [];
for (const r of RECIPES) {
  const st = build(r);
  const powers = {};
  for (const q of st.squads) powers[q.id] = Squad.squadPower(st, q.id);
  const vals = Object.values(powers);
  p1.push({
    name: r.name,
    sMercs: st.roster.filter((m) => m && m.grade === 'S').length,
    powers,
    topPower: vals.length ? Math.max(...vals) : 0,
  });

  /* 표로 갔다 돌아오는 판을 같이 만든다 */
  let round = null; let roundErr = null;
  try { round = fromRows(JSON.parse(JSON.stringify(toRows(st)))); } catch (e) { roundErr = String((e && e.message) || e); }

  cases.push({ name: r.name, state: JSON.parse(JSON.stringify(st)) });
  cases.push({ name: r.name + '#표왕복', state: round, _err: roundErr });
}

/* ───────────────────────── P2·P3 — Deno ───────────────────────── */

const dir = mkdtempSync(join(tmpdir(), 'powerparity-'));
const inF = join(dir, 'in.json');
const outF = join(dir, 'out.json');
writeFileSync(inF, JSON.stringify({ cases: cases.map(({ name, state }) => ({ name, state })) }), 'utf8');

/** deno 가 이 기계에 있나. `--no-deno` 는 **대체 경로를 시험하려고** 있다 (메타 검사용) */
function hasDeno() {
  if (process.argv.includes('--no-deno')) return false;
  try { execFileSync('deno', ['--version'], { encoding: 'utf8', shell: true, stdio: 'pipe' }); return true; }
  catch { return false; }
}

let denoOut = null;
let runtime = 'deno';

if (hasDeno()) {
  try {
    execFileSync('deno', ['run', '--allow-read', '--allow-write', join(ROOT, 'tools/powerdeno.js'), inF, outF],
      { encoding: 'utf8', shell: true, stdio: 'pipe' });
    denoOut = JSON.parse(readFileSync(outF, 'utf8'));
  } catch (e) {
    const msg = String((e && (e.stderr || e.message)) || e);
    process.stdout.write(`\n❌ Deno 실행 실패\n${msg.slice(0, 1500)}\n`);
    process.exit(1);
  }
} else {
  /* ★★ deno 가 없어도 **그냥 넘어가지 않는다.** 서버 «사본» 은 평범한 ESM 이라
   *   node 로도 부를 수 있다 — 그러면 「사본이 썩었나 · 013 이 뭘 잃나」 는 그대로 잰다.
   *   못 재는 것은 **런타임 차이 하나뿐**이고, 그 사실을 아래에 크게 적는다.
   *   (조용히 건너뛰면 «통과» 로 보인다 — 이 저장소가 제일 싫어하는 것이다.) */
  runtime = 'node(사본)';
  const { squadPower: sp } = await import('../supabase/functions/submit-score/_power/squad.js');
  const out = [];
  for (const c of cases) {
    try {
      const st = c.state;
      const powers = {};
      for (const q of st.squads || []) powers[q.id] = sp(st, q.id);
      const vals = Object.values(powers);
      out.push({
        name: c.name,
        sMercs: (st.roster || []).filter((m) => m && m.grade === 'S').length,
        powers,
        topPower: vals.length ? Math.max(...vals) : 0,
      });
    } catch (e) { out.push({ name: c.name, error: String((e && e.message) || e) }); }
  }
  denoOut = { cases: out };
}

const byName = new Map((denoOut.cases || []).map((c) => [c.name, c]));

/* ───────────────────────── 비교 ───────────────────────── */

const bad = [];
const rows = [];

for (const a of p1) {
  const b = byName.get(a.name);                 // P2 — 서버 사본 · Deno · 원본 state
  const c = byName.get(a.name + '#표왕복');      // P3 — 같은 것 + 표 왕복
  const rowErr = (cases.find((x) => x.name === a.name + '#표왕복') || {})._err;

  const line = { 판: a.name, P1: a.topPower, P2: b && b.topPower, P3: c && c.topPower, S: a.sMercs };
  rows.push(line);

  if (rowErr) { bad.push(`${a.name}: 표 왕복에서 터졌다 — ${rowErr}`); continue; }
  if (!b) { bad.push(`${a.name}: Deno 결과가 없다 (P2)`); continue; }
  if (b.error) { bad.push(`${a.name}: Deno 에서 터졌다 — ${b.error}`); continue; }
  if (!c) { bad.push(`${a.name}: Deno 결과가 없다 (P3)`); continue; }
  if (c.error) { bad.push(`${a.name}#표왕복: Deno 에서 터졌다 — ${c.error}`); continue; }

  /* ★ 0 은 통과가 아니다 — 맨몸 판만 예외로 둔다 (그건 0 이 정답일 수 있다) */
  if (a.topPower <= 0 && a.name !== '맨몸') bad.push(`${a.name}: 클라 전력이 ${a.topPower} 다 — 판이 안 섰다`);

  if (a.topPower !== b.topPower) bad.push(`${a.name}: P1 ${a.topPower} ≠ P2 ${b.topPower}  (런타임·사본 문제)`);
  if (b.topPower !== c.topPower) bad.push(`${a.name}: P2 ${b.topPower} ≠ P3 ${c.topPower}  (013 스키마가 뭔가 잃는다)`);
  if (a.sMercs !== b.sMercs) bad.push(`${a.name}: S용병 P1 ${a.sMercs} ≠ P2 ${b.sMercs}`);
  if (b.sMercs !== c.sMercs) bad.push(`${a.name}: S용병 P2 ${b.sMercs} ≠ P3 ${c.sMercs}`);

  /* 부대별로도 본다 — 최댓값만 맞고 안쪽이 다를 수 있다 */
  for (const sid of Object.keys(a.powers)) {
    if (a.powers[sid] !== (b.powers || {})[sid]) bad.push(`${a.name}/${sid}: P1 ${a.powers[sid]} ≠ P2 ${(b.powers || {})[sid]}`);
    if ((b.powers || {})[sid] !== (c.powers || {})[sid]) bad.push(`${a.name}/${sid}: P2 ${(b.powers || {})[sid]} ≠ P3 ${(c.powers || {})[sid]}`);
  }
}

/* ★ 판이 실한가 — 값이 전부 같으면 «무엇을 바꿔도 같은 답» 인 하네스일 수 있다 */
const distinct = new Set(rows.map((r) => r.P1)).size;
if (distinct < Math.max(3, Math.floor(rows.length / 2))) {
  bad.push(`판이 서로 안 다르다 — 서로 다른 전력이 ${distinct}가지뿐이다 (${rows.length}판). 하네스를 의심해라`);
}

/* ───────────────────────── 출력 ───────────────────────── */

const w = (s, n) => String(s).padEnd(n);
process.stdout.write(`\n${w('판', 18)}${w('P1 클라', 12)}${w(`P2 서버(${runtime})`, 18)}${w('P3 +표왕복', 14)}S\n`);
process.stdout.write('─'.repeat(64) + '\n');
for (const r of rows) {
  const same = r.P1 === r.P2 && r.P2 === r.P3;
  process.stdout.write(`${w(r.판, 18)}${w(r.P1, 12)}${w(r.P2, 16)}${w(r.P3, 14)}${r.S}  ${same ? '✓' : '✗'}\n`);
}

if (!KEEP) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 지워지든 말든 */ } }
else process.stdout.write(`\n중간 파일: ${dir}\n`);

process.stdout.write('\n' + '─'.repeat(64) + '\n');
if (!bad.length) {
  process.stdout.write(`✅ 셋이 같다 — ${rows.length}판 · 서로 다른 전력 ${distinct}가지 · 서버쪽 런타임 ${runtime}\n`);
  if (runtime !== 'deno') {
    process.stdout.write('⚠ deno 가 없어 **서버 런타임 확인은 못 했다** — 사본 썩음·013 손실은 쟀다.\n'
      + '   배포 전에 deno 가 있는 곳에서 한 번 더 돌려라.\n');
  }
  process.exit(0);
}
process.stdout.write(`❌ 어긋난다 — ${bad.length}건\n\n`);
for (const b of bad) process.stdout.write(`  · ${b}\n`);
process.exit(1);
