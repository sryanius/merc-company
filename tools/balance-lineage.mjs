/**
 * 계열 특성 균형 측정기 — «한 명씩 빼며 기여도를 재다»
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   실행: node tools/balance-lineage.mjs [판수=60]
 *
 * 양쪽이 **같은 섞인 부대**(계열 하나씩 7명)를 쓰고, B 만 특성 하나를 지운다.
 * A 의 승률이 50% 를 얼마나 넘느냐 = 그 특성의 **한계 기여도**.
 * 조합·클래스·장비가 완전히 같으므로 특성만 남는다.
 *
 * ★★ 이 도구 이전에 **세 번 가짜 결과**를 냈다 (HANDOFF §86.3). 그래서 게이트가 셋이다:
 *   ① 장비가 실제로 붙었나 (맨몸 대비 배수)
 *   ② 자리가 실제 편성과 같은가 (전열끼리 거리)
 *   ③ 특성 값을 표에서 읽는가 (베껴 적지 않는다)
 *   하나라도 안 맞으면 숫자를 내놓지 않고 멈춘다.
 *
 * ★ 무언가 바꾸면 **반드시 «아무것도 안 뻐» 이 50% 근처인지** 먼저 본다.
 *   거기가 틀어지면 아래 줄은 전부 못 믿는다.
 */
import { createBattle } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import { getClass, classChain } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { getFormation } from '../src/data/formations.js';
import { traitOfChain, LINEAGE_TRAIT, BRANCH_TRAIT } from '../src/data/lineage.js';
import { mercStats } from '../src/game/merc.js';
import * as Gear from '../src/game/gear.js';

const rngMax = {
  next: () => 0.999999, float: (a, b) => b, int: (a, b) => b, chance: () => true,
  pick: (a) => a[a.length - 1], pickMany: (a, n) => a.slice(0, n), weighted: (a) => a[a.length - 1],
};
const SLOTS7 = getFormation('basic').slots;

/* 계열 하나씩 — 4차 대표 + 그 역할에 맞는 세트 */
const SQUAD = [
  { cls: 'bulwark_abyss', set: 'ironrampart', key: 'shieldman' },     // 방패병 — 수호
  { cls: 'swordgod_abyss', set: 'bloodoath', key: 'swordsman' },      // 검사   — 반격
  { cls: 'dragoonlord_apex', set: 'ironrampart', key: 'spearman' },   // 창병   — 요격
  { cls: 'masterarcher_apex', set: 'starseeker', key: 'archer' },     // 궁수   — 견제
  { cls: 'shadowblade_apex', set: 'bloodoath', key: 'rogue' },        // 도적   — 은신
  { cls: 'archmage_apex', set: 'starseeker', key: 'apprentice' },     // 마법사 — 방벽
  { cls: 'highpriest_abyss', set: 'constellation', key: 'priest' },   // 사제   — 축복
];
/* 수도승은 부대에 여덟째로 못 넣으니 사제 자리를 바꿔 따로 잰다 */
const MONK = { cls: 'arhat_abyss', set: 'constellation', key: 'monk' };

let uid = 0;
function build(spec, side, slotIdx, dropTrait) {
  const id = `u${uid++}`;
  const items = {}; const equipment = {};
  for (const slot of (Gear.SLOTS || [])) {
    let it = null;
    try { it = Gear.rollSetItem({ setId: spec.set, slot, ilvl: 80, rng: rngMax }); } catch { it = null; }
    if (!it) { try { it = Gear.rollItem({ ilvl: 80, rarity: 5, slot, rng: rngMax }); } catch { it = null; } }
    if (it) { it.id = `${id}_${slot}`; items[it.id] = it; equipment[slot] = it.id; }
  }
  const m = { uid: id, name: spec.cls, classId: spec.cls, level: 80, grade: 'S', equipment };
  const trait = (dropTrait === spec.key) ? {} : (traitOfChain(classChain(spec.cls)) || {});
  return {
    ...m, side, stats: mercStats(m, items),
    skills: (getClass(spec.cls) || {}).skills || [],
    slot: SLOTS7[slotIdx], slotIndex: slotIdx,
    ...trait,
  };
}
const squadOf = (side, dropTrait, monk) => {
  const rows = monk ? SQUAD.map((s) => (s.key === 'priest' ? MONK : s)) : SQUAD;
  return rows.map((s, i) => build(s, side, i, dropTrait));
};

/* ── 게이트 ① 장비 ── */
const naked = mercStats({ uid: 'b', classId: 'archmage_apex', level: 80, grade: 'S', equipment: {} }, {});
const probe = build({ cls: 'archmage_apex', set: 'starseeker', key: 'apprentice' }, 'ally', 5, null);
const mult = probe.stats.atk / naked.atk;
if (mult < 3) { console.log(`✗ 장비가 안 붙었다 (${mult.toFixed(1)}x) — 멈춘다`); process.exit(1); }

/* ── 게이트 ② 자리 ── */
{
  const b = createBattle({ allies: squadOf('ally', null), enemies: squadOf('enemy', null), seed: 1, getSkill, record: false, rout: false });
  const af = b.units.filter((u) => u.side === 'ally').reduce((p, u) => (u.x > p.x ? u : p));
  const ef = b.units.filter((u) => u.side === 'enemy').reduce((p, u) => (u.x < p.x ? u : p));
  const d = Math.abs(ef.x - af.x);
  console.log(`게이트 — 장비 ${mult.toFixed(1)}x · 전열끼리 거리 ${d.toFixed(1)} (실제 편성은 12 언저리)`);
  if (d > 25) { console.log('✗ 자리가 실제 편성과 다르다 — 멈춘다'); process.exit(1); }
}
/* ── 게이트 ③ 표 참조 ── */
{
  const t = traitOfChain(classChain('masterarcher_apex')) || {};
  if (t.chargeSlow !== LINEAGE_TRAIT.archer.chargeSlow) {
    console.log('✗ 표의 값과 실제 값이 다르다 — 멈춘다'); process.exit(1);
  }
}

const N = Number(process.argv[2] || 60);
const duel = (dropOnB, monk) => {
  let aw = 0; let dw = 0;
  for (let s = 1; s <= N; s++) {
    const b = createBattle({
      allies: squadOf('ally', null, monk), enemies: squadOf('enemy', dropOnB, monk),
      seed: s * 7919, getSkill, record: false, rout: false,
      allyFormationId: 'basic', enemyFormationId: 'basic',
    });
    let g = 0;
    while (!b.finished && g++ < 20000) b.step(1 / 60);
    if (b.winner === 'ally') aw++; else if (b.winner === 'enemy') dw++;
  }
  return Math.round(aw / N * 100);
};

console.log(`\n한계 기여도 — 양쪽 같은 부대, B 만 그 특성을 뺀다 (각 ${N}판)`);
console.log('50% = 있으나 없으나 같다 · 높을수록 그 특성이 판을 바꾼다\n');
console.log('빠진 특성        | A 승률');
const base = duel(null, false);
console.log(`${'(아무것도 안 뺌)'.padEnd(17)}|${(base + '%').padStart(7)}   ← 50 근처여야 판이 공정하다`);
const LABEL = {
  shieldman: '수호(방패병)', swordsman: '반격(검사)', spearman: '요격(창병)',
  archer: '견제(궁수)', rogue: '은신(도적)', apprentice: '방벽(마법사)', priest: '축복(사제)',
};
const rows = [];
for (const s of SQUAD) rows.push([LABEL[s.key], duel(s.key, false)]);
rows.push(['금강(수도승)', duel('monk', true)]);
rows.sort((a, b) => b[1] - a[1]);
for (const [label, w] of rows) console.log(`${label.padEnd(17)}|${(w + '%').padStart(7)}`);
