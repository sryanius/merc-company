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
import { hasIllustPng, getIllustPng, recolorInto } from './illustpng.js';

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
/* ★ 애니풍 «반치비 3등신» 비율 (제작자 채택 — 반치비 몸 + 치비 머리, HANDOFF §60).
 *   목이 y48(96×120)로 내려와 머리가 커졌고, 골반이 y80 으로 내려와 몸통이 짧아졌다.
 *   96×120 실제값: head/chest (48,48) · pelvis (48,80) · 어깨 (38,51)/(58,51) · 힙 (43,80)/(53,80). */
export const JOINT_BASE = {
  head: { x: 16, y: 16 },
  chest: { x: 16, y: 16 },
  pelvis: { x: 16, y: 80 / 3 },
  shLeft: { x: 38 / 3, y: 17 },
  shRight: { x: 58 / 3, y: 17 },
  handLeft: { x: 34 / 3, y: 28 },
  handRight: { x: 62 / 3, y: 28 },
  hipLeft: { x: 43 / 3, y: 80 / 3 },
  hipRight: { x: 53 / 3, y: 80 / 3 },
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
  /* 견갑은 **팔 위에** 온다 — 팔보다 먼저 그리면 팔 외곽선이 어깨를 잘라 버린다.
   * 정면은 좌우 두 짝이고 왼쪽은 뒤집어 그린다. */
  ['pauldron', 'shLeft', true],
  ['pauldron', 'shRight', false],
  ['weapon', 'handRight', false],
  ['offhand', 'handLeft', true],
  /* «포즈 판» 경로 (클래스 정체성) — partsOf 가 plate 를 주면 위의 몸 슬롯들은 전부
   * 비어 있으므로 실제로는 아래 넷만 그려진다. head2 가 판 **위에** 얹히는 게 핵심이다. */
  ['plate', 'chest', false],
  ['head2', 'head', false],
  ['hair2', 'head', false],
  ['helm2', 'head', false],
];

/** 빛 반대편 파츠를 어둡게 하는 비율. 옆모습의 먼쪽 처리와 같은 값. */
const FAR_SHADE = 0.82;

const ARM_BY_BODY = { body_slim: 'arm_slim', body_normal: 'arm_normal', body_heavy: 'arm_heavy', body_hulk: 'arm_heavy' };
/** 갑옷이 정하는 기본 견갑 (옆모습 spritegen 과 같은 표) */
const PAULDRON_BY_ARMOR = {
  armor_plate: 'pld_plate', armor_heavy: 'pld_plate', armor_mail: 'pld_mail',
  armor_leather: 'pld_leather', armor_bone: 'pld_bone',
};
const LEG_BY_ARMOR = {
  armor_cloth: 'leg_cloth', armor_robe: 'leg_cloth', armor_leather: 'leg_leather',
  armor_mail: 'leg_mail', armor_plate: 'leg_plate', armor_heavy: 'leg_plate',
  armor_bare: 'leg_bare', armor_bone: 'leg_bare',
};

function partsOf(recipe = {}) {
  /* ★ 정면 전용 얼굴(frontHead). `recipe.head` 를 바꾸면 **옆모습까지** 그 이름을 찾다
   *   머리가 사라진다 — spritegen 이 같은 레시피를 읽기 때문이다. 그래서 필드를 나눴다. */
  const face = recipe.frontHead && hasFrontPart(recipe.frontHead) ? recipe.frontHead : null;
  const head = face || recipe.head || 'head_human';

  /* ★★ «포즈 판»(plate) — 몸·팔·다리·갑옷·무기·이펙트를 클래스마다 한 장에 구운 것 (HANDOFF §61).
   *   제작자 질문 「정면은 굳이 파츠 조립 안 해도 되지 않나? 액션도 없는데」 가 계기다.
   *   조립의 존재 이유는 액션이 아니라 장비·개인 편차 반영이었는데, **팔레트 교환은
   *   통짜 그림에도 그대로 먹는다** (문자 행렬이라). 그래서 몸은 판으로 굽고
   *   얼굴·머리카락·투구만 레이어로 남겼다 — 개인 색 편차와 등급 금장이 그대로 산다.
   *   낀 갑옷·무기가 정면에 안 보이게 되는 대신, 전투 옆모습이 장비를 계속 보여 준다. */
  /* ★★★ «클래스 일러스트»(illust) — 머리·머리카락까지 포함한 **통짜 한 장**, 최우선.
   *   제작자 요청: 「비스듬히 서 있고, 화면을 풍성하게, 얼굴 생김새도 다르게, 해상도 키워도 됨」.
   *   3/4 자세·클래스별 얼굴은 공유 두개골로는 안 된다 — 머리카락 레이어 호환을 버리고
   *   전부 굽는다. 개인 색 편차(피부·머리·눈)는 팔레트 문자라 그대로 산다.
   *   머리 모양이 클래스마다 고정되는 것이 트레이드오프다 (색은 사람마다 다르다). */
  /* ★★★★ «PNG 일러스트» — 이미지 모델이 그린 그림, **최우선** (art/illustpng.js, HANDOFF §161).
   *   같은 이름(illust_<style>)으로 PNG 가 받아져 있으면 문자 일러스트 대신 그것을 쓴다.
   *   개인 색 편차(머리·눈)는 크로마키로 산다. 아직 못 받았으면 아래 문자 일러스트로 물러난다. */
  /* §174 영웅 전용 그림이 있으면 그것부터 — 없으면 클래스 그림으로 물러난다 (도감·주점·전투가 전부 같은 경로) */
  const png = [recipe.illustHero, recipe.illustClass, recipe.illust].find((n) => n && hasIllustPng(n)) || null;   // hero PNG, class PNG, style PNG
  if (png) return { png };

  const illust = recipe.illust && hasFrontPart(recipe.illust) ? recipe.illust : null;
  if (illust) return { illust };

  const plate = recipe.plate && hasFrontPart(recipe.plate) ? recipe.plate : null;
  if (plate) return { plate, head2: head, hair2: recipe.hair, helm2: recipe.helm };

  const body = recipe.body || 'body_normal';
  const armor = recipe.armor || 'armor_cloth';
  return {
    cape: recipe.cape, body, armor,
    arm: recipe.arm || ARM_BY_BODY[body] || 'arm_normal',
    leg: recipe.leg || LEG_BY_ARMOR[armor] || 'leg_cloth',
    head,
    pauldron: recipe.pauldron || PAULDRON_BY_ARMOR[armor],
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
  if (n.png) return true;                    // partsOf 가 받아졌는지 이미 확인했다
  if (n.illust) return true;                 // partsOf 가 존재를 이미 확인했다
  if (n.plate) return hasFrontPart(n.plate) && hasFrontPart(n.head2);
  return ['head', 'body', 'arm', 'leg'].every((k) => hasFrontPart(n[k]));
}

export function portraitKey(recipe = {}) {
  const n = partsOf(recipe);
  const p = recipe.palette || {};
  return ['F', n.png ? 'P:' + n.png : '', n.illust, n.plate, n.head2, n.hair2, n.helm2,
    n.body, n.head, n.hair, n.helm, n.armor, n.cape, n.arm, n.leg, n.weapon, n.offhand, n.pauldron,
    p.skin, p.hair, p.metal, p.cloth, p.leather, p.accent, p.glow, p.eye, recipe.aura, recipe.gradeBg, recipe.heroColor].join('|');
}

/**
 * 이 초상의 캔버스 크기와 발 위치.
 * 일러스트는 **자기 크기**를 쓴다 — 해상도를 올리려고 만든 경로다.
 * `norm` 은 화면 표시용 배율 보정: 큰 캔버스를 **같은 표시 높이**로 눌러
 * 카드 레이아웃을 안 건드리면서 픽셀 밀도만 올린다 (120/140 ≈ 0.86).
 */
function dimsOf(names) {
  /* PNG 는 자기 크기 그대로 — norm 이 표시 높이를 120 에 맞춘다 (일러스트와 같은 규약) */
  const png = names.png ? getIllustPng(names.png) : null;
  if (png) {
    return { W: png.w, H: png.h, footY: png.ay, norm: PORTRAIT_H / png.h, ill: null, png };
  }
  const ill = names.illust ? getFrontPart(names.illust) : null;
  if (ill) {
    return { W: ill.w, H: ill.h, footY: ill.ay, norm: PORTRAIT_H / ill.h, ill };
  }
  return { W: PORTRAIT_W, H: PORTRAIT_H, footY: PORTRAIT_FOOT_Y, norm: 1, ill: null };
}

function composeFrame(names, dims, tbl, tblFar, dy) {
  const { W, H, ill, png } = dims;
  const buf = new Uint8ClampedArray(W * H * 4);
  if (png) {
    /* PNG 는 통짜다 — 숨(dy)은 그림 높이에 비례해 키운다 (96×120 기준 1px = 240px 그림에서 2px) */
    recolorInto(buf, W, H, png, Math.round(dy * H / PORTRAIT_H), tbl);
    return buf;
  }
  if (ill) {
    // 일러스트는 조립이 없다 — 제자리에 통짜로 얹는다 (숨쉬기만 dy 로)
    blitInto(buf, W, H, ill, ill.ax, ill.ay + dy, tbl, false);
    return buf;
  }
  for (const [slot, joint, far] of ORDER) {
    const part = getFrontPart(names[slot]);
    if (!part) continue;
    const j = JOINTS[joint];
    blitInto(buf, W, H, part, j.x, j.y + dy, far ? tblFar : tbl, far);
  }
  return buf;
}

/**
 * 정면 초상 한 벌. 옆모습과 **같은 모양의 객체**를 돌려주므로
 * `drawPortraitFrame` 이 `drawSpriteFrame` 과 똑같이 쓰인다.
 */
export function buildPortrait(recipe = {}) {
  const names = partsOf(recipe);
  const dims = dimsOf(names);
  const { W, H } = dims;
  const pal = makePalette(recipe.palette || {});
  const tbl = colorTable(pal);
  const tblFar = shadeTable(tbl, FAR_SHADE);

  /* ★ 공격 포즈(§164): 같은 이름 + _atk PNG 가 있고 크기가 같으면 5번째 칸 'atk0' 로 굽는다 — 무대가 공격 클립 동안 쓴다 */
  const atk = dims.png && hasIllustPng(names.png + '_atk') ? getIllustPng(names.png + '_atk') : null;
  const atkOk = !!(atk && atk.w === W && atk.h === H);
  const frameNames = atkOk ? [...FRAMES, 'atk0'] : FRAMES;
  const atlasW = W * frameNames.length;
  const canvas = makeCanvas(atlasW, H);
  const flash = makeCanvas(atlasW, H);
  const ctx = canvas.getContext('2d');
  const fctx = flash.getContext('2d');
  const img = ctx.createImageData(atlasW, H);
  const fimg = fctx.createImageData(atlasW, H);

  const frames = {};
  frameNames.forEach((name, i) => {
    const ox = i * W;
    frames[name] = { sx: ox, sy: 0 };
    const buf = name === 'atk0' ? composeFrame(names, { ...dims, png: atk }, tbl, tblFar, 0) : composeFrame(names, dims, tbl, tblFar, BREATH[name] || 0);
    blitFrameInto(img.data, atlasW, W, H, buf, ox, 0, 0, 1, false);
    blitFrameInto(fimg.data, atlasW, W, H, buf, ox, 0, 0, 1, true);
  });
  ctx.putImageData(img, 0, 0);
  fctx.putImageData(fimg, 0, 0);

  return {
    canvas, flash, w: W, h: H, frames, key: portraitKey(recipe), aura: recipe.aura || null,
    footY: dims.footY, norm: dims.norm, png: !!dims.png, atk: atkOk,
    /* 등급 배경 (제작자: 「금빛 입히는 건 디자인 제약이니 차라리 배경을 다르게」).
     * 색을 캐릭터에 얹지 않고 **뒤에** 후광을 깐다 — 일러스트 디자인이 자유로워진다. */
    gradeBg: recipe.gradeBg || null,
    /* §177 영웅 후광 색 (없으면 BG.H 의 분홍) */
    heroColor: recipe.heroColor || null,
  };
}

/** #rrggbb 두 색을 t 만큼 섞는다 (후광 core 는 영웅 색을 흰색 쪽으로 눕힌 것) */
function mixHex(a, b, t) {
  const pa = /^#([0-9a-f]{6})$/i.exec(a || ''), pb = /^#([0-9a-f]{6})$/i.exec(b || '');
  if (!pa || !pb) return a;
  const x = parseInt(pa[1], 16), y = parseInt(pb[1], 16);
  const ch = (s) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
}

/* ─── 캐시 — 옆모습과 같은 규칙(바이트 예산 · LRU) ─── */
const cache = new Map();
export const portraitBytes = () => PORTRAIT_W * FRAMES.length * PORTRAIT_H * 4 * 2;
/* ★ PNG 초상은 한 벌이 192×240×4프레임×2캔버스 ≈ 1.5MB — 96×120 기준 개수 상한(68)만 믿으면 100MB 까지 부푼다 (§162 검토).
 *   그래서 개수와 **실제 바이트** 둘 다로 민다. 32MB ≈ PNG 21벌 — 전투 10명 + 주점 5명이 같이 살아 있을 만큼. */
export const PORTRAIT_CACHE_BYTES = 32 * 1024 * 1024;
export const PORTRAIT_CACHE_MAX = Math.max(12, Math.floor(PORTRAIT_CACHE_BYTES / portraitBytes()));
let cacheBytes = 0;
const bytesOf = (p) => (p.canvas && p.canvas.width ? p.canvas.width * p.canvas.height * 4 * 2 : portraitBytes());

export function getPortrait(recipe = {}) {
  const key = portraitKey(recipe);
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const p = buildPortrait(recipe);
  cache.set(key, p);
  cacheBytes += bytesOf(p);
  while (cache.size > 1 && (cache.size > PORTRAIT_CACHE_MAX || cacheBytes > PORTRAIT_CACHE_BYTES)) {
    const k = cache.keys().next().value;
    cacheBytes -= bytesOf(cache.get(k));
    cache.delete(k);
  }
  return p;
}
export function clearPortraitCache() { cache.clear(); cacheBytes = 0; }
export const portraitCacheBytes = () => cacheBytes;
export const portraitCacheSize = () => cache.size;

/**
 * 화면에 그린다. (x, y) 는 **발 밑 중앙**.
 * `scale` 은 옆모습과 같은 뜻이다 — 논리 픽셀(32×40 기준) 하나가 화면에서 몇 px 인가.
 */
export function drawPortraitFrame(ctx, portrait, frame, x, y, opts = {}) {
  if (!portrait) return;
  /* flip·flash 는 옆모습(drawSpriteFrame)과 같은 뜻 — 전투(HANDOFF §162)가 적을 뒤집고 피격을 흰 섬광으로 찍는다.
   * bg=false 면 등급 후광을 안 깐다 (전투 무대에서는 산만하다). */
  const { scale = 3, alpha = 1, flip = false, flash = 0, bg: showBg = true } = opts;
  const f = portrait.frames[frame] || portrait.frames.idle0;
  if (!f) return;
  /* norm: 일러스트(고해상도)를 기존과 **같은 표시 높이**로 누른다.
   * 카드 레이아웃은 그대로, 픽셀 밀도만 올라간다. */
  const px = (scale / SCALE) * (portrait.norm || 1);
  const W = portrait.w || PORTRAIT_W;
  const H = portrait.h || PORTRAIT_H;
  const dw = W * px;
  const dh = H * px;
  ctx.save();
  if (flip) { ctx.translate(Math.round(x) * 2, 0); ctx.scale(-1, 1); }   // x 를 축으로 좌우 반전 — 아래 dx0 계산은 그대로 쓴다
  /* ★ PNG 일러스트를 **줄여** 그릴 때만 보간을 켠다 (dpr 1 화면). 최근접으로 줄이면 줄이 통째로 빠진다.
   *   같은 크기·키울 때는 최근접 — 도트가 뭉개지면 안 된다. 문자 일러스트는 예전 그대로 최근접. */
  ctx.imageSmoothingEnabled = !!(portrait.png && dw < W);
  const dx0 = Math.round(x) - Math.round(dw / 2);
  const dy0 = Math.round(y) - Math.round((portrait.footY ?? PORTRAIT_FOOT_Y) * px);

  /* ── 등급 배경 — 캐릭터 **뒤에** 깐다. 금빛 덧입히기(오라)의 대체다.
   *
   * ★★ 제작자 지적: 「배경 효과가 허접하다. 좀 더 있어 보이게」.
   *   예전엔 원형 그라데이션 한 장 + 십자 반짝이 다섯 개가 전부였다 — 안 움직이고 납작했다.
   *   지금은 네 겹이다: 회전 광선 → 바닥 웅덩이 → 테 고리(S 전용) → 떠오르는 입자.
   *
   * ★ 위상(phase)을 초상 키에서 뽑는다. Date.now() 만 쓰면 화면의 모든 S 등급이
   *   **똑같이 깜빡여서** 기계처럼 보인다 — 명단에 여럿 세워 보고 알았다.
   * ★ 광선은 캐릭터 **뒤**로만 간다 (이 블록이 스프라이트보다 먼저 그려진다).
   *   실루엣을 덮지 않으니 «디자인 제약» 이 안 된다 — 오라를 버린 이유가 그것이었다(§60.2).
   */
  /* ★★ 등급 표시 (§167) — 제작자: 「이미지 바꾸면서 먼가 어색해졌어」
   *
   *   예전에는 캐릭터 **뒤에** 회전하는 광선 16개 + 링 + 떠오르는 입자를 깔았다. 문자 행렬 도트(§58~65)
   *   시절엔 그림이 단순해서 그게 «있어 보이는» 장치였는데, 세밀한 일러스트(§161)로 바꾸고 나니
   *   **그림과 싸운다** — 옷의 금장식·망토와 광선이 겹쳐 뭐가 캐릭터인지 흐려진다.
   *
   * ★ 바꾼 것: 배경을 걷어내고 **캐릭터 자체를 빛나게** 한다.
   *     ① 실루엣 테두리 발광 — 이미 있는 flash(실루엣) 캔버스를 등급색으로 물들여 바깥으로 밀어 깐다.
   *        그림 위에 아무것도 안 얹으므로 옷·무기가 그대로 읽힌다.
   *     ② 발밑 웅덩이 — 캐릭터가 «빛을 딛고 선» 느낌만 남긴다 (예전 것보다 옅고 넓다).
   *     ③ 아주 옅은 뒤광 — 어두운 카드에서 실루엣이 묻히지 않게 하는 최소한의 대비.
   *   회전·광선·링·입자는 전부 뺐다. 숨쉬기처럼 **아주 느린 밝기 맥동**만 남긴다.
   */
  const BG = {
    S: { core: '#ffe9a0', mid: '#f0d24a', glow: 3.0, halo: 0.30 },
    A: { core: '#dcc8ff', mid: '#a97ff0', glow: 2.2, halo: 0.22 },
    H: { core: '#ffd9f3', mid: '#ff7fd8', glow: 3.3, halo: 0.34 },   // §174 영웅
  };
  let bg = showBg && portrait.gradeBg && BG[portrait.gradeBg];
  if (bg && portrait.gradeBg === 'H' && portrait.heroColor) {
    bg = { ...bg, core: mixHex(portrait.heroColor, '#ffffff', 0.55), mid: portrait.heroColor };   // §177 영웅 색 후광
  }
  if (bg) {
    const cx = dx0 + dw / 2;
    const fy = dy0 + (portrait.footY ?? PORTRAIT_FOOT_Y) * px;
    let hsh = 0;
    const key = portrait.key || '';
    for (let i = 0; i < key.length; i++) hsh = (hsh * 31 + key.charCodeAt(i)) & 0xffff;
    const ph = (hsh / 0xffff) * Math.PI * 2;                 // 용병마다 맥동 위상이 다르다
    const puls = 0.5 + 0.5 * Math.sin(Date.now() / 900 + ph);

    /* ③ 뒤광 — 캐릭터 뒤 아주 옅은 원. 어두운 카드에서 실루엣을 띄운다 */
    ctx.save();
    const halo = ctx.createRadialGradient(cx, dy0 + dh * 0.45, 0, cx, dy0 + dh * 0.45, dh * 0.55);
    halo.addColorStop(0, bg.mid + Math.round(bg.halo * 255).toString(16).padStart(2, '0'));
    halo.addColorStop(1, bg.mid + '00');
    ctx.globalAlpha = alpha * (0.72 + puls * 0.14);
    ctx.fillStyle = halo;
    ctx.fillRect(dx0 - dw * 0.2, dy0, dw * 1.4, dh);
    ctx.restore();

    /* ② 발밑 웅덩이 — 넓고 옅게 */
    ctx.save();
    const pool = ctx.createRadialGradient(cx, fy, 0, cx, fy, dw * 0.50);
    pool.addColorStop(0, bg.core + '5a');
    pool.addColorStop(0.55, bg.mid + '2e');
    pool.addColorStop(1, bg.mid + '00');
    ctx.globalAlpha = alpha * (0.80 + puls * 0.20);
    ctx.fillStyle = pool;
    ctx.translate(cx, fy); ctx.scale(1, 0.26); ctx.translate(-cx, -fy);
    ctx.beginPath(); ctx.arc(cx, fy, dw * 0.50, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ① 실루엣 테두리 발광 — 등급색으로 물들인 실루엣을 바깥으로 밀어 여러 번 깐다.
   *   `portrait.flash` 는 전투 피격에 쓰는 흰 실루엣이다 (자리를 나눠 쓴다 — 캐시 한 벌로 둘 다 된다). */
  if (bg) {
    const tintKey = '_tintG' + portrait.gradeBg;
    if (!portrait[tintKey]) {
      const c = makeCanvas(portrait.flash.width, portrait.flash.height);
      const g = c.getContext('2d');
      g.drawImage(portrait.flash, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = bg.core;
      g.fillRect(0, 0, c.width, c.height);
      portrait[tintKey] = c;
    }
    const o1 = Math.max(1, Math.round(px * bg.glow));
    const puls2 = 0.5 + 0.5 * Math.sin(Date.now() / 900);
    ctx.globalAlpha = alpha * (0.30 + puls2 * 0.12);
    /* 8방향으로 밀어 깔면 테두리가 고르게 난다 (4방향이면 대각선이 얇다) */
    for (const [ax2, ay2] of [[o1, 0], [-o1, 0], [0, o1], [0, -o1],
      [o1 * 0.7, o1 * 0.7], [-o1 * 0.7, o1 * 0.7], [o1 * 0.7, -o1 * 0.7], [-o1 * 0.7, -o1 * 0.7]]) {
      ctx.drawImage(portrait[tintKey], f.sx, f.sy, W, H, dx0 + ax2, dy0 + ay2, dw, dh);
    }
    ctx.globalAlpha = alpha;
  }

  if (portrait.aura && !bg) {
    if (!portrait._tint) {
      const c = makeCanvas(portrait.flash.width, portrait.flash.height);
      const g = c.getContext('2d');
      g.drawImage(portrait.flash, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = portrait.aura;
      g.fillRect(0, 0, c.width, c.height);
      portrait._tint = c;
    }
    const o1 = Math.max(1, Math.round(px));
    ctx.globalAlpha = alpha * (0.42 + Math.sin(Date.now() / 320) * 0.10);
    for (const [ax2, ay2] of [[o1, 0], [-o1, 0], [0, o1], [0, -o1]]) {
      ctx.drawImage(portrait._tint, f.sx, f.sy, W, H, dx0 + ax2, dy0 + ay2, dw, dh);
    }
  }
  ctx.globalAlpha = alpha;
  ctx.drawImage(portrait.canvas, f.sx, f.sy, W, H, dx0, dy0, dw, dh);
  if (flash > 0) {
    ctx.globalAlpha = alpha * Math.min(1, flash);
    ctx.drawImage(portrait.flash, f.sx, f.sy, W, H, dx0, dy0, dw, dh);
  }
  ctx.restore();
}
