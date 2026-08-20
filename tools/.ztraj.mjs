/* 임시 — 가설 A: 첫 사망 이후 격차가 정말 눈덩이처럼 커지는가 (여러 시드 평균) */
import { setSkillResolver, createBattle } from './.engine_var.mjs';
import { getSkill } from '../src/data/skills.js';
import { unitsOf, scaled, mix } from './.zlib.mjs';
setSkillResolver(getSkill);
const base = unitsOf('A', 80, 1000);
const N = Number(process.env.N || 120);

function traj(k, n) {
  const T = 24;                       // 0.5초 간격 24칸 = 12초
  const alive = { a: new Array(T).fill(0), e: new Array(T).fill(0), cnt: new Array(T).fill(0) };
  const dps = { a: new Array(T).fill(0), e: new Array(T).fill(0) };
  let firstDeathT = 0, fdN = 0;
  for (let i = 0; i < n; i++) {
    const b = createBattle({
      allies: base.map((u, j) => ({ ...u, uid: `a_${j}` })),
      enemies: scaled(base, k).map((u, j) => ({ ...u, uid: `e_${j}`, slotIndex: j })),
      allyFormationId: 'basic', enemyFormationId: 'basic', seed: mix(i), record: true,
    });
    let t = 0, slot = 0, dA = 0, dE = 0, fd = null;
    while (!b.finished && t < 130) {
      b.step(1 / 60); t += 1 / 60;
      for (const e of b.drainEvents()) {
        if (e.type === 'damage') { if (String(e.uid).startsWith('a_')) dA += e.amount; else dE += e.amount; }
        if (e.type === 'death' && fd === null) fd = b.time;
      }
      while (slot < T && b.time >= slot * 0.5) {
        alive.a[slot] += b.units.filter((u) => u.alive && u.side === 'ally').length;
        alive.e[slot] += b.units.filter((u) => u.alive && u.side === 'enemy').length;
        dps.a[slot] += dA; dps.e[slot] += dE; alive.cnt[slot]++;
        slot++;
      }
    }
    // 전투가 끝난 뒤 칸은 마지막 상태로 채운다
    const fa = b.units.filter((u) => u.alive && u.side === 'ally').length;
    const fe = b.units.filter((u) => u.alive && u.side === 'enemy').length;
    while (slot < T) { alive.a[slot] += fa; alive.e[slot] += fe; dps.a[slot] += dA; dps.e[slot] += dE; alive.cnt[slot]++; slot++; }
    if (fd != null) { firstDeathT += fd; fdN++; }
  }
  return { alive, dps, T, fd: fdN ? firstDeathT / fdN : null };
}

console.log(`가설 A — 시간에 따른 평균 생존 수 / 누적 피해 (각 ${N}판 평균)`);
for (const k of [0.96, 0.98, 1.00, 1.02]) {
  const r = traj(k, N);
  console.log(`\n■ 적 스탯 k=${k.toFixed(2)}   첫 사망 평균 t=${r.fd ? r.fd.toFixed(1) : '-'}초`);
  console.log('    t    아군생존  적생존   생존격차   누적피해 아/적    피해비');
  for (let s = 0; s < r.T; s += 1) {
    const c = r.alive.cnt[s]; if (!c) continue;
    const a = r.alive.a[s] / c, e = r.alive.e[s] / c;
    const da = r.dps.a[s] / c, de = r.dps.e[s] / c;
    if (s * 0.5 > 11.5) break;
    console.log(`  ${(s * 0.5).toFixed(1).padStart(4)}   ${a.toFixed(2).padStart(6)}   ${e.toFixed(2).padStart(6)}   ${(a - e >= 0 ? '+' : '') + (a - e).toFixed(2).padStart(5)}    ${(da / 1000).toFixed(1).padStart(6)}k/${(de / 1000).toFixed(1).padStart(6)}k   ${de > 0 ? (da / de).toFixed(3) : '-'}`);
  }
}
