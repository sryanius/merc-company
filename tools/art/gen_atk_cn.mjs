// 공격 포즈 — ControlNet OpenPose 로 자세를 강제하고, 옷은 대기 그림의 프롬프트(+img2img)가 지킨다. HANDOFF §166.
//   node gen_atk_cn.mjs [--only=id,id] [--cnstrength=0.9] [--denoise=0.85] [--txt2img] [--seed=same|<n>] [--suffix=x] [--reuse] [--apply]
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
const POSEDIR = OUT + '/poses';
fs.mkdirSync(POSEDIR, { recursive: true });

const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const base = arg('base', 'http://127.0.0.1:8188');
const only = arg('only', '').split(',').filter(Boolean);
const cnStrength = Number(arg('cnstrength', 0.9));
const cnEnd = Number(arg('cnend', 0.85));
const denoise = Number(arg('denoise', 0.85));
const txt2img = flag('txt2img');
const seedArg = arg('seed', 'same');
const suffix = arg('suffix', '');
const reuse = flag('reuse');
const apply = flag('apply');
const CN = 'openpose-sdxl-xinsir.safetensors';

const { buildClassAttackPrompt, classNegative, NEGATIVE_ATK, SETTINGS } = await import(`file:///${GAME}/tools/illustprompts.mjs`);
const { POSES, POSE_FOR_WEAPON, renderPose } = await import(`file:///${GAME}/tools/openpose.mjs`);
const { encodePng } = await import(`file:///${GAME}/tools/lib/png.mjs`);

const classes = JSON.parse(fs.readFileSync(DATA + '/classes.json', 'utf8')).filter((c) => !only.length || only.includes(c.id));
const idleFixes = fs.existsSync(DATA + '/fixes.json') ? JSON.parse(fs.readFileSync(DATA + '/fixes.json', 'utf8')) : {};

/* 자세 그림은 무기별로 한 번만 만든다 */
const poseFile = (name) => {
  const f = `${POSEDIR}/${name}.png`;
  if (!fs.existsSync(f) && !name.startsWith("cls_")) {
    const buf = renderPose(POSES[name].pts, SETTINGS.w, SETTINGS.h);
    fs.writeFileSync(f, encodePng(SETTINGS.w, SETTINGS.h, Buffer.from(buf.buffer)));
  }
  return f;
};

const resultsPath = OUT + '/results_cn.json';
const results = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : {};
const run = (a, opts = {}) => spawnSync(NODE, a, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });

let i = 0;
for (const c of classes) {
  i++;
  const raw = `${OUT}/${c.id}${suffix}_raw.png`, out = `${OUT}/${c.id}${suffix}_192.png`;
  const ifx = idleFixes[c.id] || {};
  /* ★ 클래스 전용 골격 (§170) — gen_atk/class_skeletons.json 에 있으면 그걸 쓴다. 무기 계열 골격이 그 클래스의 대기와 너무 닮아 실패한 것들. */
  const CLS = fs.existsSync(DATA + "/class_skeletons.json") ? JSON.parse(fs.readFileSync(DATA + "/class_skeletons.json", "utf8")) : {};
  const poseName = CLS[c.id] ? "cls_" + c.id : (POSE_FOR_WEAPON[c.equip[0]] || "claw_strike");
  const t0 = Date.now();
  let genSec = 0;
  if (!(reuse && fs.existsSync(raw))) {
    /* ★ §170.1 — gen_atk/init_<id>.png 가 있으면 그걸 초기 이미지로 쓴다.
       그건 «출고된 대기 PNG» 를 되키운 그림이라, 옷·색이 실제 화면과 글자 그대로 같다.
       대기 raw 를 잃은(프롬프트가 바뀌어 재현 안 되는) 클래스의 짝 어긋남을 원천에서 막는다. */
    const initRaw = fs.existsSync(`${OUT}/init_${c.id}.png`) ? `${OUT}/init_${c.id}.png` : `${IDLE}/${c.id}_raw.png`;
    if (!txt2img && !fs.existsSync(initRaw)) { console.error(`[${i}/${classes.length}] ${c.id}: ✗ 대기 raw 없음`); continue; }
    /* 자세는 ControlNet 이 잡으니 프롬프트의 동작 가중은 낮춘다 (1.15) — 둘이 싸우면 옷이 흔들린다 */
    /* ★ §170.2 — atkTags 가 있으면 클래스 태그 자리를 그것으로 바꾼다 (프롬프트 한가운데, 옷이 정해지는 자리). */
    const ov = ifx.atkTags ? { ...ifx, tags: ifx.atkTags } : ifx;
    const prompt = buildClassAttackPrompt(c.id, c.style, '', ov, { actWeight: 1.15, withBg: true });
    const cn = classNegative ? classNegative(c.id) : '';
    const neg = NEGATIVE_ATK + (cn ? ', ' + cn : '') + (ifx.neg ? ', ' + ifx.neg : '') + (ifx.atkNeg ? ', ' + ifx.atkNeg : '');
    const useSeed = seedArg === 'same' ? (ifx.seed != null ? ifx.seed : 11) : Number(seedArg);
    const a = [CLIENT, `--base=${base}`, '--ckpt=animagine-xl-4.0.safetensors', `--prompt=${prompt}`, `--neg=${neg}`,
      `--w=${SETTINGS.w}`, `--h=${SETTINGS.h}`, `--steps=${SETTINGS.steps}`, `--cfg=${SETTINGS.cfg}`,
      `--sampler=${SETTINGS.sampler}`, `--scheduler=${SETTINGS.scheduler}`, `--seed=${useSeed}`, `--out=${raw}`,
      `--cn=${CN}`, `--cnimage=${poseFile(poseName)}`, `--cnstrength=${cnStrength}`, `--cnend=${cnEnd}`];
    if (!txt2img) a.push(`--init=${initRaw}`, `--denoise=${denoise}`);
    const g = run(a);
    genSec = (Date.now() - t0) / 1000;
    if (g.status !== 0) {
      results[c.id] = { name: c.name, ok: false, stage: 'generate', err: (g.stderr || '').slice(-300) };
      console.error(`[${i}/${classes.length}] ${c.id} ${c.name}: ✗ 생성 실패 ${(g.stderr || '').slice(-200)}`);
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
    name: c.name, style: c.style, pose: poseName, ok: t.status === 0,
    stage: t.status === 0 ? (apply ? 'applied' : 'processed') : 'tool',
    genSec: Math.round(genSec * 10) / 10, keyed: pick(/투명 \(([\d.]+)%\)/), hairPx: pick(/머리 표식 (\d+)칸/),
    err: t.status === 0 ? null : [...log.matchAll(/✗ ([^\n]+)/g)].map((m) => m[1].trim()).join(' | ').slice(0, 200),
  };
  results[c.id] = rec;
  console.error(`[${i}/${classes.length}] ${c.id} ${c.name} [${poseName}]: ${rec.ok ? '✓' : '✗'} ${genSec ? genSec.toFixed(1) + 's' : '재사용'} · 배경 ${rec.keyed || '?'}% · 머리 ${rec.hairPx || '?'}칸${rec.err ? ' · ' + rec.err : ''}`);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 1));
}
const ok = Object.values(results).filter((r) => r.ok).length;
console.error(`\n완료: ${ok}/${Object.keys(results).length} 통과 · ${resultsPath}`);
