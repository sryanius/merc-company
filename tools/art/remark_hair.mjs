// §193.3 클래스 raw 의 머리를 **순수 자홍(#ff00ff)** 으로 다시 칠한다 → MERC_ART_DIR/gen_remark/<id>_raw.png
//   node tools/art/remark_hair.mjs [--only=id,id] [--seed=7] [--force]
//   · 왜: 무대용 큰 그림은 머리를 사람마다 칠한다(표식 → 팔레트). 원래 표식은 «탁한 보라» 라 보라·남색 옷과 색상대가 겹쳐,
//     옷이 머리로 잡혀 흰 얼룩이 됐다 (세계수의 궁성 실측: 드레스 가슴·치마). 색으로는 못 가른다 — 같은 색이다.
//     ⇒ 편집 모델로 **머리만** 자홍으로 바꾸면 옷(남색 254°)과 머리(300°)가 갈린다. 옷·얼굴·배경은 그대로 둔다(지시문).
//   · 출력 크기는 입력과 다르다 (896×1152 → 880×1184) — 이 그림이 큰 그림의 원본이 되므로 맞출 필요가 없다.
//   · 작은 그림(192, 게임 안 카드·전투)은 이것을 안 쓴다 — 예전 표식 그대로다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const GAME = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const HERE = process.env.MERC_ART_DIR || 'C:/claude/artwork';
const PY = 'C:/pinokio/api/inteliweb-comfyui/app/env/Scripts/python.exe';
const EDIT = 'C:/claude/image-edit/edit.py';
const OUT = `${HERE}/gen_remark`;
const TMP = `${OUT}/_tmp`;
fs.mkdirSync(TMP, { recursive: true });
const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const only = arg('only', '').split(',').filter(Boolean);
const seed = Number(arg('seed', 7));
const force = args.includes('--force');

const { CLASSES } = await import(`file:///${GAME}/src/data/classes.js`);
await import(`file:///${GAME}/src/data/classes_t4.js`);
/* ★ 지시문에 특정 물건 이름(crown 등)을 넣지 마라 — «그대로 두라» 고 적은 물건을 **없던 캐릭터에게 그려 넣었다** (첫 판: 17장 중 9장에 왕관이 생겼다).
 *   ★ 눈 색은 **이름으로** 지킨다 — 안 적으면 머리와 같이 자홍이 된다(3장 중 2장). 클래스 원본의 눈 표식은 전부 청록이라 적어도 안전하다. */
export const REMARK_PROMPT = "Recolour only her hair to pure bright saturated magenta (#ff00ff), keeping the hair's shape, shading and highlights. Everything else, including her face, eyes, skin, outfit, accessories, weapon and the plain flat light green background, stays exactly as it is. Her eyes keep their bright cyan colour. Do not add or remove anything.";

const ids = (only.length ? only : Object.keys(CLASSES)).filter((id) => fs.existsSync(`${HERE}/gen/${id}_raw.png`));
let i = 0, ok = 0;
for (const id of ids) {
  i++;
  const out = `${OUT}/${id}_raw.png`;
  if (!force && fs.existsSync(out)) { ok++; continue; }
  for (const f of fs.readdirSync(TMP)) fs.unlinkSync(`${TMP}/${f}`);
  const t0 = Date.now();
  const g = spawnSync(PY, [EDIT, '-i', `${HERE}/gen/${id}_raw.png`, '-p', REMARK_PROMPT, '-s', String(seed), '-o', TMP, '-m', 'gguf', '--turbo'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const made = fs.readdirSync(TMP).filter((f) => f.endsWith('.png'));
  if (g.status !== 0 || !made.length) { console.error(`[${i}/${ids.length}] ${id}: ✗ ${((g.stderr || '') + (g.stdout || '')).slice(-140)}`); continue; }
  fs.copyFileSync(`${TMP}/${made[0]}`, out);
  ok++;
  console.error(`[${i}/${ids.length}] ${id}: ✓ ${Math.round((Date.now() - t0) / 1000)}s`);
}
console.error(`완료: ${ok}/${ids.length}`);
