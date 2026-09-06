#!/usr/bin/env node
// PNG 일러스트 받아들이기 — 이미지 모델이 그린 정면 초상 → art/illust/ + 목록 갱신
// ════════════════════════════════════════════════════════════════════════════
//
// ★ 왜 도구인가
//   그림은 «표식이 제대로 찍혔나 · 발이 바닥에 붙나 · 눈이 어디 있나» 를 재야 게임에 들어갈 수 있다.
//   손으로 목록(illust_manifest.js)을 적으면 좌표를 반드시 한 번은 틀린다.
//   그리고 **크기 줄이기는 역할별로** 해야 한다 — 자홍 머리와 살색이 섞인 가장자리 픽셀은
//   어느 색상대에도 안 들어가 «분홍 테» 로 남는다. 원본 픽셀마다 역할을 먼저 정하고,
//   줄인 픽셀은 다수 역할의 원본만 평균한다.
//
// 표식 규약 (생성 프롬프트에 그대로 쓴다):
//   머리카락 = 자홍(magenta #FF00FF 계열, 색상 300°) · 홍채 = 청록(cyan #00FFFF 계열, 180°)
//   피부 = 자연색 · 배경 = 투명 · 발이 바닥에 닿음 · 정면 3/4 자세
//
// 실행
//   node tools/illustpng.mjs 그림.png --name=illust_fighter [--bg=auto|#00ff00] [--fit=192x240] [--colors=48] [--hairHue=255-300] [--out=x.png] [--apply]
//     --bg      단색 배경 키잉 (이미지 모델은 알파를 못 낸다). auto = 테두리에서 배경색을 잰다.
//               배경을 빼면 그림 상자를 잘라 발을 바닥에 맞춘다. --bgTol=14 (색상 허용 ±도)
//     --colors  표식 제외 n 색으로 줄인다 — 부드럽게 줄어든 그림이 «도트» 로 읽히게. 0 = 안 함.
//     --hairHue / --eyeHue  표식 색상대(도). 쓴 값은 목록(marker)에 적혀 게임이 같은 기준으로 분류한다.
//     --out     처리 결과(표식 그대로)를 따로 저장해 눈으로 본다. --alpha=hard|soft
//   --nohair  표식 없는 그림(적, §163): 머리·눈 표식을 안 찾고 목록에 roles:[] 로 적는다 — 게임이 재색을 건너뛴다
//   node tools/illustpng.mjs --fixture=illust_fighter [--apply]      # 문자 일러스트 → 표식 PNG (왕복 검증용)
//   node tools/illustpng.mjs --preview=illust_fighter --out=x.png [--hair=blond --eye=blue --skin=pale] [--zoom=3]
//
// --apply 가 없으면 **재기만 하고** 아무것도 안 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, decodePng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const file = args.find((a) => !a.startsWith('--'));

const { classifyMarker, recolorInto, registerIllustPng, getIllustPng, MARKER, markerSpec, hairMask } = await import('../src/art/illustpng.js');
const { ILLUST_PNG } = await import('../src/art/illust_manifest.js');
const { makePalette } = await import('../src/art/palette.js');
const { colorTable } = await import('../src/art/pixel.js');

const ILLUST_DIR = 'art/illust';
const MANIFEST = 'src/art/illust_manifest.js';
const DEFAULT_FIT = '192x240';

/* 표식 색상대 — 모델마다 «자홍» 을 다르게 그린다 (Animagine XL 4.0 은 분홍 쪽 330~345°).
 * 여기서 쓴 값이 목록(marker)에 적히고 게임이 **같은 값**으로 분류한다. */
const range = (s, d) => { const m = /^(\d+)-(\d+)$/.exec(s || ''); return m ? [Number(m[1]), Number(m[2])] : d; };
let SPEC = markerSpec({ hair: range(arg('hairHue', ''), MARKER.hair.hue), eye: range(arg('eyeHue', ''), MARKER.eye.hue) });

/* ─────────────────────────── 역할별 줄이기 ─────────────────────────── */

/** 원본 픽셀마다 역할: 0 없음 · 1 머리 · 2 눈(청록) · 3 투명 */
function roleMap(w, h, rgba) {
  const role = new Uint8Array(w * h);
  const hm = hairMask(w, h, rgba, SPEC);         // 씨앗 + 성장 — 게임과 같은 판정
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 8) { role[i] = 3; continue; }
    if (hm[i]) { role[i] = 1; continue; }
    const k = classifyMarker(rgba[o], rgba[o + 1], rgba[o + 2], SPEC);
    role[i] = k === 'eye' ? 2 : 0;
  }
  return role;
}

/**
 * 상자 평균으로 줄인다. 단, 상자 안 **다수 역할의 원본만** 평균한다 (분홍 테 방지).
 * 투명이 다수면 투명. 비율이 정수가 아니어도 된다 (상자 경계는 반올림).
 */
function downscaleByRole(sw, sh, src, dw, dh) {
  const role = roleMap(sw, sh, src);
  const out = new Uint8ClampedArray(dw * dh * 4);
  const fx = sw / dw, fy = sh / dh;
  const cnt = new Uint32Array(4), sum = new Float64Array(4 * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.round(y * fy), y1 = Math.max(y0 + 1, Math.round((y + 1) * fy));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.round(x * fx), x1 = Math.max(x0 + 1, Math.round((x + 1) * fx));
      cnt.fill(0); sum.fill(0);
      for (let sy = y0; sy < y1 && sy < sh; sy++) {
        for (let sx = x0; sx < x1 && sx < sw; sx++) {
          const i = sy * sw + sx;
          const r = role[i];
          cnt[r]++;
          const o = i * 4;
          sum[r * 4] += src[o]; sum[r * 4 + 1] += src[o + 1]; sum[r * 4 + 2] += src[o + 2]; sum[r * 4 + 3] += src[o + 3];
        }
      }
      /* 다수 역할. 투명이 절반 이상이면 투명 — 가장자리가 번지지 않게 */
      const total = cnt[0] + cnt[1] + cnt[2] + cnt[3];
      let best = 0;
      if (cnt[3] * 2 >= total) best = 3;
      else { const wc = [cnt[0], cnt[1], cnt[2] * 3]; best = 0; for (let r = 1; r <= 2; r++) if (wc[r] > wc[best]) best = r; }   // eye x3: iris is a few px after downscale and would lose every majority vote
      const o = (y * dw + x) * 4;
      if (best === 3 || !cnt[best]) { out[o + 3] = 0; continue; }
      const n = cnt[best];
      out[o] = Math.round(sum[best * 4] / n);
      out[o + 1] = Math.round(sum[best * 4 + 1] / n);
      out[o + 2] = Math.round(sum[best * 4 + 2] / n);
      out[o + 3] = Math.round(sum[best * 4 + 3] / n);
    }
  }
  return out;
}

/** 가운데를 잘라 비율을 맞춘다 (남는 쪽만 잘린다) */
function centerCrop(w, h, rgba, aspectW, aspectH) {
  const want = aspectW / aspectH;
  const have = w / h;
  let cw = w, chh = h;
  if (have > want) cw = Math.round(h * want); else chh = Math.round(w / want);
  const x0 = Math.floor((w - cw) / 2), y0 = Math.floor((h - chh) / 2);
  if (x0 === 0 && y0 === 0 && cw === w && chh === h) return { w, h, rgba };
  const out = new Uint8ClampedArray(cw * chh * 4);
  for (let y = 0; y < chh; y++) out.set(rgba.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4), y * cw * 4);
  return { w: cw, h: chh, rgba: out };
}

/* ─────────────────────────── 재기 ─────────────────────────── */

function analyze(w, h, rgba) {
  let opaque = 0, hair = 0, cyan = 0;
  const bb = { x0: w, y0: h, x1: -1, y1: -1 };
  const hb = { x0: w, y0: h, x1: -1, y1: -1 };
  const cyanPts = [];                                   // 청록 픽셀 전부 — 머리 상자를 알고 나서 눈만 고른다
  let cyanBelow = 0;
  const grow = (b, x, y) => { if (x < b.x0) b.x0 = x; if (y < b.y0) b.y0 = y; if (x > b.x1) b.x1 = x; if (y > b.y1) b.y1 = y; };
  const hm = hairMask(w, h, rgba, SPEC);
  const seeds = hm.seeds || 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (rgba[o + 3] < 8) continue;
      opaque++;
      grow(bb, x, y);
      if (hm[y * w + x]) { hair++; grow(hb, x, y); continue; }
      const k = classifyMarker(rgba[o], rgba[o + 1], rgba[o + 2], SPEC);
      if (k === 'eye') { cyan++; cyanPts.push(x, y); }
    }
  }
  /* 발바닥 = 마지막 불투명 행. 발밑 중앙 = 그 행의 불투명 구간 가운데 */
  let ay = bb.y1;
  let ax = Math.round((bb.x0 + bb.x1) / 2);
  if (ay >= 0) {
    let l = -1, r = -1;
    for (let x = 0; x < w; x++) if (rgba[(ay * w + x) * 4 + 3] >= 8) { if (l < 0) l = x; r = x; }
    if (l >= 0) ax = Math.round((l + r) / 2);
  }
  /* 눈 = 머리 상자 안, 그 위쪽 60% 에 있는 청록. 검 광채(아래)·청록 배경 잔재(밖)는 제외된다.
   * 짧은 머리(상자 = 머리통)면 눈이 40% 근처, 허리까지 오는 긴 머리면 15% 근처 — 둘 다 60% 안이다. */
  const eb = { x0: w, y0: h, x1: -1, y1: -1, n: 0 };
  if (hb.x1 >= 0) {
    const yMax = hb.y0 + (hb.y1 - hb.y0) * 0.6;
    for (let i = 0; i < cyanPts.length; i += 2) {
      const x = cyanPts[i], y = cyanPts[i + 1];
      if (x >= hb.x0 && x <= hb.x1 && y >= hb.y0 && y <= yMax) { grow(eb, x, y); eb.n++; } else cyanBelow++;
    }
  } else cyanBelow = cyanPts.length / 2;
  const eyeBox = eb.n ? [Math.max(0, eb.x0 - 2), Math.max(0, eb.y0 - 2), Math.min(w - 1, eb.x1 + 2), Math.min(h - 1, eb.y1 + 2)] : null;
  /* 머리 색상 진단 — 그림 상자 위 30% 의 채도 있는 픽셀을 30° 칸으로 센다.
   * 모델이 «자홍» 을 분홍(340°)이나 보라(270°)로 그렸는지 여기서 보인다 → 프롬프트나 색상대를 조정한다. */
  const hueBins = new Array(12).fill(0);
  if (bb.y1 >= 0) {
    const yTop = bb.y0, yEnd = bb.y0 + Math.round((bb.y1 - bb.y0) * 0.3);
    for (let y = yTop; y <= yEnd; y++) for (let x = bb.x0; x <= bb.x1; x++) {
      const o = (y * w + x) * 4;
      if (rgba[o + 3] < 8) continue;
      const [hh, s, v] = hsv(rgba[o], rgba[o + 1], rgba[o + 2]);
      if (s < 0.25 || v < 0.15) continue;
      hueBins[Math.min(11, Math.floor(hh / 30))]++;
    }
  }
  return { opaque, hair, seeds, cyan, cyanBelow, bb, hb, eyeBox, ax, ay, hueBins };
}

function report(name, w, h, a) {
  const pct = (n) => (a.opaque ? `${(100 * n / a.opaque).toFixed(1)}%` : '-');
  const lines = [];
  const warn = [];
  lines.push(`${name}: ${w}x${h} · 불투명 ${a.opaque}칸 · 그림 상자 (${a.bb.x0},${a.bb.y0})-(${a.bb.x1},${a.bb.y1})`);
  lines.push(`  발밑 ax=${a.ax} · 발바닥 ay=${a.ay}${a.ay < h - 4 ? `  ⚠ 바닥에서 ${h - 1 - a.ay}줄 떠 있다` : ''}`);
  lines.push(`  머리 표식 ${a.hair}칸 (${pct(a.hair)}, 씨앗 ${a.seeds}칸) 상자 (${a.hb.x0},${a.hb.y0})-(${a.hb.x1},${a.hb.y1})`);
  lines.push(`  눈 표식(청록) ${a.cyan}칸 · 눈 상자 ${a.eyeBox ? a.eyeBox.join(',') : '없음'}${a.cyanBelow ? `  (머리 상자 밖 청록 ${a.cyanBelow}칸은 눈이 아니라 그대로 남는다)` : ''}`);
  lines.push(`  표식 색상대: 머리 ${SPEC.hair.hue.join('~')}° · 눈 ${SPEC.eye.hue.join('~')}°`);
  if (a.hueBins) {
    const top = a.hueBins.map((n, i) => [n, i]).sort((p, q) => q[0] - p[0]).slice(0, 3).filter(([n]) => n > 0)
      .map(([n, i]) => `${i * 30}~${i * 30 + 30}° ${n}칸`).join(' · ');
    lines.push(`  머리 쪽 색상(위 30%, 채도 있는 픽셀): ${top || '없음'}   ← 자홍은 270~330° 에 있어야 한다`);
  }
  if (!a.opaque) warn.push('그림이 비었다');
  if (NOHAIR) { a.eyeBox = null; if (a.ay < h - 4) warn.push('발이 바닥에서 떠 있다 (그대로 넣어도 되지만 카드에서 뜬다)'); return { lines, warn, fatal: warn.filter((s) => !s.endsWith('(경고)') && !s.startsWith('발이')) }; }
  if (!a.hair) warn.push(`머리 표식이 없다 (0칸) — 프롬프트에 보라 머리를 넣었나?`);
  else if (a.hair < a.opaque * 0.01) warn.push(`머리 표식이 적다 (${a.hair}칸, ${pct(a.hair)}) — 투구·후드면 정상 (경고)`);
  if (a.hair > a.opaque * 0.6) warn.push(`머리 표식이 그림의 ${pct(a.hair)} — 옷까지 자홍인 것 같다`);
  if (!a.eyeBox) warn.push('눈 표식이 없다 — 눈색 편차는 안 산다 (경고)');
  if (a.eyeBox && a.hb.x1 >= 0) {
    const ew = a.eyeBox[2] - a.eyeBox[0], eh = a.eyeBox[3] - a.eyeBox[1];
    const hw = a.hb.x1 - a.hb.x0 + 1, hh = a.hb.y1 - a.hb.y0 + 1;
    if (ew > hw * 0.8 || eh > hh * 0.5) {
      /* 청록 장식·광채가 머리 상자 안에 있다 — 눈 편차를 포기한다 (roles 에서 eye 가 빠진다). 치명이 아니다 (경고) */
      warn.push(`눈 상자가 너무 크다 (${ew}x${eh}, 머리 상자 ${hw}x${hh}) — 눈 편차 포기 (경고)`);
      a.eyeBox = null;
    }
  }
  if (a.ay < h - 4) warn.push('발이 바닥에서 떠 있다 (그대로 넣어도 되지만 카드에서 뜬다)');
  return { lines, warn, fatal: warn.filter((s) => !s.endsWith('(경고)') && !s.startsWith('발이')) };
}

/* ─────────────────────────── 목록 쓰기 ─────────────────────────── */

const HEADER = `/**
 * PNG 일러스트 목록 — **도구가 쓴다. 손으로 고치지 마라.**
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node tools/illustpng.mjs <그림.png> --name=illust_fighter --apply
 *
 * 항목 하나 = \`art/illust/<이름>.png\` 한 장.
 *   w·h    : 픽셀 크기 (그대로 그린다 — 표시 배율은 portrait.js 의 norm 이 맞춘다)
 *   ax·ay  : 발밑 중앙 열 · 발바닥 행 (문자 일러스트와 같은 규약)
 *   eyeBox : [x0, y0, x1, y1] — 청록 표식을 **이 안에서만** 눈으로 친다.
 *            (청록은 서리 마력광·청록 천과 겹칠 수 있어 상자 밖은 안 건드린다)
 *   marker : 이 그림을 받아들일 때 쓴 표식 색상대 {hair:[lo,hi], eye:[lo,hi]} — 게임이 같은 값으로 분류한다.
 *   roles  : 실제로 표식이 잡힌 역할 — 'hair' | 'eye'. 없으면 그 편차는 안 산다.
 *
 * @module art/illust_manifest
 */

/** @type {Record<string, {file:string, w:number, h:number, ax:number, ay:number, eyeBox?:number[], marker?:{hair:number[],eye:number[]}, roles:string[]}>} */
export const ILLUST_PNG = {
`;

function writeManifest(entries) {
  const names = Object.keys(entries).sort();
  const body = names.map((n) => {
    const e = entries[n];
    const eb = e.eyeBox ? `, eyeBox: [${e.eyeBox.join(', ')}]` : '';
    const mk = e.marker ? `, marker: { hair: [${e.marker.hair.join(', ')}], eye: [${e.marker.eye.join(', ')}] }` : '';
    return `  ${n}: { file: '${e.file}', w: ${e.w}, h: ${e.h}, ax: ${e.ax}, ay: ${e.ay}${eb}${mk}, roles: [${e.roles.map((r) => `'${r}'`).join(', ')}] },`;
  }).join('\n');
  const target = path.join(ROOT, MANIFEST);
  const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const eol = prev.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(target, (HEADER + body + (body ? '\n' : '') + '};\n').split('\n').join(eol));
}

/* ─────────────────────────── 모드 ─────────────────────────── */

const fixture = arg('fixture', '');
const preview = arg('preview', '');
const NOHAIR = flag('nohair');

if (preview) {
  /* 반영된 PNG 를 팔레트로 재색칠해 본다 — 게임과 같은 함수(recolorInto) */
  const m = ILLUST_PNG[preview];
  if (!m) { console.error(`목록에 ${preview} 가 없다`); process.exit(1); }
  const png = decodePng(fs.readFileSync(path.join(ROOT, m.file)));
  registerIllustPng(preview, { w: png.w, h: png.h, ax: m.ax, ay: m.ay, eyeBox: m.eyeBox || null, marker: m.marker || null, data: png.rgba });
  const rec = getIllustPng(preview);
  const pal = makePalette({ hair: arg('hair', 'brown'), eye: arg('eye', 'brown'), skin: arg('skin', 'pale') });
  const tbl = colorTable(pal);
  const buf = new Uint8ClampedArray(rec.w * rec.h * 4);
  recolorInto(buf, rec.w, rec.h, rec, 0, tbl);
  const zoom = Math.max(1, Number(arg('zoom', 1)) || 1);
  const out = zoomNN(rec.w, rec.h, buf, zoom);
  const outPath = path.resolve(ROOT, arg('out', `${preview}-preview.png`));
  fs.writeFileSync(outPath, encodePng(rec.w * zoom, rec.h * zoom, Buffer.from(out.buffer, out.byteOffset, out.length)));
  console.error(`  ${outPath} (${rec.w * zoom}x${rec.h * zoom}, hair=${arg('hair', 'brown')} eye=${arg('eye', 'brown')})`);
  process.exit(0);
}

let name = arg('name', '');
let src;                                   // { w, h, rgba }

if (fixture) {
  /* 문자 일러스트를 **표식 팔레트**로 찍는다 — 머리 3단·눈 2단이 자홍·청록이 된다.
   * 게임 팔레트로 되돌리면 원본과 똑같아야 한다 (스모크가 같은 왕복을 메모리에서 검사한다). */
  const { FRONT_PARTS } = await import('../src/art/parts_front.js');
  const p = FRONT_PARTS[fixture];
  if (!p) { console.error(`정면 파츠에 ${fixture} 가 없다`); process.exit(1); }
  const pal = markerPalette();
  SPEC = markerSpec({ hair: [285, 330], eye: [165, 200] });   // fixture palette is magenta 300deg, not the purple default
  const rgba = new Uint8ClampedArray(p.w * p.h * 4);
  for (let y = 0; y < p.h; y++) {
    const row = p.px[y] || '';
    for (let x = 0; x < p.w; x++) {
      const hex = pal[row[x] || '.'];
      if (!hex) continue;
      const n = parseInt(hex.slice(1), 16);
      const o = (y * p.w + x) * 4;
      rgba[o] = (n >> 16) & 255; rgba[o + 1] = (n >> 8) & 255; rgba[o + 2] = n & 255; rgba[o + 3] = 255;
    }
  }
  src = { w: p.w, h: p.h, rgba };
  name = name || fixture;
  console.error(`  표식 팔레트로 찍음: ${fixture} ${p.w}x${p.h} (ax ${p.ax}, ay ${p.ay})`);
} else {
  if (!file) { console.error('그림 PNG 를 넘겨라 (또는 --fixture / --preview).'); process.exit(1); }
  if (!name) { console.error('--name=illust_<style> 이 필요하다.'); process.exit(1); }
  src = decodePng(fs.readFileSync(path.resolve(ROOT, file)));
  console.error(`  읽음: ${file} ${src.w}x${src.h}`);
  /* 단색 배경 키잉 — 이미지 모델은 알파를 못 내니 순녹(#00ff00) 배경으로 그리게 하고 여기서 뺀다.
   * 자홍·청록 표식과 안 겹친다. ★ 녹색 옷은 같이 빠진다 — 프롬프트에서 녹색 의상을 피해라. */
  const bg = arg('bg', '');
  if (bg) {
    /* auto = 테두리 띠에서 배경색을 잰다. 모델은 «순녹» 을 청록빛으로 그리기도 해서 고정 색상으로는 못 뺀다. */
    let kh, est = null;
    if (bg === 'auto') {
      est = estimateBg(src.w, src.h, src.rgba);
      if (!est) { console.error('  ✗ 테두리에서 배경색을 못 쟀다 (단색이 아니다)'); process.exit(1); }
      kh = est.hue;
      if (est.achromatic) console.error(`  배경색 추정: 무채색 · 명도 ${est.val.toFixed(2)} (테두리 ${est.share}%)`);
      else console.error(`  배경색 추정: 색상 ${est.hue.toFixed(0)}° · 채도 ${est.sat.toFixed(2)} · 명도 ${est.val.toFixed(2)} (테두리 ${est.share}%)`);
    } else {
      const n = parseInt(bg.slice(1), 16);
      kh = hsv((n >> 16) & 255, (n >> 8) & 255, n & 255)[0];
    }
    const tol = Number(arg('bgTol', 14)) || 14;
    let keyed;
    /* ★ 옅은 저채도 테두리(베이지 40°·채도 0.08~0.15·명도 0.9)는 무채색으로 다룬다 — 색상 flood 로 다루면 갈색·황갈색 옷이 같은 색상대라 통째로 빠진다 (§163 적 1차: 오크 바지·고블린 로브·트롤 다리). */
    const pale = est && (est.achromatic || est.sat < 0.08 || (est.sat < 0.16 && est.val >= 0.7));
    if (pale) {
      /* 채도 0.12 미만은 «흰빛 도는 거의 흰색» — 색상대로 빼면 노이즈만 점점이 빠진다 (사제 46%). 밝기로 뺀다 */
      keyed = keyAchromatic(src.w, src.h, src.rgba, est.val, Math.max(0.12, est.sat + 0.05), true, est.sat);
      console.error(`  배경 키잉 무채색(명도 ${est.val.toFixed(2)}±0.10, 평탄): ${keyed}칸 투명 (${(100 * keyed / (src.w * src.h)).toFixed(1)}%)`);
    } else {
      /* 채도 하한은 잰 배경의 절반 — 모델이 «라임» 을 파스텔(채도 0.2)로 그리면 고정 0.3 으로는 하나도 안 빠진다 */
      const sMin = est ? Math.max(0.05, est.sat * 0.45) : 0.30;
      keyed = keyBackground(src.w, src.h, src.rgba, kh, tol, sMin);
      console.error(`  배경 키잉 ${kh.toFixed(0)}°±${tol} · 채도 ${sMin.toFixed(2)}+: ${keyed}칸 투명 (${(100 * keyed / (src.w * src.h)).toFixed(1)}%)`);
    }
    /* 2차: 색상으로 뺀 뒤 무채색 패스를 **항상** 한 번 더 — 흰 노이즈·후광 잔여·파스텔+흰 혼합. 둘 다 테두리 flood fill 이라 합쳐도 안전하다.
     * (무채색으로 시작한 경우는 이미 했으니 건너뛴다) */
    if (est && !pale) {
      const band = Math.max(2, Math.round(Math.min(src.w, src.h) * 0.02));
      let bright = 0, sv = 0;
      for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
        if (x >= band && x < src.w - band && y >= band && y < src.h - band) continue;
        const o = (y * src.w + x) * 4;
        if (src.rgba[o + 3] < 8) continue;
        const [, s2, v2] = hsv(src.rgba[o], src.rgba[o + 1], src.rgba[o + 2]);
        if (s2 < 0.15 && v2 > 0.75) { bright++; sv += v2; }
      }
      const bgV = bright ? sv / bright : Math.max(est.val, 0.9);
      const k2 = keyAchromatic(src.w, src.h, src.rgba, bgV, 0.12, false);   // 2nd pass: fixed sMax, NO enclosed removal (est.sat+0.08 let flat skin in and the face got keyed)
      if (k2) { keyed += k2; console.error(`  배경 키잉 2차(무채색 명도 ${bgV.toFixed(2)}): +${k2}칸 → 합계 ${(100 * keyed / (src.w * src.h)).toFixed(1)}%`); }
    }
    /* 3차: 바닥 그림자 — 검수에서 가장 많이 남은 것. 아래 15% 행의 회색·평탄 영역을 아래 테두리에서 flood 로 뺀다 */
    { const k3 = keyFloorShadow(src.w, src.h, src.rgba); if (k3) { keyed += k3; console.error(`  바닥 그림자 제거: ${k3}칸 → 합계 ${(100 * keyed / (src.w * src.h)).toFixed(1)}%`); } }
    /* 4차: 몸 안에 갇힌 작은 구멍을 주변 색으로 메운다 — 원본 크기 기준 0.4% 까지 (§163.2) */
    fillHoles(src.w, src.h, src.rgba, Math.round(src.w * src.h * 0.004));
    if (keyed < src.w * src.h * 0.15) { console.error('  ✗ 배경이 15% 도 안 빠졌다 — 배경이 단색이 아니거나 색상대가 틀렸다'); process.exit(1); }
  }
  const fit = arg('fit', DEFAULT_FIT);
  if (fit !== 'none') {
    const [fw, fh] = fit.split('x').map(Number);
    if (!(fw > 0 && fh > 0)) { console.error(`--fit=${fit} 은 WxH 여야 한다`); process.exit(1); }
    if (src.w !== fw || src.h !== fh) {
      /* 배경을 뺐으면 그림 상자를 잘라 **발이 바닥에 닿게** 다시 놓는다 (모델은 여백을 제멋대로 둔다).
       * 안 뺐으면(이미 투명 배경) 가운데 자르기. --frame 으로 강제할 수 있다. */
      const framed = (bg || flag('frame'))
        ? frameToAspect(src.w, src.h, src.rgba, fw, fh)
        : centerCrop(src.w, src.h, src.rgba, fw, fh);
      if (framed.box) console.error(`  그림 상자 (${framed.box.join(',')}) → ${framed.w}x${framed.h} 캔버스에 발 맞춰 놓음`);
      else if (framed.w !== src.w || framed.h !== src.h) console.error(`  비율 맞춤 자르기: ${src.w}x${src.h} → ${framed.w}x${framed.h}`);
      const rgba = downscaleByRole(framed.w, framed.h, framed.rgba, fw, fh);
      console.error(`  역할별 줄이기: ${framed.w}x${framed.h} → ${fw}x${fh} (×${(framed.w / fw).toFixed(2)})`);
      src = { w: fw, h: fh, rgba };
    }
  }
  if (arg('alpha', 'hard') === 'hard') {
    /* 도트는 반투명이 없다 — 가장자리를 딱 자른다 */
    for (let i = 3; i < src.rgba.length; i += 4) src.rgba[i] = src.rgba[i] >= 128 ? 255 : 0;
  }
  /* 색 줄이기 — 부드럽게 줄어든 그림을 «도트» 로 보이게 한다. 표식 픽셀은 건드리지 않는다 (게임이 다시 칠한다). */
  const colors = Number(arg('colors', 0)) || 0;
  if (colors > 0) {
    const k = quantize(src.w, src.h, src.rgba, colors);
    console.error(`  색 줄이기: 표식 제외 ${k}색`);
  }
  /* --out 은 처리 결과(표식 그대로)를 따로 저장 — 넣기 전에 눈으로 본다 */
  const outPng = arg('out', '');
  if (outPng) {
    fs.writeFileSync(path.resolve(outPng), encodePng(src.w, src.h, Buffer.from(src.rgba.buffer, src.rgba.byteOffset, src.rgba.length)));
    console.error(`  처리 결과 저장: ${outPng}`);
  }
}

if (!/^illust_[a-z0-9_]+$/.test(name)) { console.error(`이름은 illust_<style> 꼴이어야 한다: ${name}`); process.exit(1); }

const a = analyze(src.w, src.h, src.rgba);
const r = report(name, src.w, src.h, a);
for (const l of r.lines) console.error('  ' + l);
for (const wmsg of r.warn) console.error('  ⚠ ' + wmsg);
if (r.fatal.length) { console.error('  ✗ 넣을 수 없다 — 위 경고를 고쳐라'); process.exit(1); }

if (!flag('apply')) { console.error('  (--apply 가 없어 아무것도 안 썼다)'); process.exit(0); }

fs.mkdirSync(path.join(ROOT, ILLUST_DIR), { recursive: true });
const rel = `${ILLUST_DIR}/${name}.png`;
fs.writeFileSync(path.join(ROOT, rel), encodePng(src.w, src.h, Buffer.from(src.rgba.buffer, src.rgba.byteOffset, src.rgba.length)));
const roles = [];
if (!NOHAIR && a.hair) roles.push('hair');
if (!NOHAIR && a.eyeBox) roles.push('eye');
const entries = { ...ILLUST_PNG, [name]: { file: rel, w: src.w, h: src.h, ax: a.ax, ay: a.ay, eyeBox: (!NOHAIR && a.eyeBox) || undefined, marker: NOHAIR ? null : { hair: SPEC.hair.hue, eye: SPEC.eye.hue }, roles } };
writeManifest(entries);

/* 써 놓고 되읽는다 — 목록이 실제 파일과 맞는지 */
const back = decodePng(fs.readFileSync(path.join(ROOT, rel)));
if (back.w !== src.w || back.h !== src.h) { console.error('  ✗ 되읽은 크기가 다르다'); process.exit(1); }
console.error(`  ✓ ${rel} + ${MANIFEST} (${Object.keys(entries).length}장)`);
ensureShellEntry(rel);

/* ─────────────────────────── 배경 키잉 · 틀 맞추기 · 색 줄이기 ─────────────────────────── */

/* HSV 색상 — illustpng.js 의 것과 같은 공식 (표식 분류는 저쪽 classifyMarker 를 쓴다) */
function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
}

/** 테두리 띠(2%)의 채도 있는 픽셀을 15° 칸으로 세어 최빈 칸을 배경으로 — 파스텔은 색상이 흔들려 5° 칸으로는 30% 를 못 넘는다.
 *  색상은 그 칸(±1칸)의 원형 평균, 채도·명도도 평균. */
function estimateBg(w, h, rgba) {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const NB = 24;                                   // 15° 칸
  const bins = new Array(NB).fill(0);
  const pts = [];                                  // [hue, s, v] (채도 있는 테두리 픽셀)
  let total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= band && x < w - band && y >= band && y < h - band) continue;
    const o = (y * w + x) * 4;
    if (rgba[o + 3] < 8) continue;
    total++;
    const [hh, s, v] = hsv(rgba[o], rgba[o + 1], rgba[o + 2]);
    if (s < 0.05 || v < 0.1) continue;
    bins[Math.min(NB - 1, Math.floor(hh / 15))]++;
    pts.push(hh, s, v);
  }
  let best = 0;
  for (let b = 1; b < NB; b++) if (bins[b] > bins[best]) best = b;
  const share = (bins[best] + bins[(best + 1) % NB] + bins[(best + NB - 1) % NB]) / Math.max(1, total);
  if (!bins[best] || share < 0.3) {
    /* 무채색 배경(흰·회색) — 모델은 «white background» 를 제일 잘 그린다. 테두리 밝기 평균으로 잰다 */
    let n = 0, sv = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const o = (y * w + x) * 4;
      if (rgba[o + 3] < 8) continue;
      const [, s2, v2] = hsv(rgba[o], rgba[o + 1], rgba[o + 2]);
      if (s2 < 0.12) { n++; sv += v2; }
    }
    if (n < total * 0.6) return null;
    return { achromatic: true, hue: 0, sat: 0, val: sv / n, share: Math.round(100 * n / total) };
  }
  /* 원형 평균 — 최빈 칸 ±1 칸의 픽셀만 */
  let sx = 0, sy = 0, ss = 0, sv = 0, n = 0;
  const c0 = best * 15 + 7.5;
  for (let i = 0; i < pts.length; i += 3) {
    let d = Math.abs(pts[i] - c0); if (d > 180) d = 360 - d;
    if (d > 22.5) continue;
    const a = pts[i] * Math.PI / 180;
    sx += Math.cos(a); sy += Math.sin(a); ss += pts[i + 1]; sv += pts[i + 2]; n++;
  }
  let hue = Math.atan2(sy, sx) * 180 / Math.PI; if (hue < 0) hue += 360;
  return { hue, sat: ss / n, val: sv / n, share: Math.round(100 * share) };
}

/** 바닥 그림자 — 아래 15% 행, 채도 0.18 미만, 명도 0.25~0.92, 3×3 명도 폭 0.08 미만인 픽셀을 후보로 **아래 테두리·이미 투명한 곳**에서 flood. */
function keyFloorShadow(w, h, rgba) {
  const y0 = Math.floor(h * 0.85);
  const V = new Float32Array(w * h).fill(-1);
  for (let y = y0 - 1; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (y < 0) continue; const o = i * 4; if (rgba[o + 3] < 8) continue; V[i] = hsv(rgba[o], rgba[o + 1], rgba[o + 2])[2]; }
  const cand = new Uint8Array(w * h);
  for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const o = i * 4;
    if (rgba[o + 3] < 8) continue;
    const [, s2, v2] = hsv(rgba[o], rgba[o + 1], rgba[o + 2]);
    if (s2 >= 0.18 || v2 < 0.25 || v2 > 0.92) continue;
    let mn = 1, mx = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v3 = V[yy * w + xx]; if (v3 < 0) continue; if (v3 < mn) mn = v3; if (v3 > mx) mx = v3;
    }
    if (mx - mn < 0.08) cand[i] = 1;
  }
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (p) => { if (cand[p] && !seen[p]) { seen[p] = 1; stack.push(p); } };
  /* 씨앗: 아래 테두리 + 이미 투명한 픽셀에 붙은 후보 */
  for (let x = 0; x < w; x++) push((h - 1) * w + x);
  for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!cand[i]) continue;
    if ((x > 0 && rgba[(i - 1) * 4 + 3] === 0) || (x < w - 1 && rgba[(i + 1) * 4 + 3] === 0) || (y < h - 1 && rgba[(i + w) * 4 + 3] === 0)) push(i);
  }
  let keyed = 0;
  while (stack.length) {
    const p = stack.pop(); rgba[p * 4 + 3] = 0; keyed++;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > y0) push(p - w); if (y < h - 1) push(p + w);
  }
  return keyed;
}

/**
 * 그림 안에 갇힌 **작은 투명 구멍**을 주변 색으로 메운다 (§163.2).
 *
 * ★ 왜: 배경색이 그림 안까지 들어오는 그림이 있다 — 벌린 입 안쪽, 반투명 망토, 갈기 사이. 지우면 구멍이 뚫리고
 *   남기면 초록/보라 얼룩이 몸에 박힌다. 둘 다 틀렸다. **테두리에 안 닿은** 구멍은 «몸 안» 이므로 메우는 편이 맞다.
 *   진짜 틈(팔과 몸통 사이, 방패 고리)은 크니까 maxArea 위로 두고 그대로 투명하게 남긴다.
 * @param {number} maxArea 이 칸수보다 작은 구멍만 메운다
 */
function fillHoles(w, h, rgba, maxArea) {
  /* 투명 성분 중 테두리에 닿은 것 표시 */
  const outside = new Uint8Array(w * h);
  const st = [];
  const push = (p) => { if (rgba[p * 4 + 3] === 0 && !outside[p]) { outside[p] = 1; st.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) {
    const p = st.pop(); const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  /* 갇힌 투명 성분을 모아 작은 것만 메운다 */
  const mark = new Uint8Array(w * h);
  const holes = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (rgba[p0 * 4 + 3] !== 0 || outside[p0] || mark[p0]) continue;
    const q = [p0]; mark[p0] = 1; const members = [];
    while (q.length) {
      const p = q.pop(); members.push(p);
      const x = p % w, y = (p / w) | 0;
      const nb = [];
      if (x > 0) nb.push(p - 1); if (x < w - 1) nb.push(p + 1);
      if (y > 0) nb.push(p - w); if (y < h - 1) nb.push(p + w);
      for (const n of nb) if (rgba[n * 4 + 3] === 0 && !outside[n] && !mark[n]) { mark[n] = 1; q.push(n); }
    }
    if (members.length <= maxArea) holes.push(members);
  }
  if (!holes.length) return 0;
  const todo = new Uint8Array(w * h);
  let n = 0;
  for (const m of holes) for (const p of m) { todo[p] = 1; n++; }
  /* 가장자리부터 안쪽으로 — 이웃한 불투명 픽셀의 평균색을 칠한다 */
  for (let pass = 0; pass < 64; pass++) {
    let filled = 0;
    const next = [];
    for (let p = 0; p < w * h; p++) {
      if (!todo[p]) continue;
      const x = p % w, y = (p / w) | 0;
      let r = 0, g = 0, b = 0, c = 0;
      const nb = [];
      if (x > 0) nb.push(p - 1); if (x < w - 1) nb.push(p + 1);
      if (y > 0) nb.push(p - w); if (y < h - 1) nb.push(p + w);
      for (const q of nb) if (rgba[q * 4 + 3] > 8 && !todo[q]) { r += rgba[q * 4]; g += rgba[q * 4 + 1]; b += rgba[q * 4 + 2]; c++; }
      if (!c) continue;
      next.push([p, (r / c) | 0, (g / c) | 0, (b / c) | 0]);
    }
    for (const [p, r, g, b] of next) { rgba[p * 4] = r; rgba[p * 4 + 1] = g; rgba[p * 4 + 2] = b; rgba[p * 4 + 3] = 255; todo[p] = 0; filled++; }
    if (!filled) break;
  }
  console.error(`  갇힌 구멍 ${holes.length}곳 ${n}칸 메움`);
  return n;
}

/** 테두리에 안 닿은 후보 성분 중 minArea 이상을 뺀다 (갇힌 배경). seen = 테두리 flood 로 이미 뺀 것. */
function keyEnclosed(w, h, rgba, cand, seen, minArea) {
  let keyed = 0, comps = 0;
  const mark = new Uint8Array(w * h);
  for (let p0 = 0; p0 < w * h; p0++) {
    if (!cand[p0] || seen[p0] || mark[p0]) continue;
    const st = [p0]; mark[p0] = 1; const members = [];
    while (st.length) {
      const p = st.pop(); members.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && cand[p - 1] && !seen[p - 1] && !mark[p - 1]) { mark[p - 1] = 1; st.push(p - 1); }
      if (x < w - 1 && cand[p + 1] && !seen[p + 1] && !mark[p + 1]) { mark[p + 1] = 1; st.push(p + 1); }
      if (y > 0 && cand[p - w] && !seen[p - w] && !mark[p - w]) { mark[p - w] = 1; st.push(p - w); }
      if (y < h - 1 && cand[p + w] && !seen[p + w] && !mark[p + w]) { mark[p + w] = 1; st.push(p + w); }
    }
    if (members.length >= minArea) { comps++; for (const p of members) { rgba[p * 4 + 3] = 0; seen[p] = 1; keyed++; } }
  }
  if (comps) console.error(`  갇힌 배경 ${comps}곳 ${keyed}칸 제거`);
  return keyed;
}

/**
 * 무채색 배경 키잉 — 채도 0.12 미만 · 배경 밝기 ±0.10 · **3×3 이 평탄(명도 폭 0.03 미만)** 인 픽셀을 후보로,
 * 테두리에서 이어진 성분만 뺀다. 흰 옷·강철 갑옷은 음영과 외곽선이 있어 평탄하지 않다 — 거기서 멈춘다.
 * 바닥 그림자(회색, 아래 30%)는 밝기 조건을 넓혀 후보에 넣는다.
 */
function keyAchromatic(w, h, rgba, bgV, sMax = 0.12, enclosed = true, bgS = 0) {
  const V = new Float32Array(w * h), S = new Float32Array(w * h), Hh = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const o = i * 4; const [hh, s, v] = hsv(rgba[o], rgba[o + 1], rgba[o + 2]); Hh[i] = hh; S[i] = s; V[i] = rgba[o + 3] < 8 ? -1 : v; }
  const cand = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (V[i] < 0 || S[i] >= sMax) continue;
    /* ★ 살색 보호 (§164 공격 포즈에서 얼굴이 또 검게 빠졌다): 따뜻한 색상(5~50°)에 채도가 조금이라도 있고 밝으면 — 옅은 피부 — 후보에서 뺀다.
     *   흰 옷·흰 배경은 채도 0.06 미만이라 그대로 빠진다. 크림색 배경(60~90°)은 범위 밖. */
    if (S[i] >= Math.max(0.10, bgS + 0.04) && Hh[i] >= 5 && Hh[i] <= 45 && V[i] >= 0.55) continue;   // 배경보다 확실히 진해야 살색 — 크림색 배경(채도 0.08, 40°)이 통째로 보호된 사고
    const floor = y >= h * 0.70;
    if (!(Math.abs(V[i] - bgV) <= 0.14 || (floor && V[i] >= 0.35 && V[i] <= bgV))) continue;
    let mn = 1, mx = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v2 = V[yy * w + xx]; if (v2 < 0) continue;
      if (v2 < mn) mn = v2; if (v2 > mx) mx = v2;
    }
    if (mx - mn < (floor ? 0.10 : 0.06) || (V[i] > 0.90 && S[i] < sMax + 0.03)) cand[i] = 1;   // noisy near-white counts too
  }
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (p) => { if (cand[p] && !seen[p]) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  let keyed = 0;
  while (stack.length) {
    const p = stack.pop();
    rgba[p * 4 + 3] = 0; keyed++;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  if (enclosed) keyed += keyEnclosed(w, h, rgba, cand, seen, 2000);        // 갇힌 흰 배경 — 흰 옷이 흔하니 큰 평탄 덩어리만
  /* 가장자리 1px 더 — 평탄성 검사가 경계 픽셀을 남긴다 (배경과 외곽선 사이 안티에일리어싱) */
  const edge = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (rgba[i * 4 + 3] === 0 || S[i] >= sMax + 0.03 || Math.abs(V[i] - bgV) > 0.15) continue;
    let touch = false;
    for (let dy = -1; dy <= 1 && !touch; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if (seen[yy * w + xx]) { touch = true; break; }
    }
    if (touch) edge.push(i);
  }
  for (const i of edge) { rgba[i * 4 + 3] = 0; keyed++; }
  return keyed;
}

/**
 * 키 색상대(±tol°, 채도 sMin+, 그림자까지)를 투명으로 — 단, **테두리에서 이어진 영역만** (flood fill).
 * 모델이 배경색을 방패·지팡이에 번지게 그려도 구멍이 안 난다 — 그 장식은 남고, 부정 프롬프트가 줄인다.
 * 남은 픽셀 중 키 근처 색상은 despill 로 눌러 «색 테» 를 없앤다.
 */
function keyBackground(w, h, rgba, kh, tol = 14, sMin = 0.30) {
  const cand = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (!rgba[o + 3]) continue;
    const [hh, s, v] = hsv(rgba[o], rgba[o + 1], rgba[o + 2]);
    let dh = Math.abs(hh - kh); if (dh > 180) dh = 360 - dh;
    if (dh <= tol && s >= sMin && v >= 0.12) cand[i] = 1;
    /* floor shadow: same hue band but desaturated, only in the bottom rows (boots are brown, far from the key hue) */
    else if (dh <= tol + 6 && s >= 0.06 && v >= 0.12 && v <= 0.85 && (i / w | 0) >= h * 0.70) cand[i] = 1;
  }
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (p) => { if (cand[p] && !seen[p]) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  let keyed = 0;
  while (stack.length) {
    const p = stack.pop();
    rgba[p * 4 + 3] = 0; keyed++;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  /* ★ 갇힌 배경은 **큰 것만** 지운다 (§163.2). 40칸으로 두면 벌린 입 안쪽·이 사이 틈·반투명 망토가 통째로 사라져
   *   그림이 조각난다 — 실제로 늑대 갈기와 고블린 망토가 그렇게 부서졌다. 작은 것은 fillHoles 가 주변 색으로 메운다. */
  keyed += keyEnclosed(w, h, rgba, cand, seen, Math.max(400, Math.round(w * h * 0.004)));
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (!rgba[o + 3]) continue;
    const [hh, s] = hsv(rgba[o], rgba[o + 1], rgba[o + 2]);
    let dh = Math.abs(hh - kh); if (dh > 180) dh = 360 - dh;
    if (dh <= tol + 16 && s >= 0.2) {
      const idx = kh < 60 || kh >= 300 ? 0 : kh < 180 ? 1 : 2;
      const others = [0, 1, 2].filter((c) => c !== idx).map((c) => rgba[o + c]);
      const cap = Math.max(...others);
      if (rgba[o + idx] > cap) rgba[o + idx] = cap;
    }
  }
  return keyed;
}

/** 그림 상자를 잘라 목표 비율 캔버스에 **발은 바닥, 가로는 가운데** 로 놓는다. 여백은 투명. */
function frameToAspect(w, h, rgba, aw, ah) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] >= 8) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { w, h, rgba };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const m = Math.round(bh * 0.02);                       // 머리 위 숨통
  let ch = bh + m, cw = Math.round(ch * aw / ah);
  if (cw < bw) { cw = bw; ch = Math.round(cw * ah / aw); }
  const out = new Uint8ClampedArray(cw * ch * 4);
  const ox = Math.floor((cw - bw) / 2), oy = ch - bh;
  for (let y = 0; y < bh; y++) out.set(rgba.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + bw) * 4), ((oy + y) * cw + ox) * 4);
  return { w: cw, h: ch, rgba: out, box: [x0, y0, x1, y1] };
}

/** 중앙값 자르기(median cut)로 표식이 아닌 불투명 픽셀을 n 색으로. 제자리에서 바꾼다. */
function quantize(w, h, rgba, n) {
  const idx = [];
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 8) continue;
    if (classifyMarker(rgba[o], rgba[o + 1], rgba[o + 2], SPEC)) continue;
    idx.push(i);
  }
  if (!idx.length) return 0;
  let boxes = [idx];
  while (boxes.length < n) {
    let bi = -1, bRange = -1, bCh = 0;
    boxes.forEach((b, k) => {
      if (b.length < 2) return;
      const mn = [255, 255, 255], mx = [0, 0, 0];
      for (const i of b) for (let c = 0; c < 3; c++) { const v = rgba[i * 4 + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
      for (let c = 0; c < 3; c++) { const r = mx[c] - mn[c]; if (r > bRange) { bRange = r; bi = k; bCh = c; } }
    });
    if (bi < 0 || bRange < 6) break;
    const b = boxes[bi];
    b.sort((p, q) => rgba[p * 4 + bCh] - rgba[q * 4 + bCh]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  for (const b of boxes) {
    const avg = [0, 0, 0];
    for (const i of b) for (let c = 0; c < 3; c++) avg[c] += rgba[i * 4 + c];
    for (let c = 0; c < 3; c++) avg[c] = Math.round(avg[c] / b.length);
    for (const i of b) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = avg[c];
  }
  return boxes.length;
}

/* ─────────────────────────── sw.js 자동 등록 ─────────────────────────── */

/** APP_SHELL 에 './<rel>' 이 없으면 PNG 일러스트 블록 끝에 넣는다. 손으로 105줄 적으면 반드시 하나 빠진다 (스모크가 잡지만). */
function ensureShellEntry(rel) {
  const target = path.join(ROOT, 'sw.js');
  const raw = fs.readFileSync(target, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const text = raw.split('\r\n').join('\n');
  const entry = "  './" + rel + "',";
  if (text.includes("'./" + rel + "'")) { console.error("  sw.js: './" + rel + "' 이미 있음"); return; }
  const lines = text.split('\n');
  /* PNG 일러스트 블록 = 주석 줄 다음부터 이어지는 './art/illust/' 줄들. 그 끝에 붙인다 */
  let at = lines.findIndex((l) => l.includes('PNG 일러스트 (art/illustpng.js'));
  if (at < 0) { console.error('  ✗ sw.js 에 PNG 일러스트 블록 주석이 없다 — 손으로 넣어라'); return; }
  at++;
  while (at < lines.length && lines[at].includes("'./art/illust/")) at++;
  lines.splice(at, 0, entry);
  fs.writeFileSync(target, lines.join(eol));
  console.error("  sw.js APP_SHELL 에 './" + rel + "' 추가 (CACHE 는 배포 때 올려라)");
}

/* ─────────────────────────── 보조 ─────────────────────────── */

function markerPalette() {
  /* 마력광은 none — arcane(#8fd7ff)·frost 는 청록 색상대에 걸려 눈으로 오인된다 */
  const pal = makePalette({ skin: 'pale', hair: 'brown', metal: 'steel', cloth: 'crimson', leather: 'brown', accent: 'gold', glow: 'none', eye: 'brown' });
  return { ...pal, H: '#7a007a', h: '#c400c4', y: '#ff70ff', E: '#006e6e', e: '#00c8c8' };
}

function zoomNN(w, h, rgba, z) {
  if (z === 1) return rgba;
  const out = new Uint8ClampedArray(w * z * h * z * 4);
  for (let y = 0; y < h * z; y++) for (let x = 0; x < w * z; x++) {
    const s = ((Math.floor(y / z)) * w + Math.floor(x / z)) * 4, d = (y * w * z + x) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
  }
  return out;
}
