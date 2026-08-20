/* 임시 — 가설 A(소모전 누적) / B(집중공격) 실측 */
import { setSkillResolver, createBattle } from './.engine_var.mjs';
import { getSkill } from '../src/data/skills.js';
import { unitsOf, scaled, mix } from './.zlib.mjs';
setSkillResolver(getSkill);

const base = unitsOf('A', 80, 1000);

function trace(k, seed) {
  const b = createBattle({
    allies: base.map((u, i) => ({ ...u, uid: `a_${i}` })),
    enemies: scaled(base, k).map((u, i) => ({ ...u, uid: `e_${i}`, slotIndex: i })),
    allyFormationId: 'basic', enemyFormationId: 'basic', seed, record: true,
  });
  const byTarget = {}, hitsOn = {};
  let dmgA = 0, dmgE = 0, hits = 0;
  const series = []; let firstDeath = null; let next = 0; let t = 0;
  while (!b.finished && t < 130) {
    b.step(1 / 60); t += 1 / 60;
    for (const e of b.drainEvents()) {
      if (e.type === 'damage') {
        hits++;
        byTarget[e.targetUid] = (byTarget[e.targetUid] || 0) + e.amount;
        hitsOn[e.targetUid] = (hitsOn[e.targetUid] || 0) + 1;
        if (String(e.uid).startsWith('a_')) dmgA += e.amount; else dmgE += e.amount;
      }
      if (e.type === 'death' && firstDeath === null) firstDeath = { t: b.time, uid: e.targetUid };
    }
    if (b.time >= next) {
      next += 1;
      series.push({ t: b.time, a: b.units.filter((u) => u.alive && u.side === 'ally').length, e: b.units.filter((u) => u.alive && u.side === 'enemy').length, dmgA, dmgE });
    }
  }
  return { res: b.result, series, byTarget, hitsOn, hits, dmgA, dmgE, firstDeath, units: b.units };
}

const K = Number(process.argv[2] || 1.005);
const SEED = mix(Number(process.argv[3] || 3));
const r = trace(K, SEED);
console.log(`k=${K} seed=${SEED} → 승자 ${r.res.winner} / ${r.res.time.toFixed(1)}초 / 피해이벤트 ${r.hits}회`);
console.log(`첫 사망: t=${r.firstDeath ? r.firstDeath.t.toFixed(1) : '-'}초 (${r.firstDeath ? r.firstDeath.uid : '-'})`);
console.log('\n  t   생존 아/적   직전1초 피해 아/적   화력비(아/적)');
let p = null;
for (const s of r.series) {
  const dA = p ? s.dmgA - p.dmgA : s.dmgA;
  const dE = p ? s.dmgE - p.dmgE : s.dmgE;
  const mark = r.firstDeath && s.t >= r.firstDeath.t && (!p || p.t < r.firstDeath.t) ? '   ← 첫 사망' : '';
  console.log(`${s.t.toFixed(0).padStart(4)}   ${s.a} / ${s.e}       ${String(Math.round(dA)).padStart(6)} / ${String(Math.round(dE)).padStart(6)}       ${(dE > 0 ? dA / dE : Infinity).toFixed(2)}${mark}`);
  p = s;
}

console.log('\n── 피격자별 누적 피해 분포 (가설 B)');
const enemies = r.units.filter((u) => u.side === 'enemy');
const allies = r.units.filter((u) => u.side === 'ally');
for (const [tag, list] of [['적(=아군이 때린 쪽)', enemies], ['아군(=적이 때린 쪽)', allies]]) {
  const tot = list.reduce((a, u) => a + (r.byTarget[u.uid] || 0), 0) || 1;
  const rows = list.map((u) => ({ n: u.name, x: u.x.toFixed(0), d: r.byTarget[u.uid] || 0, h: r.hitsOn[u.uid] || 0 })).sort((a, b) => b.d - a.d);
  const hhi = rows.reduce((a, q) => a + (q.d / tot) ** 2, 0);
  console.log(`  ${tag}  총 ${Math.round(tot)}  실효 표적수 1/HHI = ${(1 / hhi).toFixed(2)}명 (균등이면 7.00)`);
  for (const q of rows) console.log(`    ${String(q.n).padEnd(11)} x=${String(q.x).padStart(3)}  ${String(Math.round(q.d)).padStart(8)}  (${(q.d / tot * 100).toFixed(1)}%)  ${q.h}회 피격`);
}
