/* 임시 — 가설 B: 순간순간 피해가 몇 명에게 갈리는가 (1초 창 기준, 다수 시드 평균) */
import { setSkillResolver, createBattle } from './.engine_var.mjs';
import { getSkill } from '../src/data/skills.js';
import { unitsOf, mix } from './.zlib.mjs';
setSkillResolver(getSkill);
const base = unitsOf('A', 80, 1000);
const N = Number(process.env.N || 100);

let sumEff = 0, sumW = 0, sumTot = 0;
const deathTimes = [];
const perTarget = {};
let battles = 0;
for (let i = 0; i < N; i++) {
  const b = createBattle({
    allies: base.map((u, j) => ({ ...u, uid: `a_${j}` })),
    enemies: base.map((u, j) => ({ ...u, uid: `e_${j}`, slotIndex: j })),
    allyFormationId: 'basic', enemyFormationId: 'basic', seed: mix(i), record: true,
  });
  let t = 0, win = {}, winEnd = 1, deaths = [];
  const flush = () => {
    const vals = Object.values(win); const tot = vals.reduce((a, c) => a + c, 0);
    if (tot > 0 && vals.length) {
      const hhi = vals.reduce((a, c) => a + (c / tot) ** 2, 0);
      sumEff += (1 / hhi) * tot; sumW += tot;      // 피해량 가중 평균
    }
    win = {};
  };
  while (!b.finished && t < 130) {
    b.step(1 / 60); t += 1 / 60;
    for (const e of b.drainEvents()) {
      if (e.type === 'damage' && String(e.targetUid).startsWith('e_')) {
        win[e.targetUid] = (win[e.targetUid] || 0) + e.amount;
        perTarget[e.targetUid] = (perTarget[e.targetUid] || 0) + e.amount; sumTot += e.amount;
      }
      if (e.type === 'death' && String(e.targetUid).startsWith('e_')) deaths.push(b.time);
    }
    if (b.time >= winEnd) { flush(); winEnd += 1; }
  }
  flush();
  if (deaths.length >= 7) { deathTimes.push(deaths.slice(0, 7)); }
  battles++;
}
console.log(`거울전 ${battles}판 · 아군이 적에게 준 피해 기준`);
console.log(`1초 창 안에서의 실효 표적 수 (피해 가중) = ${(sumEff / sumW).toFixed(2)}명 / 살아있는 7명`);
console.log('   1.00 이면 완전 집중, 7.00 이면 완전 분산');
console.log('\n적 유닛별 총 피해 비중:');
const names = ['관문수호자', '광기의대장군', '용기병대장', '그림자사수', '신궁', '대마법사', '서약의방패'];
for (let j = 0; j < 7; j++) console.log(`   e_${j} ${names[j].padEnd(12)} ${(perTarget[`e_${j}`] / sumTot * 100).toFixed(1)}%`);
if (deathTimes.length) {
  console.log(`\n적 전멸한 ${deathTimes.length}판의 사망 시각 (n번째 사망, 평균):`);
  for (let j = 0; j < 7; j++) {
    const m = deathTimes.reduce((a, d) => a + d[j], 0) / deathTimes.length;
    console.log(`   ${j + 1}번째 ${m.toFixed(2)}초${j ? `  (직전과 간격 ${(m - deathTimes.reduce((a, d) => a + d[j - 1], 0) / deathTimes.length).toFixed(2)}초)` : ''}`);
  }
}
