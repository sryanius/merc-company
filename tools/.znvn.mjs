/* 임시 — 가설 A 통제 실험: 같은 클래스 N명 vs N명 으로 인원수만 바꿔 σ 를 잰다 */
import { setSkillResolver, createBattle } from './.engine_var.mjs';
import { getSkill } from '../src/data/skills.js';
import { unitsOf, scaled, mix } from './.zlib.mjs';
setSkillResolver(getSkill);
const base = unitsOf('A', 80, 1000);
const N = Number(process.env.N || 200);

function probit(p) {
  if (p <= 0.002) p = 0.002; if (p >= 0.998) p = 0.998;
  // Beasley-Springer-Moro 근사로 충분
  const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
  const b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833];
  const c = [0.3374754822726147, 0.9761690190917186, 0.1607979714918209, 0.0276438810333863, 0.0038405729373609, 0.0003951896511919, 0.0000321767881768, 0.0000002888167364, 0.0000003960315187];
  const y = p - 0.5;
  if (Math.abs(y) < 0.42) { const r = y * y; return y * (((a[3] * r + a[2]) * r + a[1]) * r + a[0]) / ((((b[3] * r + b[2]) * r + b[1]) * r + b[0]) * r + 1); }
  let r = p > 0.5 ? 1 - p : p;
  r = Math.log(-Math.log(r));
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] * Math.pow(r, i);
  return p > 0.5 ? x : -x;
}

function measure(label, defs) {
  const pts = [];
  for (let k = 0.90; k <= 1.301; k += 0.02) {
    const kk = Math.round(k * 1000) / 1000;
    const Y = scaled(defs, kk);
    let w = 0, hits = 0, tsum = 0;
    for (let i = 0; i < N; i++) {
      const rec = i < 10;
      const b = createBattle({
        allies: defs.map((u, j) => ({ ...u, uid: `a_${j}` })),
        enemies: Y.map((u, j) => ({ ...u, uid: `e_${j}`, slotIndex: j })),
        allyFormationId: 'basic', enemyFormationId: 'basic', seed: mix(i), record: rec,
      });
      let t = 0;
      while (!b.finished && t < 130) { b.step(1 / 60); t += 1 / 60; if (rec) for (const e of b.drainEvents()) if (e.type === 'damage') hits++; }
      if (b.result.winner === 'ally') w += 1; else if (b.result.winner !== 'enemy') w += 0.5;
      tsum += b.result.time;
    }
    pts.push({ k: kk, wr: w / N, hits: hits / 10, t: tsum / N });
    if (w / N <= 0.02 && pts.length > 3) break;
  }
  const use = pts.filter((p) => p.wr > 0.03 && p.wr < 0.97);
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of use) { const z = probit(p.wr); sx += p.k; sy += z; sxy += p.k * z; sxx += p.k * p.k; }
  const n = use.length;
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const sigma = Math.abs(1 / slope);
  const hits = pts.reduce((a, p) => a + p.hits, 0) / pts.length;
  const time = pts.reduce((a, p) => a + p.t, 0) / pts.length;
  console.log(`${label.padEnd(22)} σ_k=${(sigma * 100).toFixed(2).padStart(5)}%  피해횟수 ${hits.toFixed(0).padStart(5)}  σ*√hits=${(sigma * 100 * Math.sqrt(hits)).toFixed(1).padStart(5)}  평균 ${time.toFixed(0).padStart(3)}초 (점${n})`);
  console.log('   ' + pts.map((p) => `${p.k.toFixed(2)}:${(p.wr * 100).toFixed(0)}`).join(' '));
}

console.log(`같은 클래스만 N명씩 (각 지점 ${N}판) — 인원수만 바꾼다`);
const cls = { mad: base[1], tank: base[0], mage: base[5] };
const pick = process.argv[2] || 'mad';
const u = cls[pick];
console.log(`유닛: ${u.name}\n`);
for (const n of [1, 2, 3, 5, 7]) {
  const defs = Array.from({ length: n }, (_, i) => ({ ...u, slot: { x: (i % 3) * 0.5, y: (i / 3 | 0) * 0.5 } }));
  measure(`${n}v${n}`, defs);
}
