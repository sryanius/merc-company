#!/usr/bin/env node
// 도트 대조표 — 파츠·캐릭터를 PNG 한 장으로 뽑아 **눈으로** 본다.
// ════════════════════════════════════════════════════════════════════════════
//
// ★ 왜 필요한가
//   도트를 고칠 때 문자 행렬만 보고는 이쁜지 알 수 없다. 브라우저를 띄워 확인하면
//   한 번에 한 장씩만 보게 되고 왕복이 길다. 여기서는 게임과 **같은 파이프라인**으로
//   여러 벌을 한 장에 깔아 놓고 한눈에 비교한다.
//
// ★ 파츠 하나만 볼 때는 조립하지 않는다 — 그림이 잘못된 건지 조립이 잘못된 건지
//   섞이면 진단이 안 된다.
//
// 실행
//   node tools/artsheet.mjs                          # 대표 클래스 조립본
//   node tools/artsheet.mjs --parts=body_normal,head_human
//   node tools/artsheet.mjs --class=knight --frames   # 한 클래스의 전 프레임
//   node tools/artsheet.mjs --raw                     # 승격 전 원본 파츠 (SCALE 비교용)
//   node tools/artsheet.mjs --out=경로.png --zoom=8
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/png.mjs';                                  // ★ 캔버스 스텁: spritegen 보다 먼저
import { encodePng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.slice(2).includes(`--${k}`);

const { buildSprite, SPRITE_W, SPRITE_H, FRAMES, SCALE } = await import('../src/art/spritegen.js');
const { getPart } = await import('../src/art/parts.js');
const { BODY_PARTS } = await import('../src/art/parts_body.js');
const { GEAR_PARTS } = await import('../src/art/parts_gear.js');
const { makePalette } = await import('../src/art/palette.js');
const { CLASSES } = await import('../src/data/classes.js');
const { mercRecipe } = await import('../src/game/merc.js');

const RAW_PARTS = { ...BODY_PARTS, ...GEAR_PARTS };
const ZOOM = Math.max(1, Number(arg('zoom', 6)) || 6);
const BG = [26, 28, 36, 255];
const GRID = [38, 41, 52, 255];

/* ─────────────────────── 캔버스 (RGBA 평면) ─────────────────────── */
function sheet(w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = BG[0]; px[i * 4 + 1] = BG[1]; px[i * 4 + 2] = BG[2]; px[i * 4 + 3] = BG[3];
  }
  return { w, h, px };
}
const put = (s, x, y, c) => {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  const i = (y * s.w + x) * 4;
  s.px[i] = c[0]; s.px[i + 1] = c[1]; s.px[i + 2] = c[2]; s.px[i + 3] = c[3];
};
/** 확대해서 얹는다. 최근접 확대라 도트가 뭉개지지 않는다. */
function blitZoom(s, x0, y0, src, sw, sh, zoom) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      const a = src[i + 3];
      if (!a) continue;
      const c = [src[i], src[i + 1], src[i + 2], 255];
      for (let dy = 0; dy < zoom; dy++) for (let dx = 0; dx < zoom; dx++) put(s, x0 + x * zoom + dx, y0 + y * zoom + dy, c);
    }
  }
}
/** 셀 테두리 — 어디까지가 한 파츠인지 보이게 */
function frameBox(s, x0, y0, w, h) {
  for (let x = 0; x < w; x++) { put(s, x0 + x, y0 - 1, GRID); put(s, x0 + x, y0 + h, GRID); }
  for (let y = -1; y <= h; y++) { put(s, x0 - 1, y0 + y, GRID); put(s, x0 + w, y0 + y, GRID); }
}

/* ─────────────────────── 파츠 → RGBA ─────────────────────── */
const PAL = makePalette({ skin: 'pale', hair: 'brown', metal: 'steel', cloth: 'crimson', leather: 'brown', accent: 'gold', glow: 'arcane' });
function partRgba(part) {
  const out = new Uint8ClampedArray(part.w * part.h * 4);
  for (let y = 0; y < part.h; y++) {
    const row = part.px[y] || '';
    for (let x = 0; x < part.w; x++) {
      const ch = row[x] || '.';
      const hex = PAL[ch];
      if (!hex) continue;
      const n = parseInt(hex.slice(1), 16);
      const i = (y * part.w + x) * 4;
      out[i] = (n >> 16) & 255; out[i + 1] = (n >> 8) & 255; out[i + 2] = n & 255; out[i + 3] = 255;
    }
  }
  return out;
}

/* ─────────────────────── 스프라이트 프레임 → RGBA ─────────────────────── */
function frameRgba(recipe, frame) {
  const s = buildSprite(recipe);
  const img = s.canvas.img;
  if (!img) throw new Error('spritegen 스텁이 putImageData 를 못 받았다 — tools/lib/png.mjs 의 스텁을 늘려라');
  const f = s.frames[frame] || s.frames.idle0;
  const out = new Uint8ClampedArray(SPRITE_W * SPRITE_H * 4);
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const si = (y * img.width + f.sx + x) * 4;
      const di = (y * SPRITE_W + x) * 4;
      out[di] = img.data[si]; out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2]; out[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

/* ─────────────────────── 배치 ─────────────────────── */
const PAD = 8;
function layout(cells, cols) {
  const cw = Math.max(...cells.map((c) => c.w)) * ZOOM;
  const ch = Math.max(...cells.map((c) => c.h)) * ZOOM;
  const rows = Math.ceil(cells.length / cols);
  const s = sheet(cols * (cw + PAD) + PAD, rows * (ch + PAD) + PAD);
  cells.forEach((c, i) => {
    const x0 = PAD + (i % cols) * (cw + PAD);
    const y0 = PAD + Math.floor(i / cols) * (ch + PAD);
    frameBox(s, x0, y0, cw, ch);
    blitZoom(s, x0, y0, c.rgba, c.w, c.h, ZOOM);
  });
  return s;
}

/* ─────────────────────── 무엇을 그릴까 ─────────────────────── */
const SHOWCASE = ['swordsman', 'shieldman', 'archer', 'apprentice', 'knight', 'assassin', 'swordgod', 'archmage'];
let cells = [];
let label = '';

const partsArg = arg('parts', '');
if (partsArg) {
  const names = partsArg.split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    const p = flag('raw') ? RAW_PARTS[n] : getPart(n);
    if (!p) { console.error(`  파츠 없음: ${n}`); continue; }
    cells.push({ w: p.w, h: p.h, rgba: partRgba(p) });
  }
  label = `파츠 ${names.join(' · ')}${flag('raw') ? ' (원본)' : ` (SCALE=${SCALE})`}`;
} else if (flag('frames')) {
  const id = arg('class', 'knight');
  const rec = mercRecipe({ classId: id, grade: 'A', level: 40 }, {});
  cells = FRAMES.map((f) => ({ w: SPRITE_W, h: SPRITE_H, rgba: frameRgba(rec, f) }));
  label = `${id} 전 프레임 (${FRAMES.length}장)`;
} else {
  const list = (arg('class', '') || SHOWCASE.join(',')).split(',');
  cells = list.map((id) => ({ w: SPRITE_W, h: SPRITE_H, rgba: frameRgba(mercRecipe({ classId: id, grade: 'A', level: 40 }, {}), arg('frame', 'idle0')) }));
  label = `${list.join(' · ')} — ${arg('frame', 'idle0')}`;
}

if (!cells.length) { console.error('그릴 게 없다.'); process.exit(1); }

const cols = Math.max(1, Number(arg('cols', Math.min(cells.length, 8))) || 8);
const s = layout(cells, cols);
const out = path.resolve(ROOT, arg('out', 'artsheet.png'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(s.w, s.h, s.px));
console.log(`  ${label}`);
console.log(`  ${path.relative(ROOT, out)}  ${s.w}×${s.h}  ${(fs.statSync(out).size / 1024).toFixed(1)}KB  (확대 ${ZOOM}배)`);
