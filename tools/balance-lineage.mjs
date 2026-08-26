/**
 * 계열 특성 균형 측정기 — «조합 5개에서 한 명씩 빼며 기여도를 잰다»
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   실행: node tools/balance-lineage.mjs [판수=150]
 *
 * 양쪽이 **같은 부대**를 쓰고, B 만 특성 하나를 지운다.
 * A 의 승률에서 그 조합의 **기준선**(아무것도 안 뺀 판)을 뺀 값 = 그 특성의 **한계 기여도**.
 *
 * ★★ 조합 하나로만 재면 못 쓴다 (HANDOFF §88.3). 특성끼리 간섭해서
 *   하나를 바꾸면 나머지 값이 재배치되고, 회차마다 결과가 뒤집힌다
 *   (반격 45→67→51, 요격 45→53→42, 기준선 50→44→42).
 *   그래서 **조합 5개**를 돌리고, 각 조합의 기준선을 빼서 조합 편향을 지운 뒤 평균한다.
 *
 * ★★ 이 도구 계열은 **네 번 가짜 결과**를 냈다 (§84.1 · §86.3). 그래서 게이트가 셋이다:
 *   ① 장비가 실제로 붙었나 (맨몸 대비 배수)
 *   ② 자리가 실제 편성과 같은가 (전열끼리 거리)
 *   ③ 특성 값을 표에서 읽는가 (베껴 적지 않는다)
 *   하나라도 안 맞으면 숫자를 안 내놓고 멈춘다.
 *
 * ★ 기준선이 50 에서 많이 벗어난 조합은 **결과에 표시**한다 — 버리지는 않되 믿음을 낮춘다.
 */
import { createBattle } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { getClass, classChain } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { getFormation } from '../src/data/formations.js';
import { traitOfChain, LINEAGE_TRAIT } from '../src/data/lineage.js';
import { mercStats } from '../src/game/merc.js';
import * as Gear from '../src/game/gear.js';

const rngMax = {
  next: () => 0.999999, float: (a, b) => b, int: (a, b) => b, chance: () => true,
  pick: (a) => a[a.length - 1], pickMany: (a, n) => a.slice(0, n), weighted: (a) => a[a.length - 1],
};
const SLOTS7 = getFormation('basic').slots;

/* 역할별 대표 클래스 — 계열마다 여럿 두고 조합마다 다른 걸 쓴다.
 * ★ 같은 클래스만 쓰면 «특성의 힘» 이 그 클래스에 묶인다. */
const POOL = {
  shieldman: [['bulwark_abyss', 'ironrampart'], ['gatewarden_apex', 'ironrampart'], ['oathshield_apex', 'ironrampart']],
  swordsman: [['swordgod_abyss', 'bloodoath'], ['madgeneral_apex', 'bloodoath'], ['skysplitter_apex', 'bloodoath']],
  spearman: [['dragoonlord_apex', 'ironrampart'], ['blackknight_apex', 'ironrampart']],
  archer: [['masterarcher_apex', 'starseeker'], ['spiritranger_apex', 'starseeker'], ['shadowarcher_apex', 'starseeker']],
  rogue: [['shadowblade_apex', 'bloodoath'], ['reaper_apex', 'bloodoath'], ['banditking_abyss', 'bloodoath']],
  apprentice: [['archmage_apex', 'starseeker'], ['stormcaller_abyss', 'starseeker'], ['plaguelord_abyss', 'starseeker']],
  priest: [['highpriest_abyss', 'constellation'], ['highpriest_apex', 'constellation']],
  monk: [['arhat_abyss', 'constellation'], ['fallenmonk_apex', 'constellation']],
};
const LABEL = {
  shieldman: '수호(방패병)', swordsman: '반격(검사)', spearman: '요격(창병)',
  archer: '견제(궁수)', rogue: '은신(도적)', apprentice: '방벽(마법사)',
  priest: '축복(사제)', monk: '금강(수도승)',
};
/* 부대는 7칸인데 계열은 8개다 — 조합마다 하나씩 빠진다. 그래서 5조합을 돌려 전부 덮는다.
 * 앞→뒤 순서로 적는다 (basic 진형: 앞 3 · 중 2 · 뒤 2). */
const COMPS = [
  { name: 'A 표준',   keys: ['shieldman', 'spearman', 'swordsman', 'rogue', 'archer', 'apprentice', 'priest'], pick: 0 },
  { name: 'B 수도승', keys: ['shieldman', 'spearman', 'swordsman', 'rogue', 'archer', 'apprentice', 'monk'], pick: 1 },
  { name: 'C 무도적', keys: ['shieldman', 'spearman', 'swordsman', 'monk', 'archer', 'apprentice', 'priest'], pick: 2 },
  { name: 'D 무궁수', keys: ['shieldman', 'spearman', 'swordsman', 'rogue', 'monk', 'apprentice', 'priest'], pick: 0 },
  { name: 'E 무창병', keys: ['shieldman', 'swordsman', 'monk', 'rogue', 'archer', 'apprentice', 'priest'], pick: 1 },
];

let uid = 0;
function build(cls, set, side, slotIdx, withTrait) {
  const id = `u${uid++}`;
  const items = {}; const equipment = {};
  for (const slot of (Gear.SLOTS || [])) {
    let it = null;
    try { it = Gear.rollSetItem({ setId: set, slot, ilvl: 80, rng: rngMax }); } catch { it = null; }
    if (!it) { try { it = Gear.rollItem({ ilvl: 80, rarity: 5, slot, rng: rngMax }); } catch { it = null; } }
    if (it) { it.id = `${id}_${slot}`; items[it.id] = it; equipment[slot] = it.id; }
  }
  const m = { uid: id, name: cls, classId: cls, level: 80, grade: 'S', equipment };
  return {
    ...m, side, stats: mercStats(m, items),
    skills: (getClass(cls) || {}).skills || [],
    slot: SLOTS7[slotIdx], slotIndex: slotIdx,
    ...(withTrait ? (traitOfChain(classChain(cls)) || {}) : {}),
  };
}
const pickOf = (key, n) => { const arr = POOL[key]; return arr[n % arr.length]; };
const squadOf = (comp, side, dropKey) => comp.keys.map((key, i) => {
  const [cls, set] = pickOf(key, comp.pick);
  return build(cls, set, side, i, key !== dropKey);
});

/* ── 게이트 ① 장비 ── */
const naked = mercStats({ uid: 'b', classId: 'archmage_apex', level: 80, grade: 'S', equipment: {} }, {});
const probe = build('archmage_apex', 'starseeker', 'ally', 5, false);
const mult = probe.stats.atk / naked.atk;
if (mult < 3) { console.log(`✗ 장비가 안 붙었다 (${mult.toFixed(1)}x) — 멈춘다`); process.exit(1); }

/* ── 게이트 ② 자리 ── */
{
  const b = createBattle({ allies: squadOf(COMPS[0], 'ally', null), enemies: squadOf(COMPS[0], 'enemy', null),
    seed: 1, getSkill, record: false, rout: false });
  const af = b.units.filter((u) => u.side === 'ally').reduce((p, u) => (u.x > p.x ? u : p));
  const ef = b.units.filter((u) => u.side === 'enemy').reduce((p, u) => (u.x < p.x ? u : p));
  const d = Math.abs(ef.x - af.x);
  console.log(`게이트 — 장비 ${mult.toFixed(1)}x · 전열끼리 거리 ${d.toFixed(1)}`);
  if (d > 25) { console.log('✗ 자리가 실제 편성과 다르다 — 멈춘다'); process.exit(1); }
}
/* ── 게이트 ③ 표 참조 ── */
{
  const t = traitOfChain(classChain('masterarcher_apex')) || {};
  if (t.chargeSlow !== LINEAGE_TRAIT.archer.chargeSlow) {
    console.log('✗ 표의 값과 실제 값이 다르다 — 멈춘다'); process.exit(1);
  }
}

const N = Number(process.argv[2] || 150);
const duel = (comp, dropKey) => {
  let aw = 0;
  for (let s = 1; s <= N; s++) {
    const b = createBattle({
      allies: squadOf(comp, 'ally', null), enemies: squadOf(comp, 'enemy', dropKey),
      seed: s * 7919, getSkill, record: false, rout: false,
      allyFormationId: 'basic', enemyFormationId: 'basic',
    });
    let g = 0;
    while (!b.finished && g++ < 20000) b.step(1 / 60);
    if (b.winner === 'ally') aw++;
  }
  return aw / N * 100;
};

console.log(`\n조합 ${COMPS.length}개 · 조건당 ${N}판`);
console.log('한계 기여도 = (그 특성을 뺀 B 를 상대한 A 의 승률) − (그 조합의 기준선)');
console.log('0 = 있으나 없으나 같다\n');

const lifts = {};
const bases = [];
for (const comp of COMPS) {
  const base = duel(comp, null);
  bases.push({ name: comp.name, base });
  const parts = [];
  for (const key of comp.keys) {
    const w = duel(comp, key);
    const lift = w - base;
    (lifts[key] = lifts[key] || []).push(lift);
    parts.push(`${LABEL[key].split('(')[0]} ${lift >= 0 ? '+' : ''}${lift.toFixed(0)}`);
  }
  const warn = Math.abs(base - 50) > 6 ? '  ← 기준선이 치우쳤다' : '';
  console.log(`${comp.name.padEnd(9)} 기준선 ${base.toFixed(0)}%${warn}`);
  console.log(`          ${parts.join(' · ')}`);
}

console.log('\n────────────── 조합 평균 ──────────────');
console.log('특성            | 평균 기여도 | 조합수 | 최소~최대');
const rows = Object.entries(lifts).map(([k, arr]) => {
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  return [k, avg, arr.length, Math.min(...arr), Math.max(...arr)];
}).sort((a, b) => b[1] - a[1]);
for (const [k, avg, n, lo, hi] of rows) {
  console.log(`${LABEL[k].padEnd(16)}|${((avg >= 0 ? '+' : '') + avg.toFixed(1) + '%p').padStart(12)} |${String(n).padStart(7)} | ${lo.toFixed(0)} ~ ${hi.toFixed(0)}`);
}
const avgBase = bases.reduce((a, b) => a + b.base, 0) / bases.length;
console.log(`\n기준선 평균 ${avgBase.toFixed(1)}% (50 에 가까울수록 판이 공정하다)`);
const spread = rows.length ? rows[0][1] - rows[rows.length - 1][1] : 0;
console.log(`기여도 폭 ${spread.toFixed(1)}%p (작을수록 계열이 고르다)`);
