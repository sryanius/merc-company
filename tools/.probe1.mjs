/* 임시 진단 스크립트 — 끝나면 지운다. 거울전(A vs A) 비대칭 재현 */
import * as State from '../src/game/state.js';
import * as Merc from '../src/game/merc.js';
import { getClass } from '../src/data/classes.js';
import '../src/data/classes_t4.js';
import { createBattle, setSkillResolver } from '../src/battle/engine.js';
import { getSkill } from '../src/data/skills.js';
import * as Abyss from '../src/game/abyss.js';
import { questBattleDefs } from '../src/game/quest.js';

setSkillResolver(getSkill);

const SQUAD = ['gatewarden', 'madgeneral', 'dragoonlord', 'shadowarcher', 'masterarcher', 'archmage', 'oathshield'];

function setup(grade, level, seed) {
  State.newGame(seed, `${grade}${level}`);
  const st = State.state;
  st.roster = []; st.items = [];
  const sq = st.squads[0];
  sq.memberUids = new Array(7).fill(null);
  SQUAD.forEach((classId, i) => {
    const m = { uid: `d_${i}`, name: getClass(classId).name, classId, level, grade, equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0 };
    st.roster.push(m); sq.memberUids[i] = m.uid;
  });
  for (const m of st.roster) m.hp = 0;
  return st;
}
function unitsOf(grade, level, seed) {
  const st = setup(grade, level, seed);
  const sqId = st.squads[0].id;
  const allies = questBattleDefs(Abyss.abyssQuest(st, 1, sqId), 0, st, sqId).allies;
  const idx = State.itemsById(st.items);
  return { allies: allies.map((u) => ({ ...u })), power: st.roster.reduce((a, m) => a + Merc.mercPower(m, { items: idx }), 0) };
}

function mk(A, B, seed, extra = {}) {
  return createBattle({
    allies: A.map((u, k) => ({ ...u, uid: `a_${k}` })),
    enemies: B.map((u, k) => ({ ...u, uid: `e_${k}`, slotIndex: k })),
    allyFormationId: 'basic', enemyFormationId: 'basic', seed, ...extra,
  });
}
function runOne(b) {
  let t = 0;
  while (!b.finished && t < 130) { b.step(1 / 60); t += 1 / 60; }
  return b.result;
}

const ME = unitsOf('A', 80, 1000);
const stats = { ally: 0, enemy: 0, draw: 0 };
const times = [];
for (let i = 0; i < 200; i++) {
  const r = runOne(mk(ME.allies, ME.allies, (9001 + i * 7919) >>> 0));
  stats[r.winner || 'draw']++;
  times.push(r.time);
}
console.log('거울전 A vs A, 200판(같은 UnitDef 값):', stats, '평균 시간', (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1));

// 시드를 완전히 다른 계열로 바꿔도 같은가
const s2 = { ally: 0, enemy: 0, draw: 0 };
for (let i = 0; i < 200; i++) s2[runOne(mk(ME.allies, ME.allies, (1 + i * 2654435761) >>> 0)).winner || 'draw']++;
console.log('  다른 시드 계열 200판:', s2);

// 1v1 거울전 — 각 클래스별
console.log('\n1v1 거울전 (같은 클래스끼리, 각 200판)');
for (let k = 0; k < ME.allies.length; k++) {
  const one = [ME.allies[k]];
  const s = { ally: 0, enemy: 0, draw: 0 };
  for (let i = 0; i < 200; i++) s[runOne(mk(one, one, (9001 + i * 7919) >>> 0)).winner || 'draw']++;
  console.log(`  ${String(ME.allies[k].name || ME.allies[k].classId).padEnd(10)} spd=${String(ME.allies[k].stats.spd).padEnd(6)} ally승 ${s.ally} / 적승 ${s.enemy} / 무 ${s.draw}`);
}
