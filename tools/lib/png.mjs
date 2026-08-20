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

export { encodePng, crc32, adler32 };
