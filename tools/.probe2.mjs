/* 임시 — 88% 재현 및 표본/구성 차이 분리 */
import * as State from '../src/game/state.js';
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
  const st = State.state; st.roster = []; st.items = [];
  const sq = st.squads[0]; sq.memberUids = new Array(7).fill(null);
  SQUAD.forEach((classId, i) => {
    const m = { uid: `d_${i}`, name: getClass(classId).name, classId, level, grade, equipment: {}, hp: 0, status: 'idle', woundUntil: 0, exp: 0 };
    st.roster.push(m); sq.memberUids[i] = m.uid;
  });
  return st;
}
function unitsOf(grade, level, seed) {
  const st = setup(grade, level, seed); const sqId = st.squads[0].id;
  return questBattleDefs(Abyss.abyssQuest(st, 1, sqId), 0, st, sqId).allies.map((u) => ({ ...u }));
}
const A = unitsOf('A', 80, 1000);
const B = unitsOf('A', 80, 2000);
console.log('두 A등급 부대가 정말 같은가:', JSON.stringify(A) === JSON.stringify(B) ? '완전히 동일' : '다름!');
console.log('샘플 stats a:', JSON.stringify(A[0].stats), '\n           b:', JSON.stringify(B[0].stats));

function duel(X, Y, seeds) {
  let w = 0, l = 0, d = 0;
  for (const s of seeds) {
    const b = createBattle({
      allies: X.map((u) => ({ ...u })), enemies: Y.map((u, k) => ({ ...u, uid: `e_${k}`, side: 'enemy', slotIndex: k })),
      allyFormationId: 'basic', enemyFormationId: 'basic', seed: s,
    });
    let t = 0; while (!b.finished && t < 90) { b.step(1 / 60); t += 1 / 60; }
    if (b.result.winner === 'ally') w++; else if (b.result.winner === 'enemy') l++; else d++;
  }
  return { w, l, d, n: seeds.length };
}
const dcSeeds = (n) => Array.from({ length: n }, (_, i) => (9001 + i * 7919) >>> 0);
console.log('\ndangercheck 와 똑같이 (seed 9001+i*7919):');
for (const n of [20, 50, 100, 400, 1000]) {
  const r = duel(A, B, dcSeeds(n));
  console.log(`  n=${String(n).padStart(4)}  아군승 ${(r.w / r.n * 100).toFixed(1)}%  (승 ${r.w} 패 ${r.l} 무/미결 ${r.d})`);
}
console.log('\n앞 20개 시드 각각의 결과:');
const rows = dcSeeds(20).map((s) => { const r = duel(A, B, [s]); return `${s}:${r.w ? 'W' : r.l ? 'L' : 'D'}`; });
console.log('  ' + rows.join(' '));

// 시드 계열을 바꿔 가며 20판씩 — 표본 노이즈인지 확인
console.log('\n무작위 시드 계열 20판씩 10세트:');
let tot = 0;
for (let k = 0; k < 10; k++) {
  const seeds = Array.from({ length: 20 }, (_, i) => ((k * 1013904223 + i * 1664525 + 7) >>> 0) || 1);
  const r = duel(A, B, seeds); tot += r.w;
  process.stdout.write(`${(r.w / 20 * 100).toFixed(0)}% `);
}
console.log(`\n  합계 200판: ${(tot / 200 * 100).toFixed(1)}%`);
