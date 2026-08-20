/**
 * 정면 초상 — 단원 탭·주점에 세우는 «보여주기용» 스프라이트
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 옆모습과 따로인가
 *   전투는 좌우로 줄을 세우므로 캐릭터가 **오른쪽을 봐야** 한다. 그런데 옆모습은
 *   얼굴도 좌우 대칭 장식도 절반만 보여서 «용병이 이쁘다» 가 잘 안 산다.
 *   플레이어 요청: "용병탭이나 주점에서는 정면으로 보여주고 전투에서는 옆모습으로".
 *
 * ★ 왜 spritegen 을 «시점» 으로 나누지 않았나
 *   정면은 회전도, 무기 각도도, 사망 회전도, 걷기·공격 프레임도 필요 없다.
 *   그것들을 전부 안고 있는 애니메이션 엔진을 매개변수로 가르면 **옆모습 경로까지 흔들린다.**
 *   원시 함수(`art/pixel.js`)만 나눠 쓰고 조립은 여기서 따로 한다 (HANDOFF §53).
 *
 * @module art/portrait
 */

import { SCALE, BASE_W, BASE_H, BASE_FOOT_Y } from './scale.js';
import { getFrontPart, hasFrontPart } from './parts_front.js';
import { makePalette } from './palette.js';
import { colorTable, shadeTable, blitInto, blitFrameInto, makeCanvas } from './pixel.js';

export const PORTRAIT_W = BASE_W * SCALE;
export const PORTRAIT_H = BASE_H * SCALE;
export const PORTRAIT_FOOT_Y = BASE_FOOT_Y * SCALE;

/**
 * 정면 조인트. 옆모습과 달리 **좌우 대칭**이다 —
 * back/front 가 «앞뒤» 가 아니라 «왼쪽/오른쪽» 이다.
 * 숫자는 32×40 기준이고 SCALE 배로 곱해진다 (옆모습과 같은 규약).
 *
 * ★ 어깨·손·엉덩이를 중심(x=16)에서 **같은 거리로** 벌린다.
 *   한쪽만 어긋나면 즉시 짝짝이로 보인다.
 */
export const JOINT_BASE = {
  head: { x: 16, y: 44 / 3 },
  chest: { x: 16, y: 44 / 3 },
  pelvis: { x: 16, y: 25 },
  shLeft: { x: 16 - 3.4, y: 16 },
  shRight: { x: 16 + 3.4, y: 16 },
  handLeft: { x: 16 - 4.6, y: 80 / 3 },
  handRight: { x: 16 + 4.6, y: 80 / 3 },
  hipLeft: { x: 16 - 1.9, y: 25 },
  hipRight: { x: 16 + 1.9, y: 25 },
};

export const JOINTS = (() => {
  const out = {};
  for (const k of Object.keys(JOINT_BASE)) {
    out[k] = { x: Math.round(JOINT_BASE[k].x * SCALE), y: Math.round(JOINT_BASE[k].y * SCALE) };
  }
  return out;
})();

/**
 * 프레임. 숨쉬기만 한다 — 전투가 아니라 **세워 놓고 보는** 그림이다.
 * ★ 24프레임이 아니라 4프레임이라 아틀라스가 1/6 이다 (2.1MB → 0.35MB).
 */
export const FRAMES = ['idle0', 'idle1', 'idle2', 'idle3'];

/** 프레임별 세로 흔들림 (숨). 픽셀이라 SCALE 을 탄다. */
const BREATH = { idle0: 0, idle1: 1, idle2: 0, idle3: -1 };

/** 그리는 순서. 뒤에 오는 것이 덮는다. 셋째 값은 «뒤집어 그리는가». */
const ORDER = [
  ['cape', 'chest', false],
  ['arm', 'shLeft', true],          // 왼팔 — 뒤집는다 (빛이 오른쪽에서 온다)
  ['leg', 'hipLeft', true],
  ['leg', 'hipRight', false],
  ['body', 'chest', false],
  ['armor', 'chest', false],
  ['head', 'head', false],
  ['hair', 'head', false],
  ['helm', 'head', false],
  ['arm', 'shRight', false],
  ['weapon', 'handRight', false],
  ['offhand', 'handLeft', true],
];

/** 빛 반대편 파츠를 어둡게 하는 비율. 옆모습의 먼쪽 처리와 같은 값. */
const FAR_SHADE = 0.82;

const ARM_BY_BODY = { body_slim: 'arm_slim', body_normal: 'arm_normal', body_heavy: 'arm_heavy', body_hulk: 'arm_heavy' };
const LEG_BY_ARMOR = {
  armor_cloth: 'leg_cloth', armor_robe: 'leg_cloth', armor_leather: 'leg_leather',
  armor_mail: 'leg_mail', armor_plate: 'leg_plate', armor_heavy: 'leg_plate',
  armor_bare: 'leg_bare', armor_bone: 'leg_bare',
};

function partsOf(recipe = {}) {
  const body = recipe.body || 'body_normal';
  const armor = recipe.armor || 'armor_cloth';
  return {
    cape: recipe.cape, body, armor,
    arm: recipe.arm || ARM_BY_BODY[body] || 'arm_normal',
    leg: recipe.leg || LEG_BY_ARMOR[armor] || 'leg_cloth',
    head: recipe.head || 'head_human',
    hair: recipe.hair,
    helm: recipe.helm,
    weapon: recipe.weapon,
    offhand: recipe.offhand,
  };
}

/**
 * 이 레시피를 정면으로 세울 수 있나 (핵심 파츠가 다 그려졌나).
 *
 * ★★ 부르는 쪽은 **반드시 이걸 먼저 물어야 한다.** 없는 파츠를 빼고 그리면
 *   머리 없는 몸통이 나오고, 옆모습 파츠로 대신 채우면 정면 조인트에 옆얼굴이 얹힌다.
 *   못 그리면 옆모습으로 물러나는 편이 낫다.
 */
export function canDraw(recipe = {}) {
  const n = partsOf(recipe);
  return ['head', 'body', 'arm', 'leg'].every((k) => hasFrontPart(n[k]));
}

export function portraitKey(recipe = {}) {
  const n = partsOf(recipe);
  const p = recipe.palette || {};
  return ['F', n.body, n.head, n.hair, n.helm, n.armor, n.cape, n.arm, n.leg, n.weapon, n.offhand,
    p.skin, p.hair, p.metal, p.cloth, p.leather, p.accent, p.glow].join('|');
}

function composeFrame(names, tbl, tblFar, dy) {
  const buf = new Uint8ClampedArray(PORTRAIT_W * PORTRAIT_H * 4);
  for (const [slot, joint, far] of ORDER) {
    const part = getFrontPart(names[slot]);
    if (!part) continue;
    const j = JOINTS[joint];
    blitInto(buf, PORTRAIT_W, PORTRAIT_H, part, j.x, j.y + dy, far ? tblFar : tbl, far);
  }
  return buf;
}

/**
 * 정면 초상 한 벌. 옆모습과 **같은 모양의 객체**를 돌려주므로
 * `drawPortraitFrame` 이 `drawSpriteFrame` 과 똑같이 쓰인다.
 */
export function buildPortrait(recipe = {}) {
  const names = partsOf(recipe);
  const pal = makePalette(recipe.palette || {});
  const tbl = colorTable(pal);
  const tblFar = shadeTable(tbl, FAR_SHADE);

  const atlasW = PORTRAIT_W * FRAMES.length;
  const canvas = makeCanvas(atlasW, PORTRAIT_H);
  const flash = makeCanvas(atlasW, PORTRAIT_H);
  const ctx = canvas.getContext('2d');
  const fctx = flash.getContext('2d');
  const img = ctx.createImageData(atlasW, PORTRAIT_H);
  const fimg = fctx.createImageData(atlasW, PORTRAIT_H);

  const frames = {};
  FRAMES.forEach((name, i) => {
    const ox = i * PORTRAIT_W;
    frames[name] = { sx: ox, sy: 0 };
    const buf = composeFrame(names, tbl, tblFar, BREATH[name] || 0);
    blitFrameInto(img.data, atlasW, PORTRAIT_W, PORTRAIT_H, buf, ox, 0, 0, 1, false);
    blitFrameInto(fimg.data, atlasW, PORTRAIT_W, PORTRAIT_H, buf, ox, 0, 0, 1, true);
  });
  ctx.putImageData(img, 0, 0);
  fctx.putImageData(fimg, 0, 0);

  return { canvas, flash, w: PORTRAIT_W, h: PORTRAIT_H, frames, key: portraitKey(recipe) };
}

/* ─── 캐시 — 옆모습과 같은 규칙(바이트 예산 · LRU) ─── */
const cache = new Map();
export const portraitBytes = () => PORTRAIT_W * FRAMES.length * PORTRAIT_H * 4 * 2;
export const PORTRAIT_CACHE_BYTES = 24 * 1024 * 1024;
export const PORTRAIT_CACHE_MAX = Math.max(12, Math.floor(PORTRAIT_CACHE_BYTES / portraitBytes()));

export function getPortrait(recipe = {}) {
  const key = portraitKey(recipe);
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const p = buildPortrait(recipe);
  cache.set(key, p);
  while (cache.size > PORTRAIT_CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}
export function clearPortraitCache() { cache.clear(); }
export const portraitCacheSize = () => cache.size;

/**
 * 화면에 그린다. (x, y) 는 **발 밑 중앙**.
 * `scale` 은 옆모습과 같은 뜻이다 — 논리 픽셀(32×40 기준) 하나가 화면에서 몇 px 인가.
 */
export function drawPortraitFrame(ctx, portrait, frame, x, y, opts = {}) {
  if (!portrait) return;
  const { scale = 3, alpha = 1 } = opts;
  const f = portrait.frames[frame] || portrait.frames.idle0;
  if (!f) return;
  const px = scale / SCALE;
  const dw = PORTRAIT_W * px;
  const dh = PORTRAIT_H * px;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = alpha;
  ctx.drawImage(portrait.canvas, f.sx, f.sy, PORTRAIT_W, PORTRAIT_H,
    Math.round(x) - Math.round(dw / 2), Math.round(y) - PORTRAIT_FOOT_Y * px, dw, dh);
  ctx.restore();
}
