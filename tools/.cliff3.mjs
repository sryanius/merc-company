/**
 * 임시 계측기 3 — 시드 하나하나의 '뒤집히는 전투력비'를 직접 잡는다.
 * 시드마다 승패가 뒤집히는 지점 r* 를 찾고, 그 분포의 폭이 곧 절벽 폭이다.
 * 끝나면 삭제한다.
 */
import * as State from '../src/game/state.js';
import * as Merc from '../src/game/merc.js';
import * as Gear from '../src/game/gear.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { setSkillResolver, simulate } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import * as Abyss from '../src/game/abyss.js';
import { questBattleDefs } from '../src/game/quest.js';

setSkillResolver(getSkill);   // ★ 필수

const PW = { hp: 0.14, atk: 2.6, def: 1.5, res: 1.3, spd: 1.6, crit: 2.2, critDmg: 0.5, eva: 1.8 };
const SCAL = ['hp', 'atk', 'def', 'res', 'spd'];
const FLAT = ['crit', 'critDmg', 'eva'];

const T3 = { tank: 'gatewarden', fighter: 'madgeneral', lancer: 'dragoonlord', rogue: 'shadowarcher', archer: 'masterarcher', mage: 'archmage', healer: 'highpriest', mage2: 'stormcaller' };
const T2 = { tank: 'knight', fighter: 'berserker', lancer: 'dragoon', rogue: 'assassin', archer: 'sniper', mage: 'elementalist', healer: 'priest', mage2: 'necromancer' };
const comp = (T, kind, n) => {
  if (n === 7) return kind === 'nohealer'
    ? [T.tank, T.fighter, T.lancer, T.rogue, T.archer, T.mage, T.mage2]
    : [T.tank, T.fighter, T.lancer, T.rogue, T.archer, T.mage, T.healer];
  if (n === 5) return [T.tank, T.fighter, T.rogue, T.mage, T.healer];
  return [T.tank, T.mage, T.healer];
};
const SLOTS_OF = { 7: [0, 1, 2, 3, 4, 5, 6], 5: [0, 1, 3, 5, 6], 3: [0, 3, 5] };

function build(cfg) {
  State.newGame(1000, 'x');
  const st = State.state;
  st.roster = []; st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  const classes = comp(cfg.T, cfg.kind, cfg.n);
  const slots = SLOTS_OF[cfg.n];
  classes.forEach((classId, i) => {
    st.roster.push({ uid: `u_${i}`, name: getClass(classId).name, classId, level: cfg.level, grade: 'B', equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0 });
    sq.memberUids[slots[i]] = `u_${i}`;
  });
  if (cfg.equip) {
    for (let i = 0; i < classes.length * 30; i++) { const it = State.rollLoot({ ilvl: cfg.level, rarityBonus: 0.3 }); if (it) st.items.push(it); }
    Gear.autoEquipAll(st, { squadId: sq.id });
  }
  for (const m of st.roster) m.hp = 0;
  const sqId = sq.id;
  const allies = questBattleDefs(Abyss.abyssQuest(st, 1, sqId), 0, st, sqId).allies;
  // ★ 만든 직후 값으로 꺼낸다 (State.state 싱글턴)
  const units = allies.map((u) => ({ ...u, stats: { ...u.stats } }));
  let scal = 0; let flat = 0;
  for (const u of units) { for (const k of SCAL) scal += (u.stats[k] || 0) * PW[k]; for (const k of FLAT) flat += (u.stats[k] || 0) * PW[k]; }
  return { units, scal, flat, power: scal + flat, rosterPower: st.roster.reduce((a, m) => a + Merc.mercPower(m, { items: State.itemsById(st.items) }), 0) };
}

const scaleUnits = (units, m) => units.map((u) => {
  const s = { ...u.stats };
  for (const k of SCAL) s[k] = (s[k] || 0) * m;
  return { ...u, stats: s, hp: Math.max(1, Math.round(s.hp)) };
});
const mForRatio = (S, r) => (S.power / r - S.flat) / S.scal;

function one(A, B, seed) {
  const res = simulate({
    allies: A.map((u) => ({ ...u, stats: { ...u.stats } })),
    enemies: B.map((u, k) => ({ ...u, stats: { ...u.stats }, uid: `e_${k}`, side: 'enemy' })),
    allyFormationId: 'basic', enemyFormationId: 'basic', seed: seed >>> 0,
  });
  return { win: res.winner === 'ally', t: res.time };
}

const CONFIGS = [
  { key: '7v7 힐러O Lv80 장비X', n: 7, kind: 'heal', level: 80, T: T3, equip: false },
  { key: '5v5 힐러O Lv80 장비X', n: 5, kind: 'heal', level: 80, T: T3, equip: false },
  { key: '3v3 힐러O Lv80 장비X', n: 3, kind: 'heal', level: 80, T: T3, equip: false },
  { key: '7v7 전부딜러 Lv80 장비X', n: 7, kind: 'nohealer', level: 80, T: T3, equip: false },
  { key: '7v7 힐러O Lv50 장비X', n: 7, kind: 'heal', level: 50, T: T3, equip: false },
  { key: '7v7 힐러O Lv20 장비X', n: 7, kind: 'heal', level: 20, T: T2, equip: false },
  { key: '7v7 힐러O Lv80 장비O', n: 7, kind: 'heal', level: 80, T: T3, equip: true },
  { key: '7v7 힐러O Lv20 장비O', n: 7, kind: 'heal', level: 20, T: T2, equip: true },
];

const NSEED = 300;
const LO = 0.94; const HI = 1.09; const STEP = 0.002;

console.log(`시드별 '뒤집히는 전투력비' 분포   (시드 ${NSEED}개 · 비율 ${LO}~${HI} 를 ${STEP} 단위로 훑음)`);
console.log('='.repeat(104));
console.log('  편성                       거울승률 거울전투  r*10%   r*50%   r*90%   폭(p90-p10)  비단조시드  전범위 갈림폭');

const out = [];
for (const C of CONFIGS) {
  const S = build(C);
  const grid = [];
  for (let r = LO; r <= HI + 1e-9; r += STEP) grid.push(Math.round(r * 10000) / 10000);
  const enemies = grid.map((r) => scaleUnits(S.units, mForRatio(S, r)));

  const flips = [];       // 시드별 뒤집히는 지점
  let nonMono = 0;
  let mirrorWin = 0; let mirrorT = 0;
  const mirrorEnemy = S.units;
  for (let s = 0; s < NSEED; s++) {
    const seed = (100003 + s * 7919) >>> 0;
    const m = one(S.units, mirrorEnemy, seed);
    if (m.win) mirrorWin++;
    mirrorT += m.t;

    let firstWin = null; let lastLose = null; let changes = 0; let prev = null;
    for (let i = 0; i < grid.length; i++) {
      const w = one(S.units, enemies[i], seed).win;
      if (prev !== null && w !== prev) changes++;
      prev = w;
      if (w && firstWin === null) firstWin = grid[i];
      if (!w) lastLose = grid[i];
    }
    if (changes > 1) nonMono++;
    // 뒤집히는 지점 = 마지막으로 진 비율의 바로 위
    if (lastLose !== null && firstWin !== null) flips.push(lastLose + STEP);
    else if (firstWin !== null) flips.push(LO);          // 전 구간 승
    else flips.push(HI + STEP);                          // 전 구간 패
  }
  flips.sort((a, b) => a - b);
  const q = (p) => flips[Math.min(flips.length - 1, Math.floor(p * flips.length))];
  const p10 = q(0.10); const p50 = q(0.50); const p90 = q(0.90);
  const spanAll = flips[flips.length - 1] - flips[0];
  console.log(`  ${C.key.padEnd(26)} ${(mirrorWin / NSEED * 100).toFixed(0).padStart(4)}%  ${(mirrorT / NSEED).toFixed(1).padStart(6)}초  ${p10.toFixed(4)}  ${p50.toFixed(4)}  ${p90.toFixed(4)}    ${(p90 - p10).toFixed(4)}       ${String(nonMono).padStart(3)}/${NSEED}      ${spanAll.toFixed(4)}`);
  out.push({ key: C.key, p10, p50, p90, w: p90 - p10, span: spanAll, t: mirrorT / NSEED, nonMono, power: Math.round(S.power) });
}

console.log('\n해석: r* 는 "그 시드에서 이기기 시작하는 전투력비". 시드마다 다르며,');
console.log('      그 분포의 10~90 백분위 폭이 곧 승률 10%→90% 구간의 폭이다.');
{
  const xs = out.map((o) => o.t); const ys = out.map((o) => o.w);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  console.log(`\n  거울 전투길이 vs r* 폭   피어슨 r = ${(num / Math.sqrt(dx * dy)).toFixed(3)}  (n=${xs.length})`);
  console.log('  ' + out.map((o) => `${o.t.toFixed(0)}초→${o.w.toFixed(4)}`).join('  '));
}
