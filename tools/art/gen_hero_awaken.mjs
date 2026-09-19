// §193 영웅 각성 일러스트 — 기존 영웅 raw 를 Qwen-Image-Edit 로 «각성판» 으로 → illust_hero_<id>_awk(_atk)
//   node tools/art/gen_hero_awaken.mjs [--only=id,id] [--stage=awk|atk|all] [--seed=7] [--reuse] [--apply]
//   · 제작자 결정(2026-09-19): **얼굴·머리색·눈색만 지키고 옷은 자유.** 각성 = 더 화려하고 매혹적으로 (비치는 천·맨어깨·슬릿 + 후광·빛의 날개).
//   · 새로 txt2img 하지 않는다 — 다른 사람이 나온다. §176 의 대기 raw(라임 배경)를 **편집**해 같은 얼굴을 지킨다 (§171 지시 편집).
//   · 공격은 각성 raw 에서 «자세만» (gen_hero_art.mjs 와 같은 POSE 표).
//   · 머리·눈색은 gen_hero/results.json 의 `idle.look` 을 그대로 읽는다 — 손사본을 두지 않는다.
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
const reuse = flag('reuse');
const apply = flag('apply');

const { CLASS_TAGS } = await import(`file:///${GAME}/tools/illustprompts_classes.mjs`);
const { HEROES, HERO_IDS } = await import(`file:///${GAME}/src/data/heroes.js`);
const srcResults = JSON.parse(fs.readFileSync(SRC + '/results.json', 'utf8'));

/* 각성 지시 — §171: 한 문장에 «바꿀 것» + «지킬 것». turbo 는 부정을 무시하므로 지킬 것을 명시한다. */
const AWAKEN = (look) =>
  `Redesign her outfit into an awakened, divine and glamorous form: a revealing elegant costume with sheer flowing fabric, bare shoulders, a high leg slit, ornate gold jewelry and gems, a glowing halo behind her head, wings of light and floating golden sparkles, brighter dramatic lighting. Keep her face, her ${look.hair.replace(' hair', '')} hair, her ${look.eyes}, her weapon, her standing pose and the plain flat light green background exactly the same.`;

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
  const look = srcResults[id] && srcResults[id].idle && srcResults[id].idle.look;
  const rawIdle = `${SRC}/${id}_raw.png`;
  if (!ct || !look || !fs.existsSync(rawIdle)) { console.error(`[${i}] ${id}: 원본 raw·look 없음 — §176 를 먼저 돌려라`); continue; }
  const rec = results[id] || { name: h.name, cls: ct.name, look };
  const rawAwk = `${OUT}/${id}_awk_raw.png`, awk192 = `${OUT}/${id}_awk_192.png`;
  const rawAtk = `${OUT}/${id}_awk_atk_raw.png`, atk192 = `${OUT}/${id}_awk_atk_192.png`;

  /* ── 각성 대기 — 원본 raw 의 «옷·빛만» ── */
  if (stage === 'awk' || stage === 'all') {
    const t0 = Date.now();
    if (!(reuse && fs.existsSync(rawAwk))) {
      const e = edit(rawIdle, AWAKEN(look), rawAwk);
      if (!e.ok) {
        rec.awk = { ok: false, stage: 'edit', err: e.err }; results[id] = rec; save();
        console.error(`[${i}/${ids.length}] ${id} ${h.name} 각성: ✗ 편집 실패 ${e.err.slice(-120)}`);
        continue;
      }
    }
    const r = ingest(rawAwk, `illust_hero_${id}_awk`, awk192);
    rec.awk = { ...r, sec: Math.round((Date.now() - t0) / 1000) };
    results[id] = rec; save();
    console.error(`[${i}/${ids.length}] ${id} ${h.name} 각성: ${r.ok ? '✓' : '✗'} ${rec.awk.sec}s · 배경 ${r.keyed || '?'}%${r.err ? ' · ' + r.err : ''}${r.warn.length ? ' · ⚠ ' + r.warn.join(' / ') : ''}`);
    if (!r.ok) continue;
  }

  /* ── 각성 공격 — 각성 raw 의 «자세만» ── */
  if (stage === 'atk' || stage === 'all') {
    if (!fs.existsSync(rawAwk)) { console.error(`[${i}] ${id}: 각성 raw 없음`); continue; }
    const t0 = Date.now();
    if (!(reuse && fs.existsSync(rawAtk))) {
      const w = (ct.equip || [])[0];
      const pose = POSE[w] || POSE.sword;
      const prompt = `Change only her pose into ${pose}. Keep her outfit, her weapon, her ${look.hair.replace(' hair', '')} hair, her face, all colours and the plain flat light green background exactly the same. Both feet stay on the ground.`;
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
const okAwk = Object.values(results).filter((r) => r.awk && r.awk.ok).length;
const okAtk = Object.values(results).filter((r) => r.atk && r.atk.ok).length;
console.error(`\n완료: 각성 ${okAwk} · 공격 ${okAtk} / ${Object.keys(results).length} · ${resultsPath}`);
