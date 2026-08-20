// 파츠 조합 -> 프레임 아틀라스 생성. SPEC §4.1~4.7
//
// 규약 요약
//  - 논리 캔버스 32 x 40. 발바닥(지면) y=38, 가로 중심 x=16. 캐릭터는 +x(오른쪽)를 본다.
//  - 파츠는 픽셀 행렬 그대로 ImageData 버퍼에 합성한다. 캔버스 회전/스케일 금지.
//  - 무기 회전각(weaponRot/offhandRot)은 "0 = 위쪽(-y)을 향함, 양수 = 시계방향".
//    즉 wpn_* 파츠는 날 끝이 위를 향하고 그립(ax,ay)이 아래쪽에 있도록 그려야 한다.
//  - 이 모듈은 최상위에서 document/window를 건드리지 않는다 (node import 가능).
import { getPart } from './parts.js';
import { makePalette } from './palette.js';

/**
 * 논리 캔버스 배율.
 *
 * ★★ 파츠 픽셀과 아래 좌표들은 전부 **32×40 시절 숫자로 적혀 있다.**
 *   해상도를 올릴 때 그 숫자를 전부 손으로 고치면 반드시 몇 개를 빠뜨린다
 *   (조인트 10개 · 포즈 오프셋 수십 개 · 방패 오프셋 · 회전축…).
 *   대신 **여기 하나로 곱한다.** `art/parts.js` 가 파츠를 같은 배율로 승격한다.
 *
 * ★ 1 로 되돌리면 옛 해상도로 즉시 돌아간다 — 비교할 때 쓴다.
 */
export const SCALE = 2;
const S = SCALE;

export const SPRITE_W = 32 * S;
export const SPRITE_H = 40 * S;
export const FOOT_Y = 38 * S; // 지면에 닿는 y (아틀라스 픽셀)

/**
 * 발밑에서 정수리까지 **화면 px**. 밖에서 스프라이트 높이를 잴 때는 반드시 이걸 쓴다.
 *
 * ★ `FOOT_Y * scale` 로 직접 계산하면 안 된다 — FOOT_Y 는 아틀라스 픽셀이라
 *   SCALE 을 올리는 순간 머리 위치·지평선·피해 숫자가 통째로 두 배로 뛴다.
 *   실제로 겪었다 (HANDOFF §50).
 *
 * @param {number} scale drawSpriteFrame 에 넘기는 것과 **같은** 값
 */
export function spriteFootPx(scale) { return (FOOT_Y * scale) / SCALE; }
/** 사망 프레임 전체 회전축 (골반). 여기를 축으로 넘어진다. */
export const ROT_PIVOT = { x: 16 * S, y: 26 * S };

/**
 * 방패를 그릴 때 handBack 에서 얼마나 앞으로 밀지.
 * handBack.x(11) + 8 = 19 → 몸통(중심 16)의 앞쪽 가장자리에 방패면이 오게 된다.
 * 0으로 되돌리면 방패가 등 뒤로 가서 캐릭터가 반대편을 보는 것처럼 읽힌다.
 */
export const SHIELD_OFFSET = { x: 8 * S, y: -1 * S };

/** SPEC §4.2 조인트 좌표 (스프라이트 로컬, 기본 포즈) */
export const JOINTS = scaleJoints({
  head: { x: 16, y: 14 },      // 목 (머리/헤어/투구 앵커)
  chest: { x: 16, y: 14 },     // 몸통 상단 중앙
  pelvis: { x: 16, y: 26 },
  shBack: { x: 13, y: 16 },    // 먼쪽 어깨
  shFront: { x: 19, y: 16 },   // 가까운쪽 어깨
  handBack: { x: 11, y: 24 },
  handFront: { x: 21, y: 24 },
  hipBack: { x: 14, y: 26 },
  hipFront: { x: 18, y: 26 },
});

/** 조인트 좌표를 SCALE 배로. 숫자는 32×40 기준으로 적혀 있다. */
function scaleJoints(j) {
  const out = {};
  for (const k of Object.keys(j)) out[k] = { x: j[k].x * S, y: j[k].y * S };
  return out;
}

/** SPEC §4.5 프레임 목록 */
export const FRAMES = [
  'idle0', 'idle1', 'idle2', 'idle3',
  'walk0', 'walk1', 'walk2', 'walk3',
  'atk0', 'atk1', 'atk2', 'atk3',
  'shoot0', 'shoot1', 'shoot2',
  'cast0', 'cast1', 'cast2',
  'guard0', 'hit0',
  'die0', 'die1', 'die2', 'die3',
];

const JOINT_KEYS = ['head', 'chest', 'pelvis', 'shBack', 'shFront', 'handBack', 'handFront', 'hipBack', 'hipFront'];

/** 포즈 기본값 채우기 */
function pose(o = {}) {
  // ★ dx/dy 는 **픽셀** 이라 SCALE 을 탄다. rot/alpha 는 각도·비율이라 안 탄다.
  const p = {
    dx: (o.dx || 0) * S, dy: (o.dy || 0) * S,
    weaponRot: o.weaponRot || 0, offhandRot: o.offhandRot || 0,
    rot: o.rot || 0, alpha: o.alpha == null ? 1 : o.alpha,
  };
  for (const k of JOINT_KEYS) {
    const j = o[k] || {};
    p[k] = { dx: (j.dx || 0) * S, dy: (j.dy || 0) * S };
  }
  return p;
}

/**
 * 프레임별 포즈. 애니메이션의 전부가 여기 들어있다.
 * 조인트 dx/dy 는 JOINTS 기준 오프셋, dx/dy(최상위)는 프레임 전체 평행이동,
 * rot/alpha 는 합성이 끝난 프레임 전체에 적용된다.
 */
export const POSES = {
  // ── 대기: 1px 호흡 + 무기 미세 흔들림 ──────────────────────────
  idle0: pose({}),
  idle1: pose({
    head: { dy: -1 }, chest: { dy: -1 }, shFront: { dy: -1 }, shBack: { dy: -1 },
    handFront: { dy: -1 }, handBack: { dy: -1 },
  }),
  idle2: pose({
    head: { dy: -1 }, chest: { dy: -1 }, shFront: { dy: -1 }, shBack: { dy: -1 },
    handFront: { dx: 1, dy: -1 }, handBack: { dy: -1 },
    weaponRot: 15, offhandRot: -15,
  }),
  idle3: pose({
    handFront: { dx: 1 }, weaponRot: 15, offhandRot: -15,
  }),

  // ── 보행: 다리 교차 + 몸통 상하 바운스 + 팔 반대 스윙 ─────────
  walk0: pose({ // 접지 (앞다리 앞)
    hipFront: { dx: 2 }, hipBack: { dx: -2 },
    shFront: { dx: -1 }, shBack: { dx: 1 },
    handFront: { dx: -2, dy: 1 }, handBack: { dx: 2, dy: -1 },
    chest: { dy: 1 }, head: { dy: 1 },
    weaponRot: -15,
  }),
  walk1: pose({ // 통과 (몸 뜸)
    hipFront: { dx: 1, dy: -1 }, hipBack: { dx: -1 },
    chest: { dy: -1 }, head: { dy: -1 }, shFront: { dy: -1 }, shBack: { dy: -1 },
    handFront: { dx: -1, dy: -1 }, handBack: { dx: 1, dy: -1 },
  }),
  walk2: pose({ // 접지 (뒷다리 앞)
    hipFront: { dx: -2 }, hipBack: { dx: 2 },
    shFront: { dx: 1 }, shBack: { dx: -1 },
    handFront: { dx: 2, dy: 1 }, handBack: { dx: -2, dy: -1 },
    chest: { dy: 1 }, head: { dy: 1 },
    weaponRot: 15,
  }),
  walk3: pose({ // 통과
    hipFront: { dx: -1 }, hipBack: { dx: 1, dy: -1 },
    chest: { dy: -1 }, head: { dy: -1 }, shFront: { dy: -1 }, shBack: { dy: -1 },
    handFront: { dx: 1, dy: -1 }, handBack: { dx: -1, dy: -1 },
  }),

  // ── 근접 공격: 준비 - 내리침 - 팔로스루 - 복귀 ────────────────
  atk0: pose({ // 뒤로 크게 젖혀 준비
    dx: -2,
    chest: { dx: -1 }, head: { dx: -1, dy: -1 },
    shFront: { dx: -2, dy: -1 }, shBack: { dx: 1 },
    handFront: { dx: -4, dy: -5 }, handBack: { dx: 1, dy: -1 },
    hipFront: { dx: -1 }, hipBack: { dx: 1 },
    weaponRot: -75, offhandRot: -15,
  }),
  atk1: pose({ // 앞으로 내리침 (몸 전진 3px)
    dx: 3,
    chest: { dx: 1, dy: 1 }, head: { dx: 2 },
    shFront: { dx: 1, dy: -1 }, shBack: { dx: -1 },
    handFront: { dx: -2, dy: -4 }, handBack: { dx: -2, dy: 1 },
    hipFront: { dx: 2 }, hipBack: { dx: -2 },
    weaponRot: 45, offhandRot: 15,
  }),
  atk2: pose({ // 팔로스루 (무기가 몸 앞을 훑고 지나간다)
    dx: 2,
    chest: { dx: 1, dy: 1 }, head: { dx: 1, dy: 1 },
    shFront: { dx: 2, dy: 1 }, shBack: { dx: -1, dy: 1 },
    handFront: { dx: -3, dy: 2 }, handBack: { dx: -2, dy: 2 },
    hipFront: { dx: 1 }, hipBack: { dx: -1 },
    weaponRot: 75, offhandRot: 15,
  }),
  atk3: pose({ // 복귀
    dx: 1,
    chest: { dy: 1 }, head: { dy: 1 },
    shFront: { dx: 1 },
    handFront: { dx: 1, dy: 1 }, handBack: { dx: -1, dy: 1 },
    weaponRot: 15,
  }),

  // ── 사격: 당김 - 발사(반동) - 복귀 ────────────────────────────
  shoot0: pose({ // 시위 당김
    dx: -1,
    chest: { dx: -1 }, head: { dx: -1 },
    shFront: { dx: 1 }, shBack: { dx: -1, dy: -1 },
    handFront: { dx: 2, dy: -4 }, handBack: { dx: -2, dy: -5 },
    hipBack: { dx: -1 },
    offhandRot: -15,
  }),
  shoot1: pose({ // 발사
    dx: 1,
    chest: { dx: 1 }, head: { dx: 1 },
    shFront: { dx: 1, dy: -1 }, shBack: { dx: 1 },
    handFront: { dx: 3, dy: -4 }, handBack: { dx: 2, dy: -4 },
    hipFront: { dx: 1 },
    weaponRot: 15,
  }),
  shoot2: pose({ // 복귀
    handFront: { dx: 1, dy: -2 }, handBack: { dx: -1, dy: -1 },
    shFront: { dy: -1 }, head: { dy: -1 },
  }),

  // ── 시전: 팔 들어올림 + 무기 위로 + 몸 살짝 뒤로 ──────────────
  // (지팡이는 그립 위로 19px 이므로 손을 5px 이상 올리면 윗부분이 잘린다)
  cast0: pose({
    dx: -1,
    chest: { dy: -1 }, head: { dx: -1, dy: -1 },
    shFront: { dy: -1 }, shBack: { dy: -1 },
    handFront: { dx: 2, dy: -3 }, handBack: { dx: -1, dy: -2 },
    offhandRot: -15,
  }),
  cast1: pose({
    dx: -2,
    chest: { dx: -1, dy: -1 }, head: { dx: -2, dy: -1 },
    shFront: { dy: -2 }, shBack: { dx: -1, dy: -1 },
    handFront: { dx: 4, dy: -6 }, handBack: { dx: -2, dy: -4 },
    hipBack: { dx: -1 },
    weaponRot: -15, offhandRot: -30,
  }),
  cast2: pose({
    dx: -1,
    chest: { dy: -1 }, head: { dy: -1 },
    shFront: { dx: 1, dy: -1 },
    handFront: { dx: 3, dy: -4 }, handBack: { dx: -1, dy: -3 },
    weaponRot: 15, offhandRot: -15,
  }),

  // ── 방어 / 피격 ──────────────────────────────────────────────
  guard0: pose({ // 방패 앞으로, 몸 웅크림
    dx: -1, dy: 1,
    chest: { dy: 1 }, head: { dx: -1, dy: 1 },
    shFront: { dx: -1, dy: 1 }, shBack: { dx: 3 },
    handFront: { dx: -3, dy: 1 }, handBack: { dx: 9, dy: -1 },
    hipFront: { dx: -1 },
    weaponRot: -30, offhandRot: 0,
  }),
  hit0: pose({ // 뒤로 젖혀지고 머리 뒤로
    dx: -2,
    chest: { dx: -1, dy: -1 }, head: { dx: -3, dy: -1 },
    shFront: { dx: -1 }, shBack: { dx: -2 },
    handFront: { dx: -2, dy: 2 }, handBack: { dx: -1, dy: 2 },
    hipFront: { dx: 1 },
    weaponRot: -15, offhandRot: -15,
  }),

  // ── 사망: 무릎 꺾임 - 기울어짐 - 쓰러짐 - 완전히 누움 ─────────
  die0: pose({
    chest: { dx: -1, dy: 3 }, head: { dx: -2, dy: 3 },
    shFront: { dx: -1, dy: 3 }, shBack: { dx: -1, dy: 3 },
    handFront: { dx: -2, dy: 3 }, handBack: { dx: -2, dy: 3 },
    hipFront: { dy: 2 }, hipBack: { dy: 2 },
    weaponRot: -30, offhandRot: -15,
  }),
  die1: pose({
    dx: -1, dy: 1,
    chest: { dx: -1, dy: 2 }, head: { dx: -2, dy: 2 },
    shFront: { dx: -1, dy: 2 }, shBack: { dx: -1, dy: 2 },
    handFront: { dx: -3, dy: 4 }, handBack: { dx: -3, dy: 4 },
    hipFront: { dy: 1 }, hipBack: { dy: 1 },
    weaponRot: -45, offhandRot: -30,
    rot: 30,
  }),
  die2: pose({
    dx: -4, dy: 6,
    chest: { dy: 2 }, head: { dx: -1, dy: 2 },
    handFront: { dx: -4, dy: 5 }, handBack: { dx: -4, dy: 5 },
    weaponRot: -60, offhandRot: -45,
    rot: 75, alpha: 0.85,
  }),
  die3: pose({
    dx: -5, dy: 6,
    chest: { dy: 2 }, head: { dx: -2, dy: 2 },
    handFront: { dx: -5, dy: 6 }, handBack: { dx: -5, dy: 6 },
    weaponRot: -75, offhandRot: -60,
    rot: 90, alpha: 0.55,
  }),
};

// ── 파츠 회전 ───────────────────────────────────────────────────

const rotCache = new WeakMap(); // part -> Map(deg -> rotated part)

/**
 * 파츠 픽셀 행렬을 최근접 이웃으로 회전한다 (양수 = 시계방향).
 * 앵커도 함께 변환해서 새 앵커를 돌려준다.
 * @returns {{w:number,h:number,ax:number,ay:number,px:string[]}}
 */
export function rotateMatrix(part, deg) {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  if (d === 0 || !part || part.w <= 0 || part.h <= 0) {
    return { w: part.w, h: part.h, ax: part.ax, ay: part.ay, px: part.px.slice() };
  }
  const r = (d * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const { w, h, ax, ay, px } = part;
  // 앵커 기준 네 모서리를 돌려 새 경계 상자를 구한다
  const cor = [[-ax, -ay], [w - ax, -ay], [-ax, h - ay], [w - ax, h - ay]];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [cx, cy] of cor) {
    const rx = cx * cos - cy * sin;
    const ry = cx * sin + cy * cos;
    if (rx < x0) x0 = rx; if (rx > x1) x1 = rx;
    if (ry < y0) y0 = ry; if (ry > y1) y1 = ry;
  }
  x0 = Math.floor(x0); y0 = Math.floor(y0);
  x1 = Math.ceil(x1); y1 = Math.ceil(y1);
  const nw = Math.max(1, x1 - x0), nh = Math.max(1, y1 - y0);
  const nax = -x0, nay = -y0;
  const rows = new Array(nh);
  for (let ry = 0; ry < nh; ry++) {
    let s = '';
    for (let rx = 0; rx < nw; rx++) {
      // 대상 픽셀 중심을 역회전해서 원본 픽셀을 샘플링 (구멍 없음)
      const dx = rx - nax + 0.5, dy = ry - nay + 0.5;
      const sx = dx * cos + dy * sin;
      const sy = -dx * sin + dy * cos;
      const c = Math.floor(sx + ax), rr = Math.floor(sy + ay);
      s += (c >= 0 && c < w && rr >= 0 && rr < h) ? px[rr][c] : '.';
    }
    rows[ry] = s;
  }
  return { w: nw, h: nh, ax: nax, ay: nay, px: rows };
}

function rotatedPart(part, deg) {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  if (d === 0) return part;
  let m = rotCache.get(part);
  if (!m) { m = new Map(); rotCache.set(part, m); }
  let out = m.get(d);
  if (!out) { out = rotateMatrix(part, d); m.set(d, out); }
  return out;
}

/** 파츠를 (jx,jy)에 놓았을 때 프레임 밖으로 나가는 픽셀 비율 */
function clipRatio(rp, jx, jy) {
  let out = 0, total = 0;
  for (let r = 0; r < rp.h; r++) {
    const row = rp.px[r];
    for (let c = 0; c < rp.w; c++) {
      if (row[c] === '.') continue;
      total++;
      const x = jx - rp.ax + c, y = jy - rp.ay + r;
      if (x < 0 || x >= SPRITE_W || y < 0 || y >= SPRITE_H) out++;
    }
  }
  return total ? out / total : 0;
}

/**
 * 32x40 안에 들어가도록 회전각을 다듬는다.
 * 낫/미늘창처럼 그립 위로 20px 넘게 뻗은 무기는 크게 휘두르면 화면 밖으로 잘려나가므로
 * 잘림이 한계를 넘으면 15도씩 각을 줄인다 (무거운 무기는 덜 휘두른다 — 자연스럽다).
 */
const CLIP_LIMIT = 0.08;
function fitRot(part, deg, jx, jy) {
  let d = Math.round(deg / 15) * 15;
  while (d !== 0) {
    const rp = rotatedPart(part, d);
    if (clipRatio(rp, jx, jy) <= CLIP_LIMIT) return rp;
    d -= Math.sign(d) * 15;
  }
  return part;
}

/** 어깨->손 벡터로 팔 회전각(15도 배수)을 구한다. 기본 자세(아래로 뻗음)가 0도. */
function armAngle(sx, sy, hx, hy) {
  const dx = hx - sx, dy = hy - sy;
  if (dx === 0 && dy === 0) return 0;
  const a = (-Math.atan2(dx, dy) * 180) / Math.PI;
  return Math.round(a / 15) * 15;
}

// ── 색 테이블 ───────────────────────────────────────────────────

function hexToRgb(hex) {
  if (!hex) return null;
  let s = String(hex).replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  if (!Number.isFinite(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorTable(pal) {
  const t = Object.create(null);
  for (const k in pal) t[k] = hexToRgb(pal[k]);
  t['.'] = null;
  return t;
}

/** 먼쪽(back) 파츠용 어두운 테이블 */
function shadeTable(t, f) {
  const o = Object.create(null);
  for (const k in t) {
    const c = t[k];
    o[k] = c ? [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)] : null;
  }
  return o;
}

// ── 합성 ────────────────────────────────────────────────────────

function blit(buf, part, jx, jy, tbl) {
  if (!part || !part.px) return;
  const { w, h, ax, ay, px } = part;
  for (let r = 0; r < h; r++) {
    const y = jy - ay + r;
    if (y < 0 || y >= SPRITE_H) continue;
    const row = px[r];
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (ch === '.' || ch === ' ') continue;
      const col = tbl[ch];
      if (!col) continue;
      const x = jx - ax + c;
      if (x < 0 || x >= SPRITE_W) continue;
      const i = (y * SPRITE_W + x) * 4;
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
    }
  }
}

const ARM_BY_BODY = { body_slim: 'arm_slim', body_normal: 'arm_normal', body_heavy: 'arm_heavy', body_hulk: 'arm_heavy' };
const LEG_BY_ARMOR = {
  armor_cloth: 'leg_cloth', armor_robe: 'leg_cloth', armor_leather: 'leg_leather',
  armor_mail: 'leg_mail', armor_plate: 'leg_plate', armor_heavy: 'leg_plate',
  armor_bare: 'leg_bare', armor_bone: 'leg_bare',
};

/** 레시피 -> 실제 파츠 이름 (arm/leg 는 body/armor 에서 유도, 레시피로 직접 지정도 가능) */
function partNames(recipe = {}) {
  const body = recipe.body || 'body_normal';
  const armor = recipe.armor || 'armor_cloth';
  return {
    body, armor,
    cape: recipe.cape || 'cape_none',
    arm: recipe.arm || ARM_BY_BODY[body] || 'arm_normal',
    leg: recipe.leg || LEG_BY_ARMOR[armor] || 'leg_cloth',
    head: recipe.head || 'head_human',
    hair: recipe.hair || 'hair_none',
    helm: recipe.helm || 'helm_none',
    weapon: recipe.weapon || 'wpn_none',
    offhand: recipe.offhand || 'shd_none',
  };
}

function resolveParts(recipe) {
  const n = partNames(recipe);
  const out = {};
  for (const k in n) out[k] = getPart(n[k]);
  return out;
}

/** 한 프레임을 32x40 RGBA 버퍼에 합성 (전체 dx/dy/rot/alpha 는 아직 미적용) */
function composeFrame(parts, tbl, tblBack, tblCape, p) {
  const buf = new Uint8ClampedArray(SPRITE_W * SPRITE_H * 4);
  const jx = (k) => JOINTS[k].x + p[k].dx;
  const jy = (k) => JOINTS[k].y + p[k].dy;

  const chestX = jx('chest'), chestY = jy('chest');
  const headX = jx('head'), headY = jy('head');
  const sbX = jx('shBack'), sbY = jy('shBack');
  const sfX = jx('shFront'), sfY = jy('shFront');
  const hbX = jx('handBack'), hbY = jy('handBack');
  const hfX = jx('handFront'), hfY = jy('handFront');
  const pbX = jx('hipBack'), pbY = jy('hipBack');
  const pfX = jx('hipFront'), pfY = jy('hipFront');

  // SPEC §4.6 그리기 순서
  blit(buf, parts.cape, chestX, chestY, tblCape);
  blit(buf, rotatedPart(parts.arm, armAngle(sbX, sbY, hbX, hbY)), sbX, sbY, tblBack);
  blit(buf, parts.leg, pbX, pbY, tblBack);
  blit(buf, parts.leg, pfX, pfY, tbl);
  blit(buf, parts.body, chestX, chestY, tbl);
  blit(buf, parts.armor, chestX, chestY, tbl);
  blit(buf, parts.head, headX, headY, tbl);
  blit(buf, parts.hair, headX, headY, tbl);
  blit(buf, parts.helm, headX, headY, tbl);
  // 방패는 "먼쪽 손"에 들지만, 옆모습에서는 **적을 향한 앞쪽**에 그려야 방패로 읽힌다.
  //
  // handBack(x=11)에 그대로 붙이면 방패가 몸 왼쪽 뒤로 통째로 튀어나온다. 그러면 오른쪽을
  // 보고 있는데도 "왼쪽을 보고 있다"로 읽힌다 — 실제로 플레이어가 방패병을 보고 두 번
  // 지적한 문제다. 투구를 얼굴 보이는 것으로 바꿔도 해결되지 않았던 진짜 원인이 이것이다.
  //
  // 손의 움직임(포즈 델타)은 그대로 따르게 두고 위치만 몸 앞쪽으로 옮긴다.
  const shX = hbX + SHIELD_OFFSET.x, shY = hbY + SHIELD_OFFSET.y;
  // 잘림 판정은 프레임 전체 이동(p.dx/p.dy)까지 반영한 최종 위치로 한다
  blit(buf, fitRot(parts.offhand, p.offhandRot, shX + p.dx, shY + p.dy), shX, shY, tbl);
  blit(buf, rotatedPart(parts.arm, armAngle(sfX, sfY, hfX, hfY)), sfX, sfY, tbl);
  blit(buf, fitRot(parts.weapon, p.weaponRot, hfX + p.dx, hfY + p.dy), hfX, hfY, tbl);
  return buf;
}

/** 프레임 버퍼 전체를 ROT_PIVOT 기준으로 회전 (사망용) */
function rotateBuffer(buf, deg) {
  const out = new Uint8ClampedArray(buf.length);
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const dx = x - ROT_PIVOT.x + 0.5, dy = y - ROT_PIVOT.y + 0.5;
      const sx = dx * cos + dy * sin + ROT_PIVOT.x;
      const sy = -dx * sin + dy * cos + ROT_PIVOT.y;
      const cx = Math.floor(sx), cy = Math.floor(sy);
      if (cx < 0 || cx >= SPRITE_W || cy < 0 || cy >= SPRITE_H) continue;
      const si = (cy * SPRITE_W + cx) * 4;
      if (buf[si + 3] === 0) continue;
      const di = (y * SPRITE_W + x) * 4;
      out[di] = buf[si]; out[di + 1] = buf[si + 1]; out[di + 2] = buf[si + 2]; out[di + 3] = buf[si + 3];
    }
  }
  return out;
}

/** 프레임 버퍼를 아틀라스 ImageData 에 복사 (dx/dy 평행이동 + alpha, white=실루엣) */
function blitFrame(dst, atlasW, buf, ox, dx, dy, alpha, white) {
  for (let y = 0; y < SPRITE_H; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= SPRITE_H) continue;
    for (let x = 0; x < SPRITE_W; x++) {
      const si = (y * SPRITE_W + x) * 4;
      const sa = buf[si + 3];
      if (!sa) continue;
      const tx = x + dx;
      if (tx < 0 || tx >= SPRITE_W) continue;
      const di = (ty * atlasW + ox + tx) * 4;
      if (white) { dst[di] = 255; dst[di + 1] = 255; dst[di + 2] = 255; }
      else { dst[di] = buf[si]; dst[di + 1] = buf[si + 1]; dst[di + 2] = buf[si + 2]; }
      dst[di + 3] = alpha >= 1 ? sa : Math.round(sa * alpha);
    }
  }
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('spritegen: 캔버스를 만들 수 없는 환경 (buildSprite 는 브라우저 전용)');
}

/** 레시피 -> 캐시 키 */
export function spriteKey(recipe = {}) {
  const n = partNames(recipe);
  const p = recipe.palette || {};
  return [
    n.body, n.head, n.hair, n.helm, n.armor, n.cape, n.arm, n.leg, n.weapon, n.offhand,
    p.skin || 'pale', p.hair || 'brown', p.metal || 'iron', p.cloth || 'ash',
    p.leather || 'brown', p.accent || 'gold', p.glow || 'none',
  ].join('|');
}

/**
 * 레시피로 프레임 아틀라스를 만든다.
 * @returns {{canvas:any, flash:any, w:number, h:number, frames:Record<string,{sx:number,sy:number}>, key:string}}
 */
export function buildSprite(recipe = {}) {
  const parts = resolveParts(recipe);
  const pal = makePalette(recipe.palette || {});
  const tbl = colorTable(pal);
  const tblBack = shadeTable(tbl, 0.68);
  const tblCape = shadeTable(tbl, 0.86);

  const atlasW = SPRITE_W * FRAMES.length;
  const canvas = makeCanvas(atlasW, SPRITE_H);
  const flash = makeCanvas(atlasW, SPRITE_H);
  const ctx = canvas.getContext('2d');
  const fctx = flash.getContext('2d');
  const img = ctx.createImageData(atlasW, SPRITE_H);
  const fimg = fctx.createImageData(atlasW, SPRITE_H);

  const frames = {};
  for (let i = 0; i < FRAMES.length; i++) {
    const name = FRAMES[i];
    const p = POSES[name] || POSES.idle0;
    let buf = composeFrame(parts, tbl, tblBack, tblCape, p);
    if (p.rot) buf = rotateBuffer(buf, p.rot);
    const ox = i * SPRITE_W;
    blitFrame(img.data, atlasW, buf, ox, p.dx, p.dy, p.alpha, false);
    blitFrame(fimg.data, atlasW, buf, ox, p.dx, p.dy, p.alpha, true);
    frames[name] = { sx: ox, sy: 0 };
  }
  ctx.putImageData(img, 0, 0);
  fctx.putImageData(fimg, 0, 0);

  return { canvas, flash, w: SPRITE_W, h: SPRITE_H, frames, key: spriteKey(recipe) };
}

/**
 * 스프라이트 캐시.
 *
 * ★★ **상한이 있어야 한다.** 아틀라스 한 장이 SPRITE_W×SPRITE_H×24프레임 이고
 *   기본·발광 두 장을 들고 있다. 32×40 시절엔 한 벌에 약 0.25MB 라 무제한이어도 티가 안 났지만
 *   64×80(SCALE=2)이 되면서 **4배인 약 1MB** 가 됐다 — 적 외형까지 쌓이면 수백 벌이라
 *   휴대폰에서 먼저 죽는다. 여기서 막는다 (HANDOFF §50).
 *
 * ★ 버리는 순서는 **가장 오래 안 쓴 것**(LRU). Map 은 넣은 순서를 지키므로
 *   꺼낼 때 다시 넣어 «최근» 으로 올리면 별도 자료구조 없이 LRU 가 된다.
 */
const spriteCache = new Map();

/** 대략 1MB × 이 값 = 최대 캔버스 메모리. 한 판에 등장하는 외형 수보다 넉넉하다. */
export const SPRITE_CACHE_MAX = 120;

/** 캐시된 스프라이트 조회 (없으면 생성) */
export function getSprite(recipe = {}) {
  const key = spriteKey(recipe);
  const hit = spriteCache.get(key);
  if (hit) {
    spriteCache.delete(key); spriteCache.set(key, hit);   // 최근 쓴 것으로 올린다
    return hit;
  }
  const s = buildSprite(recipe);
  spriteCache.set(key, s);
  while (spriteCache.size > SPRITE_CACHE_MAX) {
    const oldest = spriteCache.keys().next().value;
    spriteCache.delete(oldest);
  }
  return s;
}

export function clearSpriteCache() { spriteCache.clear(); }
export const spriteCacheSize = () => spriteCache.size;

/** 단색 실루엣 캔버스 (스프라이트별 캐시) */
function tintedCanvas(sprite, color) {
  if (!sprite._tints) sprite._tints = new Map();
  let c = sprite._tints.get(color);
  if (!c) {
    c = makeCanvas(sprite.canvas.width, sprite.canvas.height);
    const g = c.getContext('2d');
    g.drawImage(sprite.flash, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    sprite._tints.set(color, c);
  }
  return c;
}

/**
 * 렌더러/UI 공용 단일 진입점. (x, y) 는 **발 밑 중앙**(지면 접점).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} sprite getSprite() 결과
 * @param {string} frame FRAMES 중 하나
 */
export function drawSpriteFrame(ctx, sprite, frame, x, y, opts = {}) {
  if (!sprite) return;
  const { scale = 3, flip = false, flash = 0, alpha = 1, tint = null } = opts;
  const f = sprite.frames[frame] || sprite.frames.idle0;
  if (!f) return;
  /* ★★ `scale` 은 **논리 픽셀(32×40 기준) 하나가 화면에서 몇 px 인가** 다 — 아틀라스 픽셀이 아니다.
   *   부르는 쪽은 전부 `16 * scale, 38 * scale` 처럼 논리 좌표로 자리를 잡는다.
   *   해상도를 올렸다고 여기서 그대로 곱하면 스프라이트만 SCALE 배로 커져 판이 다 어긋난다.
   *   그래서 화면 크기는 그대로 두고 **같은 자리에 더 촘촘히** 그린다. */
  const px = scale / SCALE;                 // 아틀라스 픽셀 하나가 화면에서 몇 px 인가
  const dw = SPRITE_W * px, dh = SPRITE_H * px;
  const ox = -Math.round(dw / 2), oy = -FOOT_Y * px;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  if (flip) ctx.scale(-1, 1);
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite.canvas, f.sx, f.sy, SPRITE_W, SPRITE_H, ox, oy, dw, dh);

  if (tint) {
    const color = typeof tint === 'string' ? tint : tint.color;
    const amount = typeof tint === 'string' ? 0.5 : (tint.amount == null ? 0.5 : tint.amount);
    if (color && amount > 0) {
      ctx.globalAlpha = alpha * Math.min(1, amount);
      ctx.drawImage(tintedCanvas(sprite, color), f.sx, f.sy, SPRITE_W, SPRITE_H, ox, oy, dw, dh);
    }
  }
  if (flash > 0) {
    ctx.globalAlpha = alpha * Math.min(1, flash);
    ctx.drawImage(sprite.flash, f.sx, f.sy, SPRITE_W, SPRITE_H, ox, oy, dw, dh);
  }
  ctx.restore();
}
