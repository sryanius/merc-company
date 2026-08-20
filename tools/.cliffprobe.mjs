/* 임시 계측 — 절벽 폭 측정용 하네스 검증 (probe). 끝나면 삭제한다. */
import * as State from '../src/game/state.js';
import * as Merc from '../src/game/merc.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { createBattle, setSkillResolver, simulate } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import * as Abyss from '../src/game/abyss.js';
import { questBattleDefs } from '../src/game/quest.js';

setSkillResolver(getSkill);   // ★ 빼먹으면 스킬이 전부 사라진다

const SQUAD7 = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];

function setup(classes, slots, level, grade, seed) {
  State.newGame(seed, `p${seed}`);
  const st = State.state;
  st.roster = [];
  st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  classes.forEach((classId, i) => {
    const m = {
      uid: `u_${seed}_${i}`, name: getClass(classId).name, classId, level, grade,
      equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0,
    };
    st.roster.push(m);
    sq.memberUids[slots[i]] = m.uid;
  });
  for (const m of st.roster) m.hp = 0;
  return st;
}

const PW = { hp: 0.14, atk: 2.6, def: 1.5, res: 1.3, spd: 1.6, crit: 2.2, critDmg: 0.5, eva: 1.8 };
const SCAL = ['hp', 'atk', 'def', 'res', 'spd'];
const FLAT = ['crit', 'critDmg', 'eva'];

function build(classes, slots, level, grade, seed) {
  const st = setup(classes, slots, level, grade, seed);
  const sqId = st.squads[0].id;
  const allies = questBattleDefs(Abyss.abyssQuest(st, 1, sqId), 0, st, sqId).allies;
  const units = allies.map((u) => ({ ...u, stats: { ...u.stats } }));
  const idx = State.itemsById(st.items);
  const rosterPower = st.roster.reduce((a, m) => a + Merc.mercPower(m, { items: idx }), 0);
  let scal = 0; let flat = 0;
  for (const u of units) {
    for (const k of SCAL) scal += (u.stats[k] || 0) * PW[k];
    for (const k of FLAT) flat += (u.stats[k] || 0) * PW[k];
  }
  return { units, rosterPower, scal, flat, defPower: scal + flat };
}

/** 배율 m 을 SCALING 스탯에만 곱한 사본 */
function scaled(units, m) {
  return units.map((u, k) => {
    const s = { ...u.stats };
    for (const key of SCAL) s[key] = (s[key] || 0) * m;
    return { ...u, stats: s, hp: Math.max(1, Math.round(s.hp)) };
  });
}

const A = build(SQUAD7, [0, 1, 2, 3, 4, 5, 6], 80, 'B', 1000);
const Braw = build(SQUAD7, [0, 1, 2, 3, 4, 5, 6], 80, 'B', 2000);

console.log('roster mercPower 합 :', A.rosterPower);
console.log('UnitDef 기반 power  :', Math.round(A.defPower), '(scal', Math.round(A.scal), '+ flat', Math.round(A.flat), ')');
console.log('두 값 차이 비율     :', (A.defPower / A.rosterPower).toFixed(6));
console.log('A vs B 동일편성 power비 :', (A.defPower / Braw.defPower).toFixed(6));

// 타이밍
const t0 = Date.now();
let wins = 0; let times = [];
for (let i = 0; i < 30; i++) {
  const r = simulate({
    allies: A.units.map((u) => ({ ...u, stats: { ...u.stats } })),
    enemies: Braw.units.map((u, k) => ({ ...u, stats: { ...u.stats }, uid: `e_${k}`, side: 'enemy', slotIndex: k })),
    allyFormationId: 'basic', enemyFormationId: 'basic',
    seed: (9001 + i * 7919) >>> 0,
  });
  if (r.winner === 'ally') wins++;
  times.push(r.time);
}
const dt = Date.now() - t0;
console.log(`\n동일 편성 30판: 승률 ${(wins / 30 * 100).toFixed(0)}%  평균 ${(times.reduce((a, b) => a + b) / 30).toFixed(1)}초  소요 ${dt}ms (판당 ${(dt / 30).toFixed(1)}ms)`);

// 배율 스윕 확인
console.log('\n배율 → 실제 power비 확인');
for (const r of [0.90, 0.95, 1.00, 1.05, 1.10]) {
  const m = (A.defPower / r - Braw.flat) / Braw.scal;
  const en = scaled(Braw.units, m);
  let sc = 0; let fl = 0;
  for (const u of en) { for (const k of SCAL) sc += u.stats[k] * PW[k]; for (const k of FLAT) fl += u.stats[k] * PW[k]; }
  let w = 0;
  for (let i = 0; i < 30; i++) {
    const res = simulate({
      allies: A.units.map((u) => ({ ...u, stats: { ...u.stats } })),
      enemies: en.map((u, k) => ({ ...u, stats: { ...u.stats }, uid: `e_${k}`, side: 'enemy', slotIndex: k })),
      allyFormationId: 'basic', enemyFormationId: 'basic',
      seed: (9001 + i * 7919) >>> 0,
    });
    if (res.winner === 'ally') w++;
  }
  console.log(`  목표 ${r.toFixed(2)}  m=${m.toFixed(4)}  실측비 ${(A.defPower / (sc + fl)).toFixed(4)}  승률 ${(w / 30 * 100).toFixed(0)}%`);
}
