// PNG 인코더 + 캔버스 스텁 — 도구 공용.
// ════════════════════════════════════════════════════════════════════════════
//
// ★ 왜 여기 있나
//   외부 의존성 0 이 이 저장소의 규칙이라 sharp·canvas 를 못 쓴다.
//   그래서 순수 JS 로 PNG 를 직접 쓴다. 원래 tools/icons.mjs 안에 있었는데
//   도트를 눈으로 확인하는 도구(artsheet)가 같은 것을 필요로 해서 꺼냈다.
//
// ★ 스텁은 **spritegen 을 import 하기 전에** 꽂아야 한다.
//   buildSprite 가 쓰는 캔버스 API 는 createImageData / putImageData 둘뿐이다.
//   spritegen 이 더 쓰기 시작하면 여기서 터진다 — 그러면 스텁을 늘려라.

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

let zlibInflate = null;
try { ({ inflateSync: zlibInflate } = await import('node:zlib')); } catch { /* 디코드는 zlib 없이는 못 한다 */ }

/**
 * PNG → { w, h, rgba }. **8비트 · 비인터레이스** 만 받는다 (이미지 모델·Aseprite 기본 출력이 그렇다).
 * 색 유형 0(회색)·2(RGB)·3(인덱스)·4(회색+알파)·6(RGBA) 전부 RGBA 로 편다.
 * ★ 왜 여기 있나: 외부 의존성 0 — 그림을 **받아들이는** 도구(tools/illustpng.mjs)도 순수 JS 여야 한다.
 */
function decodePng(buf) {
  if (!zlibInflate) throw new Error('PNG 디코드에는 node:zlib 이 필요하다');
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('PNG 가 아니다 (서명 불일치)');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  let plte = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!w || !h) throw new Error('IHDR 가 없다');
  if (depth !== 8) throw new Error(`비트 깊이 ${depth} 은 안 받는다 — 8비트로 저장해라`);
  if (interlace) throw new Error('인터레이스 PNG 는 안 받는다 — 인터레이스를 끄고 저장해라');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error(`색 유형 ${ctype} 은 안 받는다`);
  const raw = zlibInflate(Buffer.concat(idat));
  const stride = w * ch;
  if (raw.length < (stride + 1) * h) throw new Error(`IDAT 가 짧다 (${raw.length} < ${(stride + 1) * h})`);
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i];
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) v = x + pae(a, b, c);
      else throw new Error(`알 수 없는 필터 ${f} (행 ${y})`);
      cur[i] = v & 255;
    }
    p += stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const s = x * ch;
      if (ctype === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
      else if (ctype === 2) {
        out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2];
        out[o + 3] = (trns && trns.length >= 6 && cur[s] === trns[1] && cur[s + 1] === trns[3] && cur[s + 2] === trns[5]) ? 0 : 255;
      } else if (ctype === 0) {
        const g = cur[s]; out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = (trns && trns.length >= 2 && g === trns[1]) ? 0 : 255;
      } else if (ctype === 4) {
        const g = cur[s]; out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = cur[s + 1];
      } else {
        const idx = cur[s];
        if (!plte) throw new Error('PLTE 없는 인덱스 PNG');
        out[o] = plte[idx * 3]; out[o + 1] = plte[idx * 3 + 1]; out[o + 2] = plte[idx * 3 + 2];
        out[o + 3] = (trns && idx < trns.length) ? trns[idx] : 255;
      }
    }
    cur.copy(prev);
  }
  return { w, h, rgba: new Uint8ClampedArray(out.buffer, out.byteOffset, out.length) };
}

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

/** 압축을 실제로 쓰고 있나 (도구가 로그에 찍는다) */
export const usingZlib = () => !!zlibDeflate;

export { encodePng, decodePng, crc32, adler32 };
