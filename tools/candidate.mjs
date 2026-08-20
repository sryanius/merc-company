#!/usr/bin/env node
// 도트 후보 시험대 — JSON 한 벌을 받아 캐릭터 한 명을 PNG 로 세운다.
// ════════════════════════════════════════════════════════════════════════════
//
// ★ 왜 spritegen 을 안 쓰나
//   후보마다 **조인트(비율)까지 다를 수 있다.** spritegen 의 JOINTS 는 상수라
//   후보를 갈아 끼우려면 모듈을 고쳐야 하고, 그러면 게임이 그때마다 흔들린다.
//   여기서는 조립만 따로 하고, 채택된 뒤에 진짜 파츠 파일로 옮긴다.
//
// ★ 자세는 «차렷» 하나만 그린다. 애니메이션은 그림이 정해진 뒤 문제다.
//
// JSON 형식
//   {
//     "name": "이름", "note": "한 줄 설명",
//     "joints": { "head": {"x":32,"y":28}, ... },        // 생략하면 현행
//     "parts": { "body": {"w":24,"h":26,"ax":12,"ay":0,"px":["....", ...]}, ... }
//   }
//   parts 의 열쇠: cape body armor head hair helm arm leg weapon offhand
//
// 실행
//   node tools/candidate.mjs 후보.json [후보2.json ...] --out=비교.png --zoom=6
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';
import { makePalette, PIX_CHARS } from '../src/art/palette.js';
import { JOINTS as DEFAULT_JOINTS, SPRITE_W as DEF_W, SPRITE_H as DEF_H } from '../src/art/spritegen.js';

/* ★ 후보마다 **캔버스 크기가 다를 수 있다** — 해상도 자체를 비교하려고 만든 도구다.
 *   후보 JSON 의 canvas: {w,h} 를 쓰고, 없으면 지금 게임 규격을 쓴다. */
const canvasOf = (c) => ({ w: (c.canvas && c.canvas.w) || DEF_W, h: (c.canvas && c.canvas.h) || DEF_H });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const files = args.filter((a) => !a.startsWith('--'));
const ZOOM = Math.max(1, Number(arg('zoom', 6)) || 6);

const PAL = makePalette({ skin: 'pale', hair: 'brown', metal: 'steel', cloth: 'crimson', leather: 'brown', accent: 'gold', glow: 'arcane' });
const ALLOWED = new Set(PIX_CHARS);

/* 그리는 순서 — spritegen composeFrame 과 같다. 뒤에 오는 것이 덮는다. */
const ORDER = [
  ['cape', 'chest'], ['armBack', 'shBack'], ['legBack', 'hipBack'], ['legFront', 'hipFront'],
  ['body', 'chest'], ['armor', 'chest'], ['head', 'head'], ['hair', 'head'], ['helm', 'head'],
  ['offhand', 'handBack'], ['armFront', 'shFront'], ['weapon', 'handFront'],
];

function compose(cand, problems) {
  const { w: CW, h: CH } = canvasOf(cand);
  const J = { ...DEFAULT_JOINTS, ...(cand.joints || {}) };
  const grid = Array.from({ length: CH }, () => new Array(CW).fill('.'));
  const P = cand.parts || {};
  // arm/leg 는 한 벌로 앞뒤에 쓴다
  const resolved = { ...P, armBack: P.armBack || P.arm, armFront: P.armFront || P.arm, legBack: P.legBack || P.leg, legFront: P.legFront || P.leg };

  for (const [slot, joint] of ORDER) {
    const p = resolved[slot];
    if (!p || !Array.isArray(p.px)) continue;
    const j = J[joint];
    if (!j) { problems.push(`조인트 없음: ${joint}`); continue; }
    if (p.px.length !== p.h) problems.push(`${slot}: 행 개수 ${p.px.length} ≠ h ${p.h}`);
    for (let y = 0; y < p.px.length; y++) {
      const row = p.px[y];
      if (row.length !== p.w) { problems.push(`${slot}: ${y}행 길이 ${row.length} ≠ w ${p.w}`); }
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        if (!ALLOWED.has(ch)) { problems.push(`${slot}: 모르는 문자 '${ch}' (${y}행 ${x}열)`); continue; }
        const gx = j.x + (x - (p.ax || 0));
        const gy = j.y + (y - (p.ay || 0));
        if (gx < 0 || gx >= CW || gy < 0 || gy >= CH) continue;
        grid[gy][gx] = ch;
      }
    }
  }
  return grid;
}

/* ─────────────────────── 자동 판정 ───────────────────────
 * ★ «이쁘다» 는 눈으로 봐야 하지만, **방향 가독성과 실루엣 결함은 잴 수 있다.**
 *   눈으로만 고르면 옆모습이 뒤돌아 보이는 후보를 이쁘다고 뽑는 일이 생긴다 —
 *   실제로 플레이어가 방패병을 두 번 지적한 게 그 경우였다 (tools/facing.mjs). */
function judge(grid, cand) {
  const { w: SPRITE_W, h: SPRITE_H } = canvasOf(cand);
  const J = { ...DEFAULT_JOINTS, ...(cand.joints || {}) };
  const MID = SPRITE_W / 2;
  let eye = 0, eyeX = 0, skin = 0, skinX = 0, hair = 0, hairX = 0;
  let top = -1, bottom = -1, left = SPRITE_W, right = -1;
  const colFill = new Array(SPRITE_W).fill(0);
  const rowFill = new Array(SPRITE_H).fill(0);
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const c = grid[y][x];
      if (c === '.') continue;
      if (top < 0) top = y;
      bottom = y; colFill[x]++; rowFill[y]++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (c === 'e') { eye++; eyeX += x; }
      else if (c === 's' || c === 'S' || c === 'x') { skin++; skinX += x; }
      else if (c === 'h' || c === 'H' || c === 'y') { hair++; hairX += x; }
    }
  }
  const avg = (sum, n) => (n ? sum / n : null);
  const out = {
    eye, eyeX: avg(eyeX, eye), skin, skinX: avg(skinX, skin), hair, hairX: avg(hairX, hair),
    top, bottom, left, right, height: bottom - top + 1, width: right - left + 1,
    bad: [],
  };
  // 방향
  if (!eye) out.bad.push('눈이 없다');
  else if (out.eyeX < MID + 3) out.bad.push(`눈 평균 x ${out.eyeX.toFixed(1)} (≥${MID + 3} 이어야 앞을 본다)`);
  if (skin < 10) out.bad.push(`보이는 피부 ${skin}px (≥10)`);
  else if (out.skinX < MID + 1.6) out.bad.push(`얼굴 평균 x ${out.skinX.toFixed(1)} (≥${(MID + 1.6).toFixed(1)})`);
  if (hair && out.hairX > MID + 0.4) out.bad.push(`머리카락 평균 x ${out.hairX.toFixed(1)} (≤${(MID + 0.4).toFixed(1)}, 뒤통수 쪽이어야 한다)`);
  // 조립 결함 — 조인트 사이가 비면 몸이 끊겨 보인다
  for (let y = top; y <= bottom; y++) if (!rowFill[y]) { out.bad.push(`y=${y} 가 통째로 비었다 (몸이 끊긴다)`); break; }
  // 발이 지면에 닿나 (캔버스 높이의 5% 안쪽이면 닿은 것으로 본다)
  if (bottom < SPRITE_H * 0.93) out.bad.push(`발이 지면에서 ${SPRITE_H - 2 - bottom}px 떠 있다`);
  // 대두 판정 — 머리 폭 대 어깨 폭
  const headRow = Math.max(0, J.head.y - 12);
  const shoulderRow = Math.min(SPRITE_H - 1, J.shFront.y + 1);
  const wAt = (y) => { let a = SPRITE_W, b = -1; for (let x = 0; x < SPRITE_W; x++) if (grid[y][x] !== '.') { if (x < a) a = x; b = x; } return b < 0 ? 0 : b - a + 1; };
  out.headW = wAt(headRow); out.shoulderW = wAt(shoulderRow);
  out.heads = out.height / Math.max(1, (J.head.y - top));
  return out;
}

/* ─────────────────────── 그리기 ─────────────────────── */
const BG = [26, 28, 36], GRID = [40, 44, 56], GROUND = [58, 52, 44];
function sheet(w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = BG[0]; px[i * 4 + 1] = BG[1]; px[i * 4 + 2] = BG[2]; px[i * 4 + 3] = 255; }
  return { w, h, px };
}
const put = (s, x, y, c) => {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  const i = (y * s.w + x) * 4;
  s.px[i] = c[0]; s.px[i + 1] = c[1]; s.px[i + 2] = c[2]; s.px[i + 3] = 255;
};

const PAD = 10;
const cands = [];
for (const f of files) {
  const abs = path.resolve(ROOT, f);
  let json;
  try { json = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { console.error(`  ✗ ${f}: ${e.message}`); continue; }
  const problems = [];
  const grid = compose(json, problems);
  const m = judge(grid, json);
  /* ★ canvas 를 **같이 들고 다녀야 한다.** 예전엔 grid 만 넘겼더니 아래 배치 계산이
   *   후보의 캔버스를 못 읽고 기본값(64×80)으로 쳐서, 96×120 후보가 셀 밖으로 잘려 나갔다. */
  cands.push({ name: json.name || path.basename(f, '.json'), note: json.note || '', grid, problems, m, canvas: canvasOf(json) });
}
if (!cands.length) { console.error('읽은 후보가 없다.'); process.exit(1); }

/* ★ 해상도가 다른 후보를 나란히 놓을 때는 **화면에서 같은 크기**로 맞춰야 공평하다.
 *   64×80 을 6배로, 96×120 을 6배로 그리면 후자가 그냥 더 커 보여서 «더 이쁘다» 로 착각한다.
 *   게임은 어느 쪽이든 96×120 CSS px 에 그리므로, 여기서도 같은 최종 크기로 맞춘다. */
const REF_H = 40;                                  // 논리 높이 (32×40 기준)
const zoomOf = (c) => (ZOOM * REF_H) / canvasOf(c).h * 2;
const cellOf = (c) => ({ w: Math.round(canvasOf(c).w * zoomOf(c)), h: Math.round(canvasOf(c).h * zoomOf(c)) });
const CELL_W = Math.max(...cands.map((c) => cellOf(c).w));
const CELL_H = Math.max(...cands.map((c) => cellOf(c).h));

const s = sheet(cands.length * (CELL_W + PAD) + PAD, CELL_H + PAD * 2);
cands.forEach((c, i) => {
  const x0 = PAD + i * (CELL_W + PAD), y0 = PAD;
  const cz = zoomOf(c);
  const { w: CW, h: CH } = canvasOf(c);
  for (let x = -1; x <= CELL_W; x++) { put(s, x0 + x, y0 - 1, GRID); put(s, x0 + x, y0 + CELL_H, GRID); }
  for (let y = -1; y <= CELL_H; y++) { put(s, x0 - 1, y0 + y, GRID); put(s, x0 + CELL_W, y0 + y, GRID); }
  // 지면선 (발바닥 y=38*SCALE)
  const gy = y0 + Math.round((CH - 2) * cz);
  for (let x = 0; x < CELL_W; x++) put(s, x0 + x, gy, GROUND);
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const hex = PAL[c.grid[y][x]];
      if (!hex) continue;
      const n = parseInt(hex.slice(1), 16);
      const col = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      const px0 = x0 + Math.round(x * cz), py0 = y0 + Math.round(y * cz);
      const px1 = x0 + Math.round((x + 1) * cz), py1 = y0 + Math.round((y + 1) * cz);
      for (let yy = py0; yy < py1; yy++) for (let xx = px0; xx < px1; xx++) put(s, xx, yy, col);
    }
  }
});

const out = path.resolve(ROOT, arg('out', 'candidate.png'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(s.w, s.h, s.px));

for (const c of cands) {
  console.log(`  ${c.name}${c.note ? ' — ' + c.note : ''}`);
  if (c.problems.length) {
    const uniq = [...new Set(c.problems)];
    for (const p of uniq.slice(0, 6)) console.log(`      ✗ 규격 ${p}`);
    if (uniq.length > 6) console.log(`      … 그 외 ${uniq.length - 6}건`);
  }
  const m = c.m;
  console.log(`      키 ${m.height}px · 폭 ${m.width}px · 머리폭 ${m.headW} 어깨폭 ${m.shoulderW}`
    + ` · ${m.heads.toFixed(1)}등신 · 눈x ${m.eyeX == null ? '—' : m.eyeX.toFixed(1)} 얼굴 ${m.skin}px 머리카락x ${m.hairX == null ? '—' : m.hairX.toFixed(1)}`);
  for (const p of m.bad) console.log(`      ✗ ${p}`);
  if (!c.problems.length && !m.bad.length) console.log('      ✓ 규격·방향 모두 통과');
}
console.log(`\n  ${path.relative(ROOT, out)}  ${s.w}×${s.h}  (확대 ${ZOOM}배)`);
