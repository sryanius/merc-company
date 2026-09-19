// §193 무대용 큰 그림 — 클래스 105 + 영웅 56(+각성) 의 raw 를 448×560 으로 → art/big/<name>.png + art/big/manifest.json
//   node tools/art/bigart.mjs [--only=name,name] [--classes] [--heroes] [--awk]   (아무 것도 안 주면 셋 다)
//   · 목록(illust_manifest.js)엔 안 넣는다 — 부팅 때 전부 메모리에 펴지므로(§162) 큰 그림은 «열 때만» 받는다 (src/art/bigart.js).
//   · 클래스는 표식(자홍 머리·청록 눈)을 그대로 둔다 — 게임이 같은 recolorInto 로 사람마다 칠한다. 영웅은 --nohair.
//   · 128색 — 48색(192 판)은 큰 그림에서 띠가 진다. 실측 갈라드 149KB(무손실) → 86KB(128색).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const GAME = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const HERE = process.env.MERC_ART_DIR || 'C:/claude/artwork';
const OUT = 'art/big';
const META = `${OUT}/manifest.json`;
const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const only = arg('only', '').split(',').filter(Boolean);
const all = !flag('classes') && !flag('heroes') && !flag('awk');

const { CLASSES } = await import(`file:///${GAME}/src/data/classes.js`);
await import(`file:///${GAME}/src/data/classes_t4.js`);
const { HERO_IDS } = await import(`file:///${GAME}/src/data/heroes.js`);

const jobs = [];
if (all || flag('classes')) for (const id of Object.keys(CLASSES)) jobs.push({ name: `illust_${id}`, raw: `${HERE}/gen/${id}_raw.png`, nohair: false });
if (all || flag('heroes')) for (const id of HERO_IDS) jobs.push({ name: `illust_hero_${id}`, raw: `${HERE}/gen_hero/${id}_raw.png`, nohair: true });
if (all || flag('awk')) for (const id of HERO_IDS) jobs.push({ name: `illust_hero_${id}_awk`, raw: `${HERE}/gen_hero_awk/${id}_awk_raw.png`, nohair: true, optional: true });

fs.mkdirSync(`${GAME}/${OUT}`, { recursive: true });
let ok = 0, skip = 0;
const bad = [];
for (const j of jobs) {
  if (only.length && !only.includes(j.name)) continue;
  if (!fs.existsSync(j.raw)) { if (j.optional) { skip++; continue; } bad.push(`${j.name}: raw 없음`); continue; }
  const a = ['tools/illustpng.mjs', j.raw, `--name=${j.name}`, '--bg=auto', '--fit=448x560', '--colors=128',
    `--out=${OUT}/${j.name}.png`, `--metaout=${META}`];
  if (j.nohair) a.push('--nohair');
  const r = spawnSync(process.execPath, a, { cwd: GAME, encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status === 0 && fs.existsSync(`${GAME}/${OUT}/${j.name}.png`)) ok++;
  else bad.push(`${j.name}: ${(r.stderr || '').split('\n').filter((l) => /✗/.test(l)).join(' | ').slice(0, 160)}`);
}
console.error(`완료: ${ok}장 · 건너뜀 ${skip} · 실패 ${bad.length}${bad.length ? '\n  ' + bad.join('\n  ') : ''}`);
process.exit(bad.length ? 1 : 0);
