/**
 * 난이도 색이 실제 승률을 맞히는가
 * ────────────────────────────────────────────────────────────────
 * 의뢰 카드의 색(식은 죽 먹기 / 여유 / 적정 / 위험 / 무모)은
 * **전투력 비율** 하나로 정해진다 (`ui/quests.js dangerLevelByPower`).
 *
 * ★ 그런데 등급 격차는 전투력 비율보다 훨씬 가파르다 —
 *   `tools/gradegap.mjs` 실측에서 전투력 1.12배(한 등급) 차이가 **승률 0%** 로 나왔다.
 *   그렇다면 "여유"(비율 1.22~1.60)라고 뜨는 판이 실제로는 확실한 패배일 수 있다.
 *   색이 그 낭떠러지를 전달하는지 재는 것이 이 도구의 목적이다.
 *
 * 실행: node tools/dangercheck.mjs [--n=20]
 */
import * as State from '../src/game/state.js';
import * as Merc from '../src/game/merc.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import * as Abyss from '../src/game/abyss.js';
import { questBattleDefs } from '../src/game/quest.js';

setSkillResolver(getSkill);

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const N = parseInt(arg('n', '20'), 10);

/* ★ ui/quests.js 의 경계값을 그대로 옮겨 적었다. 저기를 고치면 여기도 고쳐야 한다 —
 *   두 벌이 어긋나면 이 도구가 거짓말을 하게 된다. */
const BANDS = [
  { min: 1.60, label: '식은 죽 먹기' },
  { min: 1.22, label: '여유' },
  { min: 0.92, label: '적정' },
  { min: 0.70, label: '위험' },
  { min: 0, label: '무모' },
];
const bandOf = (r) => (BANDS.find((b) => r >= b.min) || BANDS[BANDS.length - 1]).label;

const SQUAD = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];

function setup(grade, level, seed) {
  State.newGame(seed, `${grade}${level}`);
  const st = State.state;
  st.roster = [];
  st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  SQUAD.forEach((classId, i) => {
    const m = {
      uid: `d_${i}`, name: getClass(classId).name, classId, level, grade,
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0,
    };
    st.roster.push(m);
    sq.memberUids[i] = m.uid;
  });
  for (const m of st.roster) m.hp = 0;
  return st;
}

const powerOf = (st) => {
  const idx = State.itemsById(st.items);
  return st.roster.reduce((a, m) => a + Merc.mercPower(m, { items: idx }), 0);
};

/**
 * 부대 하나를 만들고 **즉시** UnitDef 로 뽑아 둔다.
 *
 * ★ `State.state` 는 **싱글턴**이다. `setup()` 을 두 번 부르고 나서 두 결과를 쓰면
 *   둘 다 마지막 것을 가리킨다 — 이 프로젝트에서 이미 한 번 밟은 함정이고
 *   이 도구를 처음 쓸 때 또 밟았다(A vs A 가 80% 로 나왔다).
 *   만든 직후에 값으로 꺼내 두는 것만이 안전하다.
 */
function unitsOf(grade, level, seed) {
  const st = setup(grade, level, seed);
  const sqId = st.squads[0].id;
  const allies = questBattleDefs(Abyss.abyssQuest(st, 1, sqId), 0, st, sqId).allies;
  return { allies: allies.map((u) => ({ ...u })), power: powerOf(st) };
}

/** A 부대 vs B 부대 승률 */
function duel(A, B, n) {
  let win = 0;
  for (let i = 0; i < n; i++) {
    const b = createBattle({
      allies: A.map((u) => ({ ...u })),
      enemies: B.map((u, k) => ({ ...u, uid: `e_${k}`, side: 'enemy', slotIndex: k })),
      allyFormationId: 'basic', enemyFormationId: 'basic',
      seed: (9001 + i * 7919) >>> 0,
    });
    let t = 0;
    while (!b.finished && t < 90) { b.step(1 / 60); t += 1 / 60; }
    if (b.result.winner === 'ally') win++;
  }
  return win / n;
}

console.log(`난이도 색이 실제 승률을 맞히는가 — 각 ${N}판`);
console.log('='.repeat(78));
console.log('\n색 기준 (ui/quests.js): 전투력 비율만 본다');
for (const b of BANDS) console.log(`  ${String(b.min).padStart(4)} 이상 → ${b.label}`);

/* ── 1. 등급 차이로 만든 판 — 색이 뭐라고 하고 실제는 어떤가 ── */
console.log('\n── 1. 등급만 다른 상대 (양쪽 Lv80)');
console.log('  아군    적    전투력비  색           실제승률   판정');
const GR = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
const rowsG = [];
const ME = unitsOf('A', 80, 1000);          // ★ 한 번만 만들어 값으로 들고 있는다
for (const foe of GR) {
  const EN = unitsOf(foe, 80, 2000);
  const ratio = ME.power / EN.power;
  const band = bandOf(ratio);
  const wr = duel(ME.allies, EN.allies, N);
  // 색이 약속하는 승률 대역 (사람이 보통 그렇게 읽는다)
  const promise = { '식은 죽 먹기': '거의 확실', 여유: '유리', 적정: '반반', 위험: '불리', 무모: '거의 진다' }[band];
  const bad = (band === '식은 죽 먹기' && wr < 0.9) || (band === '여유' && wr < 0.6)
    || (band === '적정' && (wr < 0.25 || wr > 0.75)) || (band === '위험' && wr > 0.5)
    || (band === '무모' && wr > 0.2);
  rowsG.push({ foe, ratio, band, wr, bad });
  console.log(`   A     ${foe}    ${ratio.toFixed(2)}배  ${band.padEnd(11)} ${(wr * 100).toFixed(0).padStart(4)}%     ${bad ? '✗ 어긋남' : '✓'}   (${promise})`);
}

/* ── 2. 같은 전투력 비율인데 원인이 다르면? ──
 * 인원수로 만든 1.2배와 등급으로 만든 1.2배가 같은 결과를 내는지 본다.
 * 색은 둘을 구분하지 못한다 — 비율만 보기 때문이다. */
console.log('\n── 2. 같은 비율, 다른 원인 (색은 둘을 구분 못 한다)');
{
  const cases = [];
  const b80 = unitsOf('B', 80, 1000);
  const c80 = unitsOf('C', 80, 2000);
  const b68 = unitsOf('B', 68, 3000);
  cases.push({ tag: '등급 B vs C', ratio: b80.power / c80.power, wr: duel(b80.allies, c80.allies, N) });
  cases.push({ tag: '레벨 80 vs 68', ratio: b80.power / b68.power, wr: duel(b80.allies, b68.allies, N) });

  console.log('  구성              전투력비  색          실제승률');
  for (const c of cases) {
    console.log(`  ${c.tag.padEnd(16)}  ${c.ratio.toFixed(2)}배  ${bandOf(c.ratio).padEnd(10)} ${(c.wr * 100).toFixed(0).padStart(4)}%`);
  }
}

/* ── 3. 전환점은 어디인가 (적 레벨을 조금씩 올려 가며) ──
 * ★ 구간 경계를 다시 잡으려면 "승률 50% 가 되는 전투력 비율"과
 *   "그 전환이 얼마나 좁은 구간에서 일어나는가"를 알아야 한다. */
console.log('\n── 3. 승률 전환점 (아군 B Lv80 고정, 적을 조금씩 강하게)');
console.log('  적Lv  전투력비   색          승률');
const sweep = [];
{
  const me = unitsOf('B', 80, 1000);
  for (let lv = 60; lv <= 96; lv += 4) {
    const en = unitsOf('B', Math.min(80, lv), 4000 + lv);
    /* 레벨 상한이 80 이라 그 위는 못 만든다 — 대신 적 등급을 올려 비율을 낮춘다 */
    const use = lv <= 80 ? en : unitsOf(lv <= 88 ? 'A' : 'S', 80, 4000 + lv);
    const ratio = me.power / use.power;
    const wr = duel(me.allies, use.allies, N);
    sweep.push({ lv, ratio, wr });
    const bar = '█'.repeat(Math.round(wr * 16)).padEnd(16, '·');
    console.log(`  ${String(lv <= 80 ? lv : `80+${lv - 80}등급`).padStart(6)}  ${ratio.toFixed(2)}배  ${bandOf(ratio).padEnd(10)} ${bar} ${(wr * 100).toFixed(0).padStart(4)}%`);
  }
  // 50% 를 지나는 구간을 찾는다
  let lo = null;
  let hi = null;
  for (const s2 of sweep) {
    if (s2.wr >= 0.5) lo = s2;          // 마지막으로 이기던 지점
    if (s2.wr < 0.5 && !hi) hi = s2;    // 처음으로 지는 지점
  }
  if (lo && hi) {
    console.log(`
  승률 50% 는 전투력비 **${Math.min(lo.ratio, hi.ratio).toFixed(2)} ~ ${Math.max(lo.ratio, hi.ratio).toFixed(2)}** 사이에 있다`);
    console.log(`  → 그 폭이 ${Math.abs(lo.ratio - hi.ratio).toFixed(2)} 밖에 안 된다. '적정'(0.92~1.22) 은 폭 0.30 이라 **10배 넓다.**`);
  }
}

/* ── 결론 ── */
console.log('\n' + '─'.repeat(78));
const wrong = rowsG.filter((r) => r.bad);
if (!wrong.length) {
  console.log('✅ 색이 실제 승률과 어긋나는 구간이 없다.');
} else {
  console.log(`⚠ 색이 실제와 어긋나는 구간 ${wrong.length}개:`);
  for (const r of wrong) {
    console.log(`   적 ${r.foe}등급 — 화면은 "${r.band}"(비율 ${r.ratio.toFixed(2)}) 인데 실제 승률 ${(r.wr * 100).toFixed(0)}%`);
  }
  console.log('\n   원인: 색은 **전투력 비율 하나**로 정하는데, 등급 격차는 그 비율보다 훨씬 가파르다.');
  console.log('   같은 1.2배라도 등급에서 온 것과 레벨에서 온 것의 결과가 다르다 (§2 참고).');
}
