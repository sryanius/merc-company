// 105 클래스 일괄 생성 → 도구로 처리(--out, 적용은 안 함) → 결과 표(results.json)
//   node gen_all.mjs [--base=http://127.0.0.1:8188] [--seed=11] [--only=id,id] [--style=fighter] [--reuse] [--apply]
//   --apply : 처리 통과한 것을 게임에 넣는다 (검수 뒤에 쓴다)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
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
const OUT = HERE + '/gen';
fs.mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const base = arg('base', 'http://127.0.0.1:8188');
const seed = Number(arg('seed', 11));
const only = arg('only', '').split(',').filter(Boolean);
const styleFilter = arg('style', '');
const reuse = flag('reuse');
const apply = flag('apply');

const { buildClassPrompt, classNegative, NEGATIVE, SETTINGS } = await import(`file:///${GAME}/tools/illustprompts.mjs`);
const classes = JSON.parse(fs.readFileSync(DATA + '/classes.json', 'utf8'))
  .filter((c) => (!only.length || only.includes(c.id)) && (!styleFilter || c.style === styleFilter));

const resultsPath = OUT + '/results.json';
const results = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : {};
const run = (a, opts = {}) => spawnSync(NODE, a, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });

let i = 0;
for (const c of classes) {
  i++;
  const raw = `${OUT}/${c.id}_raw.png`, out = `${OUT}/${c.id}_192.png`;
  const t0 = Date.now();
  let genSec = 0;
  if (!(reuse && fs.existsSync(raw))) {
    /* gen/fixes.json — 검수가 준 보정: { id: { extra: '추가 태그', neg: '추가 부정', seed: 12 } } */
    const fixes = fs.existsSync(DATA + '/fixes.json') ? JSON.parse(fs.readFileSync(DATA + '/fixes.json', 'utf8')) : {};
    const fx = fixes[c.id] || {};
    const prompt = buildClassPrompt(c.id, c.style, fx.extra || '', fx);
    const cn = classNegative ? classNegative(c.id) : '';
    const neg = NEGATIVE + (cn ? ', ' + cn : '') + (fx.neg ? ', ' + fx.neg : '');
    const useSeed = fx.seed != null ? fx.seed : seed;
    const g = run([CLIENT, `--base=${base}`, '--ckpt=animagine-xl-4.0.safetensors', `--prompt=${prompt}`, `--neg=${neg}`,
      `--w=${SETTINGS.w}`, `--h=${SETTINGS.h}`, `--steps=${SETTINGS.steps}`, `--cfg=${SETTINGS.cfg}`,
      `--sampler=${SETTINGS.sampler}`, `--scheduler=${SETTINGS.scheduler}`, `--seed=${useSeed}`, `--out=${raw}`]);
    genSec = (Date.now() - t0) / 1000;
    if (g.status !== 0) {
      results[c.id] = { name: c.name, style: c.style, ok: false, stage: 'generate', err: (g.stderr || '').slice(-300) };
      console.error(`[${i}/${classes.length}] ${c.id} ${c.name}: ✗ 생성 실패`);
      fs.writeFileSync(resultsPath, JSON.stringify(results, null, 1));
      continue;
    }
  }
  const toolArgs = [`${GAME}/tools/illustpng.mjs`, raw, `--name=illust_${c.id}`, '--bg=auto', '--fit=192x240', '--colors=48', `--out=${out}`];
  if (apply) toolArgs.push('--apply');
  const t = run(toolArgs, { cwd: GAME });
  const log = t.stderr || '';
  const pick = (re) => { const m = re.exec(log); return m ? m[1] : null; };
  const rec = {
    name: c.name, style: c.style, tier: c.tier, ok: t.status === 0, stage: t.status === 0 ? (apply ? 'applied' : 'processed') : 'tool',
    genSec: Math.round(genSec * 10) / 10,
    keyed: pick(/투명 \(([\d.]+)%\)/), hairPx: pick(/머리 표식 (\d+)칸/), eyeBox: pick(/눈 상자 ([\d,]+)/),
    warn: [...log.matchAll(/⚠ ([^\n]+)/g)].map((m) => m[1].trim()).slice(0, 4),
    err: t.status === 0 ? null : [...log.matchAll(/✗ ([^\n]+)/g)].map((m) => m[1].trim()).join(' | ').slice(0, 300),
  };
  results[c.id] = rec;
  console.error(`[${i}/${classes.length}] ${c.id} ${c.name} (${c.style} t${c.tier}): ${rec.ok ? '✓' : '✗'} ${genSec ? genSec.toFixed(1) + 's' : '재사용'} · 배경 ${rec.keyed || '?'}% · 머리 ${rec.hairPx || '?'}칸${rec.err ? ' · ' + rec.err : ''}`);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 1));
}
const ok = Object.values(results).filter((r) => r.ok).length;
console.error(`\n완료: ${ok}/${Object.keys(results).length} 통과 · ${resultsPath}`);
