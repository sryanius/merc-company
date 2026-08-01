#!/usr/bin/env node
// PWA 아이콘 생성기 — `icons/*.png` 를 이 게임의 도트로 직접 만든다.
//
// 왜 스크립트인가
//   외부 의존성 0 / 빌드 스텝 없음이 이 프로젝트의 규칙이라 sharp·canvas 같은 걸 쓸 수 없다.
//   그렇다고 아이콘을 손으로 그려 넣으면 스프라이트 파츠를 고쳐도 아이콘이 따라오지 않는다.
//   그래서 **게임과 똑같은 스프라이트 파이프라인**(art/spritegen.js)을 node 에서 돌려
//   프레임 한 장을 뽑고, 순수 JS 로 PNG 를 직접 써서 떨군다.
//
// 어떻게 canvas 없이 spritegen 을 돌리나
//   `buildSprite()` 는 `document` 도 `OffscreenCanvas` 도 없으면 던진다. 그런데 실제로 쓰는 건
//   `createImageData` / `putImageData` 둘뿐이다. 그래서 그 둘만 가진 최소 스텁을 전역에 꽂는다.
//   → 렌더러가 화면에 그리는 픽셀과 **바이트 단위로 같은** 아틀라스를 얻는다.
//   (spritegen 이 캔버스 API 를 더 쓰기 시작하면 여기서 터진다. 그러면 스텁을 늘려라.)
//
// PNG 는 어떻게 쓰나
//   시그니처 + IHDR + IDAT + IEND. IDAT 의 zlib 스트림은 `node:zlib`(표준 라이브러리라
//   외부 의존성이 아니다)로 압축하고, 없거나 실패하면 **저장(store) 블록**으로 폴백한다.
//   저장 블록만으로도 규격상 완전히 유효한 PNG 다 — 크기만 커진다.
//
// 실행
//   node tools/icons.mjs                    # icons/ 에 5장 생성 (재실행 가능, 결과 결정론)
//   node tools/icons.mjs --class=knight --frame=idle0
//   node tools/icons.mjs --list             # 쓸 만한 클래스/프레임 후보만 출력
//
// 아이콘을 바꾸고 싶으면 CLASS_ID / FRAME 상수만 만지면 된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'icons');

// ── 0. canvas 스텁 (import 보다 먼저 꽂아야 한다) ────────────────────────────
class StubCanvas {
  constructor(w, h) { this.width = w; this.height = h; this.img = null; }
  getContext() {
    const self = this;
    return {
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img) => { self.img = img; },
    };
  }
}
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = StubCanvas;

const { buildSprite, SPRITE_W, SPRITE_H, FOOT_Y, FRAMES } = await import('../src/art/spritegen.js');
const { CLASSES } = await import('../src/data/classes.js');

// ── 1. 무엇을 그릴 것인가 ───────────────────────────────────────────────────
/** 아이콘의 얼굴. 중갑기사 = 판금·망토·카이트 방패, 이 게임을 가장 잘 대표한다. */
const CLASS_ID = 'knight';
/**
 * 방어 자세. 후보를 전부 뽑아 48px 로 줄여 놓고 골랐다 —
 * `idle0`/`atk*` 는 실루엣이 세로로 길쭉해 정사각형 아이콘에서 좌우가 비고,
 * `guard0` 는 방패가 앞으로 나와 **가로로 퍼진 실루엣**이라 작게 줄여도 "방패 든 기사"로 읽힌다.
 */
const FRAME = 'guard0';

const ARGS = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = ARGS.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const classId = argOf('class', CLASS_ID);
const frameName = argOf('frame', FRAME);

if (ARGS.includes('--list')) {
  console.log('클래스 후보:', Object.keys(CLASSES).filter((k) => CLASSES[k].tier === 1).join(', '));
  console.log('프레임 후보:', FRAMES.join(', '));
  process.exit(0);
}

// ── 2. 색 ───────────────────────────────────────────────────────────────────
// index.html / manifest.webmanifest 의 theme_color·background_color 와 맞춰 둔 값이다.
// 한쪽만 바꾸면 홈 화면에서 아이콘 배경과 스플래시 배경이 어긋나 보인다.
const BG_TOP = [0x1e, 0x18, 0x2e];   // 위쪽 (theme_color #14111c 보다 살짝 밝게)
const BG_BOTTOM = [0x0b, 0x09, 0x11]; // 아래쪽 (background_color #0d0b12 근처)
const HALO = [0xe0, 0xa0, 0x3c];      // 캐릭터 뒤 횃불빛. 도트의 검은 외곽선이 배경에 묻히는 걸 막는다
const HALO_MAX = 0.42;                // 헤일로 최대 세기
const VIGNETTE = 0.42;                // 모서리 어둡기

// ── 3. PNG 인코더 (순수 JS) ─────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function adler32(buf) {
  let a = 1, b = 0;
  // 5552 바이트마다 한 번만 나머지 연산 (표준 NMAX)
  for (let i = 0; i < buf.length;) {
    const end = Math.min(i + 5552, buf.length);
    for (; i < end; i++) { a += buf[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** deflate 저장(store) 블록만 쓰는 폴백. 압축은 안 되지만 규격상 완전히 유효하다. */
function deflateStore(raw) {
  const parts = [Buffer.from([0x78, 0x01])]; // CMF/FLG (8=deflate, 32K window, 체크 OK)
  const MAX = 0xFFFF;
  let off = 0;
  do {
    const n = Math.min(MAX, raw.length - off);
    const head = Buffer.alloc(5);
    head[0] = (off + n >= raw.length) ? 1 : 0; // BFINAL, BTYPE=00
    head.writeUInt16LE(n, 1);
    head.writeUInt16LE(n ^ 0xFFFF, 3);
    parts.push(head, Buffer.from(raw.buffer, raw.byteOffset + off, n));
    off += n;
  } while (off < raw.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(adler32(raw), 0);
  parts.push(tail);
  return Buffer.concat(parts);
}

let zlibDeflate = null;
// --nozlib 은 store 폴백이 정말 유효한 PNG 를 만드는지 확인할 때 쓴다 (파일이 20배쯤 커진다).
if (!process.argv.includes('--nozlib')) {
  try { ({ deflateSync: zlibDeflate } = await import('node:zlib')); } catch { /* 폴백을 쓴다 */ }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const pae = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
};

/** RGBA 버퍼(w*h*4) → PNG. 행마다 필터 5종 중 잔차 합이 가장 작은 것을 고른다. */
function encodePng(w, h, rgba) {
  const bpp = 4, stride = w * bpp;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    rgba.copy ? rgba.copy(cur, 0, y * stride, y * stride + stride)
      : cur.set(rgba.subarray(y * stride, y * stride + stride));
    const score = [0, 0, 0, 0, 0];
    for (let i = 0; i < stride; i++) {
      const x = cur[i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const v = [x, (x - a) & 255, (x - b) & 255, (x - ((a + b) >> 1)) & 255, (x - pae(a, b, c)) & 255];
      for (let f = 0; f < 5; f++) { cand[f][i] = v[f]; score[f] += v[f] < 128 ? v[f] : 256 - v[f]; }
    }
    let best = 0;
    for (let f = 1; f < 5; f++) if (score[f] < score[best]) best = f;
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
    cur.copy(prev);
  }

  let z = null;
  if (zlibDeflate) { try { z = zlibDeflate(raw, { level: 9 }); } catch { z = null; } }
  if (!z) z = deflateStore(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // deflate / adaptive filter / no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', z),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 4. 스프라이트 프레임 뽑기 ───────────────────────────────────────────────
function spriteFrame(recipe, frame) {
  const s = buildSprite(recipe);
  const img = s.canvas.img;
  if (!img) throw new Error('spritegen 스텁이 putImageData 를 못 받았다 — 스텁을 갱신해라');
  const f = s.frames[frame];
  if (!f) throw new Error(`프레임 없음: ${frame}`);
  const out = new Uint8ClampedArray(SPRITE_W * SPRITE_H * 4);
  let x0 = SPRITE_W, x1 = -1, y0 = SPRITE_H, y1 = -1;
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const si = (y * img.width + f.sx + x) * 4;
      const di = (y * SPRITE_W + x) * 4;
      out[di] = img.data[si]; out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2]; out[di + 3] = img.data[si + 3];
      if (img.data[si + 3] > 0) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('빈 프레임이다 (그려진 픽셀 0)');
  return { data: out, x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ── 5. 아이콘 합성 ──────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 스프라이트를 배율 S 로 놓았을 때 아이콘 중심에서 가장 먼 픽셀 모서리까지의 거리 */
function maxRadius(fr, size, S) {
  const { ox, oy } = place(fr, size, S);
  const cx = size / 2, cy = size / 2;
  let r = 0;
  for (let y = fr.y0; y <= fr.y1; y++) {
    for (let x = fr.x0; x <= fr.x1; x++) {
      if (fr.data[(y * SPRITE_W + x) * 4 + 3] === 0) continue;
      const px0 = ox + x * S, py0 = oy + y * S;
      for (const [px, py] of [[px0, py0], [px0 + S, py0], [px0, py0 + S], [px0 + S, py0 + S]]) {
        const d = Math.hypot(px - cx, py - cy);
        if (d > r) r = d;
      }
    }
  }
  return r;
}

/** 스프라이트 바운딩 박스를 아이콘 중앙에 놓는 좌상단 오프셋 */
function place(fr, size, S) {
  const ox = Math.round(size / 2 - (fr.x0 + fr.w / 2) * S);
  const oy = Math.round(size * 0.49 - (fr.y0 + fr.h / 2) * S);
  return { ox, oy };
}

/** 마스크를 박스 블러 (헤일로용). 분리 가능 필터라 가로/세로 따로 돈다. */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const n = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / n;
      sum -= src[y * w + Math.min(w - 1, Math.max(0, x - r))];
      sum += src[y * w + Math.min(w - 1, Math.max(0, x + r + 1))];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      sum -= tmp[Math.min(h - 1, Math.max(0, y - r)) * w + x];
      sum += tmp[Math.min(h - 1, Math.max(0, y + r + 1)) * w + x];
    }
  }
  return out;
}

/**
 * 아이콘 한 장.
 * @param {'any'|'maskable'} purpose maskable 은 안쪽 원(지름 80%) 밖이 잘려 나갈 수 있으므로
 *   **실제 그려진 픽셀**이 그 원 안에 들어오도록 배율을 낮춘다 (바운딩 박스 모서리 기준이 아니다 —
 *   도트는 직사각형을 꽉 채우지 않아서 모서리 기준으로 재면 필요 이상으로 작아진다).
 */
function renderIcon(fr, size, purpose) {
  // 배율: 세로를 먼저 맞추고 상한(세로 88% / 가로 86%)을 넘으면 줄인다.
  // 도트는 **정수 배율**이어야 픽셀이 안 뭉개진다. floor 가 아니라 round 로 잡고 상한으로 깎는 이유는
  // 180px(apple-touch-icon) 처럼 3.9 가 나오는 크기에서 floor 를 쓰면 한 칸(x3)으로 떨어져
  // 아이콘이 눈에 띄게 작아지기 때문이다.
  const fillH = purpose === 'maskable' ? 0.82 : 0.80;
  let S = Math.max(1, Math.round((size * fillH) / fr.h));
  while (S > 1 && (fr.h * S > size * 0.88 || fr.w * S > size * 0.86)) S--;
  if (purpose === 'maskable') {
    const safeR = size * 0.40; // 안전 원 반지름 (지름 = 아이콘의 80%)
    while (S > 1 && maxRadius(fr, size, S) > safeR) S--;
  }
  const { ox, oy } = place(fr, size, S);

  const px = Buffer.alloc(size * size * 4);
  const mask = new Float32Array(size * size);
  for (let y = fr.y0; y <= fr.y1; y++) {
    for (let x = fr.x0; x <= fr.x1; x++) {
      if (fr.data[(y * SPRITE_W + x) * 4 + 3] === 0) continue;
      for (let dy = 0; dy < S; dy++) {
        const iy = oy + y * S + dy;
        if (iy < 0 || iy >= size) continue;
        for (let dx = 0; dx < S; dx++) {
          const ix = ox + x * S + dx;
          if (ix < 0 || ix >= size) continue;
          mask[iy * size + ix] = 1;
        }
      }
    }
  }
  // 블러 반경은 도트 한 칸(S)에 비례시킨다. 크게 잡으면 스티커 테두리처럼 뭉개지므로 실루엣에 붙인다.
  const blurR = Math.max(2, Math.round(S * 0.8));
  const halo = boxBlur(boxBlur(mask, size, size, blurR), size, size, blurR);

  // 발밑 그림자 (지면감). FOOT_Y 가 스프라이트의 접지선이다.
  const footY = oy + (FOOT_Y + 1.5) * S;
  const shRx = Math.max(4, fr.w * S * 0.52), shRy = Math.max(2, shRx * 0.20);
  const cx = size / 2, cy = size / 2, halfDiag = Math.hypot(cx, cy);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const t = y / (size - 1);
      let r = lerp(BG_TOP[0], BG_BOTTOM[0], t);
      let g = lerp(BG_TOP[1], BG_BOTTOM[1], t);
      let b = lerp(BG_TOP[2], BG_BOTTOM[2], t);

      // 비네트 (모서리를 눌러 가운데로 시선을 모은다)
      const v = 1 - VIGNETTE * Math.pow(clamp01(Math.hypot(x - cx, y - cy) / halfDiag), 2.1);
      r *= v; g *= v; b *= v;

      // 헤일로 (도트의 검은 외곽선이 배경에 묻히지 않게 뒤를 밝힌다)
      const hk = clamp01(halo[y * size + x] * 2.6) * HALO_MAX;
      if (hk > 0) {
        r = lerp(r, HALO[0], hk); g = lerp(g, HALO[1], hk); b = lerp(b, HALO[2], hk);
      }

      // 발밑 그림자 — 헤일로 **뒤에** 곱해야 한다. 앞에 두면 발치의 강한 헤일로가 그림자를 지운다.
      const sy = (y - footY) / shRy, sx = (x - cx) / shRx;
      const sd = sx * sx + sy * sy;
      if (sd < 1) {
        const k = 0.62 * (1 - sd) * (1 - sd);
        r *= 1 - k; g *= 1 - k; b *= 1 - k;
      }

      px[i] = Math.round(clamp01(r / 255) * 255);
      px[i + 1] = Math.round(clamp01(g / 255) * 255);
      px[i + 2] = Math.round(clamp01(b / 255) * 255);
      px[i + 3] = 255; // 아이콘 배경은 반드시 불투명 (maskable 규격)
    }
  }

  // 도트를 정수 배율 최근접 이웃으로 얹는다 (부드럽게 하지 않는다 — 픽셀아트다)
  for (let y = fr.y0; y <= fr.y1; y++) {
    for (let x = fr.x0; x <= fr.x1; x++) {
      const si = (y * SPRITE_W + x) * 4;
      const a = fr.data[si + 3];
      if (!a) continue;
      const sr = fr.data[si], sg = fr.data[si + 1], sb = fr.data[si + 2], sa = a / 255;
      for (let dy = 0; dy < S; dy++) {
        const iy = oy + y * S + dy;
        if (iy < 0 || iy >= size) continue;
        for (let dx = 0; dx < S; dx++) {
          const ix = ox + x * S + dx;
          if (ix < 0 || ix >= size) continue;
          const i = (iy * size + ix) * 4;
          px[i] = Math.round(lerp(px[i], sr, sa));
          px[i + 1] = Math.round(lerp(px[i + 1], sg, sa));
          px[i + 2] = Math.round(lerp(px[i + 2], sb, sa));
        }
      }
    }
  }
  return { png: encodePng(size, size, px), scale: S };
}

// ── 6. 출력 ─────────────────────────────────────────────────────────────────
// manifest.webmanifest 의 icons 배열과 **파일명·크기가 일치해야 한다.** 여기를 바꾸면 거기도 바꿔라.
const TARGETS = [
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'icon-maskable-192.png', size: 192, purpose: 'maskable' },
  { file: 'icon-maskable-512.png', size: 512, purpose: 'maskable' },
  // iOS 는 manifest 아이콘을 무시하고 이걸 본다. 홈 화면 추가 시 자체적으로 모서리를 둥글린다.
  { file: 'apple-touch-icon.png', size: 180, purpose: 'any' },
];

const recipe = CLASSES[classId] && CLASSES[classId].sprite;
if (!recipe) {
  console.error(`클래스 없음: ${classId} (--list 로 후보 확인)`);
  process.exit(1);
}

const fr = spriteFrame(recipe, frameName);
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`용병단 PWA 아이콘 — ${CLASSES[classId].name}(${classId}) / ${frameName}`);
console.log(`도트 바운딩 박스 ${fr.w}x${fr.h} (x ${fr.x0}~${fr.x1}, y ${fr.y0}~${fr.y1})`);
console.log(`zlib: ${zlibDeflate ? 'node:zlib deflate' : 'store 블록 폴백'}\n`);

for (const t of TARGETS) {
  const { png, scale } = renderIcon(fr, t.size, t.purpose);
  fs.writeFileSync(path.join(OUT_DIR, t.file), png);
  console.log(`  icons/${t.file.padEnd(24)} ${String(t.size).padStart(3)}px  ${t.purpose.padEnd(8)} x${scale}  ${(png.length / 1024).toFixed(1)}KB`);
}
console.log(`\n완료 — ${TARGETS.length}장. manifest.webmanifest 의 icons 와 파일명이 같아야 한다.`);
