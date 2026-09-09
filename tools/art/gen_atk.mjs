// 공격 포즈 생성 — 대기 raw(gen/<id>_raw.png)를 img2img 초기 이미지로 → gen_atk/<id>_raw.png → 도구(illust_<id>_atk)
//   node gen_atk.mjs [--only=id,id] [--denoise=0.6] [--seed=<n|same>] [--reuse] [--apply] [--txt2img] [--suffix=x]
//   gen_atk/fixes_atk.json — { id: { extra, neg, seed, denoise } }
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const NODE = process.execPath;
const CLIENT = 'C:/claude/pinokio_agent/skills/maoper11/inteliweb-comfyui/clients/generate.mjs';
const GAME = 'C:/claude/game';
/* ★ §183 입력(원고·보정표)은 저장소 안 tools/art/data 에, 중간 산출물(수백 MB)은 저장소 밖에 둔다.
 *   작업 폴더는 환경변수 MERC_ART_DIR 로 바꿈 — 기본 C:/claude/artwork (경로는 / 로 적어라). */
const DATA = fileURLToPath(new URL('./data', import.meta.url));
const HERE = process.env.MERC_ART_DIR || 'C:/claude/artwork';
fs.mkdirSync(HERE, { recursive: true });
const IDLE = HERE + '/gen';
const OUT = HERE + '/gen_atk';
fs.mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const base = arg('base', 'http://127.0.0.1:8188');
const only = arg('only', '').split(',').filter(Boolean);
const denoiseDefault = Number(arg('denoise', 0.6));
const seedArg = arg('seed', 'same');
const reuse = flag('reuse');
const apply = flag('apply');
const txt2img = flag('txt2img');
const suffix = arg('suffix', '');
const actWeight = Number(arg('actw', 1.2));
const withBg = flag('bg') ? true : txt2img;   // img2img 기본: BG 태그 없음 (--bg 로 켤 수 있다)

const { buildClassAttackPrompt, classNegative, NEGATIVE_ATK, SETTINGS } = await import(`file:///${GAME}/tools/illustprompts.mjs`);
const classes = JSON.parse(fs.readFileSync(DATA + '/classes.json', 'utf8')).filter((c) => !only.length || only.includes(c.id));
const idleFixes = fs.existsSync(DATA + '/fixes.json') ? JSON.parse(fs.readFileSync(DATA + '/fixes.json', 'utf8')) : {};
const idleResults = fs.existsSync(IDLE + '/results.json') ? JSON.parse(fs.readFileSync(IDLE + '/results.json', 'utf8')) : {};

const resultsPath = OUT + '/results_atk.json';
const results = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : {};
const run = (a, opts = {}) => spawnSync(NODE, a, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });

let i = 0;
for (const c of classes) {
  i++;
  const initRaw = `${IDLE}/${c.id}_raw.png`;
  const raw = `${OUT}/${c.id}${suffix}_raw.png`, out = `${OUT}/${c.id}${suffix}_192.png`;
  const fixes = fs.existsSync(DATA + '/fixes_atk.json') ? JSON.parse(fs.readFileSync(DATA + '/fixes_atk.json', 'utf8')) : {};
  const fx = fixes[c.id] || {};
  const ifx = idleFixes[c.id] || {};
  const t0 = Date.now();
  let genSec = 0;
  if (!(reuse && fs.existsSync(raw))) {
    if (!txt2img && !fs.existsSync(initRaw)) { results[c.id] = { name: c.name, ok: false, stage: 'init', err: '대기 raw 없음' }; console.error(`[${i}/${classes.length}] ${c.id}: ✗ 대기 raw 없음`); continue; }
    /* 대기 그림과 같은 태그 재정의(6차 fixes.json 의 tags/hairStyle)를 쓴다 — 같은 옷이어야 한다 */
    const prompt = buildClassAttackPrompt(c.id, c.style, fx.extra || '', ifx, { actWeight, withBg });
    const cn = classNegative ? classNegative(c.id) : '';
    const neg = NEGATIVE_ATK + (cn ? ', ' + cn : '') + (ifx.neg ? ', ' + ifx.neg : '') + (fx.neg ? ', ' + fx.neg : '');
    const idleSeed = ifx.seed != null ? ifx.seed : 11;
    const useSeed = fx.seed != null ? fx.seed : (seedArg === 'same' ? idleSeed : Number(seedArg));
    const denoise = fx.denoise != null ? fx.denoise : denoiseDefault;
    const a = [CLIENT, `--base=${base}`, '--ckpt=animagine-xl-4.0.safetensors', `--prompt=${prompt}`, `--neg=${neg}`,
      `--w=${SETTINGS.w}`, `--h=${SETTINGS.h}`, `--steps=${SETTINGS.steps}`, `--cfg=${SETTINGS.cfg}`,
      `--sampler=${SETTINGS.sampler}`, `--scheduler=${SETTINGS.scheduler}`, `--seed=${useSeed}`, `--out=${raw}`];
    if (!txt2img) a.push(`--init=${initRaw}`, `--denoise=${denoise}`);
    const g = run(a);
    genSec = (Date.now() - t0) / 1000;
    if (g.status !== 0) {
      results[c.id] = { name: c.name, ok: false, stage: 'generate', err: (g.stderr || '').slice(-300) };
      console.error(`[${i}/${classes.length}] ${c.id} ${c.name}: ✗ 생성 실패 ${(g.stderr || '').slice(-160)}`);
      fs.writeFileSync(resultsPath, JSON.stringify(results, null, 1));
      continue;
    }
  }
  const toolArgs = [`${GAME}/tools/illustpng.mjs`, raw, `--name=illust_${c.id}_atk`, '--bg=auto', '--fit=192x240', '--colors=48', `--out=${out}`];
  if (apply) toolArgs.push('--apply');
  const t = run(toolArgs, { cwd: GAME });
  const log = t.stderr || '';
  const pick = (re) => { const m = re.exec(log); return m ? m[1] : null; };
  const rec = {
    name: c.name, style: c.style, ok: t.status === 0, stage: t.status === 0 ? (apply ? 'applied' : 'processed') : 'tool',
    genSec: Math.round(genSec * 10) / 10, keyed: pick(/투명 \(([\d.]+)%\)/), hairPx: pick(/머리 표식 (\d+)칸/),
    warn: [...log.matchAll(/⚠ ([^\n]+)/g)].map((m) => m[1].trim()).slice(0, 4),
    err: t.status === 0 ? null : [...log.matchAll(/✗ ([^\n]+)/g)].map((m) => m[1].trim()).join(' | ').slice(0, 300),
  };
  results[c.id] = rec;
  console.error(`[${i}/${classes.length}] ${c.id} ${c.name}: ${rec.ok ? '✓' : '✗'} ${genSec ? genSec.toFixed(1) + 's' : '재사용'} · 배경 ${rec.keyed || '?'}% · 머리 ${rec.hairPx || '?'}칸${rec.err ? ' · ' + rec.err : ''}`);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 1));
}
const ok = Object.values(results).filter((r) => r.ok).length;
console.error(`\n완료: ${ok}/${Object.keys(results).length} 통과 · ${resultsPath}`);
