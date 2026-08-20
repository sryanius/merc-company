/* 임시 — 가설 A(소모전 누적) / B(집중공격) 실측 */
import { setSkillResolver, createBattle } from './.engine_var.mjs';
import { getSkill } from '../src/data/skills.js';
import { unitsOf, scaled } from './.cliff.mjs';
setSkillResolver(getSkill);

const mix = (i) => { let x = (i * 2654435761 + 12345) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) || 1; };
const base = unitsOf('A', 80, 1000);

function trace(k, seed) {
  const b = createBattle({
    allies: base.map((u, i) => ({ ...u, uid: `a_${i}` })),
    enemies: scaled(base, k).map((u, i) => ({ ...u, uid: `e_${i}`, slotIndex: i })),
    allyFormationId: 'basic', enemyFormationId: 'basic', seed, record: true,
  });
  const byTarget = {};       // 피격자별 누적 피해
  const hitsOn = {};         // 피격자별 피격 횟수
  let dmgA = 0, dmgE = 0, hits = 0;
  const series = [];
  let firstDeath = null;
  let next = 0;
  let t = 0;
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
console.log(`k=${K} seed=${SEED} → 승자 ${r.res.winner} / ${r.res.time.toFixed(1)}초 / 총 타격 ${r.hits}회`);
console.log(`첫 사망: t=${r.firstDeath ? r.firstDeath.t.toFixed(1) : '-'}초 (${r.firstDeath ? r.firstDeath.uid : '-'})`);
console.log('\n  t   생존 아/적   초당피해 아/적    누적피해비(아/적)  화력비');
let p = null;
for (const s of r.series) {
  const dA = p ? s.dmgA - p.dmgA : s.dmgA;
  const dE = p ? s.dmgE - p.dmgE : s.dmgE;
  const mark = r.firstDeath && Math.abs(s.t - r.firstDeath.t) < 1 ? '  ← 첫 사망' : '';
  console.log(`${s.t.toFixed(0).padStart(4)}   ${s.a} / ${s.e}      ${String(Math.round(dA)).padStart(6)} / ${String(Math.round(dE)).padStart(6)}     ${(s.dmgA / 1000).toFixed(0).padStart(5)}k/${(s.dmgE / 1000).toFixed(0).padStart(5)}k     ${(dE > 0 ? dA / dE : Infinity).toFixed(2)}${mark}`);
  p = s;
}

// ── 가설 B: 피해가 몇 명에게 분산되는가
console.log('\n── 피격자별 누적 피해 분포 (가설 B)');
const enemies = r.units.filter((u) => u.side === 'enemy');
const allies = r.units.filter((u) => u.side === 'ally');
for (const side of [['적(아군이 때린 쪽)', enemies], ['아군(적이 때린 쪽)', allies]]) {
  const tot = side[1].reduce((a, u) => a + (r.byTarget[u.uid] || 0), 0);
  const rows = side[1].map((u) => ({ n: u.name, x: u.x.toFixed(0), d: r.byTarget[u.uid] || 0, h: r.hitsOn[u.uid] || 0 })).sort((a, b) => b.d - a.d);
  const hhi = rows.reduce((a, q) => a + (q.d / tot) ** 2, 0);
  console.log(`  ${side[0]}  총 ${Math.round(tot)}  HHI=${hhi.toFixed(3)} (1/7=0.143 이 균등, 1.0 이 완전 집중) → 실효 표적수 ${(1 / hhi).toFixed(2)}명`);
  for (const q of rows) console.log(`    ${String(q.n).padEnd(10)} x=${String(q.x).padStart(3)}  ${String(Math.round(q.d)).padStart(7)}  (${(q.d / tot * 100).toFixed(1)}%)  ${q.h}회`);
}
