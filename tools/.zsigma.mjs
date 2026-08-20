/* 임시 — 절벽 폭 σ 를 프로빗 회귀로 정량화 + 노이즈 성분 분해 */
import { setSkillResolver, createBattle } from './.engine_var.mjs';
import { getSkill } from '../src/data/skills.js';
import { unitsOf, scaled, mix } from './.zlib.mjs';
setSkillResolver(getSkill);

const base = unitsOf('A', 80, 1000);
const N = Number(process.env.N || 200);

function run(X, Y, seed, record = false) {
  const b = createBattle({
    allies: X.map((u, i) => ({ ...u, uid: `a_${i}` })),
    enemies: Y.map((u, i) => ({ ...u, uid: `e_${i}`, slotIndex: i })),
    allyFormationId: 'basic', enemyFormationId: 'basic', seed, record,
  });
  let t = 0, hits = 0;
  while (!b.finished && t < 130) {
    b.step(1 / 60); t += 1 / 60;
    if (record) for (const e of b.drainEvents()) if (e.type === 'damage') hits++;
  }
  return { winner: b.result.winner, time: b.result.time, hits };
}
function wrAt(X, k, mod) {
  let w = 0, tt = 0, hh = 0;
  const Y = scaled(X, k, mod ? mod(k) : {});
  const XX = mod ? X.map((u) => ({ ...u, stats: { ...u.stats, ...mod(1) } })) : X;
  for (let i = 0; i < N; i++) {
    const r = run(XX, Y, mix(i), i < 12);
    if (r.winner === 'ally') w += 1; else if (!r.winner || r.winner === 'draw') w += 0.5;
    tt += r.time; if (i < 12) hh += r.hits;
  }
  return { wr: w / N, t: tt / N, hits: hh / 12 };
}
// 표준정규 역함수 (Acklam 근사)
function probit(p) {
  if (p <= 0.0001) p = 0.0001; if (p >= 0.9999) p = 0.9999;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** 승률 곡선을 프로빗 직선으로 회귀 → σ_k (k 단위 표준편차) */
function sigmaOf(label, X, mod) {
  const pts = [];
  const STEP = Number(process.env.STEP || 0.02);
  for (let k = 0.90; k <= 1.201; k += STEP) {
    const r = wrAt(X, Math.round(k * 1000) / 1000, mod);
    pts.push({ k: Math.round(k * 1000) / 1000, ...r });
    if (r.wr <= 0.02 && pts.length > 3) break;
  }
  const use = pts.filter((p) => p.wr > 0.03 && p.wr < 0.97);
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of use) { const z = probit(p.wr); sx += p.k; sy += z; sxy += p.k * z; sxx += p.k * p.k; }
  const n = use.length;
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const sigma = Math.abs(1 / slope);
  const k50 = -((sy / n) - slope * (sx / n)) / slope;
  const hits = pts.reduce((a, p) => a + p.hits, 0) / pts.length;
  const time = pts.reduce((a, p) => a + p.t, 0) / pts.length;
  console.log(`${label.padEnd(34)} σ_k=${(sigma * 100).toFixed(2).padStart(5)}%  50%지점 k=${k50.toFixed(3)}  10→90%폭=${(2.563 * sigma * 100).toFixed(1).padStart(4)}%p  평균 ${time.toFixed(0)}초 / 피해 ${hits.toFixed(0)}회  (회귀점 ${n}개)`);
  console.log('    ' + pts.map((p) => `${p.k.toFixed(2)}:${(p.wr * 100).toFixed(0)}%`).join(' '));
  return { sigma, hits };
}

const which = process.argv[2] || 'all';
console.log(`각 지점 ${N}판 · JITTER=${process.env.JITTER || '0.07'}`);
if (which === 'all' || which === 'a') sigmaOf('7v7 기본', base);
if (which === 'all' || which === 'b') sigmaOf('7v7 crit=0', base, () => ({ crit: 0 }));
if (which === 'all' || which === 'c') sigmaOf('7v7 eva=0', base, () => ({ eva: 0 }));
if (which === 'all' || which === 'd') sigmaOf('7v7 crit=0,eva=0', base, () => ({ crit: 0, eva: 0 }));
if (which === '1') sigmaOf('1v1 광기의대장군', [base[1]]);
if (which === '1t') sigmaOf('1v1 관문수호자', [base[0]]);
if (which === '3') sigmaOf('3v3 (탱/딜/마)', [base[0], base[1], base[5]]);
