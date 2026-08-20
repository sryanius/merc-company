/* 임시 — 아군 쪽 구조적 이점 검증: 거울전 대량 표본 + 틱 순서 뒤집기 */
import { setSkillResolver, createBattle } from './.engine_var.mjs';
import { getSkill } from '../src/data/skills.js';
import { unitsOf, mix } from './.zlib.mjs';
setSkillResolver(getSkill);
const base = unitsOf('A', 80, 1000);
const N = Number(process.env.N || 2000);

function mirror(defs, n, seedf) {
  let w = 0, l = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const b = createBattle({
      allies: defs.map((u, j) => ({ ...u, uid: `a_${j}` })),
      enemies: defs.map((u, j) => ({ ...u, uid: `e_${j}`, slotIndex: j })),
      allyFormationId: 'basic', enemyFormationId: 'basic', seed: seedf(i), record: false,
    });
    let t = 0; while (!b.finished && t < 130) { b.step(1 / 60); t += 1 / 60; }
    if (b.result.winner === 'ally') w++; else if (b.result.winner === 'enemy') l++; else d++;
  }
  const p = (w + d / 2) / n;
  const se = Math.sqrt(0.25 / n);
  return { w, l, d, p, z: (p - 0.5) / se };
}
const good = (i) => mix(i);
const dcSeed = (i) => (9001 + i * 7919) >>> 0;

console.log(`거울전 (완전히 같은 UnitDef 양쪽), TICKORDER=${process.env.TICKORDER || 'allyfirst(원본)'}`);
let r = mirror(base, N, good);
console.log(`  잘 섞은 시드   n=${N}  아군승 ${r.w} 패 ${r.l} 무 ${r.d} → ${(r.p * 100).toFixed(1)}%  (z=${r.z.toFixed(2)})`);
r = mirror(base, N, dcSeed);
console.log(`  9001+i*7919   n=${N}  아군승 ${r.w} 패 ${r.l} 무 ${r.d} → ${(r.p * 100).toFixed(1)}%  (z=${r.z.toFixed(2)})`);
for (const n of [20, 40, 80, 160]) {
  const q = mirror(base, n, dcSeed);
  console.log(`     ↑ 앞 ${String(n).padStart(3)}판만 보면 ${(q.p * 100).toFixed(1)}%`);
}
