/**
 * 도트 합성 원시 함수 — 크기에 매이지 않는다.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 따로 있나
 *   `spritegen.js` 는 **옆모습 전투 스프라이트**의 주인이다 — 회전·무기 각도·사망 회전·24프레임.
 *   단원 탭과 주점에 세울 **정면 초상**은 그중 아무것도 필요 없고, 조인트도 다르다.
 *   애니메이션 엔진을 통째로 «시점» 매개변수로 나누면 옆모습 경로까지 흔들린다.
 *   그래서 **원시 함수만 여기로 내리고 조립은 각자** 한다 (HANDOFF §53).
 *
 * ★ 여기 있는 것은 전부 순수 함수다. DOM 은 makeCanvas 하나만 만진다.
 *
 * @module art/pixel
 */

export function hexToRgb(hex) {
  if (!hex) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 팔레트(문자 -> hex) -> 문자 -> [r,g,b] */
export function colorTable(pal) {
  const t = Object.create(null);
  for (const k in pal) t[k] = hexToRgb(pal[k]);
  t['.'] = null;
  return t;
}

/** 먼쪽(back) 파츠용 어두운 테이블 */
export function shadeTable(t, f) {
  const o = Object.create(null);
  for (const k in t) {
    const c = t[k];
    o[k] = c ? [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)] : null;
  }
  return o;
}

/**
 * 파츠 하나를 RGBA 버퍼에 찍는다. 앵커(ax, ay)가 (jx, jy)에 얹힌다.
 *
 * ★ `flipX` 는 **앵커를 축으로** 좌우를 뒤집는다. 정면 초상에서 반대쪽 팔·다리를
 *   같은 파츠로 쓰려고 만들었다 — 안 뒤집으면 명암이 양쪽 다 같은 방향이라 납작해진다.
 *
 * @param {Uint8ClampedArray} buf 대상 RGBA 버퍼 (W×H)
 */
export function blitInto(buf, W, H, part, jx, jy, tbl, flipX = false) {
  if (!part || !part.px) return;
  const { w, h, px } = part;
  const ax = part.ax || 0;
  const ay = part.ay || 0;
  for (let r = 0; r < h; r++) {
    const y = jy - ay + r;
    if (y < 0 || y >= H) continue;
    const row = px[r];
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (ch === '.' || ch === ' ') continue;
      const col = tbl[ch];
      if (!col) continue;
      const x = flipX ? jx + ax - c : jx - ax + c;
      if (x < 0 || x >= W) continue;
      const i = (y * W + x) * 4;
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
    }
  }
}

/** 프레임 버퍼를 아틀라스에 복사 (평행이동 + alpha, white=실루엣) */
export function blitFrameInto(dst, atlasW, W, H, buf, ox, dx, dy, alpha, white) {
  for (let y = 0; y < H; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const sa = buf[si + 3];
      if (!sa) continue;
      const tx = x + dx;
      if (tx < 0 || tx >= W) continue;
      const di = (ty * atlasW + ox + tx) * 4;
      if (white) { dst[di] = 255; dst[di + 1] = 255; dst[di + 2] = 255; }
      else { dst[di] = buf[si]; dst[di + 1] = buf[si + 1]; dst[di + 2] = buf[si + 2]; }
      dst[di + 3] = alpha >= 1 ? sa : Math.round(sa * alpha);
    }
  }
}

export function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('도트: 캔버스를 만들 수 없는 환경 (스프라이트 생성은 브라우저 전용)');
}
