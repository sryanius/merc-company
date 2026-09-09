// §180 던전 난이도 격자 — tools/dungeon.mjs 를 여러 (early, wall) 로 돌려 풀세트 도달·완주·게이트만 뽑는다
//   node grid_dg.mjs --diff=hard --settier=1 [--basetier=0] --early=1.6,1.8,2.0 --wall=1.3 [--grade=S] [--n=6 --nrun=10]
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const diff = arg('diff', 'hard'), settier = arg('settier', '1'), basetier = arg('basetier', '0'), grade = arg('grade', 'S');
const earlys = arg('early', '').split(',').filter(Boolean).map(Number);
const walls = arg('wall', '').split(',').filter(Boolean).map(Number);
const n = arg('n', '6'), nrun = arg('nrun', '10');

function one(early, wall) {
  const a = ['tools/dungeon.mjs', `--grade=${grade}`, `--diff=${diff}`, `--settier=${settier}`, `--n=${n}`, `--nrun=${nrun}`];
  if (Number(basetier) > 0) a.push(`--basetier=${basetier}`);
  if (early) a.push(`--early=${early}`);
  if (wall) a.push(`--wall=${wall}`);
  const r = spawnSync(process.execPath, a, { cwd: 'C:/claude/game', encoding: 'utf8', maxBuffer: 1 << 24 });
  const out = (r.stdout || '') + (r.stderr || '');
  // 3. 던전 런 표
  const sec = out.slice(out.indexOf('3. 던전 런'), out.indexOf('4. 설계 C'));
  const row = (label) => {
    const m = sec.split('\n').find((l) => l.trim().startsWith(label));
    if (!m) return null;
    const cells = m.trim().split(/\s+/);
    return { reach: cells[1], w5: cells[5], w7: cells[6], w10: cells[7] };
  };
  const full = row('풀세트'), s5 = row('세트5'), s8 = row('세트8'), s0 = row('전설10');
  const gate = (re) => { const m = out.match(re); return m ? m[1].trim() : '?'; };
  return {
    full, s5, s8, s0,
    acc: gate(/\[(OK  |FAIL)\] ★ 장신구 게이트/), wep: gate(/\[(OK  |FAIL)\] ★ 무기 게이트/), clear: gate(/\[(OK  |FAIL)\] 풀세트 · 10웨이브 완주/),
  };
}

console.log(`diff=${diff} settier=${settier} basetier=${basetier} grade=${grade}`);
console.log('early  wall | 전설10 도달 | 세트5 도달·7웨↑ | 세트8 도달·10웨 | 풀세트 도달·10웨 | 장신구/무기/완주');
for (const e of (earlys.length ? earlys : [0])) {
  for (const w of (walls.length ? walls : [0])) {
    const r = one(e, w);
    const f = (x) => (x ? `${x.reach}·${x.w7 || '?'}·${x.w10}` : '-');
    console.log(`${String(e || '-').padStart(5)}  ${String(w || '-').padStart(4)} | ${r.s0 ? r.s0.reach : '-'} | ${r.s5 ? `${r.s5.reach}·${r.s5.w7}` : '-'} | ${r.s8 ? `${r.s8.reach}·${r.s8.w10}` : '-'} | ${r.full ? `${r.full.reach}·${r.full.w10}` : '-'} | ${r.acc}/${r.wep}/${r.clear}`);
  }
}
