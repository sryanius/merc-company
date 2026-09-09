// 적 75종 일괄 생성 → 도구(--nohair) → results_enemy.json
//   node gen_enemies.mjs [--base=http://127.0.0.1:8188] [--seed=21] [--only=id,id] [--reuse] [--apply]
//   gen/fixes_enemy.json — 보정 { id: { extra, neg, seed, tags, pose, subject, weapon, bg } }
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
const OUT = HERE + '/gen_enemy';
fs.mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const base = arg('base', 'http://127.0.0.1:8188');
const seed = Number(arg('seed', 21));
const only = arg('only', '').split(',').filter(Boolean);
const reuse = flag('reuse');
const apply = flag('apply');

const { buildEnemyPrompt, enemyNegative, SETTINGS } = await import(`file:///${GAME}/tools/illustprompts.mjs`);
const enemies = JSON.parse(fs.readFileSync(DATA + '/enemies.json', 'utf8')).filter((e) => !only.length || only.includes(e.id));

const resultsPath = OUT + '/results_enemy.json';
const results = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : {};
const run = (a, opts = {}) => spawnSync(NODE, a, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });

let i = 0;
for (const e of enemies) {
  i++;
  const raw = `${OUT}/${e.id}_raw.png`, out = `${OUT}/${e.id}_192.png`;
  const t0 = Date.now();
  let genSec = 0;
  const fixes = fs.existsSync(DATA + '/fixes_enemy.json') ? JSON.parse(fs.readFileSync(DATA + '/fixes_enemy.json', 'utf8')) : {};
  const fx = fixes[e.id] || {};
  if (!(reuse && fs.existsSync(raw))) {
    const prompt = buildEnemyPrompt(e.id, fx.extra || '', fx);
    if (!prompt) { results[e.id] = { name: e.name, ok: false, stage: 'prompt', err: 'ENEMY_TAGS 에 없다' }; console.error(`[${i}/${enemies.length}] ${e.id}: ✗ 태그 없음`); continue; }
    const neg = enemyNegative(e.id) + (fx.neg ? ', ' + fx.neg : '');
    const useSeed = fx.seed != null ? fx.seed : seed;
    const genArgs = [CLIENT, `--base=${base}`, '--ckpt=animagine-xl-4.0.safetensors', `--prompt=${prompt}`, `--neg=${neg}`,
      `--w=${SETTINGS.w}`, `--h=${SETTINGS.h}`, `--steps=${SETTINGS.steps}`, `--cfg=${SETTINGS.cfg}`,
      `--sampler=${SETTINGS.sampler}`, `--scheduler=${SETTINGS.scheduler}`, `--seed=${useSeed}`, `--out=${raw}`];
    if (fx.pose_cn) {
      const poseFile = OUT + "/pose_" + fx.pose_cn + ".png";
      if (!fs.existsSync(poseFile)) {
        const { POSES, renderPose } = await import("file:///C:/claude/game/tools/openpose.mjs");
        const { encodePng } = await import("file:///C:/claude/game/tools/lib/png.mjs");
        const buf = renderPose(POSES[fx.pose_cn].pts, SETTINGS.w, SETTINGS.h);
        fs.writeFileSync(poseFile, encodePng(SETTINGS.w, SETTINGS.h, Buffer.from(buf.buffer)));
      }
      genArgs.push("--cn=openpose-sdxl-xinsir.safetensors", `--cnimage=${poseFile}`, `--cnstrength=${fx.cn_strength || 1.0}`, "--cnend=1.0");
    }
    const g = run(genArgs);
    genSec = (Date.now() - t0) / 1000;
    if (g.status !== 0) {
      results[e.id] = { name: e.name, ok: false, stage: 'generate', err: (g.stderr || '').slice(-300) };
      console.error(`[${i}/${enemies.length}] ${e.id} ${e.name}: ✗ 생성 실패 ${(g.stderr || '').slice(-120)}`);
      fs.writeFileSync(resultsPath, JSON.stringify(results, null, 1));
      continue;
    }
  }
  const toolArgs = [`${GAME}/tools/illustpng.mjs`, raw, `--name=illust_enemy_${e.id}`, '--bg=auto', '--fit=192x240', '--colors=48', '--nohair', `--out=${out}`];
  if (apply) toolArgs.push('--apply');
  const t = run(toolArgs, { cwd: GAME });
  const log = t.stderr || '';
  const pick = (re) => { const m = re.exec(log); return m ? m[1] : null; };
  const rec = {
    name: e.name, tier: e.tier, boss: e.boss, ok: t.status === 0, stage: t.status === 0 ? (apply ? 'applied' : 'processed') : 'tool',
    genSec: Math.round(genSec * 10) / 10, seed: fx.seed != null ? fx.seed : seed,
    keyed: pick(/투명 \(([\d.]+)%\)/),
    warn: [...log.matchAll(/⚠ ([^\n]+)/g)].map((m) => m[1].trim()).slice(0, 4),
    err: t.status === 0 ? null : [...log.matchAll(/✗ ([^\n]+)/g)].map((m) => m[1].trim()).join(' | ').slice(0, 300),
  };
  results[e.id] = rec;
  console.error(`[${i}/${enemies.length}] ${e.id} ${e.name} (t${e.tier}${e.boss ? ' BOSS' : ''}): ${rec.ok ? '✓' : '✗'} ${genSec ? genSec.toFixed(1) + 's' : '재사용'} · 배경 ${rec.keyed || '?'}%${rec.err ? ' · ' + rec.err : ''}`);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 1));
}
const ok = Object.values(results).filter((r) => r.ok).length;
console.error(`\n완료: ${ok}/${Object.keys(results).length} 통과 · ${resultsPath}`);
