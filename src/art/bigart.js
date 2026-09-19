/**
 * 무대용 큰 그림 (§193) — `art/big/<name>.png`(448×560) 를 **열 때만** 받아 머리·눈을 사람마다 칠한다.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 따로 있나: 목록(illust_manifest.js)의 그림은 부팅 때 **전부 메모리에 펴진다** (§162 — 192×240 한 벌 ≈ 1.5MB).
 *   448×560 을 거기 넣으면 161장 × 1MB 가 부팅에 실린다. 그래서 큰 그림은 목록 밖(`art/big/manifest.json`)에 두고
 *   상세 무대가 그 한 장만 받는다. 셸(sw.js)에도 안 넣는다 — 오프라인이면 작은 캔버스로 간다.
 *
 * ★ 색칠은 게임과 **같은 함수**(illustpng.js `recolorInto`)다. 표식(자홍 머리·청록 눈)이 큰 그림에도 그대로 있고,
 *   `manifest.json` 이 눈 상자·표식 색상대를 들고 있다 (tools/art/bigart.mjs 가 illustpng.mjs --metaout 으로 적는다).
 *   영웅은 표식이 없어(§176 --nohair) 그대로 찍힌다.
 *
 * @module art/bigart
 */
import { recolorInto } from './illustpng.js';
import { makePalette } from './palette.js';
import { colorTable } from './pixel.js';

const META_URL = 'art/big/manifest.json';
let metaP = null;
/** 최근에 칠한 캔버스 몇 장 — 앞뒤로 넘길 때 다시 안 받는다 */
const cache = new Map();
const CACHE_MAX = 6;

function meta() {
  if (!metaP) {
    metaP = fetch(META_URL).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  }
  return metaP;
}

/** 이 레시피가 쓸 큰 그림 이름 — 영웅은 각성이면 `_awk`, 아니면 클래스 그림. 없으면 null. */
export function bigNameOf(recipe) {
  if (!recipe) return null;
  if (recipe.illustHero) return recipe.illustHero + (recipe.awakened ? '_awk' : '');
  return recipe.illustClass || null;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`큰 그림 없음: ${url}`));
    im.src = url;
  });
}

/**
 * 큰 초상 한 장. **못 받으면 null** — 부르는 쪽이 작은 캔버스(portrait.js)로 간다.
 * @param {object} recipe mercRecipe() 결과
 * @returns {Promise<HTMLCanvasElement|null>} 448×560 캔버스 (머리·눈 칠해짐)
 */
export async function bigPortrait(recipe) {
  try {
    const m = await meta();
    const names = [bigNameOf(recipe)];
    /* 각성판이 아직 없는 영웅은 평소 그림으로 */
    if (recipe && recipe.awakened && recipe.illustHero) names.push(recipe.illustHero);
    const name = names.find((n) => n && m[n]);
    if (!name) return null;
    const pal = makePalette((recipe && recipe.palette) || {});
    const key = `${name}|${pal.H}|${pal.h}|${pal.y}|${pal.E}|${pal.e}`;
    if (cache.has(key)) return cache.get(key);

    const e = m[name];
    const img = await loadImage(`art/big/${name}.png`);
    const w = Number(e.w) || img.naturalWidth;
    const h = Number(e.h) || img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    if (Array.isArray(e.roles) && e.roles.length) {
      const src = ctx.getImageData(0, 0, w, h);
      const rec = { w, h, data: src.data, eyeBox: e.eyeBox || null, marker: e.marker || null, roles: e.roles, _roles: null };
      const out = new Uint8ClampedArray(w * h * 4);
      recolorInto(out, w, h, rec, 0, colorTable(pal));
      ctx.putImageData(new ImageData(out, w, h), 0, 0);
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, c);
    return c;
  } catch (e) {
    console.info('[bigart] 큰 그림을 못 받았다 — 작은 캔버스로 간다', e && e.message);
    return null;
  }
}
