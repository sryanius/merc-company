/* 임시 — 큰 수의 법칙: 타격 1회의 편차 vs 전투 전체 누적 피해의 편차 */
import { setSkillResolver, createBattle } from './.engine_var.mjs';
import { getSkill } from '../src/data/skills.js';
import { unitsOf, mix } from './.zlib.mjs';
setSkillResolver(getSkill);
const base = unitsOf('A', 80, 1000);
const N = Number(process.env.N || 400);
const T = Number(process.argv[2] || 2.0);   // 첫 사망(≈3.2초) 이전이라 소모전 효과가 섞이지 않는다

const tot = []; const per = [];
for (let i = 0; i < N; i++) {
  const b = createBattle({
    allies: base.map((u, j) => ({ ...u, uid: `a_${j}` })),
    enemies: base.map((u, j) => ({ ...u, uid: `e_${j}`, slotIndex: j })),
    allyFormationId: 'basic', enemyFormationId: 'basic', seed: mix(i), record: true,
  });
  let t = 0, d = 0, h = 0;
  while (t < T) {
    b.step(1 / 60); t += 1 / 60;
    for (const e of b.drainEvents()) if (e.type === 'damage' && String(e.uid).startsWith('a_')) { d += e.amount; h++; if (i < 40) per.push(e.amount); }
  }
  tot.push({ d, h });
}
const cv = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const s = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); return { m, s, cv: s / m }; };
const D = cv(tot.map((x) => x.d));
const H = cv(tot.map((x) => x.h));
console.log(`t=0~${T}초 (첫 사망 이전), 거울전 ${N}판 · 아군이 준 누적 피해`);
console.log(`  평균 타격 횟수 ${H.m.toFixed(0)}회`);
console.log(`  누적 피해 평균 ${D.m.toFixed(0)}  표준편차 ${D.s.toFixed(0)}  → 변동계수 CV = ${(D.cv * 100).toFixed(2)}%`);
console.log(`  타격 1회의 CV (같은 표적이 섞여 크기가 다르므로 참고용) = ${(cv(per).cv * 100).toFixed(0)}%`);
console.log(`  1/√${H.m.toFixed(0)} = ${(100 / Math.sqrt(H.m)).toFixed(2)}%  ← 타격 1회 CV 를 이 비율로 깎는다`);
console.log(`\n  ▶ 즉 전투 하나의 '실력 외 흔들림'은 ${(D.cv * 100).toFixed(2)}% 뿐이다.`);
console.log(`     양측이 각각 이만큼 흔들리므로 승패를 가르는 잡음의 표준편차는 약 ${(D.cv * Math.SQRT2 * 100).toFixed(2)}%.`);
console.log(`     스탯을 1% 올리면 화력·유효체력이 그보다 크게 움직이므로, 승률은 몇 %p 안에서 0→100 으로 넘어간다.`);
