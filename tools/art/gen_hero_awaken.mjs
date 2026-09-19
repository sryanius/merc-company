// §193 영웅 각성 일러스트 — 기존 영웅 raw 를 Qwen-Image-Edit 로 «각성판» 으로 → illust_hero_<id>_awk(_atk)
//   node tools/art/gen_hero_awaken.mjs [--only=id,id] [--stage=awk|atk|scene|awkscene|all] [--style=auto|drama|regal|ascend|dark|pinup] [--seed=7] [--reuse] [--apply]
//   · scene / awkscene (§193.2): 평소 raw / 각성 raw 의 **라임 배경을 계열별 장면으로 채운다** → 무대 전용 art/big/illust_hero_<id>[_awk]_scene.webp
//     투명이 필요 없으니 키잉·색 줄이기 없이 원본 해상도(896×1152) 그대로 WebP(q88) 로 — 가장자리 계단·128색 거칢이 없다.
//     메타는 art/big/manifest.json 에 {w,h,scene:true} 로 적는다 (bigart.js 가 장면을 먼저 찾는다).
//   · 제작자 결정(2026-09-19): **얼굴·머리색·눈색만 지키고 옷은 자유.** 각성 = 더 화려하고 매혹적으로.
//   · 새로 txt2img 하지 않는다 — 다른 사람이 나온다. §176 의 대기 raw(라임 배경)를 **편집**해 같은 얼굴을 지킨다 (§171 지시 편집).
//   · 첫 시안(«흰 드레스 + 후광 + 날개»)은 셋이 똑같아 «평범» 했다 (§193.1). 방향 시안 5장에서 고른 것을 --style 로 준다.
//     auto = apex 는 drama(계열 원소 효과 + 영웅 색), abyss 는 dark(검은 날개·사슬·영웅 색 빛).
//   · «지킬 것» 에 머리색 **이름을 넣지 않는다** — results.json 의 look 이 raw 와 다른 영웅이 있었다(키릴 → 금발). 그림을 보고 지키게 한다.
//   · 공격은 각성 raw 에서 «자세만» (gen_hero_art.mjs 와 같은 POSE 표).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const PY = 'C:/pinokio/api/inteliweb-comfyui/app/env/Scripts/python.exe';
const EDIT = 'C:/claude/image-edit/edit.py';
const GAME = 'C:/claude/game';
const NODE = process.execPath;
const HERE = process.env.MERC_ART_DIR || 'C:/claude/artwork';
const SRC = HERE + '/gen_hero';                 // §176 의 대기 raw 가 여기 있다
const OUT = HERE + '/gen_hero_awk';
const TMP = OUT + '/_tmp';
fs.mkdirSync(TMP, { recursive: true });

const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const seed = Number(arg('seed', 7));
const only = arg('only', '').split(',').filter(Boolean);
const stage = arg('stage', 'all');
const style = arg('style', 'auto');
const reuse = flag('reuse');
const apply = flag('apply');

const { CLASS_TAGS } = await import(`file:///${GAME}/tools/illustprompts_classes.mjs`);
const { HEROES, HERO_IDS } = await import(`file:///${GAME}/src/data/heroes.js`);

/* ── 영웅 색 → 말 (hex 를 가장 가까운 이름으로) ── */
const COLOR_WORDS = [
  ['crimson', [224, 67, 63]], ['gold', [255, 201, 74]], ['silver', [154, 156, 184]], ['violet', [165, 107, 255]],
  ['ice blue', [111, 216, 255]], ['emerald green', [111, 216, 106]], ['amber orange', [255, 122, 42]], ['pale pink', [255, 127, 216]],
  ['deep blue', [60, 90, 220]], ['jade', [70, 180, 150]], ['white', [240, 240, 245]], ['black', [30, 30, 40]],
];
function colorWord(hex) {
  const n = parseInt(String(hex || '#ff7fd8').slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = COLOR_WORDS[0], bd = Infinity;
  for (const w of COLOR_WORDS) { const d = w[1].reduce((a, v, i) => a + (v - c[i]) ** 2, 0); if (d < bd) { bd = d; best = w; } }
  return best[0];
}
/* 계열(fx) → 효과 말 */
const FX_WORDS = {
  fire: 'swirling flames and embers', ice: 'frost crystals and a frozen wind', holy: 'radiant golden light rays', shadow: 'violet shadow smoke',
  nature: 'glowing leaves and forest spirits', lightning: 'crackling arcs of lightning', poison: 'toxic green mist', bolt: 'floating arcane runes',
  heal: 'soft healing light and feathers', buff: 'shimmering golden aura', slash: 'sharp wind and glowing petals', pierce: 'sharp wind and glowing petals',
  arrow: 'a rushing wind and glowing feathers', blunt: 'cracked ground and shockwaves',
};
const KEEP = 'Keep her face, her hair colour, her eye colour, her weapon and the plain flat light green background exactly the same.';
function promptFor(id, h, kind) {
  const col = colorWord(h.color);
  const fx = FX_WORDS[h.fx] || FX_WORDS.slash;
  switch (kind) {
    case 'regal': return `Transform her into her awakened form as a goddess of war: an elaborate ${col} and gold crown with a jeweled diadem, a huge ornate ${col} cape spreading behind her, crystal shoulder armor over a revealing elegant dress with a high leg slit, floating golden rings and jewels orbiting her, a brilliant ${col} backlight like a rising sun, ${fx} around her, a majestic pose with her weapon held upright. ${KEEP}`;
    case 'ascend': return `Transform her into her ascended form: she floats slightly above the ground, six blazing ${col} energy weapons hovering in a circle behind her, cracks of glowing ${col} light across her outfit, glowing eyes, a torn flowing outfit with a high slit and bare shoulders, hair floating upward as if weightless, ${fx} and dramatic light rays from below. ${KEEP}`;
    case 'dark': return `Transform her into her awakened abyss form: a dark black and ${col} outfit with sheer fabric and a high leg slit, glowing ${col} eyes, shadowy black smoke and huge torn black wings spreading behind her, floating broken weapon fragments circling her, chains of ${col} light, ${fx}, a cold moonlit rim light and an eerie ${col} glow. ${KEEP}`;
    case 'pinup': return `Transform her into her awakened form: a seductive elegant ${col} and black evening gown with sheer see-through fabric, deep neckline, bare shoulders and a very high leg slit, gold body jewelry, a confident alluring pose with her weapon resting on her shoulder, ${fx} and sparkling ${col} light particles. ${KEEP}`;
    default: return `Transform her into her awakened form as a legendary warrior: a dramatic battle-ready stance, her weapon wreathed in ${col} and gold light, her long hair and a torn ${col} cape whipping in a violent wind, ${fx} around her, a sleek black and ${col} outfit with gold ornaments, high leg slit, bare shoulders, intense rim lighting from behind. ${KEEP}`;
  }
}
/* ── 장면 — 계열(fx)별 장소. apex 는 밝고 장엄하게, abyss 는 같은 장소의 어둡고 달빛 버전 ── */
const SCENE = {
  fire: 'a volcanic ruin with rivers of lava, drifting embers and a burning sky',
  ice: 'a frozen mountain peak with ice crystals, blowing snow and a pale aurora',
  holy: 'a grand cathedral of light with tall stained-glass windows and golden light rays',
  shadow: 'an abyssal void with violet mist, floating shattered stone and a dark moon',
  nature: 'an ancient forest with giant glowing trees, floating spirit lights and morning mist',
  lightning: 'a storm-wracked cliff top with crackling lightning across dark clouds',
  poison: 'a misty swamp with glowing toxic pools and twisted trees',
  bolt: 'an arcane observatory with floating runes, star maps and a night sky',
  heal: 'a serene sanctuary garden with a shining fountain and drifting petals',
  buff: 'a sunlit temple courtyard with banners and golden light',
  slash: 'a ruined battlefield at dusk with a blood-red sky, distant burning banners and cracked stone ground',
  pierce: 'a ruined battlefield at dusk with a blood-red sky, distant burning banners and cracked stone ground',
  blunt: 'a ruined battlefield at dusk with a blood-red sky, distant burning banners and cracked stone ground',
  arrow: 'a windswept cliff above a vast forest at golden hour, feathers drifting in the wind',
};
function scenePrompt(id, h) {
  const col = colorWord(h.color);
  const place = SCENE[h.fx] || SCENE.slash;
  const mood = id.endsWith('_abyss')
    ? 'the scene is dark and moonlit, with deep shadows and an eerie glow'
    : 'the scene is epic and cinematic, with dramatic depth of field';
  return `Replace the plain flat light green background with a dramatic painted scene: ${place}; ${mood}, lit in ${col} and gold to match her, a soft shadow under her feet. Keep her face, her hair, her outfit, her weapon and her pose exactly the same.`;
}
/** 장면 raw → WebP (원본 해상도, q88) — PIL 로. 투명이 없으니 키잉을 안 거친다. */
function toWebp(rawPng, outWebp) {
  const py = `from PIL import Image; im=Image.open(r'${rawPng}').convert('RGB'); im.save(r'${outWebp}', 'WEBP', quality=88, method=6); print(im.size[0], im.size[1])`;
  const g = spawnSync(PY, ['-c', py], { encoding: 'utf8' });
  if (g.status !== 0) return null;
  const [w, hh] = (g.stdout || '').trim().split(/\s+/).map(Number);
  return { w, h: hh };
}
function writeSceneMeta(name, dim) {
  const mp = `${GAME}/art/big/manifest.json`;
  const cur = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : {};
  cur[name] = { w: dim.w, h: dim.h, scene: true, file: `${name}.webp` };
  fs.writeFileSync(mp, JSON.stringify(cur, null, 1));
}
function styleOf(id) {
  if (style !== 'auto') return style;
  return id.endsWith('_abyss') ? 'dark' : 'drama';
}

/* Qwen 자세 지시 — gen_hero_art.mjs 의 POSE 와 같다 (무기별) */
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

/** Qwen 편집 한 장. 성공하면 out 에 복사한다. */
function edit(input, prompt, out) {
  for (const f of fs.readdirSync(TMP)) fs.unlinkSync(TMP + '/' + f);
  const a = [EDIT, '-i', input, '-p', prompt, '-s', String(seed), '-o', TMP, '-m', 'gguf', '--turbo'];
  const g = spawnSync(PY, a, { encoding: 'utf8', maxBuffer: 1 << 24 });
  const made = fs.readdirSync(TMP).filter((f) => f.endsWith('.png'));
  if (g.status !== 0 || !made.length) return { ok: false, err: ((g.stderr || '') + (g.stdout || '')).slice(-200) };
  fs.copyFileSync(TMP + '/' + made[0], out);
  return { ok: true };
}

let i = 0;
for (const id of ids) {
  i++;
  const h = HEROES[id];
  const ct = CLASS_TAGS[id];
  const rawIdle = `${SRC}/${id}_raw.png`;
  if (!ct || !fs.existsSync(rawIdle)) { console.error(`[${i}] ${id}: 원본 raw 없음 — §176 를 먼저 돌려라`); continue; }
  const kind = styleOf(id);
  const rec = results[id] || { name: h.name, cls: ct.name };
  rec.style = kind;
  const rawAwk = `${OUT}/${id}_awk_raw.png`, awk192 = `${OUT}/${id}_awk_192.png`;
  const rawAtk = `${OUT}/${id}_awk_atk_raw.png`, atk192 = `${OUT}/${id}_awk_atk_192.png`;

  /* ── 각성 대기 — 원본 raw 의 «옷·빛만» ── */
  if (stage === 'awk' || stage === 'all') {
    const t0 = Date.now();
    if (!(reuse && fs.existsSync(rawAwk))) {
      const e = edit(rawIdle, promptFor(id, h, kind), rawAwk);
      if (!e.ok) {
        rec.awk = { ok: false, stage: 'edit', err: e.err }; results[id] = rec; save();
        console.error(`[${i}/${ids.length}] ${id} ${h.name} 각성(${kind}): ✗ 편집 실패 ${e.err.slice(-120)}`);
        continue;
      }
    }
    const r = ingest(rawAwk, `illust_hero_${id}_awk`, awk192);
    rec.awk = { ...r, sec: Math.round((Date.now() - t0) / 1000) };
    results[id] = rec; save();
    console.error(`[${i}/${ids.length}] ${id} ${h.name} 각성(${kind}): ${r.ok ? '✓' : '✗'} ${rec.awk.sec}s · 배경 ${r.keyed || '?'}%${r.err ? ' · ' + r.err : ''}${r.warn.length ? ' · ⚠ ' + r.warn.join(' / ') : ''}`);
    if (!r.ok) continue;
  }

  /* ── 각성 공격 — 각성 raw 의 «자세만» ── */
  if (stage === 'atk' || stage === 'all') {
    if (!fs.existsSync(rawAwk)) { console.error(`[${i}] ${id}: 각성 raw 없음`); continue; }
    const t0 = Date.now();
    if (!(reuse && fs.existsSync(rawAtk))) {
      const w = (ct.equip || [])[0];
      const pose = POSE[w] || POSE.sword;
      const prompt = `Change only her pose into ${pose}. Keep her outfit, her weapon, her hair colour, her face, all colours and the plain flat light green background exactly the same. Both feet stay on the ground.`;
      const e = edit(rawAwk, prompt, rawAtk);
      if (!e.ok) {
        rec.atk = { ok: false, stage: 'edit', err: e.err }; results[id] = rec; save();
        console.error(`[${i}/${ids.length}] ${id} ${h.name} 각성 공격: ✗ 편집 실패 ${e.err.slice(-120)}`);
        continue;
      }
    }
    const r = ingest(rawAtk, `illust_hero_${id}_awk_atk`, atk192);
    rec.atk = { ...r, sec: Math.round((Date.now() - t0) / 1000) };
    results[id] = rec; save();
    console.error(`[${i}/${ids.length}] ${id} ${h.name} 각성 공격: ${r.ok ? '✓' : '✗'} ${rec.atk.sec}s · 배경 ${r.keyed || '?'}%${r.err ? ' · ' + r.err : ''}${r.warn.length ? ' · ⚠ ' + r.warn.join(' / ') : ''}`);
  }
}
/* ── 장면 (평소 · 각성) — 무대 전용, WebP 원본 해상도 ── */
if (stage === 'scene' || stage === 'awkscene' || stage === 'all') {
  let j = 0;
  for (const id of ids) {
    j++;
    const h = HEROES[id];
    const rec = results[id] || { name: h.name };
    for (const kind of (stage === 'all' ? ['scene', 'awkscene'] : [stage])) {
      const awk = kind === 'awkscene';
      const input = awk ? `${OUT}/${id}_awk_raw.png` : `${SRC}/${id}_raw.png`;
      if (!fs.existsSync(input)) { if (awk) { console.error(`[${j}] ${id}: 각성 raw 없음 — 장면 건너뜀`); continue; } console.error(`[${j}] ${id}: raw 없음`); continue; }
      const rawScene = `${OUT}/${id}${awk ? '_awk' : ''}_scene_raw.png`;
      const name = `illust_hero_${id}${awk ? '_awk' : ''}_scene`;
      const t0 = Date.now();
      if (!(reuse && fs.existsSync(rawScene))) {
        const e = edit(input, scenePrompt(id, h), rawScene);
        if (!e.ok) { rec[kind] = { ok: false, err: e.err }; results[id] = rec; save(); console.error(`[${j}/${ids.length}] ${id} ${h.name} ${kind}: ✗ ${e.err.slice(-120)}`); continue; }
      }
      let dim = null;
      if (apply) {
        fs.mkdirSync(`${GAME}/art/big`, { recursive: true });
        dim = toWebp(rawScene, `${GAME}/art/big/${name}.webp`);
        if (dim) writeSceneMeta(name, dim);
      }
      rec[kind] = { ok: true, sec: Math.round((Date.now() - t0) / 1000), applied: !!dim };
      results[id] = rec; save();
      console.error(`[${j}/${ids.length}] ${id} ${h.name} ${kind}: ✓ ${rec[kind].sec}s${dim ? ` → art/big/${name}.webp ${dim.w}x${dim.h}` : ''}`);
    }
  }
}
const okAwk = Object.values(results).filter((r) => r.awk && r.awk.ok).length;
const okAtk = Object.values(results).filter((r) => r.atk && r.atk.ok).length;
console.error(`\n완료: 각성 ${okAwk} · 공격 ${okAtk} / ${Object.keys(results).length} · ${resultsPath}`);
