// §176 영웅 일러스트 — 대기(txt2img · Animagine XL 4.0) + 공격(Qwen-Image-Edit «자세만») → illust_hero_<id>(_atk)
//   node gen_hero_art.mjs [--only=id,id] [--stage=idle|atk|all] [--seed=21] [--reuse] [--apply] [--base=http://127.0.0.1:8188]
//   · 영웅은 고정된 외모다 — 머리·눈 표식(보라/청록)을 쓰지 않고 색을 직접 정한다 (--nohair 로 넣는다: 게임이 재색을 안 한다)
//   · 대기 raw(896x1152, 라임 배경)를 Qwen 에 넣어 «자세만» 바꾼다 (§171 방식) → 옷·색이 원본 픽셀 그대로라 짝이 안 어긋난다
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const NODE = process.execPath;
const CLIENT = 'C:/claude/pinokio_agent/skills/maoper11/inteliweb-comfyui/clients/generate.mjs';
const PY = 'C:/pinokio/api/inteliweb-comfyui/app/env/Scripts/python.exe';
const EDIT = 'C:/claude/image-edit/edit.py';
const GAME = 'C:/claude/game';
/* ★ §183 입력(원고·보정표)은 저장소 안 tools/art/data 에, 중간 산출물(수백 MB)은 저장소 밖에 둔다.
 *   작업 폴더는 환경변수 MERC_ART_DIR 로 바꿈 — 기본 C:/claude/artwork (경로는 / 로 적어라). */
const DATA = fileURLToPath(new URL('./data', import.meta.url));
const HERE = process.env.MERC_ART_DIR || 'C:/claude/artwork';
fs.mkdirSync(HERE, { recursive: true });
const OUT = HERE + '/gen_hero';
const TMP = OUT + '/_tmp';
fs.mkdirSync(TMP, { recursive: true });

const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const base = arg('base', 'http://127.0.0.1:8188');
const seed = Number(arg('seed', 21));
const only = arg('only', '').split(',').filter(Boolean);
const stage = arg('stage', 'all');
const reuse = flag('reuse');
const apply = flag('apply');

const { buildClassPrompt, classNegative, NEGATIVE, SETTINGS } = await import(`file:///${GAME}/tools/illustprompts.mjs`);
const { CLASS_TAGS } = await import(`file:///${GAME}/tools/illustprompts_classes.mjs`);
const { HEROES, HERO_IDS } = await import(`file:///${GAME}/src/data/heroes.js`);

/* ── 고정 외모 — 표식 색(보라 머리·청록 눈)과 키 색(라임)을 피한다. 같은 3차에서 갈라진 apex/abyss 가 다르게. */
const HAIR = ['silver hair', 'jet black hair', 'blonde hair', 'crimson red hair', 'snow white hair', 'dark brown hair',
  'navy blue hair', 'ash gray hair', 'platinum blonde hair', 'auburn hair', 'golden hair', 'dark blue hair',
  'chestnut brown hair', 'copper red hair', 'black hair with silver streaks', 'pale blonde hair'];
const EYES = ['golden eyes', 'red eyes', 'blue eyes', 'amber eyes', 'gray eyes', 'crimson eyes',
  'ice blue eyes', 'brown eyes', 'orange eyes', 'yellow eyes', 'silver eyes', 'dark blue eyes'];
export function lookOf(id) {
  const i = HERO_IDS.indexOf(id);
  return { hair: HAIR[(i * 7 + 3) % HAIR.length], eyes: EYES[(i * 5 + 1) % EYES.length] };
}
const LEAD_MARKER = '(vivid purple hair:1.3), (bright violet hair:1.2), saturated purple hair, glossy hair, cyan eyes, aqua eyes';
/* 영웅 표식 — «더 이쁘고 멋진»: 장식·자수·망토·후광. 토큰 절벽(§170.3)을 넘지 않게 짧게. */
const REGALIA = '(ornate gold trim:1.1), intricate detailed armor, elaborate embroidery, jeweled hair ornament, flowing cape, majestic aura, dramatic rim lighting';
const HERO_NEG = 'purple hair, violet hair, pink hair, green hair, teal hair, cyan eyes, aqua eyes, green eyes';

/* Qwen 자세 지시 — 무기(equip[0])별. §171: 한 문장에 «바꿀 것» + «지킬 것» 을 같이 적는다 (turbo 는 부정을 무시한다) */
const POSE = {
  sword: 'a sword slash: she swings the sword across her body in a wide stance, torso turned', greatsword: 'an overhead greatsword swing with a wide stance, both hands on the hilt',
  katana: 'a katana slash, iaido draw cut, wide stance', rapier: 'a lunging rapier thrust, front leg bent, blade extended forward',
  dagger: 'a lunging dagger slash, reverse grip, low stance', twindagger: 'a dual dagger slash, lunging forward, low stance',
  axe: 'a wide battle axe swing, wide stance', greataxe: 'an overhead great axe swing, wide stance', mace: 'a mace swing across her body, wide stance',
  hammer: 'an overhead war hammer swing, wide stance', spear: 'a spear thrust, lunging forward with the spear extended', pike: 'a pike thrust, lunging forward',
  halberd: 'a halberd sweep, wide stance', scythe: 'a scythe sweep across her body, wide stance',
  bow: 'drawing the bow, arrow nocked, bowstring pulled back, aiming forward', longbow: 'drawing the longbow, arrow nocked, bowstring pulled back, aiming forward',
  crossbow: 'aiming the crossbow forward, stock at her shoulder', staff: 'a spellcasting pose: staff raised high, a glow at the staff tip',
  wand: 'a spellcasting pose: wand pointed forward, a glow at the wand tip', tome: 'a spellcasting pose: the open grimoire glowing, one hand raised',
  claw: 'a clawed strike, lunging forward, martial arts stance', orb: 'a spellcasting pose: the orb glowing, one hand raised', shield: 'a shield bash, charging forward with the shield raised',
};

const ids = (only.length ? only : HERO_IDS).filter((id) => HEROES[id]);
const resultsPath = OUT + '/results.json';
const results = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : {};
const save = () => fs.writeFileSync(resultsPath, JSON.stringify(results, null, 1));
const run = (a, opts = {}) => spawnSync(NODE, a, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 24, ...opts });
const pick = (log, re) => { const m = re.exec(log); return m ? m[1] : null; };

function ingest(raw, name, out) {
  const a = [`${GAME}/tools/illustpng.mjs`, raw, `--name=${name}`, '--bg=auto', '--fit=192x240', '--colors=48', '--nohair', `--out=${out}`];
  if (apply) a.push('--apply');
  const t = run(a, { cwd: GAME });
  const log = t.stderr || '';
  return {
    ok: t.status === 0, keyed: pick(log, /투명 \(([\d.]+)%\)/),
    warn: [...log.matchAll(/⚠ ([^\n]+)/g)].map((m) => m[1].trim()).slice(0, 3),
    err: t.status === 0 ? null : [...log.matchAll(/✗ ([^\n]+)/g)].map((m) => m[1].trim()).join(' | ').slice(0, 200),
  };
}

let i = 0;
for (const id of ids) {
  i++;
  const h = HEROES[id];
  const ct = CLASS_TAGS[id];
  if (!ct) { console.error(`[${i}] ${id}: CLASS_TAGS 없음`); continue; }
  const look = lookOf(id);
  const rec = results[id] || { name: h.name, cls: ct.name };
  const rawIdle = `${OUT}/${id}_raw.png`, idle192 = `${OUT}/${id}_192.png`;
  const rawAtk = `${OUT}/${id}_atk_raw.png`, atk192 = `${OUT}/${id}_atk_192.png`;

  /* ── 대기 ── */
  if (stage === 'idle' || stage === 'all') {
    const t0 = Date.now();
    if (!(reuse && fs.existsSync(rawIdle))) {
      const prompt = buildClassPrompt(id, ct.style, REGALIA).replace(LEAD_MARKER, `${look.hair}, glossy hair, ${look.eyes}`);
      const cn = classNegative ? classNegative(id) : '';
      const neg = NEGATIVE + (cn ? ', ' + cn : '') + ', ' + HERO_NEG;
      const g = run([CLIENT, `--base=${base}`, '--ckpt=animagine-xl-4.0.safetensors', `--prompt=${prompt}`, `--neg=${neg}`,
        `--w=${SETTINGS.w}`, `--h=${SETTINGS.h}`, `--steps=${SETTINGS.steps}`, `--cfg=${SETTINGS.cfg}`,
        `--sampler=${SETTINGS.sampler}`, `--scheduler=${SETTINGS.scheduler}`, `--seed=${seed}`, `--out=${rawIdle}`]);
      if (g.status !== 0) {
        rec.idle = { ok: false, stage: 'generate', err: (g.stderr || '').slice(-200) };
        results[id] = rec; save();
        console.error(`[${i}/${ids.length}] ${id} ${h.name}: ✗ 대기 생성 실패`);
        continue;
      }
    }
    const r = ingest(rawIdle, `illust_hero_${id}`, idle192);
    rec.idle = { ...r, look, sec: Math.round((Date.now() - t0) / 1000) };
    results[id] = rec; save();
    console.error(`[${i}/${ids.length}] ${id} ${h.name} 대기: ${r.ok ? '✓' : '✗'} ${rec.idle.sec}s · 배경 ${r.keyed || '?'}% · ${look.hair}/${look.eyes}${r.err ? ' · ' + r.err : ''}${r.warn.length ? ' · ⚠ ' + r.warn.join(' / ') : ''}`);
    if (!r.ok) continue;
  }

  /* ── 공격 — 대기 raw 의 «자세만» ── */
  if (stage === 'atk' || stage === 'all') {
    if (!fs.existsSync(rawIdle)) { console.error(`[${i}] ${id}: 대기 raw 없음`); continue; }
    const t0 = Date.now();
    if (!(reuse && fs.existsSync(rawAtk))) {
      const w = (ct.equip || [])[0];
      const pose = POSE[w] || POSE.sword;
      const prompt = `Change only her pose into ${pose}. Keep her outfit, her weapon, her ${look.hair.replace(' hair', '')} hair, her face, all colours and the plain flat light green background exactly the same. Both feet stay on the ground.`;
      for (const f of fs.readdirSync(TMP)) fs.unlinkSync(TMP + '/' + f);
      const a = [EDIT, '-i', rawIdle, '-p', prompt, '-s', String(seed), '-o', TMP, '-m', 'gguf', '--turbo'];
      const g = spawnSync(PY, a, { encoding: 'utf8', maxBuffer: 1 << 24 });
      const made = fs.readdirSync(TMP).filter((f) => f.endsWith('.png'));
      if (g.status !== 0 || !made.length) {
        rec.atk = { ok: false, stage: 'edit', err: ((g.stderr || '') + (g.stdout || '')).slice(-200) };
        results[id] = rec; save();
        console.error(`[${i}/${ids.length}] ${id} ${h.name} 공격: ✗ 편집 실패 ${(g.stderr || g.stdout || '').slice(-120)}`);
        continue;
      }
      fs.copyFileSync(TMP + '/' + made[0], rawAtk);
    }
    const r = ingest(rawAtk, `illust_hero_${id}_atk`, atk192);
    rec.atk = { ...r, sec: Math.round((Date.now() - t0) / 1000) };
    results[id] = rec; save();
    console.error(`[${i}/${ids.length}] ${id} ${h.name} 공격: ${r.ok ? '✓' : '✗'} ${rec.atk.sec}s · 배경 ${r.keyed || '?'}%${r.err ? ' · ' + r.err : ''}${r.warn.length ? ' · ⚠ ' + r.warn.join(' / ') : ''}`);
  }
}
const okIdle = Object.values(results).filter((r) => r.idle && r.idle.ok).length;
const okAtk = Object.values(results).filter((r) => r.atk && r.atk.ok).length;
console.error(`\n완료: 대기 ${okIdle} · 공격 ${okAtk} / ${Object.keys(results).length} · ${resultsPath}`);
