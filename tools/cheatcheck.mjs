/**
 * 랭킹 검증 규칙 계측기
 * ────────────────────────────────────────────────────────────────
 * `src/game/rules.js` 가 (a) 정상 플레이를 안 막고 (b) 조작을 잡는지 잰다.
 *
 * ★ 순서가 중요하다 — **오탐 검사를 먼저** 돌린다.
 *   오탐으로 정상 플레이어의 랭킹을 지우는 게 치트보다 큰 사고다.
 *   조작을 몇 개 놓치는 건 감수할 수 있지만, 멀쩡한 사람을 걸면 안 된다.
 *
 * 실행: node tools/cheatcheck.mjs
 */
import * as Rules from '../src/game/rules.js';
import { DAYS_PER_WEEK, DAYS_PER_MONTH } from '../src/game/state.js';
import { goldRange } from '../src/data/abyss.js';

let fails = 0;
const pass = (s) => console.log(`   ✓ ${s}`);
const fail = (s, d) => { fails++; console.log(`   ✗ ${s}\n       ${d}`); };

/** 평범한 세이브 하나 */
const base = (o = {}) => ({
  seed: 12345, companyName: '검사단', day: 100,
  abyssBest: 40, abyssBestDay: 92, abyssLastRunDay: 92,
  towerBest: 150, towerBestDay: 85, towerLastRunDay: 85,
  questsDone: 120, battlesWon: 300, battlesLost: 40,
  gold: 50_000, renown: 2_000, cityId: 'greenhold',
  rosterN: 30, rosterCap: 40, topLevel: 62, squadsN: 4, petsN: 6, itemsN: 200,
  ...o,
});

const judge = (prev, s) => Rules.judge(prev, s);

/* ★ 실제 게임에서 `dive()` 는 best 와 lastRunDay 를 **같이** 갱신한다.
 *   테스트 데이터가 그 관계를 안 지키면 규칙이 옳아도 실패한다 (실제로 그랬다).
 *   "잠수했다"를 한 함수로 표현해서 관계가 저절로 지켜지게 한다. */
const dove = (day, depth, o = {}) => base({
  day, abyssBest: depth, abyssBestDay: day, abyssLastRunDay: day, ...o,
});
const climbed = (day, floor, o = {}) => base({
  day, towerBest: floor, towerBestDay: day, towerLastRunDay: day, ...o,
});

console.log('랭킹 검증 규칙 — src/game/rules.js');
console.log('='.repeat(74));

/* ─────────── 1. 오탐 (여기가 제일 중요하다) ─────────── */
console.log('\n── 1. 정상 플레이를 막지 않는가 (오탐)');
{
  const prev = base();
  const ok = [
    ['첫 제출 (비교 대상 없음)', null, base()],
    ['아무것도 안 변함', prev, base()],
    ['하루 지나 의뢰 5건', prev, base({ day: 101, questsDone: 125, battlesWon: 310, gold: 80_000, renown: 2_100 })],
    ['일주일 뒤 나락 갱신', prev, dove(107, 55, { gold: 130_000 })],
    ['한 달 뒤 탑 갱신', prev, climbed(128, 200, { gold: 20_000 })],
    ['오래 쉬다 복귀 (100일 뒤)', prev, dove(200, 70, { questsDone: 400, battlesWon: 900, gold: 900_000, renown: 12_000 })],
    ['골드를 다 썼다 (감소)', prev, base({ day: 105, gold: 1_000 })],
    ['단원을 정리했다 (감소)', prev, base({ day: 101, rosterN: 12 })],
    ['만렙 · 정원 70 후반부', prev, base({
      day: 300, topLevel: 80, rosterN: 70, rosterCap: 70,
      abyssBest: 80, abyssBestDay: 295, abyssLastRunDay: 295,
      towerBest: 470, towerBestDay: 290, towerLastRunDay: 290,
      questsDone: 800, battlesWon: 2000, gold: 2_000_000, renown: 40_000,
    })],
    ['나락 만렙 부대 한 주 수입', prev, dove(107, 80, { gold: 50_000 + goldRange(80) })],
    ['같은 날 두 번 제출 (그 사이 잠수 한 번)', prev, dove(100, 90, { abyssLastRunDay: 99, abyssBestDay: 99 })],
  ];
  for (const [name, p, s] of ok) {
    const r = judge(p, s);
    if (r.verdict === 'ok') pass(name);
    else fail(`${name} — 정상인데 막혔다`, `${r.tier}: ${r.reasons.join(' / ')}`);
  }
}

/* ─────────── 2. 조작을 잡는가 ─────────── */
console.log('\n── 2. 조작을 잡는가');
{
  const prev = base();
  const caught = [
    ['나락 상한 초과', prev, base({ abyssBest: 9999 }), 'A'],
    ['탑 상한 초과', prev, base({ towerBest: 9999 }), 'A'],
    ['레벨 상한 초과', prev, base({ topLevel: 999 }), 'A'],
    ['기록이 줄었다 (되감기)', prev, base({ abyssBest: 10 }), 'A'],
    ['일차가 뒤로 갔다', prev, base({ day: 50 }), 'A'],
    // ★ "같은 날 갱신"은 사실 정상이다 — 제출 뒤에 잠수하면 그럴 수 있다.
    //   진짜로 불가능한 건 "같은 주에 두 번 잠수" 다. lastRunDay 로 그걸 본다.
    ['같은 주에 나락을 두 번 (40 → 200)', prev, base({ day: 100, abyssBest: 200, abyssBestDay: 92, abyssLastRunDay: 92 }), 'A'],
    ['같은 달에 탑을 두 번', prev, base({ day: 100, towerBest: 400, towerBestDay: 85, towerLastRunDay: 85 }), 'A'],
    ['이긴 판보다 끝낸 의뢰가 많다', prev, base({ questsDone: 999, battlesWon: 300 }), 'A'],
    ['기록일이 미래', prev, base({ abyssBest: 60, abyssBestDay: 500 }), 'A'],
    ['부대 9개', prev, base({ squadsN: 9 }), 'A'],
    ['하루 만에 골드 1억', prev, base({ day: 101, gold: 100_000_000 }), 'B'],
    ['하루 만에 의뢰 500건', prev, base({ day: 101, questsDone: 620, battlesWon: 1200 }), 'B'],
    ['명성만 폭증', prev, base({ day: 101, renown: 999_999 }), 'B'],
  ];
  for (const [name, p, s, want] of caught) {
    const r = judge(p, s);
    if (r.verdict === 'ok') fail(`${name} — 통과해버렸다`, '규칙에 구멍이 있다');
    else if (r.tier !== want) fail(`${name} — 등급이 다르다`, `기대 ${want} / 실제 ${r.tier}: ${r.reasons.join(' / ')}`);
    else pass(`${name} → ${r.tier}등급`);
  }
}

/* ─────────── 3. 입장 제한이 실제로 무기가 되는가 ─────────── */
console.log('\n── 3. 입장 제한 (이 검증의 가장 강한 근거)');
{
  const prev = base({ day: 100, abyssBest: 40, towerBest: 150 });
  const cases = [
    [`나락: ${DAYS_PER_WEEK}일 뒤 갱신은 정상`, dove(107, 60), 'ok'],
    ['나락: 같은 주 재잠수는 불가능', base({ day: 100, abyssBest: 60, abyssBestDay: 92, abyssLastRunDay: 92 }), 'reject'],
    ['나락: 같은 날이라도 새 주에 잠수했으면 정상', dove(100, 60, { abyssLastRunDay: 99, abyssBestDay: 99 }), 'ok'],
    [`탑: ${DAYS_PER_MONTH}일 뒤 갱신은 정상`, climbed(128, 300), 'ok'],
    ['탑: 기록만 오르고 등반 기록이 그대로', base({ day: 130, towerBest: 300, towerBestDay: 129, towerLastRunDay: 85 }), 'reject'],
  ];
  for (const [name, s, want] of cases) {
    const r = judge(prev, s);
    const got = r.verdict === 'flag' ? 'ok' : r.verdict;   // B등급은 여기 관심사가 아니다
    if (got === want) pass(name);
    else fail(name, `기대 ${want} / 실제 ${r.verdict} ${r.tier}: ${r.reasons.join(' / ')}`);
  }
}

/* ─────────── 4. 깨진 입력에 안 터지는가 ─────────── */
console.log('\n── 4. 깨진 입력');
{
  const bad = [null, undefined, {}, { seed: 'x' }, { day: NaN }, [], 'string', 0];
  let threw = 0;
  for (const b of bad) {
    try { judge(null, Rules.extractScore(b)); judge(base(), Rules.extractScore(b)); }
    catch (e) { threw++; console.log(`       터짐: ${JSON.stringify(b)} — ${e.message}`); }
  }
  if (threw) fail('깨진 입력에 예외', `${threw}건`);
  else pass(`깨진 입력 ${bad.length}종에 예외 없음`);
}

/* ─────────── 5. extractScore 가 실제 세이브에서 값을 뽑는가 ─────────── */
console.log('\n── 5. 실제 세이브에서 값 추출');
{
  const State = await import('../src/game/state.js');
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  State.newGame(4242, '추출검사');
  State.state.day = 88;
  State.state.abyss = { best: 55, bestDay: 80, lastRunDay: 80, lastRunDepth: 55, lastGold: 0 };
  State.state.tower = { best: 210, bestDay: 57, lastRunDay: 57, lastRunFloor: 210 };
  const s = Rules.extractScore(State.state);
  const bad = [];
  if (s.abyssBest !== 55) bad.push(`abyssBest=${s.abyssBest}`);
  if (s.abyssBestDay !== 80) bad.push(`abyssBestDay=${s.abyssBestDay}`);
  if (s.towerBest !== 210) bad.push(`towerBest=${s.towerBest}`);
  if (s.day !== 88) bad.push(`day=${s.day}`);
  if (!s.companyName) bad.push('companyName 없음');
  if (s.seed !== 4242) bad.push(`seed=${s.seed}`);
  if (bad.length) fail('추출값이 다르다', bad.join(' / '));
  else pass(`추출 정상 (${s.companyName} · ${s.day}일차 · 나락 ${s.abyssBest} · 탑 ${s.towerBest})`);
  delete globalThis.localStorage;
}

/* ─────────── 6. 진짜 플레이로 만든 세이브가 통과하는가 ───────────
 * ★ 손으로 쓴 픽스처로 통과해도 "내 머릿속 모델이 자기 자신과 일치한다"는 것밖에
 *   증명 못 한다. 실제 `dive()` 를 돌려 나온 세이브로 재는 게 유일하게 의미 있는 검사다.
 *   (이 절을 넣기 전 픽스처들은 lastRunDay 를 안 옮겨서 규칙이 옳은데도 실패했다.) */
console.log('\n── 6. 실제 잠수로 만든 세이브');
{
  const State = await import('../src/game/state.js');
  const Abyss = await import('../src/game/abyss.js');
  const Merc = await import('../src/game/merc.js');
  const { RNG } = await import('../src/core/rng.js');
  const { setSkillResolver } = await import('../src/battle/engine.js');
  const { getSkill } = await import('../src/data/skills.js');
  setSkillResolver(getSkill);
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

  State.newGame(9090, '실전검사');
  const st = State.state;
  const rng = new RNG(31);
  while (st.roster.length < 7) st.roster.push(Merc.createMerc({ level: 55, grade: 'B', rng }));
  for (const m of st.roster) { m.level = 55; m.hp = 0; }
  st.squads[0].memberUids = st.roster.slice(0, 7).map((m) => m.uid);

  const bad = [];
  let prev = null;
  for (let w = 0; w < 6; w++) {
    st.day = 1 + w * 7;                       // 주마다 한 번 — 게임이 강제하는 그대로
    const r = Abyss.dive(st, st.squads[0].id, {});
    if (!r.ok) { bad.push(`${w + 1}주차 잠수 실패: ${r.reason}`); continue; }
    const cur = Rules.extractScore(st);
    const v = judge(prev, cur);
    if (v.verdict !== 'ok') {
      bad.push(`${w + 1}주차(${st.day}일 · ${cur.abyssBest}심층) ${v.tier}: ${v.reasons.join(' / ')}`);
    }
    prev = cur;
  }
  if (bad.length) fail('실제 플레이가 막혔다', bad.join('\n       '));
  else pass(`6주 연속 잠수 전부 통과 (최종 ${prev.abyssBest}심층 · ${prev.gold.toLocaleString()}G)`);

  const cheat = { ...prev, abyssBest: prev.abyssBest + 100 };
  const cv = judge(prev, cheat);
  if (cv.verdict === 'ok') fail('같은 주 재잠수 조작이 통과했다', '규칙에 구멍');
  else pass(`같은 주 재잠수 조작 → ${cv.tier}등급`);

  delete globalThis.localStorage;
}

console.log('\n' + '─'.repeat(74));
if (fails) { console.log(`❌ 실패 ${fails}건`); process.exit(1); }
console.log('✅ 전부 통과 — 정상 플레이를 안 막고 조작을 잡는다');
