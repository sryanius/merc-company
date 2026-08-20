/* 임시 — 시드 계열 자기상관: n=20 표본이 왜 거짓말을 했는가 */
import { setSkillResolver, createBattle } from './.engine_var.mjs';
import { getSkill } from '../src/data/skills.js';
import { unitsOf, mix } from './.zlib.mjs';
setSkillResolver(getSkill);
const base = unitsOf('A', 80, 1000);

function outcome(seed) {
  const b = createBattle({
    allies: base.map((u, j) => ({ ...u, uid: `a_${j}` })),
    enemies: base.map((u, j) => ({ ...u, uid: `e_${j}`, slotIndex: j })),
    allyFormationId: 'basic', enemyFormationId: 'basic', seed, record: false,
  });
  let t = 0; while (!b.finished && t < 130) { b.step(1 / 60); t += 1 / 60; }
  return b.result.winner === 'ally' ? 1 : b.result.winner === 'enemy' ? 0 : 0.5;
}

const W = 20, WIN = 60;
for (const [tag, f] of [['9001 + i*7919 (dangercheck)', (i) => (9001 + i * 7919) >>> 0], ['잘 섞은 시드', (i) => mix(i)]]) {
  const res = [];
  for (let i = 0; i < W * WIN; i++) res.push(outcome(f(i)));
  const means = [];
  for (let g = 0; g < WIN; g++) means.push(res.slice(g * W, g * W + W).reduce((a, b) => a + b, 0) / W);
  const mu = means.reduce((a, b) => a + b, 0) / WIN;
  const sd = Math.sqrt(means.reduce((a, b) => a + (b - mu) ** 2, 0) / (WIN - 1));
  // 연속 1차 자기상관
  let num = 0, den = 0; const m2 = res.reduce((a, b) => a + b, 0) / res.length;
  for (let i = 0; i + 1 < res.length; i++) num += (res[i] - m2) * (res[i + 1] - m2);
  for (let i = 0; i < res.length; i++) den += (res[i] - m2) ** 2;
  // 최장 연승
  let run = 0, best = 0; for (const r of res) { if (r === 1) { run++; best = Math.max(best, run); } else run = 0; }
  console.log(`${tag}`);
  console.log(`  전체 ${res.length}판 승률 ${(m2 * 100).toFixed(1)}%   20판 창(${WIN}개) 평균 ${(mu * 100).toFixed(1)}%  표준편차 ${(sd * 100).toFixed(1)}%p  (이항이면 11.2%p)`);
  console.log(`  1차 자기상관 r1=${(num / den).toFixed(3)}   최장 연승 ${best}판   20판 창 최대 ${(Math.max(...means) * 100).toFixed(0)}% / 최소 ${(Math.min(...means) * 100).toFixed(0)}%`);
}
