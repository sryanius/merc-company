#!/usr/bin/env node
// 정면 후보 시험대 — candidate.mjs 의 정면판.
// 후보 JSON(조인트 포함)을 portrait.js 와 같은 순서·뒤집기로 조립해 PNG 로 깐다.
//   node tools/frontcand.mjs a.json b.json --out=cmp.png --zoom=5
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';
import { makePalette, PIX_CHARS } from '../src/art/palette.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const files = args.filter((a) => !a.startsWith('--'));
const ZOOM = Math.max(1, Number(arg('zoom', 5)) || 5);
const W = 96, H = 120;

/* portrait.js 의 기본 조인트 — 후보가 joints 로 덮어쓴다 */
const DEF_J = {
  head: { x: 48, y: 44 }, chest: { x: 48, y: 44 }, pelvis: { x: 48, y: 75 },
  shLeft: { x: 39, y: 48 }, shRight: { x: 57, y: 48 },
  handLeft: { x: 34, y: 80 }, handRight: { x: 62, y: 80 },
  hipLeft: { x: 42, y: 75 }, hipRight: { x: 54, y: 75 },
};
/* portrait.js 와 같은 그리기 순서 (셋째 값 = 뒤집기) */
const ORDER = [
  ['cape', 'chest', false],
  ['arm', 'shLeft', true], ['leg', 'hipLeft', true], ['leg', 'hipRight', false],
  ['body', 'chest', false], ['armor', 'chest', false],
  ['head', 'head', false], ['hair', 'head', false], ['helm', 'head', false],
  ['arm', 'shRight', false],
];
const PAL = makePalette({ skin: 'pale', hair: 'brown', metal: 'steel', cloth: 'crimson', leather: 'tan', accent: 'gold', eye: 'blue' });
const ALLOWED = new Set(PIX_CHARS);

function compose(cand, problems) {
  const J = { ...DEF_J, ...(cand.joints || {}) };
  const grid = Array.from({ length: H }, () => new Array(W).fill('.'));
  for (const [slot, joint, flip] of ORDER) {
    const p = (cand.parts || {})[slot];
    if (!p || !Array.isArray(p.px)) continue;
    const j = J[joint];
    if (p.px.length !== p.h) problems.push(`${slot}: 행 ${p.px.length} ≠ h ${p.h}`);
    for (let y = 0; y < p.px.length; y++) {
      const row = p.px[y];
      if (row.length !== p.w) problems.push(`${slot}: ${y}행 길이 ${row.length} ≠ w ${p.w}`);
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        if (!ALLOWED.has(ch)) { problems.push(`${slot}: 모르는 문자 '${ch}'`); continue; }
        const gx = flip ? j.x + (p.ax || 0) - x : j.x - (p.ax || 0) + x;
        const gy = j.y - (p.ay || 0) + y;
        if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;
        grid[gy][gx] = ch;
      }
    }
  }
  return grid;
}

const BG = [26, 28, 36], LINE = [40, 44, 56];
const cands = files.map((f) => {
  const json = JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));
  const problems = [];
  return { name: json.name || path.basename(f, '.json'), grid: compose(json, problems), problems: [...new Set(problems)] };
});
if (!cands.length) { console.error('후보 없음'); process.exit(1); }

const CW = W * ZOOM, CH = H * ZOOM, PAD = 10;
const sw = cands.length * (CW + PAD) + PAD, sh = CH + PAD * 2;
const px = new Uint8ClampedArray(sw * sh * 4);
for (let i = 0; i < sw * sh; i++) { px[i * 4] = BG[0]; px[i * 4 + 1] = BG[1]; px[i * 4 + 2] = BG[2]; px[i * 4 + 3] = 255; }
const put = (x, y, c) => { if (x < 0 || y < 0 || x >= sw || y >= sh) return; const i = (y * sw + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
cands.forEach((c, i) => {
  const x0 = PAD + i * (CW + PAD), y0 = PAD;
  for (let x = -1; x <= CW; x++) { put(x0 + x, y0 - 1, LINE); put(x0 + x, y0 + CH, LINE); }
  for (let y = -1; y <= CH; y++) { put(x0 - 1, y0 + y, LINE); put(x0 + CW, y0 + y, LINE); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const hex = PAL[c.grid[y][x]];
    if (!hex) continue;
    const n = parseInt(hex.slice(1), 16), col = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (let dy = 0; dy < ZOOM; dy++) for (let dx = 0; dx < ZOOM; dx++) put(x0 + x * ZOOM + dx, y0 + y * ZOOM + dy, col);
  }
});
const out = path.resolve(ROOT, arg('out', 'frontcand.png'));
fs.writeFileSync(out, encodePng(sw, sh, px));
for (const c of cands) {
  console.log(`  ${c.name}${c.problems.length ? ' — ✗ ' + c.problems.slice(0, 3).join(' / ') : ' ✓'}`);
}
console.log(`  ${path.relative(ROOT, out)}  ${sw}×${sh}`);
