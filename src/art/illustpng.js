/**
 * PNG 일러스트 — 이미지 모델이 그린 정면 초상을 **그대로** 꽂는 길
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 생겼나
 *   정면 일러스트(illust_*)는 문자 행렬로 그렸다 — 언어 모델이 찍은 도트의 천장이
 *   제작자 눈에 «허접» 이었다 (2026-09-06, HANDOFF §161). 레퍼런스(애니풍 고해상도
 *   일러스트)는 이미지 모델이 만들고, 여기서는 그 PNG 를 **문자 행렬로 바꾸지 않고**
 *   RGBA 그대로 쓴다. 팔레트 문자 29종으로 양자화하면 그 풍성함이 죽는다.
 *
 * ★★ 개인 편차(머리색·눈색)는 **크로마키** 로 산다.
 *   생성할 때 머리카락은 자홍~분홍(색상 285~350°), 홍채는 청록(165~200°) 으로 그리게 하고,
 *   그 색상대의 픽셀만 용병 팔레트(h/H/y · e/E)로 바꿔 찍는다. **명도는 원본을 따른다** —
 *   음영은 이미지 모델이 그린 그대로 살고 색조만 바뀐다.
 *   ★ 모델마다 «자홍» 을 다르게 그린다 (Animagine XL 은 분홍 쪽 330~345°). 그래서 도구가
 *   그림마다 **실제로 쓴 색상대를 목록(marker)에 적고**, 여기서는 그 값으로 분류한다 —
 *   도구와 게임이 다른 기준으로 나누면 도구는 통과인데 화면엔 분홍이 남는다.
 *   청록은 서리 마력광·청록 천과 겹칠 수 있어 **눈 상자(eyeBox) 안에서만** 눈으로 친다.
 *
 * ★★ 재색칠은 **명도 곡선을 원본 그대로** 둔다 (HSL 치환, §161.7).
 *   처음엔 원본 명도를 팔레트 3색(H·h·y) 사이에 선형으로 눌러 넣었는데, 보라 머리의 넓은 명암 폭이
 *   금발·백발의 좁은 3색으로 찌그러져 **대비가 죽고 밋밋**해졌다 (제작자: 「머리색 바꾼 부분이 많이 어색」).
 *   지금은 색상·채도만 팔레트 기본색(h)의 것으로 바꾸고, 명도는 «원본 명도 − 원본 평균 + 기본색 명도» —
 *   음영의 폭이 그대로 산다. 6단계로 밴딩해서 나머지(48색 양자화)와 같은 «도트» 질감을 낸다.
 *   머리 가장자리의 번진 픽셀(채도가 낮아 표식에서 빠진 것)은 이웃이 머리면 머리로 흡수한다 — 안 그러면 보라 테가 남는다.
 *
 * ★ 우선순위: PNG > 문자 일러스트 > 포즈 판 > 조립 (portrait.js `partsOf`).
 *   PNG 는 비동기로 받는다. 못 받았거나 아직이면 **조용히 다음 단계**로 물러난다 —
 *   이 저장소의 정면 규칙 그대로다. 받는 대로 초상 캐시를 비워 다음 그리기부터 쓴다.
 *
 * ★ 순수 함수부(classifyMarker · recolorInto)는 DOM 을 안 만진다 — 도구와 스모크가 그대로 쓴다.
 *
 * @module art/illustpng
 */

import { ILLUST_PNG } from './illust_manifest.js';

/** 기본 표식 색상대 (HSV 색상, 도). 채도·명도 하한은 «밝은 하이라이트도 잡되 회색은 안 잡는» 값. */
export const MARKER = {
  hair: { hue: [255, 300], sat: 0.30, val: 0.15 },
  eye: { hue: [165, 200], sat: 0.30, val: 0.15 },
};

/** 목록의 `marker`({hair:[lo,hi], eye:[lo,hi]}) 를 완전한 규격으로. 없는 칸은 기본값. */
export function markerSpec(m) {
  return {
    hair: { ...MARKER.hair, hue: (m && m.hair) || MARKER.hair.hue },
    eye: { ...MARKER.eye, hue: (m && m.eye) || MARKER.eye.hue },
  };
}

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}

/**
 * 이 픽셀이 어느 표식인가. 'hair' | 'eye' | null.
 * ★ 눈은 여기서 «청록» 만 본다 — 상자 안인지는 부르는 쪽이 판단한다.
 * @param {object} [spec] markerSpec() 결과. 없으면 기본 MARKER.
 */
export function classifyMarker(r, g, b, spec = MARKER) {
  const [h, s, v] = rgb2hsv(r, g, b);
  if (v < 0.1) return null;
  const H = spec.hair;
  if (s >= H.sat && v >= H.val && h >= H.hue[0] && h <= H.hue[1]) return 'hair';
  const E = spec.eye;
  if (s >= E.sat && v >= E.val && h >= E.hue[0] && h <= E.hue[1]) return 'eye';
  return null;
}

/** 상대 휘도 (0~1). 표식 안에서 «얼마나 밝은가» 만 쓰므로 감마는 안 편다. */
const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** RGB(0~255) → HSL(0~1). 재색칠은 명도(L)를 원본에서 가져오므로 HSL 을 쓴다. */
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const L = (mx + mn) / 2;
  if (!d) return [0, 0, L];
  const S = L > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let H;
  if (mx === r) H = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) H = ((b - r) / d + 2) / 6;
  else H = ((r - g) / d + 4) / 6;
  return [H, S, L];
}
function hsl2rgb(H, S, L) {
  if (!S) { const v = Math.round(L * 255); return [v, v, v]; }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(H + 1 / 3) * 255), Math.round(f(H) * 255), Math.round(f(H - 1 / 3) * 255)];
}

/** 명도 밴딩 단계 — 나머지 그림이 48색이라 머리도 이 정도로 끊어야 같은 «도트» 로 보인다 */
const HAIR_BANDS = 6;

const inBox = (box, x, y) => !box || (x >= box[0] && y >= box[1] && x <= box[2] && y <= box[3]);

/**
 * 머리 마스크 — **씨앗 + 성장**.
 *   씨앗: classifyMarker 가 머리라고 한 픽셀 (채도 0.30+). 성장: 씨앗에서 8이웃으로, 색상이 머리 색상대(±5°)이고
 *   채도 0.10+ · 크로마 12/255+ · 명도 0.12+ 인 픽셀을 계속 먹는다 (BFS, 선형).
 * ★ 왜: Animagine 은 «vivid purple hair» 를 **탁한 보라(채도 0.05~0.25)** 로 그린다 — 기사 파일럿은 색상대 안 24,021칸 중
 *   채도 0.30+ 가 446칸뿐이었다. 채도 하한을 그냥 낮추면 흰 옷의 푸른 그늘·외곽선까지 머리가 된다.
 *   씨앗에 **붙어 있는** 탁한 보라만 먹으면 머리는 다 잡히고 떨어져 있는 그늘은 안 잡힌다.
 * @returns {Uint8Array} 1 = 머리 (seeds 속성 = 씨앗 수). 눈은 여기서 안 다룬다.
 */
export function hairMask(w, h, data, spec = MARKER, minAlpha = 8) {
  const H = spec.hair;
  const lo = H.hue[0] - 5, hi = H.hue[1] + 5;
  const mask = new Uint8Array(w * h);
  const cand = new Uint8Array(w * h);            // 성장 후보
  const q = [];
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (data[i + 3] < minAlpha) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const [hh, s, v] = rgb2hsv(r, g, b);
    if (!(hh >= lo && hh <= hi && v >= 0.12)) continue;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (s >= H.sat && v >= H.val && hh >= H.hue[0] && hh <= H.hue[1]) { mask[p] = 1; q.push(p); }
    else if (s >= 0.10) cand[p] = 1;                  // chroma test dropped: dark dusky purple has chroma < 12 but is still hair
  }
  const seeds = q.length;
  while (q.length) {
    const p = q.pop();
    const x = p % w, y = (p / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const n = yy * w + xx;
      if (cand[n] && !mask[n]) { mask[n] = 1; q.push(n); }
    }
  }
  /* 연결 성분 필터 — 모델이 «purple hair» 를 무기·보석에도 번지게 그린다. 가장 큰 성분(머리)은 항상 두고,
   * 나머지는 면적이 그 8% 이상이고 무게중심이 그림 위쪽 절반(불투명 상자 기준)일 때만 머리로 인정한다.
   * 긴 머리는 한 덩어리라 살고, 검날(아래쪽)·손잡이(작음)는 빠진다. */
  const comp = new Int32Array(w * h).fill(-1);
  const comps = [];
  let top = h, bottom = -1;
  for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] >= minAlpha) { const y = (p / w) | 0; if (y < top) top = y; if (y > bottom) bottom = y; }
  const midY = top + (bottom - top) * 0.5;
  for (let p0 = 0; p0 < w * h; p0++) {
    if (!mask[p0] || comp[p0] >= 0) continue;
    const id = comps.length;
    const st = [p0]; comp[p0] = id;
    let area = 0, sy = 0;
    while (st.length) {
      const p = st.pop();
      area++; sy += (p / w) | 0;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const n = yy * w + xx;
        if (mask[n] && comp[n] < 0) { comp[n] = id; st.push(n); }
      }
    }
    comps.push({ area, cy: sy / area });
  }
  if (comps.length > 1) {
    let largest = 0;
    comps.forEach((c, i) => { if (c.area > comps[largest].area) largest = i; });
    const keep = comps.map((c, i) => i === largest || (c.area >= comps[largest].area * 0.08 && c.cy <= midY));
    let dropped = 0;
    for (let p = 0; p < w * h; p++) if (mask[p] && !keep[comp[p]]) { mask[p] = 0; dropped++; }
    mask.dropped = dropped;
  }
  mask.seeds = seeds;
  return mask;
}

/**
 * 역할별 통계 — 표식 픽셀의 휘도 범위와 **구분되는 단계 수**. 그림마다 한 번만 센다.
 *
 * ★ 단계가 3 이하(문자 일러스트를 표식 팔레트로 찍은 것 = 왕복 검증용)면 **순위로** 맞춘다 —
 *   그림자·기본·하이라이트가 정확히 H·h·y 로 돌아온다. 이미지 모델이 그린 연속 음영은
 *   단계가 수십이라 휘도를 [0,1] 로 펴서 3점 보간한다.
 */
function roleStats(rec) {
  if (rec._roles) return rec._roles;
  const { w, h, data, eyeBox } = rec;
  /* ★ 표식 없는 그림(적, HANDOFF §163): 목록의 roles 가 [] — 분류 없이 그대로 찍는다. 보라 옷·청록 눈이 있어도 안 건드린다. */
  if (Array.isArray(rec.roles) && rec.roles.length === 0) return (rec._roles = { hair: null, eye: null, role: new Uint8Array(w * h) });
  const spec = markerSpec(rec.marker);
  const out = { hair: null, eye: null };
  const lv = { hair: new Set(), eye: new Set() };
  const mn = { hair: 1, eye: 1 }, mx = { hair: 0, eye: 0 };
  const lsum = { hair: 0, eye: 0 }, lmin = { hair: 1, eye: 1 }, lmax = { hair: 0, eye: 0 }, n = { hair: 0, eye: 0 };
  const role = new Uint8Array(w * h);          // 0 없음 · 1 머리 · 2 눈
  /* 머리는 씨앗+성장 마스크. 단, 씨앗이 3단계 이하(문자 픽스처)면 성장 없이 씨앗만 — 왕복이 정확해야 한다. */
  const hm = hairMask(w, h, data, spec);
  const seedLevels = new Set();
  for (let p = 0; p < w * h; p++) {
    if (!hm[p]) continue;
    const i = p * 4;
    if (classifyMarker(data[i], data[i + 1], data[i + 2], spec) === 'hair') seedLevels.add(Math.round(luma(data[i], data[i + 1], data[i + 2]) * 255));
    if (seedLevels.size > 3) break;
  }
  const fixture = seedLevels.size <= 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      if (data[i + 3] < 8) continue;
      let k = classifyMarker(data[i], data[i + 1], data[i + 2], spec);
      if (k === 'eye' && !inBox(eyeBox, x, y)) k = null;
      if (!k && hm[p] && !fixture) k = 'hair';
      if (!k) continue;
      role[p] = k === 'hair' ? 1 : 2;
      const L = luma(data[i], data[i + 1], data[i + 2]);
      const q = Math.round(L * 255);            // 8비트 단계로 센다 — 부동소수 흔들림 무시
      lv[k].add(q);
      if (L < mn[k]) mn[k] = L;
      if (L > mx[k]) mx[k] = L;
      const l = rgb2hsl(data[i], data[i + 1], data[i + 2])[2];
      lsum[k] += l; n[k]++;
      if (l < lmin[k]) lmin[k] = l;
      if (l > lmax[k]) lmax[k] = l;
    }
  }
  for (const k of ['hair', 'eye']) {
    if (!lv[k].size) continue;
    const levels = [...lv[k]].sort((a, b) => a - b);
    out[k] = { min: mn[k], max: mx[k], levels, count: levels.length, lmin: lmin[k], lmax: lmax[k], lmean: lsum[k] / n[k] };
  }
  rec._roles = { ...out, role };
  return rec._roles;
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * 머리 색.
 *   단계 ≤3 (문자 픽스처): 순위로 H·h·y — 왕복이 정확하다.
 *   연속 음영: 팔레트 기본색(h)의 색상·채도 + «원본 명도 − 원본 평균 + 기본색 명도», 6단계 밴딩.
 *   ★ 검정 머리는 밝은 부분이 회청색으로 뜨고 백발은 그늘이 회색으로 진다 — 애니 머리 음영이 원래 그렇다.
 */
function hairColor(st, px, tbl, target) {
  if (st.count <= 3) {
    const H = tbl.H, h = tbl.h, y = tbl.y;
    const rank = st.levels.indexOf(Math.round(luma(px[0], px[1], px[2]) * 255));
    if (st.count === 1) return h;
    if (st.count === 2) return rank === 0 ? H : h;
    return rank === 0 ? H : rank === 1 ? h : y;
  }
  const l = rgb2hsl(px[0], px[1], px[2])[2];
  const span = Math.max(1e-6, st.lmax - st.lmin);
  const band = Math.min(HAIR_BANDS - 1, Math.floor(((l - st.lmin) / span) * HAIR_BANDS));
  const lb = st.lmin + ((band + 0.5) / HAIR_BANDS) * span;       // 밴드 가운데 명도
  const L = Math.min(0.96, Math.max(0.04, target[2] + (lb - st.lmean)));
  /* 그늘은 채도를 조금 올린다 — 같은 채도로 어둡게만 하면 탁해진다 */
  const S = Math.min(1, target[1] * (lb < st.lmean ? 1.15 : 1));
  return hsl2rgb(target[0], S, L);
}

/** 눈: 동공·홍채 그늘 E → 홍채 e. 눈은 작아서 보간하지 않는다 — 두 색으로 또렷하게. */
function eyeColor(st, L, tbl) {
  const E = tbl.E, e = tbl.e;
  if (st.count <= 2) {
    if (st.count === 1) return e;
    return st.levels.indexOf(Math.round(L * 255)) === 0 ? E : e;
  }
  const t = st.max > st.min ? (L - st.min) / (st.max - st.min) : 0.5;
  return t < 0.5 ? E : e;
}

/**
 * PNG 일러스트를 RGBA 버퍼(W×H)에 찍는다. 표식은 팔레트 색으로 바뀌고 나머지는 그대로다.
 *
 * @param {Uint8ClampedArray} buf 대상 (W×H×4)
 * @param {object} rec  registerIllustPng 로 등록한 그림 {w,h,data,eyeBox,marker}
 * @param {number} dy   세로 흔들림(숨). 픽셀.
 * @param {Record<string,number[]|null>} tbl  문자 → [r,g,b] (pixel.js colorTable). H·h·y·E·e 를 쓴다.
 */
export function recolorInto(buf, W, H, rec, dy, tbl) {
  const { w, h, data } = rec;
  const st = roleStats(rec);
  const role = st.role;
  const target = tbl.h ? rgb2hsl(tbl.h[0], tbl.h[1], tbl.h[2]) : null;
  for (let y = 0; y < h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < w; x++) {
      if (x >= W) break;
      const si = (y * w + x) * 4;
      const a = data[si + 3];
      if (!a) continue;
      const di = (ty * W + x) * 4;
      const k = role[y * w + x];
      let c = null;
      if (k === 1 && st.hair && target) c = hairColor(st.hair, [data[si], data[si + 1], data[si + 2]], tbl, target);
      else if (k === 2 && st.eye && tbl.e) c = eyeColor(st.eye, luma(data[si], data[si + 1], data[si + 2]), tbl);
      if (c) { buf[di] = c[0]; buf[di + 1] = c[1]; buf[di + 2] = c[2]; }
      else { buf[di] = data[si]; buf[di + 1] = data[si + 1]; buf[di + 2] = data[si + 2]; }
      buf[di + 3] = a;
    }
  }
}

/* ─────────────────────────── 등록 · 조회 ─────────────────────────── */

/** @type {Map<string, {w:number,h:number,ax:number,ay:number,data:Uint8ClampedArray,eyeBox?:number[],marker?:object}>} */
const loaded = new Map();

/** 받은 그림을 등록한다. `rec = null` 이면 뺀다 (검사용). */
export function registerIllustPng(name, rec) {
  if (!rec) { loaded.delete(name); return; }
  if (!rec.data || rec.data.length !== rec.w * rec.h * 4) throw new Error(`illustpng: ${name} 버퍼 크기가 ${rec.w}x${rec.h} 와 다르다`);
  loaded.set(name, { ax: 0, ay: rec.h - 1, ...rec, _roles: null });
}
export const hasIllustPng = (name) => !!name && loaded.has(name);
export const getIllustPng = (name) => (name && loaded.get(name)) || null;
export const illustPngCount = () => loaded.size;

/**
 * 목록의 PNG 를 전부 받아 등록한다 (브라우저 전용). 하나 실패해도 나머지는 계속.
 * 각 그림이 등록될 때마다 `onLoaded(name)` — 초상 캐시를 비우는 데 쓴다.
 * ★ 부팅을 막지 않는다. 받기 전에 그린 초상은 문자 일러스트다 — 정면 규칙대로 물러난 것.
 */
export async function preloadIllustPngs({ base = './', onLoaded = null } = {}) {
  const names = Object.keys(ILLUST_PNG);
  let ok = 0;
  const fails = [];
  await Promise.all(names.map(async (name) => {
    const m = ILLUST_PNG[name];
    try {
      const rec = await fetchIllust(base + m.file, m);
      registerIllustPng(name, rec);
      ok++;
      if (onLoaded) { try { onLoaded(name); } catch (e) { console.warn('[illustpng] onLoaded', e); } }
    } catch (e) {
      fails.push(name);
      console.warn(`[illustpng] ${name} 를 못 받았다 — 문자 일러스트로 물러난다`, e);
    }
  }));
  return { ok, fails, total: names.length };
}

async function fetchIllust(url, m) {
  if (typeof fetch !== 'function') throw new Error('fetch 없음');
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  let bmp;
  if (typeof createImageBitmap === 'function') bmp = await createImageBitmap(blob);
  else bmp = await blobToImage(blob);
  const w = bmp.width, h = bmp.height;
  if (w !== m.w || h !== m.h) throw new Error(`${url}: ${w}x${h} 인데 목록은 ${m.w}x${m.h}`);
  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
  else { canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  if (bmp.close) bmp.close();
  return { w, h, ax: m.ax, ay: m.ay, eyeBox: m.eyeBox || null, marker: m.marker || null, roles: Array.isArray(m.roles) ? m.roles : null, data: img.data };
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
