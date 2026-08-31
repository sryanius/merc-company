/**
 * 「서버가 만든 의뢰 목록 == 게임이 만든 의뢰 목록」 을 **잰다** (§104 17단계 2번 조각)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 이게 먼저인가
 *   2번 조각은 「서버가 `genQuests` 를 다시 돌려 보상 G 가 정직한지 본다」 다.
 *   그런데 서버가 만든 목록이 게임이 만든 것과 **다르면**, 정직한 보상이 전부
 *   «없는 의뢰» 나 «G 가 다르다» 로 찍힌다 — 그 상태로 판정을 켜면 정상 플레이어가
 *   통째로 거절된다 (§94 가 「가장 나쁜 사고」 로 못 박은 것).
 *
 * ★★ 세 경로를 잰다. 셋이 **정확히** 같아야 한다.
 *
 *     Q1  게임 경로   — `src/game/state.js refreshCity` 가 실제로 만드는 목록,  node
 *     Q2  클라 사본   — `src/game/questgen.js` 를 직접 부른 것,  node
 *     Q3  서버 사본   — `supabase/functions/run-op/_rules/questgen.js`,  **Deno**
 *
 *   Q1≠Q2 면 «껍데기가 시드나 부대 수를 다르게 넘긴다» 는 뜻이다 (§138 의 갈림길).
 *   Q2≠Q3 면 «런타임·평탄화» 가 범인이다 (Deno 에서 안 되는 것을 썼거나 사본이 썩었다).
 *
 * ★★ **빈 목록을 통과로 세지 않는다.** 0 대 0 비교는 아무것도 증명 못 한다.
 *   목록이 비었거나 전부 같은 길이면 그 자체로 실패다.
 *
 * ★★★ 그리고 **부대 수를 안 넘기면 갈린다** 는 것을 여기서 못 박는다.
 *   서버엔 전역 상태가 없어서 생략하면 1부대로 보고 6~7건만 만든다 —
 *   그러면 7번 이후 의뢰가 전부 «없는 의뢰» 가 된다. 그게 실제로 갈리는지 잰다.
 *
 * 실행: node tools/questparity.mjs
 *       node tools/questparity.mjs --keep   (중간 JSON 을 지우지 않는다)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KEEP = process.argv.includes('--keep');

const State = await import('../src/game/state.js');
const Gen = await import('../src/game/questgen.js');
const { hashStr } = await import('../src/game/enemygen.js');
const { RNG } = await import('../src/core/rng.js');

let fails = 0;
const fail = (s) => { fails++; console.log(`  ✗ ${s}`); };
const pass = (s) => console.log(`  ✓ ${s}`);

/* ───────────────────────── 판을 짓는다 ───────────────────────── */

/** 비교에 쓸 축만 뽑는다 (의뢰 전체를 비교하면 JSON 이 수십 MB 다) */
const axes = (list) => ({
  n: list.length,
  ids: list.map((q) => q.id),
  golds: list.map((q) => Math.round(Number(q.reward?.gold) || 0)),
  exps: list.map((q) => Math.round(Number(q.reward?.exp) || 0)),
  renowns: list.map((q) => Math.round(Number(q.reward?.renown) || 0)),
  rolls: list.map((q) => (Array.isArray(q.reward?.itemRolls) ? q.reward.itemRolls.length : -1)),
  ranks: list.map((q) => String(q.rankLabel || '')),
  levels: list.map((q) => Math.round(Number(q.level) || 0)),
  waveNs: list.map((q) => (Array.isArray(q.waves) ? q.waves.length : -1)),
  names: list.map((q) => String(q.name || '')),
});

/**
 * 「게임이 실제로 만드는 목록」 — 손으로 짓지 않는다.
 *
 * ★★ `refreshCity` 를 **그대로 부른다.** 시드 식을 여기 다시 쓰면 그게 곧 넷째 사본이고,
 *   그러면 이 도구는 「내가 쓴 식이 내가 쓴 식과 같다」 만 확인하게 된다.
 */
function viaGame({ seed, cityId, day, squads }) {
  State.newGame(seed, '검사단');
  const st = State.state;
  st.day = day;
  st.cityId = cityId;
  /* 부대를 원하는 수만큼 맞춘다 — 목록 길이가 여기에 달렸다 */
  while (st.squads.length < squads) {
    st.squads.push({ ...st.squads[0], id: `sq_${st.squads.length}`, memberUids: [], petUids: [] });
  }
  st.squads.length = squads;
  st.quests = {};
  State.refreshCity(cityId, true);
  return (st.quests[cityId] || {}).list || [];
}

const CASES = [];
for (const cityId of ['greenhold', 'frostgate', 'kingsrest']) {
  for (const day of [1, 4, 37, 300, 901]) {
    for (const squads of [1, 3, 5]) {
      CASES.push({ name: `${cityId}#${day}#${squads}`, cityId, day, squads, seed: 1234567 ^ (day * 7919) });
    }
  }
}

console.log(`의뢰 목록 재현 대조 — ${CASES.length}판`);
console.log('='.repeat(72));

/* ── Q1 게임 경로 · Q2 클라 사본 ─────────────────────────────────── */
const q1 = new Map();
const q2 = new Map();
for (const c of CASES) {
  q1.set(c.name, axes(viaGame(c)));
  const r = new RNG((hashStr(`qs#${c.cityId}#${c.day}`) ^ ((c.seed || 0) >>> 0)) >>> 0);
  q2.set(c.name, axes(Gen.genQuests(c.cityId, c.day, r, Gen.resolveSquadCount(c.squads))));
}

/* ★ 판이 실한가 — 비었거나 전부 같으면 아무것도 증명 못 한다 */
const lens = CASES.map((c) => q1.get(c.name).n);
const total = lens.reduce((a, b) => a + b, 0);
if (total < 200) fail(`판이 빈약하다 — 의뢰 ${total}건 (200건 이상이어야 한다)`);
else pass(`판이 실하다 — 의뢰 ${total}건 (${Math.min(...lens)}~${Math.max(...lens)}건/판)`);
if (new Set(lens).size < 2) fail('목록 길이가 전부 같다 — 부대 수가 실제로 먹는지 확인 못 한다');
else pass(`목록 길이가 부대 수를 따라 갈린다 (${[...new Set(lens)].sort((a, b) => a - b).join('·')})`);

/* ── Q3 서버 사본 (Deno) ────────────────────────────────────────── */
const dir = mkdtempSync(join(tmpdir(), 'questparity-'));
const inF = join(dir, 'in.json');
const outF = join(dir, 'out.json');
writeFileSync(inF, JSON.stringify({
  cases: CASES.map((c) => ({ name: c.name, cityId: c.cityId, day: c.day, seed: c.seed, squadCount: c.squads })),
}), 'utf8');

let q3 = new Map();
try {
  execFileSync('deno', ['run', '--allow-read', '--allow-write', join(ROOT, 'tools/questdeno.js'), inF, outF],
    { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(readFileSync(outF, 'utf8'));
  for (const c of parsed.cases || []) q3.set(c.name, c);
  pass(`서버 사본이 Deno 에서 돈다 (${q3.size}판)`);
} catch (e) {
  fail(`서버 사본을 Deno 로 못 돌렸다 — ${String(e.stderr || e.message || e).split('\n').slice(0, 4).join(' / ')}`);
  q3 = new Map();
}
if (!KEEP) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 지우기 실패는 무시 */ } }

/* ── 대조 ───────────────────────────────────────────────────────── */
const AXES = ['n', 'ids', 'golds', 'exps', 'renowns', 'rolls', 'ranks', 'levels', 'waveNs', 'names'];
const cmp = (a, b) => AXES.filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]));

const d12 = [];
const d23 = [];
for (const c of CASES) {
  const a = q1.get(c.name);
  const b = q2.get(c.name);
  const d = q3.get(c.name);
  const x = cmp(a, b);
  if (x.length) d12.push(`${c.name}: ${x.join('·')}`);
  if (q3.size) {
    if (d?.error) d23.push(`${c.name}: 서버가 던졌다 — ${d.error}`);
    else { const y = cmp(b, d); if (y.length) d23.push(`${c.name}: ${y.join('·')}`); }
  }
}
if (d12.length) fail(`Q1≠Q2 — 게임 경로와 클라 사본이 다르다 (${d12.length}판): ${d12.slice(0, 3).join(' | ')}`);
else pass(`Q1 == Q2 — 게임이 만드는 목록과 questgen 직접 호출이 같다 (${CASES.length}판)`);
if (q3.size) {
  if (d23.length) fail(`Q2≠Q3 — 서버 사본이 다르다 (${d23.length}판): ${d23.slice(0, 3).join(' | ')}`);
  else pass(`Q2 == Q3 — **Deno 의 서버 사본이 같은 목록을 만든다** (${CASES.length}판)`);
}

/* ── ★★★ 부대 수를 안 넘기면 갈리나 (서버가 반드시 명시해야 하는 이유) ── */
{
  const c = CASES.find((x) => x.squads === 5);
  const r1 = new RNG((hashStr(`qs#${c.cityId}#${c.day}`) ^ (c.seed >>> 0)) >>> 0);
  const r2 = new RNG((hashStr(`qs#${c.cityId}#${c.day}`) ^ (c.seed >>> 0)) >>> 0);
  const withN = Gen.genQuests(c.cityId, c.day, r1, Gen.resolveSquadCount(5));
  const without = Gen.genQuests(c.cityId, c.day, r2);            // 부대 수 생략 = 서버의 실수
  if (without.length >= withN.length) {
    fail(`부대 수를 생략해도 목록이 안 짧아진다 (${without.length} vs ${withN.length}) — 이 위험이 사라졌거나 검사가 틀렸다`);
  } else {
    const lost = withN.slice(without.length).length;
    pass(`부대 수를 생략하면 목록이 ${withN.length} → ${without.length}건으로 줄어 `
      + `의뢰 ${lost}건이 «없는 의뢰» 가 된다 — 서버는 반드시 명시해야 한다`);
  }
}

console.log('='.repeat(72));
console.log(fails ? `❌ ${fails}건 실패` : '✅ 세 경로가 같은 의뢰 목록을 만든다');
process.exit(fails ? 1 : 0);
