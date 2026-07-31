// 전투 화면 렌더러. SPEC §6.
//
//  - 브라우저 전용(Canvas 2D). 엔진/데이터는 건드리지 않고 "읽기"만 한다.
//  - 필드 좌표(가로 100 x 세로 60) -> 화면 픽셀 변환은 f2x/f2y 가 담당한다.
//  - 스스로 루프를 돌리지 않는다. 외부에서 update(dtReal) / draw() 를 호출한다.
//    (편의용 start()/stop() 도 제공한다)
//  - 배경은 정적이므로 한 번만 그려 오프스크린 캔버스에 캐시한다.
import { clamp, lerp, TAU } from '../core/util.js';
import { RNG } from '../core/rng.js';
import { GRADE_COLOR } from '../art/palette.js';
import { getSprite, drawSpriteFrame, FOOT_Y } from '../art/spritegen.js';
import { createFxSystem } from '../art/fx.js';
import { getSkill } from '../data/skills.js';

/** 스프라이트 확대 배율 (SPEC §4.1) */
export const SPRITE_SCALE = 3;
const FIELD_W = 100;
const FIELD_H = 60;
const FONT = '"Pretendard","Malgun Gothic","맑은 고딕",system-ui,sans-serif';

/**
 * 폰트 문자열은 캐시해 둔다.
 * `ctx.font = \`bold 12px ${FONT}\`` 처럼 매 프레임 조립하면 문자열 할당 + CSS 폰트 파싱이
 * 프레임당 수십 번 일어난다. 유닛 14기 × (이름·레벨) + 데미지 숫자까지 더하면 무시할 수 없다.
 *
 * ★ 모바일 대응으로 오버레이 글자 크기가 **가변**이 됐다(uiScale). 그래서 고정 상수 대신
 *   (굵기, 크기) 캐시로 바꿨다 — 배율이 몇 종류든 문자열은 한 번만 만들어진다.
 */
const fontCache = new Map();
function fnt(weight, size) {
  const px = Math.max(8, Math.round(size));
  const k = `${weight}|${px}`;
  let f = fontCache.get(k);
  if (!f) { f = weight ? `${weight} ${px}px ${FONT}` : `${px}px ${FONT}`; fontCache.set(k, f); }
  return f;
}
/** 오버레이 기준 글자 크기(px). uiScale = 1 이면 예전 상수와 완전히 같은 문자열이 나온다. */
const FS_NAME = 12;
const FS_LV = 10;
const FS_TIME = 14;
const FS_SPEED = 12;
const FS_BANNER = 13;
const FS_BUBBLE = 12;
const FS_ENDSUB = 13;
const FS_ENDING = 62;

const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);
const EASE_IN = (t) => t * t * t;
const hashStr = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };

function hex2rgb(h) {
  let s = String(h).replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** 두 색 사이 보간. 원경 대기 원근(멀수록 하늘색에 가까워짐)에 쓴다. */
function mix(a, b, t, alpha = 1) {
  const A = hex2rgb(a), B = hex2rgb(b);
  const c = [0, 1, 2].map((i) => Math.round(lerp(A[i], B[i], t)));
  return alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

const STAT_KO = { hp: '체력', atk: '공격력', def: '방어력', res: '저항', spd: '속도', crit: '치명', critDmg: '치명피해', eva: '회피' };

/** tint 인자용 재사용 객체 — 유닛마다 매 프레임 새 객체를 만들 이유가 없다 */
const TINT_DOT = { color: '#9be04a', amount: 0.26 };
const TINT_FLASH = { color: '#ffffff', amount: 1 };

/* ────────────────────────────────────────────── 바이옴 테마 */

/** 지역별 색/실루엣 구성 (하늘 3단 그라디언트 + 원경 2겹 + 지면 3단) */
const THEMES = {
  plains: {
    sky: ['#25355c', '#5a7aa8', '#c3b184'], sun: '#ffe6ae', sunY: 0.30,
    ground: ['#6a7444', '#48512a', '#2a2f18'],
    far: { k: 'hills', amp: 58 }, near: { k: 'conifers', n: 10, h: 70 },
    farCol: '#4a5a78', nearCol: '#26301f', amb: 'pollen', ambN: 24,
  },
  forest: {
    sky: ['#1d3348', '#3f6b6a', '#9ab07a'], sun: '#e8f0c0', sunY: 0.26,
    ground: ['#4a5c34', '#33401f', '#1d2412'],
    far: { k: 'conifers', n: 30, h: 80 }, near: { k: 'conifers', n: 12, h: 128 },
    farCol: '#2f4a4a', nearCol: '#16240f', amb: 'leaf', ambN: 22,
  },
  mountain: {
    sky: ['#2a2f52', '#5f6a92', '#b6b3c0'], sun: '#fff2d8', sunY: 0.22,
    ground: ['#5d5f68', '#43444e', '#26262e'],
    far: { k: 'peaks', h: 156, snow: true }, near: { k: 'peaks', h: 82 },
    farCol: '#525a7a', nearCol: '#2e3242', amb: 'snow', ambN: 22,
  },
  desert: {
    sky: ['#4a3a66', '#a5714e', '#e6bb7a'], sun: '#ffd98a', sunY: 0.34,
    ground: ['#c2a066', '#96794a', '#5e4b2c'],
    far: { k: 'dunes', amp: 50 }, near: { k: 'ruins', n: 7, h: 100 },
    farCol: '#8a6b4a', nearCol: '#4d3a26', amb: 'dust', ambN: 28,
  },
  swamp: {
    sky: ['#1c2a2a', '#3d5145', '#7c8a63'], sun: '#c8d69a', sunY: 0.28,
    ground: ['#454f36', '#333c28', '#1d2318'],
    far: { k: 'deadTrees', n: 16, h: 104 }, near: { k: 'reeds', n: 70, h: 48 },
    farCol: '#2b3a34', nearCol: '#17201a', amb: 'spore', ambN: 20,
  },
  coast: {
    sky: ['#1f3a63', '#4d84ad', '#cfd8c8'], sun: '#fff0c4', sunY: 0.24,
    ground: ['#a9a179', '#7f7a58', '#4c4a35'],
    far: { k: 'sea' }, near: { k: 'rocks', n: 11, h: 64 },
    farCol: '#3f6c94', nearCol: '#2c3340', amb: 'mist', ambN: 16,
  },
  tundra: {
    sky: ['#2c3a60', '#6e82a8', '#d3dbe6'], sun: '#eef4ff', sunY: 0.20,
    ground: ['#b9c2cf', '#8e97a8', '#5a6070'],
    far: { k: 'peaks', h: 138, snow: true }, near: { k: 'deadTrees', n: 11, h: 84 },
    farCol: '#5d6d92', nearCol: '#3a4258', amb: 'snow', ambN: 46,
  },
  cave: {
    sky: ['#0d0b14', '#1c1826', '#332a3c'], sun: null, sunY: 0,
    ground: ['#4c4360', '#342d44', '#1c1826'],
    far: { k: 'stalac', n: 18, h: 118 }, near: { k: 'stalag', n: 13, h: 92 },
    farCol: '#241f30', nearCol: '#171320', amb: 'ember', ambN: 20,
  },
};
const themeOf = (b) => THEMES[b] || THEMES.plains;

/* ────────────────────────────────────────────── 애니메이션 클립 */

const CLIPS = {
  atk: [['atk0', 0.10], ['atk1', 0.07], ['atk2', 0.09], ['atk3', 0.11]],
  shoot: [['shoot0', 0.14], ['shoot1', 0.09], ['shoot2', 0.12]],
  cast: [['cast0', 0.16], ['cast1', 0.22], ['cast2', 0.14]],
  hit: [['hit0', 0.17]],
  die: [['die0', 0.13], ['die1', 0.13], ['die2', 0.14], ['die3', 0.60]],
};
const IDLE = ['idle0', 'idle1', 'idle2', 'idle3'];
const WALK = ['walk0', 'walk1', 'walk2', 'walk3'];

function clipFrame(clip, t) {
  let acc = 0;
  for (let i = 0; i < clip.length; i++) {
    acc += clip[i][1];
    if (t < acc) return clip[i][0];
  }
  return null; // 끝
}
const clipLen = (clip) => clip.reduce((a, f) => a + f[1], 0);

/* ────────────────────────────────────────────── 배경 그리기 */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * 화면 전체를 덮는 정적 오버레이(비네트·가장자리 펄스)를 오프스크린에 굽는다.
 *
 * **성능상 핵심이다.** 그라디언트를 매 프레임 `fillRect` 로 칠하면 픽셀마다 그라디언트를
 * 평가해야 해서 전체 화면 한 장에 수 ms 가 든다(실측 dpr2 에서 비네트 5.6ms · 펄스 4.6ms
 * = 프레임의 54%). 한 번 구워서 `drawImage` 로 blit 하면 같은 그림이 1.1ms 로 떨어진다.
 * 장치 픽셀 1:1 로 굽기 때문에 확대/축소 샘플링도 일어나지 않는다.
 */
function bakeOverlay(w, h, dprv, paint) {
  const c = makeCanvas(w * dprv, h * dprv);
  const g = c.getContext('2d');
  g.setTransform(dprv, 0, 0, dprv, 0, 0);
  paint(g);
  return c;
}

/** 부드러운 방사형 광채 스프라이트 (shadowBlur 대체용). 지름 = size, hex = '#rrggbb' */
function bakeGlow(size, hex, peak = 0.85, inner = 0.16) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const r = size / 2;
  const rgb = hex2rgb(hex);
  const rgba = (al) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${al})`;
  const grd = g.createRadialGradient(r, r, r * inner, r, r, r);
  grd.addColorStop(0, rgba(peak));
  grd.addColorStop(0.45, rgba(peak * 0.42));
  grd.addColorStop(1, rgba(0));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

function hills(g, R, W, baseY, amp, col) {
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(-30, baseY + 400);
  g.lineTo(-30, baseY);
  let x = -30;
  while (x < W + 40) {
    const w = R.float(110, 240), h = R.float(amp * 0.35, amp);
    g.quadraticCurveTo(x + w * 0.5, baseY - h, x + w, baseY - R.float(0, amp * 0.22));
    x += w;
  }
  g.lineTo(W + 40, baseY + 400);
  g.closePath();
  g.fill();
}

function dunes(g, R, W, baseY, amp, col) {
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(-30, baseY + 400);
  g.lineTo(-30, baseY);
  let x = -30;
  while (x < W + 40) {
    const w = R.float(200, 380), h = R.float(amp * 0.4, amp);
    g.bezierCurveTo(x + w * 0.35, baseY - h, x + w * 0.6, baseY - h * 0.9, x + w, baseY - R.float(0, amp * 0.15));
    x += w;
  }
  g.lineTo(W + 40, baseY + 400);
  g.closePath();
  g.fill();
}

function peaks(g, R, W, baseY, h, col, snow) {
  const tips = [];
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(-40, baseY + 400);
  g.lineTo(-40, baseY);
  let x = -40;
  while (x < W + 60) {
    const w = R.float(130, 280), ph = R.float(h * 0.45, h);
    const mid = x + w * 0.5;
    // 살짝 꺾인 능선
    g.lineTo(mid - w * 0.16, baseY - ph * 0.62);
    g.lineTo(mid, baseY - ph);
    tips.push({ x: mid, y: baseY - ph, w: w * 0.34 });
    g.lineTo(mid + w * 0.2, baseY - ph * 0.55);
    g.lineTo(x + w, baseY - R.float(0, h * 0.16));
    x += w;
  }
  g.lineTo(W + 60, baseY + 400);
  g.closePath();
  g.fill();
  if (snow) {
    g.fillStyle = 'rgba(232,238,248,.62)';
    for (const t of tips) {
      g.beginPath();
      g.moveTo(t.x, t.y);
      g.lineTo(t.x + t.w * 0.55, t.y + t.w * 0.85);
      g.lineTo(t.x + t.w * 0.18, t.y + t.w * 0.6);
      g.lineTo(t.x - t.w * 0.2, t.y + t.w * 0.95);
      g.lineTo(t.x - t.w * 0.55, t.y + t.w * 0.7);
      g.closePath();
      g.fill();
    }
  }
}

function conifers(g, R, W, baseY, h, col, n) {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const x = R.float(-30, W + 30);
    const hh = h * R.float(0.62, 1.18);
    const w = hh * R.float(0.34, 0.46);
    const yb = baseY + R.float(-4, 8);
    g.fillRect(x - Math.max(1, w * 0.07), yb - hh * 0.24, Math.max(2, w * 0.14), hh * 0.26);
    for (let k = 0; k < 3; k++) {
      const t = k / 3;
      const ty = yb - hh * (0.2 + t * 0.62);
      const tw = w * (1 - t * 0.42);
      g.beginPath();
      g.moveTo(x, ty - hh * 0.34);
      g.lineTo(x + tw * 0.5, ty);
      g.lineTo(x - tw * 0.5, ty);
      g.closePath();
      g.fill();
    }
  }
}

function deadTrees(g, R, W, baseY, h, col, n) {
  g.strokeStyle = col;
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = R.float(-20, W + 20);
    const hh = h * R.float(0.6, 1.2);
    const yb = baseY + R.float(-3, 9);
    g.lineWidth = Math.max(2, hh * 0.05);
    g.beginPath();
    g.moveTo(x, yb);
    g.lineTo(x + R.float(-6, 6), yb - hh * 0.55);
    g.lineTo(x + R.float(-10, 10), yb - hh);
    g.stroke();
    g.lineWidth = Math.max(1.2, hh * 0.028);
    for (let k = 0; k < 3; k++) {
      const by = yb - hh * R.float(0.4, 0.92);
      const d = R.chance(0.5) ? 1 : -1;
      g.beginPath();
      g.moveTo(x + R.float(-4, 4), by);
      g.lineTo(x + d * R.float(12, 30), by - R.float(6, 22));
      g.stroke();
    }
  }
}

function reeds(g, R, W, baseY, h, col, n) {
  g.strokeStyle = col;
  g.lineWidth = 2;
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = R.float(-10, W + 10);
    const hh = h * R.float(0.5, 1.25);
    const bend = R.float(-9, 9);
    g.beginPath();
    g.moveTo(x, baseY + R.float(0, 10));
    g.quadraticCurveTo(x + bend * 0.5, baseY - hh * 0.6, x + bend, baseY - hh);
    g.stroke();
  }
}

function ruins(g, R, W, baseY, h, col, n) {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const x = R.float(-20, W + 20);
    const hh = h * R.float(0.4, 1.1);
    const w = R.float(14, 30);
    const yb = baseY + R.float(-2, 10);
    g.fillRect(x, yb - hh, w, hh);
    // 부서진 윗면
    g.beginPath();
    g.moveTo(x, yb - hh);
    g.lineTo(x + w * 0.35, yb - hh - R.float(4, 14));
    g.lineTo(x + w * 0.72, yb - hh - R.float(0, 8));
    g.lineTo(x + w, yb - hh);
    g.closePath();
    g.fill();
    if (R.chance(0.35)) { // 무너진 아치
      const aw = R.float(26, 46);
      g.beginPath();
      g.moveTo(x + w, yb - hh * 0.9);
      g.quadraticCurveTo(x + w + aw * 0.5, yb - hh * 1.25, x + w + aw, yb - hh * 0.55);
      g.lineTo(x + w + aw, yb - hh * 0.35);
      g.quadraticCurveTo(x + w + aw * 0.5, yb - hh * 1.05, x + w, yb - hh * 0.7);
      g.closePath();
      g.fill();
    }
  }
}

function rocks(g, R, W, baseY, h, col, n) {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const x = R.float(-20, W + 20);
    const hh = h * R.float(0.35, 1.1);
    const w = hh * R.float(0.9, 1.8);
    g.beginPath();
    g.moveTo(x - w * 0.5, baseY + 6);
    g.lineTo(x - w * 0.32, baseY - hh * 0.6);
    g.lineTo(x - w * 0.05, baseY - hh);
    g.lineTo(x + w * 0.3, baseY - hh * 0.72);
    g.lineTo(x + w * 0.5, baseY + 6);
    g.closePath();
    g.fill();
  }
}

function sea(g, R, W, baseY, col) {
  const grd = g.createLinearGradient(0, baseY - 40, 0, baseY + 26);
  grd.addColorStop(0, col);
  grd.addColorStop(1, '#1d3f5c');
  g.fillStyle = grd;
  g.fillRect(-10, baseY - 40, W + 20, 70);
  g.strokeStyle = 'rgba(220,238,255,.28)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) {
    const y = baseY - R.float(0, 36);
    const x = R.float(-10, W);
    const w = R.float(16, 60);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke();
  }
}

function stalag(g, R, W, baseY, h, col, n) {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const x = R.float(-20, W + 20);
    const hh = h * R.float(0.4, 1.15);
    const w = hh * R.float(0.24, 0.42);
    g.beginPath();
    g.moveTo(x - w * 0.5, baseY + 10);
    g.lineTo(x + R.float(-3, 3), baseY - hh);
    g.lineTo(x + w * 0.5, baseY + 10);
    g.closePath();
    g.fill();
  }
}

function stalac(g, R, W, topY, h, col, n) {
  g.fillStyle = col;
  g.fillRect(-10, -10, W + 20, topY + 12);
  for (let i = 0; i < n; i++) {
    const x = R.float(-20, W + 20);
    const hh = h * R.float(0.35, 1.1);
    const w = hh * R.float(0.2, 0.4);
    g.beginPath();
    g.moveTo(x - w * 0.5, topY);
    g.lineTo(x + R.float(-3, 3), topY + hh);
    g.lineTo(x + w * 0.5, topY);
    g.closePath();
    g.fill();
  }
}

function silhouette(g, spec, R, W, baseY, col) {
  switch (spec.k) {
    case 'hills': hills(g, R, W, baseY, spec.amp, col); break;
    case 'dunes': dunes(g, R, W, baseY, spec.amp, col); break;
    case 'peaks': peaks(g, R, W, baseY, spec.h, col, spec.snow); break;
    case 'conifers': conifers(g, R, W, baseY, spec.h, col, spec.n); break;
    case 'deadTrees': deadTrees(g, R, W, baseY, spec.h, col, spec.n); break;
    case 'reeds': reeds(g, R, W, baseY, spec.h, col, spec.n); break;
    case 'ruins': ruins(g, R, W, baseY, spec.h, col, spec.n); break;
    case 'rocks': rocks(g, R, W, baseY, spec.h, col, spec.n); break;
    case 'sea': sea(g, R, W, baseY, col); break;
    case 'stalag': stalag(g, R, W, baseY, spec.h, col, spec.n); break;
    case 'stalac': stalac(g, R, W, baseY - 30, spec.h, col, spec.n); break;
    default: break;
  }
}

const ROCKY = { desert: 1, coast: 1, cave: 1, mountain: 1, tundra: 1 };

/** 지면 얼룩 (넓은 색 편차) — 밋밋한 그라디언트를 깨준다 */
function groundMottle(g, R, th, W, H, top) {
  for (let i = 0; i < 26; i++) {
    const t = R.float(0, 1);
    const y = lerp(top, H + 20, t);
    const x = R.float(-60, W + 60);
    const rx = lerp(60, 260, t), ry = lerp(8, 44, t);
    g.fillStyle = R.chance(0.5)
      ? mix(th.ground[2], '#000000', 0.25, 0.14)
      : mix(th.ground[0], '#ffffff', 0.18, 0.09);
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, TAU);
    g.fill();
  }
}

/** 지면 잡티 (풀포기/자갈/뼈). 원근에 따라 아래쪽일수록 커진다. */
function groundDetail(g, R, biome, th, W, H, gy0) {
  const rocky = !!ROCKY[biome];
  const light = mix(th.ground[0], '#ffffff', 0.32);
  const dark = mix(th.ground[2], '#000000', 0.3);
  for (let i = 0; i < 190; i++) {
    const t = R.float(0, 1);
    const y = lerp(gy0 - 34, H + 10, t * t * 0.55 + t * 0.45);
    const x = R.float(-14, W + 14);
    const s = lerp(1.2, 5.6, t);
    if (rocky) {
      g.fillStyle = R.chance(0.55) ? mix(th.ground[2], '#000000', 0.35, 0.5) : mix(th.ground[0], '#ffffff', 0.25, 0.4);
      g.beginPath();
      g.ellipse(x, y, s * 1.5, s * 0.62, R.float(-0.4, 0.4), 0, TAU);
      g.fill();
    } else {
      // 풀포기: 어두운 밑동 + 밝은 잎
      g.strokeStyle = R.chance(0.62) ? dark : light;
      g.globalAlpha = lerp(0.28, 0.6, t);
      g.lineWidth = Math.max(1, s * 0.34);
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x - s * 0.75, y - s * 1.5);
      g.moveTo(x, y); g.lineTo(x + s * 0.15, y - s * 2.1);
      g.moveTo(x, y); g.lineTo(x + s * 0.85, y - s * 1.3);
      g.stroke();
      g.globalAlpha = 1;
    }
  }
  // 굵직한 지물 몇 개 (바위/통나무/뼈)
  for (let i = 0; i < 9; i++) {
    const t = R.float(0.25, 1);
    const y = lerp(gy0 - 20, H, t);
    const x = R.float(0, W);
    const s = lerp(7, 20, t);
    g.fillStyle = mix(th.ground[2], '#000000', 0.4);
    g.beginPath();
    g.ellipse(x, y + s * 0.22, s * 1.25, s * 0.4, 0, 0, TAU);
    g.fill();
    g.fillStyle = rocky ? mix(th.ground[1], '#ffffff', 0.22) : mix(th.ground[2], '#5a4a34', 0.5);
    g.beginPath();
    g.moveTo(x - s, y + s * 0.2);
    g.lineTo(x - s * 0.6, y - s * 0.55);
    g.lineTo(x + s * 0.1, y - s * 0.75);
    g.lineTo(x + s * 0.85, y - s * 0.3);
    g.lineTo(x + s, y + s * 0.2);
    g.closePath();
    g.fill();
    g.fillStyle = mix(th.ground[0], '#ffffff', 0.34, 0.55);
    g.beginPath();
    g.ellipse(x - s * 0.2, y - s * 0.45, s * 0.36, s * 0.16, -0.3, 0, TAU);
    g.fill();
  }
}

/**
 * 배경을 캔버스 밖까지 조금 더 그려두는 여백(px).
 * (예전엔 화면 흔들림 때 가장자리가 비지 않게 하려는 용도였다. 흔들림은 제거했지만
 *  배경 그라디언트/실루엣이 가장자리에서 잘려 보이지 않도록 여백은 그대로 둔다)
 */
const BG_PAD = 16;

/** 정적 배경을 오프스크린 캔버스에 굽는다 (여백 포함, 장치 픽셀 1:1) */
function bakeBackdrop(W, H, dpr, biome, horizonY, gy0) {
  const th = themeOf(biome);
  const c = makeCanvas((W + BG_PAD * 2) * dpr, (H + BG_PAD * 2) * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.translate(BG_PAD, BG_PAD);
  const R = new RNG(hashStr(`bg:${biome}`) || 7);

  // 하늘
  const sky = g.createLinearGradient(0, 0, 0, horizonY + 10);
  sky.addColorStop(0, th.sky[0]);
  sky.addColorStop(0.62, th.sky[1]);
  sky.addColorStop(1, th.sky[2]);
  g.fillStyle = sky;
  g.fillRect(-BG_PAD, -BG_PAD, W + BG_PAD * 2, horizonY + 12 + BG_PAD);

  // 별 / 태양
  if (biome === 'cave') {
    g.fillStyle = 'rgba(160,140,220,.16)';
    for (let i = 0; i < 40; i++) g.fillRect(R.float(0, W), R.float(0, horizonY), 2, 2);
  } else {
    if (th.sun) {
      const sy = horizonY * th.sunY;
      const sx = W * 0.74;
      const gl = g.createRadialGradient(sx, sy, 4, sx, sy, 150);
      gl.addColorStop(0, th.sun);
      gl.addColorStop(0.18, 'rgba(255,236,180,.35)');
      gl.addColorStop(1, 'rgba(255,236,180,0)');
      g.fillStyle = gl;
      g.beginPath(); g.arc(sx, sy, 150, 0, TAU); g.fill();
      g.fillStyle = th.sun;
      g.beginPath(); g.arc(sx, sy, 17, 0, TAU); g.fill();
    }
    // 구름 띠
    g.fillStyle = 'rgba(255,255,255,.07)';
    for (let i = 0; i < 14; i++) {
      const y = R.float(horizonY * 0.15, horizonY * 0.9);
      const x = R.float(-60, W);
      const w = R.float(90, 280), h = R.float(6, 16);
      g.beginPath(); g.ellipse(x, y, w * 0.5, h * 0.5, 0, 0, TAU); g.fill();
    }
  }

  // 원경 실루엣 2겹 — 먼 층일수록 하늘색에 섞어 대기 원근을 준다
  silhouette(g, th.far, R, W, horizonY + 6, th.far.k === 'sea' ? th.farCol : mix(th.farCol, th.sky[2], 0.42));
  silhouette(g, th.near, R, W, horizonY + 30, mix(th.nearCol, th.sky[2], 0.10));

  // 지면
  const gTop = horizonY + 10;
  const grd = g.createLinearGradient(0, gTop, 0, H);
  grd.addColorStop(0, mix(th.ground[0], th.sky[2], 0.34));
  grd.addColorStop(0.16, th.ground[0]);
  grd.addColorStop(0.5, th.ground[1]);
  grd.addColorStop(1, th.ground[2]);
  g.fillStyle = grd;
  g.fillRect(-BG_PAD, gTop, W + BG_PAD * 2, H - gTop + BG_PAD);
  groundMottle(g, R, th, W, H, gTop);

  // 지평선 안개 (하늘/지면 경계를 부드럽게)
  const haze = g.createLinearGradient(0, horizonY - 22, 0, horizonY + 40);
  haze.addColorStop(0, mix(th.sky[2], '#ffffff', 0.2, 0));
  haze.addColorStop(0.45, mix(th.sky[2], '#ffffff', 0.35, biome === 'cave' ? 0.10 : 0.20));
  haze.addColorStop(1, mix(th.sky[2], '#ffffff', 0.2, 0));
  g.fillStyle = haze;
  g.fillRect(-BG_PAD, horizonY - 22, W + BG_PAD * 2, 62);

  groundDetail(g, R, biome, th, W, H, gy0);

  // 진영 구분: 아주 옅은 중앙 띠
  const mid = g.createLinearGradient(W * 0.5 - 90, 0, W * 0.5 + 90, 0);
  mid.addColorStop(0, 'rgba(0,0,0,0)');
  mid.addColorStop(0.5, 'rgba(0,0,0,.10)');
  mid.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mid;
  g.fillRect(W * 0.5 - 90, horizonY + 18, 180, H - horizonY - 18);

  return c;
}

/* ────────────────────────────────────────────── 렌더러 */

/**
 * 전투 렌더러 생성.
 * @param {HTMLCanvasElement} canvas
 * @param {{width?:number,height?:number,biome?:string}} opts
 */
export function createRenderer(canvas, { width = 1280, height = 560, biome = 'plains' } = {}) {
  if (!canvas || !canvas.getContext) throw new Error('renderer: 캔버스가 필요합니다');
  const ctx = canvas.getContext('2d', { alpha: false });

  let W = width, H = height;
  let dpr = 1;
  let horizonY = 0, GY0 = 0, GY1 = 0, GX0 = 0, GX1 = 0;
  let backdrop = null;
  let vignette = null;          // 구워진 비네트 (오프스크린 캔버스)
  const edgeSprites = new Map(); // 가장자리 펄스 색 -> 구워진 오버레이 (알파 1 기준)
  let hudStrip = null;           // 상단 HUD 그라디언트 띠 (구워 둔 오버레이)
  /** 미리 구운 방사형 광채 (shadowBlur 대체). 종류가 서너 개뿐이라 캐시가 작다. */
  const glows = new Map();
  function glowSprite(size, hex, peak, inner) {
    const k = `${size}|${hex}|${peak}|${inner}`;
    let s = glows.get(k);
    if (!s) { s = bakeGlow(size, hex, peak, inner); glows.set(k, s); }
    return s;
  }
  let curBiome = biome;

  const fx = createFxSystem();
  const R = new RNG(0xb17e5); // 연출용 난수 (전투 결정론과 무관)

  let battle = null;
  const vis = new Map();     // uid -> 시각 상태
  const order = [];          // 깊이 정렬용 캐시 (매 프레임 재사용한다)

  let speed = 1;
  let paused = false;

  /* ── 타격감 노브 ───────────────────────────────────────
     **화면 전체를 움직이는 연출은 하나도 쓰지 않는다.**
     흔들림·줌 펀치·카메라 이동·회전 전부 없다 (플레이어가 눈이 아프다고 했다).
     대신 전부 "국소" 연출이다: 시간 정지 / 유닛 플래시 / 유닛 스케일 펀치 /
     넉백 / 충격파 링 / 데미지 숫자 펀치 / 무기 궤적 / 가장자리 색 펄스. */

  /**
   * 히트스톱(초). 시간이 멈추는 것이 타격감의 핵심이지만 **드물어야** 효과가 산다.
   *
   * 예전에는 일반 타격에도 45ms, 치명타에 110ms 를 걸었다. 7대7에서는 피해 이벤트가
   * 초당 예닐곱 번 들어오므로 **재생 시간의 30% 가까이가 3프레임짜리 정지로 잘려 나갔고**,
   * 플레이어는 이걸 "프레임 드랍되는 느낌"으로 느꼈다. 렌더러가 느린 게 아니라
   * 일부러 멈추고 있었던 것이다(프레임당 렌더 비용은 예산 16.7ms 중 6ms 수준).
   *
   * 그래서 일반 타격에서는 정지를 아예 뺐다. 플래시·스케일 펀치·넉백·충격파 링만으로도
   * 타격은 충분히 읽힌다. 정지는 치명타와 처치처럼 "드물고 중요한 순간"에만 남긴다.
   */
  const HITSTOP = 0;
  const HITSTOP_CRIT = 0.07;
  /**
   * 히트스톱 최소 간격(초). 치명타가 몰리면 정지가 연달아 걸려 다시 끊겨 보인다.
   * 마지막 정지로부터 이 시간이 지나기 전에는 새 정지를 걸지 않는다.
   */
  const HITSTOP_GAP = 0.25;
  /** 피격 플래시 지속(초) = 프레임 수 / 60 */
  const FLASH_HIT = 2 / 60;
  const FLASH_CRIT = 4 / 60;
  const FLASH_DEATH = 6 / 60;
  /** 치명타 플래시 색 (일반 피격은 흰 실루엣) */
  const FLASH_CRIT_COL = '#ffe66a';
  /** 넉백 스프링 (탄성 복귀) */
  const KB_STIFF = 420;
  const KB_DAMP = 15;
  /** 가장자리 펄스 색: 아군 피해는 붉게, 적이 크게 맞으면 금색 */
  const EDGE_ALLY = '#ff4a38';
  const EDGE_ENEMY = '#ffcf5a';

  let hitstop = 0;
  /** 마지막으로 정지를 건 시각(렌더러 누적 시간). 정지가 연달아 겹치는 것을 막는다. */
  let lastStopAt = -999;
  /**
   * 배속이 높을수록 정지가 상대적으로 길어지므로 배속으로 나눈다.
   * `HITSTOP_GAP` 안에 이미 정지를 걸었다면 무시한다 — 정지가 연쇄되면
   * 그 자체가 프레임 드랍처럼 보인다(플레이어가 실제로 그렇게 느꼈다).
   */
  const stopFor = (s) => {
    if (!(s > 0)) return;
    if (animT - lastStopAt < HITSTOP_GAP) return;
    lastStopAt = animT;
    hitstop = Math.max(hitstop, s / Math.max(1, speed));
  };

  /** 가장자리 비네트 펄스 (테두리 색만 변한다. 화면은 절대 움직이지 않는다) */
  let edge = 0;
  let edgeCol = EDGE_ALLY;
  const pulseEdge = (v, col) => { if (v >= edge) { edge = Math.min(1, v); edgeCol = col; } };

  /**
   * 승패가 갈린 뒤 결과 화면으로 넘어가기 전에 붙잡아 두는 시간(초).
   * 엔진은 승패가 결정되는 순간 finished 를 세우지만, 화면에서는 아직 마지막 타격과
   * 사망 연출, 승리 텍스트가 재생 중이다. 이걸 안 기다리면 "전투가 다 끝나기도 전에
   * 화면이 끝난다"는 상태가 된다.
   */
  const SETTLE_HOLD = 1.5;
  let simTime = 0;
  let animT = 0;             // 연출용 누적 시간 (배속 반영)
  let ending = null;         // {winner, t}
  const pops = [];           // 데미지/회복 숫자
  const ambient = [];
  const logFns = [];
  const endFns = [];
  let raf = 0, lastTs = 0;

  /* ── 오버레이 배율 (모바일 대응) ─────────────────────────
     캔버스는 CSS 로 화면 폭에 맞춰 축소된다(`width:100%`). 논리 폭 W 가 그대로여도
     폰에서는 표시 폭이 절반 이하로 줄어 **이름표·HP 바·데미지 숫자가 안 읽힌다.**
     그래서 표시 폭에 맞춰 오버레이만 키운다. 유닛 스프라이트는 건드리지 않는다
     (스프라이트를 키우면 진형 간격보다 커져 서로 겹치고, 픽셀아트 배율도 깨진다). */

  /** 오버레이 확대 배율. 1 = PC 기준(예전과 완전히 동일한 그림) */
  let uiScale = 1;
  /** true 면 표시 폭을 보고 스스로 정한다. `setUiScale(n)` 을 부르면 꺼진다. */
  let uiAuto = true;
  /** 표시 폭 재확인 간격용 누적 시간 — 매 프레임 clientWidth 를 읽으면 강제 리플로우가 난다 */
  let uiCheckT = 0;
  let lastClientW = -1;
  /** 배율 상한. 더 키우면 바·글자가 유닛 간격을 넘어 서로 가린다 */
  const UI_MAX = 2.2;

  /** 표시 폭 기준 자동 배율. 논리 1px 이 화면에서 0.5 CSS px 면 글자를 2배로 키운다. */
  function autoUiScale() {
    const cw = (canvas && canvas.clientWidth) || 0;
    if (!(cw > 0) || !(W > 0)) return uiScale;
    return clamp(0.95 / (cw / W), 1, UI_MAX);
  }

  function applyUiScale(n) {
    const v = clamp(Number(n) || 1, 0.6, 3);
    if (Math.abs(v - uiScale) < 0.01) return uiScale;
    uiScale = v;
    // 이름표는 구워 두는 스프라이트다 — 배율이 바뀌면 전부 다시 구워야 한다
    for (const vv of vis.values()) { vv.plate = null; vv.plateLv = -1; }
    return uiScale;
  }

  function syncUiScale(force) {
    if (!uiAuto) return uiScale;
    const cw = (canvas && canvas.clientWidth) || 0;
    if (!force && cw === lastClientW) return uiScale;
    lastClientW = cw;
    return applyUiScale(autoUiScale());
  }

  /* ── 지오메트리 ─────────────────────────────────────── */
  function layout() {
    const real = Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    dpr = Math.min(real, 2);
    // 표시 폭이 논리 폭보다 한참 작으면(폰) 장치 픽셀보다 큰 버퍼를 만들 이유가 없다.
    // 오히려 픽셀아트를 축소 샘플링해 뭉개진다 — 표시 폭 기준으로 버퍼를 맞춘다.
    // 기준을 넉넉히(0.8배) 잡아, 캔버스가 거의 등배로 보이는 PC 에서는 예전 값이 그대로 유지된다.
    const cw = (canvas && canvas.clientWidth) || 0;
    if (cw > 0 && W > 0) {
      const fit = (cw * real) / W;
      if (fit < dpr * 0.8) dpr = clamp(fit, 1, 2);
    }
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.imageRendering = 'pixelated';
    horizonY = Math.round(H * 0.36);
    GY0 = Math.round(H * 0.44);   // 필드 y=0 (가장 뒤)
    GY1 = Math.round(H * 0.985);  // 필드 y=60 (가장 앞)
    GX0 = Math.round(Math.min(90, W * 0.06));
    GX1 = W - GX0;
    backdrop = bakeBackdrop(W, H, dpr, curBiome, horizonY, GY0);
    // 비네트는 모양이 변하지 않는다 — 한 번 굽고 매 프레임 blit 한다 (위 bakeOverlay 주석 참조)
    vignette = bakeOverlay(W, H, dpr, (g) => {
      const vg = g.createRadialGradient(W * 0.5, H * 0.48, H * 0.34, W * 0.5, H * 0.5, H * 0.95);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,.55)');
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    });
    edgeSprites.clear();
    // 상단 HUD 그라디언트 띠도 정적이다 — 구워서 blit 한다
    hudStrip = bakeOverlay(W, 64, dpr, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, 'rgba(6,5,10,.62)');
      gr.addColorStop(1, 'rgba(6,5,10,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, 64);
    });
    // dpr/크기가 바뀌면 구워 둔 이름표는 해상도가 맞지 않는다 — 다시 굽게 한다
    for (const v of vis.values()) { v.plate = null; v.plateLv = -1; }
    lastClientW = -1;
    syncUiScale(true);   // 표시 폭이 바뀌었을 수 있다 (회전·창 크기 변경)
    seedAmbient();
  }

  const f2x = (fx0) => GX0 + (fx0 / FIELD_W) * (GX1 - GX0);
  const f2y = (fy0) => GY0 + (fy0 / FIELD_H) * (GY1 - GY0);

  /* ── 환경 파티클 ───────────────────────────────────── */
  function seedAmbient() {
    ambient.length = 0;
    const th = themeOf(curBiome);
    for (let i = 0; i < (th.ambN || 20); i++) ambient.push(newAmb(th.amb, true));
  }
  function newAmb(kind, anywhere) {
    const a = { kind, x: R.float(-20, W + 20), y: anywhere ? R.float(0, H) : -10, ph: R.float(0, TAU) };
    switch (kind) {
      case 'snow': a.vx = R.float(-16, 8); a.vy = R.float(22, 52); a.s = R.float(1.4, 3); a.al = R.float(0.4, 0.9); break;
      case 'leaf': a.vx = R.float(-34, -8); a.vy = R.float(16, 38); a.s = R.float(2, 4); a.al = R.float(0.3, 0.7); break;
      case 'dust': a.vx = R.float(-70, -24); a.vy = R.float(-4, 10); a.s = R.float(1, 2.6); a.al = R.float(0.15, 0.4); break;
      case 'ember': a.vx = R.float(-10, 10); a.vy = R.float(-34, -12); a.s = R.float(1.2, 2.6); a.al = R.float(0.35, 0.85); a.y = anywhere ? R.float(0, H) : H + 10; break;
      case 'spore': a.vx = R.float(-8, 8); a.vy = R.float(-18, -5); a.s = R.float(1.4, 3.2); a.al = R.float(0.2, 0.5); a.y = anywhere ? R.float(0, H) : H + 10; break;
      case 'mist': a.vx = R.float(-26, -8); a.vy = R.float(-2, 3); a.s = R.float(20, 60); a.al = R.float(0.05, 0.12); break;
      default: a.vx = R.float(-12, 12); a.vy = R.float(-14, -3); a.s = R.float(1, 2.4); a.al = R.float(0.2, 0.5); a.y = anywhere ? R.float(0, H) : H + 10; break;
    }
    return a;
  }
  function updateAmbient(dt) {
    for (let i = 0; i < ambient.length; i++) {
      const a = ambient[i];
      a.ph += dt * 2.4;
      a.x += (a.vx + Math.sin(a.ph) * (a.kind === 'leaf' ? 26 : 8)) * dt;
      a.y += a.vy * dt;
      if (a.x < -70 || a.x > W + 70 || a.y < -40 || a.y > H + 40) ambient[i] = newAmb(a.kind, false);
    }
  }
  function drawAmbient(g) {
    for (const a of ambient) {
      g.globalAlpha = a.al;
      if (a.kind === 'mist') {
        g.fillStyle = '#cfe0ee';
        g.beginPath(); g.ellipse(a.x, a.y, a.s, a.s * 0.28, 0, 0, TAU); g.fill();
      } else if (a.kind === 'ember') {
        g.fillStyle = '#ff9a3a';
        g.fillRect(a.x, a.y, a.s, a.s);
      } else if (a.kind === 'leaf') {
        g.fillStyle = '#7f9c4a';
        g.save(); g.translate(a.x, a.y); g.rotate(a.ph);
        g.beginPath(); g.ellipse(0, 0, a.s, a.s * 0.5, 0, 0, TAU); g.fill();
        g.restore();
      } else if (a.kind === 'spore') {
        g.fillStyle = '#b8d68a';
        g.beginPath(); g.arc(a.x, a.y, a.s, 0, TAU); g.fill();
      } else if (a.kind === 'dust') {
        g.fillStyle = '#e0cfa8';
        g.fillRect(a.x, a.y, a.s * 2, a.s * 0.8);
      } else {
        g.fillStyle = '#eaf2ff';
        g.fillRect(a.x, a.y, a.s, a.s);
      }
    }
    g.globalAlpha = 1;
  }

  /* ── 전투 연결 ─────────────────────────────────────── */
  function setBattle(b, opts = {}) {
    battle = b || null;
    vis.clear();
    pops.length = 0;
    fx.clear();
    ending = null;
    hitstop = 0; edge = 0; lastStopAt = -999;
    simTime = 0; animT = 0;
    const nb = opts.biome || (b && (b.biome || (b.cfg && b.cfg.biome))) || curBiome;
    if (nb !== curBiome) { curBiome = nb; layout(); }
    if (!battle) return;
    let i = 0;
    for (const u of battle.units) vis.set(u.uid, makeVis(u, i++));
    order.length = 0;
    for (const u of battle.units) order.push(u);
  }

  function setBiome(b) {
    if (!b || b === curBiome) return;
    curBiome = b;
    layout();
  }

  function makeVis(u, i) {
    return {
      u,
      sprite: null,
      hpCur: u.hp, hpGhost: u.hp, ghostWait: 0,
      state: 'idle', clip: null, clipT: 0,
      idleOff: (i * 0.37) % 1,
      ox: 0, oy: 0,
      kx: 0, ky: 0, kvx: 0, kvy: 0,   // 넉백 오프셋 + 스프링 속도
      flashT: 0, flashCol: null,       // 피격 실루엣 플래시 (남은 시간 / 색, null = 흰색)
      punchT: 0, punchDur: 0.12, punchAmp: 0, // 스케일 펀치
      swung: false,                    // 이번 스윙에서 무기 궤적을 이미 뿌렸는가
      lunge: null, meleeWait: 0,
      bubble: null, alpha: 1,
      dieT: -1, gone: false,
      popN: 0, popT: -9,
      ringT: 0,
      // 이름표 스프라이트 캐시 (drawPlate 가 처음 그릴 때 굽는다. uiScale 이 바뀌면 무효화된다)
      plate: null, plateLv: -1, plateW: 0, plateH: 0, platePad: 0, plateTop: 0, plateAnchor: 0,
    };
  }

  /* ── 타격 반응 (전부 유닛 하나에만 적용된다) ─────────── */

  /** 흰(또는 지정색) 실루엣 플래시 */
  function setFlash(v, dur, col) {
    if (dur >= v.flashT) { v.flashT = dur; v.flashCol = col || null; }
  }
  /** 스케일 펀치 — 맞는 순간 부풀었다가 punchDur 에 걸쳐 1.0으로 복귀 */
  function setPunch(v, amp, dur) {
    v.punchAmp = amp; v.punchDur = dur; v.punchT = dur;
  }
  /** 넉백 — 즉시 밀어내고 스프링이 탄성 있게 되돌린다 */
  function setKnock(v, dx, dy) {
    v.kx = dx; v.ky = dy; v.kvx = 0; v.kvy = 0;
  }
  /** 현재 스케일 배율 (1.0 = 원래 크기) */
  function punchScale(v) {
    if (v.punchT <= 0 || v.punchAmp <= 0) return 1;
    const p = clamp(v.punchT / v.punchDur, 0, 1);
    return 1 + v.punchAmp * (p * p * (3 - 2 * p)); // smoothstep 감쇠
  }
  /** 넉백 스프링 적분 (배속이 커도 터지지 않도록 고정 스텝으로 쪼갠다) */
  function springKnock(v, dt) {
    if (!v.kx && !v.ky && !v.kvx && !v.kvy) return;
    let rem = Math.min(dt, 0.12);
    while (rem > 1e-4) {
      const h = Math.min(rem, 1 / 120);
      v.kvx += -v.kx * KB_STIFF * h;
      v.kvy += -v.ky * KB_STIFF * h;
      const d = Math.max(0, 1 - KB_DAMP * h);
      v.kvx *= d; v.kvy *= d;
      v.kx += v.kvx * h; v.ky += v.kvy * h;
      rem -= h;
    }
    if (Math.abs(v.kx) < 0.1 && Math.abs(v.kvx) < 1) { v.kx = 0; v.kvx = 0; }
    if (Math.abs(v.ky) < 0.1 && Math.abs(v.kvy) < 1) { v.ky = 0; v.kvy = 0; }
  }
  /** 무기 궤적 — 근접 스윙이 지나간 자리에 호 잔상을 남긴다 */
  function weaponTrail(v) {
    const d = facing(v.u);
    fx.spawn('trail', posX(v) + d * 6, chestY(v) + 6, { dir: d, scale: 1 });
  }

  const spriteOf = (v) => (v.sprite || (v.sprite = getSprite(v.u.recipe || {})));
  const homeX = (u) => f2x(u.x);
  const homeY = (u) => f2y(u.y);
  const facing = (u) => (u.side === 'ally' ? 1 : -1);
  const posX = (v) => homeX(v.u) + v.ox + v.kx;
  const posY = (v) => homeY(v.u) + v.oy + v.ky;
  const chestY = (v) => posY(v) - FOOT_Y * SPRITE_SCALE * 0.55;
  const headTop = (v) => posY(v) - FOOT_Y * SPRITE_SCALE;

  /* ── 로그 ──────────────────────────────────────────── */
  function log(text) {
    if (!text) return;
    for (const fn of logFns) { try { fn(text); } catch (e) { console.error(e); } }
  }
  const nameOf = (uid) => {
    const u = battle && battle.unitOf ? battle.unitOf(uid) : null;
    return u ? u.name : '?';
  };

  /* ── 이벤트 소비 ───────────────────────────────────── */
  function consume(events) {
    for (const e of events) {
      switch (e.type) {
        case 'act': onAct(e); break;
        case 'lunge': onLunge(e); break;
        case 'proj': onProj(e); break;
        case 'damage': onDamage(e); break;
        case 'heal': onHeal(e); break;
        case 'miss': onMiss(e); break;
        case 'buff': onBuff(e); break;
        case 'status': onStatus(e); break;
        case 'death': onDeath(e); break;
        case 'end': onEnd(e); break;
        default: break;
      }
    }
  }

  function play(v, name) {
    if (v.dieT >= 0) return;
    v.clip = CLIPS[name] || null;
    v.clipT = 0;
    v.swung = false;
  }

  function onAct(e) {
    const v = vis.get(e.uid);
    if (!v || v.dieT >= 0) return;
    const u = v.u;
    const sk = e.skillId ? getSkill(e.skillId) : null;
    if (sk) {
      v.bubble = { text: sk.name || e.skillId, t: 0, dur: 1.05 };
      log(`${u.name} — ${sk.name || e.skillId}`);
    }
    const range = sk ? (sk.range || 'melee') : (u.basicRange === 'ranged' ? 'ranged' : 'melee');
    const support = sk ? (sk.target === 'self' || sk.target === 'ally' || sk.target === 'allAlly') : false;
    const magic = sk ? (sk.dmgType === 'magic' || !sk.dmgType || sk.dmgType === 'none') : (u.basicDmgType === 'magic');
    if (support) play(v, 'cast');
    else if (range === 'melee') { v.meleeWait = 0.07; }      // lunge 이벤트를 잠깐 기다린다
    else play(v, magic ? 'cast' : 'shoot');
  }

  function onLunge(e) {
    const v = vis.get(e.uid);
    const t = vis.get(e.targetUid);
    if (!v || !t || v.dieT >= 0) return;
    v.meleeWait = 0;
    const d = facing(v.u);
    const tx = homeX(t.u) - d * 62;
    const ty = homeY(t.u);
    v.lunge = { t: 0, out: 0.25, hold: 0.13, back: 0.32, dx: tx - homeX(v.u), dy: ty - homeY(v.u) };
    v.clip = null;
    fx.spawn('dust', posX(v), posY(v), { dir: d, count: 5 });
  }

  function onProj(e) {
    const v = vis.get(e.uid);
    const t = vis.get(e.targetUid);
    if (!v || !t) return;
    const d = facing(v.u);
    const from = { x: posX(v) + d * 20, y: posY(v) - 66 };
    const to = { x: posX(t), y: chestY(t) };
    // 엔진이 예약한 명중 시각과 비행 시간을 맞춘다 (필드 거리 / 필드 속도)
    const fd = Math.hypot(t.u.x - v.u.x, t.u.y - v.u.y);
    const dur = clamp(fd / (e.speed || 110), 0.08, 0.7);
    const dist = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    fx.projectile(e.fx || 'arrow', from, to, { speed: dist / dur, impact: false });
  }

  function onDamage(e) {
    const t = vis.get(e.targetUid);
    if (!t) return;
    const src = e.uid != null ? vis.get(e.uid) : null;
    const dir = src ? facing(src.u) : -facing(t.u);
    const crit = !!e.crit;

    // ① 피격 유닛 플래시 — 일반은 흰 실루엣 2프레임, 치명타는 노란 실루엣 4프레임
    setFlash(t, crit ? FLASH_CRIT : FLASH_HIT, crit ? FLASH_CRIT_COL : null);
    // ② 스케일 펀치 — 맞는 유닛 하나만 부푼다. 화면은 그대로다.
    setPunch(t, crit ? 0.26 : 0.18, crit ? 0.16 : 0.12);
    // ③ 넉백 — 크게 밀리고 스프링으로 되튀며 복귀
    setKnock(t, -dir * (crit ? 14 : 7), crit ? -5 : -1.5);
    t.ghostWait = 0.42;
    if (t.dieT < 0 && !t.lunge) play(t, 'hit');

    const cx = posX(t), cy = chestY(t);
    fx.spawn(e.fx || 'hit', cx, cy, { dir, crit, scale: crit ? 1.35 : 1 });
    // ④ 국소 임팩트 + 충격파 링 (치명타는 이중 링 + 방사형 스파이크)
    fx.spawn('impact', cx, cy, { dir, crit });
    fx.spawn('shockwave', cx, cy, { dir, crit, scale: crit ? 1.15 : 0.9 });

    // ⑤ 데미지 숫자 펀치
    addPop(t, `${Math.round(e.amount)}`, crit ? '#ffd24a' : '#ffe4e4', crit ? 1.6 : 1, crit);

    // ⑥ 히트스톱 — 화면 흔들림을 대신하는 주 연출.
    //    정지 중에는 update() 가 통째로 멈추므로 파티클도 함께 얼어붙는다.
    stopFor(crit ? HITSTOP_CRIT : HITSTOP);
    // ⑦ 가장자리 펄스 — 테두리 색만 밝아진다 (화면은 움직이지 않는다)
    if (crit) {
      const ally = t.u.side === 'ally';
      pulseEdge(ally ? 0.9 : 0.7, ally ? EDGE_ALLY : EDGE_ENEMY);
    }

    const who = e.uid != null ? `${nameOf(e.uid)} → ` : '';
    log(`${who}${nameOf(e.targetUid)} ${Math.round(e.amount)} 피해${crit ? ' (치명타!)' : ''}`);
  }

  function onHeal(e) {
    const t = vis.get(e.targetUid);
    if (!t) return;
    fx.spawn('heal', posX(t), posY(t) - 8, { dir: facing(t.u) });
    addPop(t, `+${Math.round(e.amount)}`, '#7ff0a0', 1.05, false);
    log(`${e.uid != null ? `${nameOf(e.uid)} → ` : ''}${nameOf(e.targetUid)} ${Math.round(e.amount)} 회복`);
  }

  function onMiss(e) {
    const t = vis.get(e.targetUid);
    if (!t) return;
    addPop(t, '빗나감', '#cfd4e0', 0.92, false);
    fx.spawn('dust', posX(t), posY(t), { dir: -facing(t.u), count: 4 });
    log(`${nameOf(e.targetUid)} 회피!`);
  }

  function onBuff(e) {
    const t = vis.get(e.targetUid);
    if (!t) return;
    const up = (e.amount || 0) >= 0;
    t.ringT = Math.max(t.ringT, 0.9);
    fx.spawn('buff', posX(t), posY(t), { dir: facing(t.u), color: up ? '#ffd24a' : '#b06fd6' });
    addPop(t, `${STAT_KO[e.stat] || e.stat} ${up ? '▲' : '▼'}`, up ? '#ffe08a' : '#d6a8ff', 0.86, false);
    log(`${nameOf(e.targetUid)} ${STAT_KO[e.stat] || e.stat} ${up ? '증가' : '감소'}`);
  }

  function onStatus(e) {
    const t = vis.get(e.targetUid);
    if (!t) return;
    if (e.status === 'stun') {
      addPop(t, '기절', '#ffe08a', 0.95, false);
      fx.spawn('blunt', posX(t), chestY(t), { dir: facing(t.u), scale: 0.7 });
      log(`${nameOf(e.targetUid)} 기절 (${(e.dur || 1).toFixed(1)}초)`);
    } else if (e.status === 'shield') {
      t.ringT = Math.max(t.ringT, 0.8);
      fx.spawn('holy', posX(t), chestY(t), { dir: facing(t.u), scale: 0.8 });
      log(`${nameOf(e.targetUid)} 보호막`);
    } else if (e.status === 'dot') {
      fx.spawn('poison', posX(t), chestY(t), { dir: facing(t.u), scale: 0.7 });
      log(`${nameOf(e.targetUid)} 지속 피해`);
    }
  }

  function onDeath(e) {
    const t = vis.get(e.targetUid);
    if (!t) return;
    t.dieT = 0;
    t.clip = CLIPS.die;
    t.clipT = 0;
    t.lunge = null;
    t.bubble = null;
    // 처치 연출: 흰 실루엣으로 한 번 번쩍인 뒤 파편이 흩어지며 페이드
    setFlash(t, FLASH_DEATH, null);
    setPunch(t, 0.22, 0.18);
    fx.spawn('shatter', posX(t), posY(t), { dir: facing(t.u) });
    fx.spawn('death', posX(t), posY(t), { dir: facing(t.u) });
    stopFor(0.05);
    const ally = t.u.side === 'ally';
    pulseEdge(ally ? 1 : 0.8, ally ? EDGE_ALLY : EDGE_ENEMY);
    log(`${t.u.name} 쓰러짐`);
  }

  function onEnd(e) {
    ending = { winner: e.winner, t: 0 };
    pulseEdge(0.8, e.winner === 'ally' ? EDGE_ENEMY : EDGE_ALLY);
    const txt = e.winner === 'ally' ? '승리' : e.winner === 'enemy' ? '패배' : '무승부';
    log(`── 전투 종료: ${txt} ──`);
    for (const fn of endFns) { try { fn(e.winner); } catch (err) { console.error(err); } }
  }

  /**
   * 동시에 떠 있을 수 있는 숫자 팝업 상한.
   * 원래 상한이 없었다 — 광역기가 겹치면 외곽선 텍스트가 수십 개씩 쌓여 프레임이 튄다.
   * 넘치면 가장 오래된 것부터 걷어낸다(어차피 사라지기 직전이다).
   */
  const MAX_POPS = 28;

  function addPop(v, text, color, size, crit) {
    if (animT - v.popT < 0.42) v.popN = Math.min(v.popN + 1, 3);
    else v.popN = 0;
    v.popT = animT;
    if (pops.length >= MAX_POPS) pops.splice(0, pops.length - MAX_POPS + 1);
    pops.push({
      x: posX(v) + R.float(-8, 8),
      y: chestY(v) - 12 - v.popN * 15,
      vx: R.float(-16, 16), vy: -92 - (crit ? 34 : 0),
      life: crit ? 1.15 : 0.92, max: crit ? 1.15 : 0.92,
      text, color, size, crit, born: 0,
      // 튀어나오듯 커진 상태에서 1.0으로 줄어든다. 치명타는 더 크게 + 살짝 기울인다.
      pop0: crit ? 2.1 : 1.7, popDur: crit ? 0.15 : 0.12,
      rot: crit ? R.float(-0.17, -0.07) : 0,
    });
  }

  /* ── 갱신 ──────────────────────────────────────────── */
  /**
   * @param {object} v 시각 상태
   * @param {number} dt 배속이 반영된 시뮬 시간
   * @param {number} dr 실제 경과 시간 — 플래시/펀치는 "몇 프레임"이 기준이라 실시간을 쓴다
   *                    (배속을 올려도 눈에 보여야 한다)
   */
  function updateUnit(v, dt, dr) {
    const u = v.u;

    // HP 바 (즉시 바 + 지연 고스트 바)
    v.hpCur += (u.hp - v.hpCur) * Math.min(1, dt * 16);
    if (Math.abs(v.hpCur - u.hp) < 0.6) v.hpCur = u.hp;
    if (v.hpGhost > u.hp) {
      v.ghostWait -= dt;
      if (v.ghostWait <= 0) v.hpGhost = Math.max(u.hp, v.hpGhost - u.maxHp * 0.9 * dt - 1);
    } else if (v.hpGhost < u.hp) {
      v.hpGhost += (u.hp - v.hpGhost) * Math.min(1, dt * 10);
    }

    if (v.flashT > 0) { v.flashT = Math.max(0, v.flashT - dr); if (!v.flashT) v.flashCol = null; }
    if (v.punchT > 0) v.punchT = Math.max(0, v.punchT - dr);
    if (v.ringT > 0) v.ringT = Math.max(0, v.ringT - dt);
    springKnock(v, dt);

    if (v.bubble) { v.bubble.t += dt; if (v.bubble.t >= v.bubble.dur) v.bubble = null; }
    if (v.meleeWait > 0) {
      v.meleeWait -= dt;
      if (v.meleeWait <= 0 && !v.lunge && v.dieT < 0) play(v, 'atk');
    }

    // 사망
    if (v.dieT >= 0) {
      v.dieT += dt;
      const len = clipLen(CLIPS.die);
      v.alpha = v.dieT <= len - 0.35 ? 1 : clamp(1 - (v.dieT - (len - 0.35)) / 0.55, 0, 1);
      if (v.alpha <= 0.01) v.gone = true;
      v.lunge = null;
      return;
    }

    // 돌진
    if (v.lunge) {
      const L = v.lunge;
      L.t += dt;
      const total = L.out + L.hold + L.back;
      if (L.t >= total) {
        v.lunge = null; v.ox = 0; v.oy = 0;
      } else if (L.t < L.out) {
        const p = EASE_OUT(L.t / L.out);
        v.ox = L.dx * p; v.oy = L.dy * p;
        if (!L.dusted && L.t > L.out * 0.9) { L.dusted = true; fx.spawn('dust', posX(v), posY(v), { dir: facing(v.u), count: 4 }); }
      } else if (L.t < L.out + L.hold) {
        v.ox = L.dx; v.oy = L.dy;
        // 무기가 지나간 자리에 호 잔상
        if (!L.swung && L.t > L.out + L.hold * 0.2) { L.swung = true; weaponTrail(v); }
      } else {
        const p = EASE_IN((L.t - L.out - L.hold) / L.back);
        v.ox = L.dx * (1 - p); v.oy = L.dy * (1 - p);
      }
      return;
    }
    v.ox += (0 - v.ox) * Math.min(1, dt * 12);
    v.oy += (0 - v.oy) * Math.min(1, dt * 12);

    // 일반 클립
    if (v.clip) {
      v.clipT += dt;
      // 제자리 근접 스윙에도 궤적을 붙인다 (돌진 없이 때리는 경우)
      if (v.clip === CLIPS.atk && !v.swung && v.clipT >= 0.10) { v.swung = true; weaponTrail(v); }
      if (v.clipT >= clipLen(v.clip)) v.clip = null;
    }
  }

  function frameOf(v) {
    if (v.dieT >= 0) return clipFrame(CLIPS.die, v.dieT) || 'die3';
    if (v.lunge) {
      const L = v.lunge;
      if (L.t < L.out * 0.62) return WALK[Math.floor(L.t / 0.062) % 4];
      if (L.t < L.out) return 'atk0';
      if (L.t < L.out + L.hold * 0.55) return 'atk1';
      if (L.t < L.out + L.hold) return 'atk2';
      if (L.t < L.out + L.hold + 0.10) return 'atk3';
      return WALK[3 - (Math.floor((L.t - L.out - L.hold) / 0.07) % 4)];
    }
    if (v.clip) {
      const f = clipFrame(v.clip, v.clipT);
      if (f) return f;
    }
    if (battle && v.u.stunUntil > battle.time) return 'hit0';
    return IDLE[Math.floor((animT * 4.2 + v.idleOff * 4)) % 4];
  }

  function updatePops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      p.life -= dt;
      p.born += dt;
      if (p.life <= 0) { pops.splice(i, 1); continue; }
      p.vy += 210 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /**
   * 프레임 갱신.
   * @param {number} dtReal 실제 경과 시간(초)
   */
  function update(dtReal) {
    const dr = clamp(dtReal || 0, 0, 0.05);
    if (hitstop > 0) {
      // 히트스톱: 시뮬·유닛·파티클·데미지 숫자가 통째로 얼어붙는다.
      // "멈춰야 얼어붙는 느낌이 산다" — 여기서 return 하는 것이 그 구현이다.
      hitstop -= dr;
      if (edge > 0) edge = Math.max(0, edge - dr * 1.2); // 정지 중엔 테두리도 거의 유지
      return;
    }
    const dt = dr * speed;
    animT += dt;

    // 표시 폭이 바뀌면(회전·창 크기) 오버레이 배율을 다시 잡는다.
    // clientWidth 읽기는 강제 리플로우라 매 프레임 하지 않고 0.4초마다만 확인한다.
    uiCheckT += dr;
    if (uiCheckT >= 0.4) { uiCheckT = 0; syncUiScale(false); }

    if (battle && !paused) {
      if (!battle.finished) battle.step(dt);
      const evs = battle.drainEvents ? battle.drainEvents() : [];
      if (evs.length) consume(evs);
      simTime = battle.time;
    }

    for (const v of vis.values()) { if (!v.gone) updateUnit(v, dt, dr); }
    fx.update(dt);
    updatePops(dt);
    updateAmbient(dr);

    if (edge > 0) edge = Math.max(0, edge - dr * 3.2);
    if (ending) ending.t += dr;
  }

  /* ── 그리기 ────────────────────────────────────────── */
  function text(g, s, x, y, { font = `12px ${FONT}`, color = '#e8e2d8', align = 'center', base = 'alphabetic', ow = 3, oc = 'rgba(8,6,12,.92)' } = {}) {
    g.font = font;
    g.textAlign = align;
    g.textBaseline = base;
    if (ow > 0) {
      g.lineJoin = 'round';
      g.lineWidth = ow;
      g.strokeStyle = oc;
      g.strokeText(s, x, y);
    }
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  function bar(g, x, y, w, h, ratio, color, bg = 'rgba(6,5,10,.78)') {
    g.fillStyle = bg;
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = color;
    g.fillRect(x, y, Math.max(0, Math.round(w * clamp(ratio, 0, 1))), h);
  }

  function drawShadow(g, v) {
    const x = posX(v), y = posY(v);
    const lift = clamp(1 - Math.abs(v.oy) / 60, 0.72, 1);
    g.globalAlpha = 0.40 * v.alpha * lift;
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(x, y + 1, 27 * lift, 8 * lift, 0, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
  }

  function drawGroundRing(g, v) {
    const u = v.u;
    const x = posX(v), y = posY(v);
    if (u.boss) {
      g.save();
      g.globalAlpha = 0.5 + Math.sin(animT * 2.4) * 0.12;
      g.strokeStyle = '#e0b44a';
      g.lineWidth = 2;
      g.beginPath(); g.ellipse(x, y + 1, 32, 10, 0, 0, TAU); g.stroke();
      g.restore();
    }
    if (u.buffs && u.buffs.length) {
      g.save();
      g.globalAlpha = 0.55;
      g.strokeStyle = u.buffs.some((b) => b.amount < 0) ? '#b06fd6' : '#ffd24a';
      g.lineWidth = 1.5;
      const a0 = animT * 1.6;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.ellipse(x, y + 1, 24, 7.5, 0, a0 + i * 2.1, a0 + i * 2.1 + 1.2);
        g.stroke();
      }
      g.restore();
    }
    if (v.ringT > 0) {
      const p = 1 - v.ringT / 0.9;
      g.save();
      g.globalAlpha = (1 - p) * 0.7;
      g.strokeStyle = '#ffe9a8';
      g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(x, y + 1, 12 + p * 32, 4 + p * 11, 0, 0, TAU); g.stroke();
      g.restore();
    }
  }

  function drawUnit(g, v) {
    const u = v.u;
    const sp = spriteOf(v);
    const x = posX(v), y = posY(v);
    let tint = (u.dots && u.dots.length) ? TINT_DOT : null;
    let flash = 0;
    if (v.flashT > 0) {
      // 치명타는 노란 실루엣(색 있는 tint), 일반/사망은 흰 실루엣(flash)
      if (v.flashCol) { TINT_FLASH.color = v.flashCol; tint = TINT_FLASH; }
      else flash = 1;
    }
    // 스케일 펀치는 발밑 기준으로 확대되므로 유닛이 제자리에서 부푼다 (화면은 그대로)
    drawSpriteFrame(g, sp, frameOf(v), x, y, {
      scale: SPRITE_SCALE * punchScale(v),
      flip: u.side === 'enemy',
      flash,
      alpha: v.alpha,
      tint,
    });
    // 보호막 막
    if (u.shield > 0 && v.dieT < 0) {
      g.save();
      g.globalAlpha = 0.22 + Math.sin(animT * 6) * 0.06;
      g.strokeStyle = '#a8e8f0';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(x, y - 58, 34, 62, 0, 0, TAU);
      g.stroke();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.08;
      g.fillStyle = '#5fb8e8';
      g.fill();
      g.restore();
    }
  }

  function drawStunStars(g, v) {
    const us = uiScale;
    const top = headTop(v) + 4;
    const x = posX(v);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = animT * 4.4 + (i * TAU) / 3;
      const sx = x + Math.cos(a) * 17 * us;
      const sy = top - 6 * us + Math.sin(a) * 5 * us;
      const s = (3.4 + Math.sin(a) * 1.1) * us;
      g.fillStyle = '#ffe08a';
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? s * 0.45 : s;
        const ang = (k / 10) * TAU - Math.PI / 2;
        const px = sx + Math.cos(ang) * rr, py = sy + Math.sin(ang) * rr;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /* 이름표 스프라이트 여백 (베이스라인 기준, uiScale = 1 일 때의 값) */
  const PLATE_PADX = 5;
  const PLATE_TOP = 15;
  const PLATE_H = 21;

  /**
   * 이름표(등급 점 + Lv + 이름)를 통째로 구워 둔다.
   *
   * 이 세 요소는 전투 내내 변하지 않는데(레벨만 예외) 원래는 매 프레임 유닛마다
   * `measureText` 1회 + **외곽선 있는 텍스트 2줄**을 새로 그렸다. 외곽선 텍스트는
   * 글리프 외곽 패스를 만들어 stroke 한 뒤 fill 하는 2패스라 14기 × 2줄이면 만만치 않다.
   * 한 번 굽고 `drawImage` 로 blit 하면 그림은 완전히 동일하고 비용만 사라진다.
   */
  function plateSprite(g, v) {
    if (v.plate && v.plateLv === v.u.level) return v.plate;
    const u = v.u;
    const us = uiScale;
    const label = `${u.boss ? '★ ' : ''}${u.name}`;
    const lvText = `Lv${u.level || 1}`;
    const fName = fnt('bold', FS_NAME * us);
    const fLv = fnt('', FS_LV * us);
    g.font = fName;
    const nw = g.measureText(label).width;
    const lw = 22 * us;
    const cw = 10 * us + lw + 3 * us + nw;       // startX 기준 실제 내용 폭
    // 가로 중심 기준은 예전 코드와 **완전히 같은 식**을 쓴다 (nw + lw + 12).
    // 여기를 cw 로 바꾸면 이름표가 1.5px 왼쪽으로 밀린다(픽셀 비교로 확인했다).
    v.plateAnchor = nw + lw + 12 * us;
    const padx = PLATE_PADX * us;
    const top = PLATE_TOP * us;
    const ph = Math.ceil(PLATE_H * us);
    const ow = 3 * us;
    const w = Math.ceil(cw + padx * 2);
    const c = makeCanvas(w * dpr, ph * dpr);
    const q = c.getContext('2d');
    q.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = padx;                              // 스프라이트 안에서의 startX
    const ny = top;                               // 스프라이트 안에서의 베이스라인
    q.beginPath();
    q.arc(sx + 3 * us, ny - 4 * us, 3.2 * us, 0, TAU);
    q.fillStyle = GRADE_COLOR[u.grade] || '#8a8a96';
    q.fill();
    q.strokeStyle = 'rgba(8,6,12,.9)';
    q.lineWidth = Math.max(1, us * 0.8);
    q.stroke();
    text(q, lvText, sx + 10 * us, ny, { font: fLv, color: '#bdb6c8', align: 'left', ow });
    text(q, label, sx + 10 * us + lw + 3 * us, ny, {
      font: fName, color: u.boss ? '#f0d24a' : (u.side === 'ally' ? '#e8e2d8' : '#e4c6c6'), align: 'left', ow,
    });
    v.plate = c;
    v.plateLv = u.level;
    v.plateW = w;
    v.plateH = ph;
    v.platePad = padx;
    v.plateTop = top;
    return c;
  }

  function drawPlate(g, v) {
    const u = v.u;
    const us = uiScale;
    const x = Math.round(posX(v));
    // 바 **폭**은 글자만큼 키우지 않는다 — 폰에서는 유닛 간격보다 넓어져 옆 유닛의 바를 가린다.
    // 두께와 글자는 그대로 키운다 (읽히는 게 목적이다).
    const bw = Math.round(58 * Math.min(us, 1.45));
    const bh = Math.max(6, Math.round(6 * us * 0.8));
    const by = Math.round(posY(v)) - 132 - Math.round((us - 1) * 8);
    const gy = by + bh + 2;
    const ny = by - Math.round(6 * us);

    // 이름 / 레벨 / 등급 점 / 보스 표식 — 구워 둔 스프라이트 한 장
    const plate = plateSprite(g, v);
    const startX = x - v.plateAnchor / 2;
    g.drawImage(plate, Math.round(startX - v.platePad), Math.round(ny - v.plateTop), v.plateW, v.plateH);

    // HP (지연 바 -> 현재 바 -> 보호막)
    const ratio = u.maxHp > 0 ? v.hpCur / u.maxHp : 0;
    const ghost = u.maxHp > 0 ? v.hpGhost / u.maxHp : 0;
    bar(g, x - bw / 2, by, bw, bh, 1, 'rgba(20,16,26,.85)', 'rgba(6,5,10,.85)');
    if (ghost > ratio) {
      g.fillStyle = 'rgba(240,120,120,.75)';
      g.fillRect(x - bw / 2, by, Math.round(bw * clamp(ghost, 0, 1)), bh);
    }
    const hpCol = u.side === 'ally'
      ? (ratio > 0.5 ? '#6fbe7a' : ratio > 0.22 ? '#d6b64a' : '#cf5a5a')
      : (ratio > 0.5 ? '#c9584f' : ratio > 0.22 ? '#c98a3a' : '#8e3a3a');
    g.fillStyle = hpCol;
    g.fillRect(x - bw / 2, by, Math.round(bw * clamp(ratio, 0, 1)), bh);
    if (u.shield > 0) {
      const sr = clamp(u.shield / u.maxHp, 0, 1);
      g.fillStyle = 'rgba(168,232,240,.85)';
      g.fillRect(x - bw / 2, by, Math.round(bw * sr), Math.max(2, Math.round(2 * us * 0.8)));
    }
    // 테두리
    g.strokeStyle = 'rgba(0,0,0,.6)';
    g.lineWidth = 1;
    g.strokeRect(x - bw / 2 - 0.5, by - 0.5, bw + 1, bh + 1);

    // 행동 게이지
    bar(g, x - bw / 2, gy, bw, Math.max(3, Math.round(3 * us * 0.8)),
      (u.gauge || 0) / 100, u.gauge >= 92 ? '#ffe9a8' : '#a8842a', 'rgba(6,5,10,.7)');
  }

  function drawBubble(g, v) {
    const b = v.bubble;
    if (!b) return;
    const us = uiScale;
    const p = b.t / b.dur;
    const a = p < 0.12 ? p / 0.12 : p > 0.78 ? clamp((1 - p) / 0.22, 0, 1) : 1;
    const pop = p < 0.12 ? 0.78 + 0.22 * (p / 0.12) : 1;
    const x = Math.round(posX(v));
    // 배율이 커지면 이름표도 함께 커진다 — 말풍선을 그만큼 더 띄워 겹치지 않게 한다
    const y = Math.round(posY(v)) - 152 - Math.round((us - 1) * 46);
    g.save();
    g.globalAlpha = a;
    g.translate(x, y);
    g.scale(pop * us, pop * us);
    g.font = fnt('bold', FS_BUBBLE);
    if (b.w == null) b.w = g.measureText(b.text).width + 18;   // 말풍선 폭은 한 번만 잰다
    const w = b.w;
    const h = 20;
    g.fillStyle = 'rgba(16,12,24,.9)';
    g.strokeStyle = v.u.side === 'ally' ? 'rgba(224,180,74,.85)' : 'rgba(168,58,74,.85)';
    g.lineWidth = 1.2;
    g.beginPath();
    const r = 5;
    g.moveTo(-w / 2 + r, -h);
    g.arcTo(w / 2, -h, w / 2, 0, r);
    g.arcTo(w / 2, 0, -w / 2, 0, r);
    g.arcTo(-w / 2, 0, -w / 2, -h, r);
    g.arcTo(-w / 2, -h, w / 2, -h, r);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(-4, 0); g.lineTo(0, 6); g.lineTo(4, 0);
    g.closePath();
    g.fill();
    g.fillStyle = '#f2e6c8';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(b.text, 0, -h / 2 + 1);
    g.restore();
  }

  /**
   * 데미지 숫자 — 튀어나오듯 크게 나타났다가 1.0으로 줄며 떠오른다.
   *
   * 치명타 광채에 `shadowBlur` 를 쓰지 않는다. 캔버스 2D에서 그림자 블러는 글리프를
   * 별도 표면에 그린 뒤 흐리는 2패스라 텍스트 한 줄에도 비싸고, 치명타가 몰리면
   * 프레임을 통째로 잡아먹는다. 미리 구운 방사형 광채를 뒤에 한 장 깔아 같은 인상을 낸다.
   */
  function drawPops(g) {
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      const t = p.life / p.max;
      const a = t > 0.55 ? 1 : t / 0.55;
      const dur = p.popDur || 0.12;
      const k = p.born < dur ? lerp(p.pop0 || 1.7, 1, EASE_OUT(clamp(p.born / dur, 0, 1))) : 1;
      const size = Math.round(15 * p.size * uiScale);
      g.save();
      g.globalAlpha = a;
      g.translate(p.x, p.y);
      if (p.rot) g.rotate(p.rot);
      g.scale(k, k);
      if (p.crit) {
        const gw = size * 3.4, gh = size * 2.2;
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = a * 0.75;
        g.drawImage(glowSprite(64, '#ffaa28', 0.85, 0.16), -gw / 2, -gh / 2 - size * 0.34, gw, gh);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = a;
      }
      text(g, p.text, 0, 0, {
        font: fnt(p.crit ? '900' : 'bold', size),
        color: p.color, align: 'center',
        ow: p.crit ? 5 : 3.4,
        oc: p.crit ? 'rgba(74,26,4,.95)' : 'rgba(8,6,12,.92)',
      });
      g.restore();
    }
  }

  /**
   * 가장자리 비네트 펄스. **테두리 색만 밝아진다 — 화면은 움직이지 않는다.**
   * 아군이 크게 맞으면 붉게, 적이 치명타를 맞으면 금색.
   */
  /**
   * 색별 가장자리 오버레이를 굽는다 (알파 1 기준).
   * 원래 그라디언트는 정지점 알파가 전부 `a` 에 정비례하므로(0 / 0.10a / 0.5a),
   * 알파 1로 구워 두고 `globalAlpha = a` 로 그리면 **수학적으로 완전히 동일한 결과**다.
   * 색은 EDGE_ALLY/EDGE_ENEMY 둘뿐이라 캐시도 최대 2장이다.
   */
  function edgeSprite(col) {
    let s = edgeSprites.get(col);
    if (s) return s;
    const c = hex2rgb(col);
    const rgba = (al) => `rgba(${c[0]},${c[1]},${c[2]},${al})`;
    s = bakeOverlay(W, H, dpr, (g) => {
      const grd = g.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.30, W * 0.5, H * 0.5, Math.max(W, H) * 0.62);
      grd.addColorStop(0, rgba(0));
      grd.addColorStop(0.6, rgba(0.10));
      grd.addColorStop(1, rgba(0.5));
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    });
    edgeSprites.set(col, s);
    return s;
  }

  function drawEdgePulse(g) {
    // 0.02 미만은 눈에 보이지 않는다. 전체 화면 합성 한 장을 통째로 아끼는 컷오프다.
    if (edge <= 0.02) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = clamp(edge, 0, 1);
    g.drawImage(edgeSprite(edgeCol), 0, 0, W, H);
    g.restore();
  }

  /** 상단 진영 요약 */
  function drawTeamBanner(g, side, x, align) {
    if (!battle) return;
    let hp = 0, max = 0, alive = 0, n = 0;
    for (const u of battle.units) {
      if (u.side !== side) continue;
      n++; hp += Math.max(0, u.hp); max += u.maxHp; if (u.alive) alive++;
    }
    if (!n) return;
    const us = uiScale;
    // 배율이 커져도 양쪽 배너가 화면 폭을 넘지 않게 상한을 둔다
    const w = Math.min(Math.round(210 * us), Math.round(W * 0.42));
    const h = Math.max(8, Math.round(8 * us * 0.85));
    const bx = align === 'left' ? x : x - w;
    text(g, side === 'ally' ? `아군  ${alive}/${n}` : `적군  ${alive}/${n}`,
      align === 'left' ? bx : bx + w, Math.round(24 * us),
      { font: fnt('bold', FS_BANNER * us), color: side === 'ally' ? '#bfe0c2' : '#e8bcbc', align, ow: 3 * us });
    bar(g, bx, Math.round(30 * us), w, h, max ? hp / max : 0, side === 'ally' ? '#6fbe7a' : '#c9584f');
  }

  function drawHud(g) {
    const us = uiScale;
    // 상단 그라디언트로 가독성 확보 (구워 둔 띠를 blit)
    if (hudStrip) g.drawImage(hudStrip, 0, 0, W, Math.round(64 * us));
    drawTeamBanner(g, 'ally', Math.round(18 * us), 'left');
    drawTeamBanner(g, 'enemy', W - Math.round(18 * us), 'right');
    const t = Math.max(0, simTime);
    text(g, `${t.toFixed(1)}초`, W / 2, Math.round(24 * us), { font: fnt('bold', FS_TIME * us), color: '#e0d2a8', ow: 3 * us });
    text(g, `${speed}x`, W / 2, Math.round(42 * us), { font: fnt('', FS_SPEED * us), color: '#a79db0', ow: 3 * us });
  }

  /**
   * 승패 연출이 사라지는 데 걸리는 시간(초). `SETTLE_HOLD` 가 지나면 UI(`ui/battle.js`)가
   * 같은 자리에 자기 진행 오버레이(승/패 + 진행 버튼)를 띄운다. 둘을 겹쳐 두면
   * "승리" 글자가 두 번 찍히고 버튼이 캔버스 글자 위에 올라앉으므로 여기서 조용히 물러난다.
   */
  const ENDING_FADE = 0.45;

  function drawEnding(g) {
    if (!ending) return;
    const out = 1 - clamp((ending.t - SETTLE_HOLD) / ENDING_FADE, 0, 1);
    if (out <= 0.004) return;   // UI가 넘겨받았다 — 전장을 가리지 않는다
    const us = uiScale;
    const p = clamp(ending.t / 0.42, 0, 1);
    const e = EASE_OUT(p);
    const win = ending.winner;
    const label = win === 'ally' ? '승리' : win === 'enemy' ? '패배' : '무승부';
    const col = win === 'ally' ? '#f0d24a' : win === 'enemy' ? '#cf5a5a' : '#b0a8bc';
    g.save();
    g.globalAlpha = 0.34 * e * out;
    g.fillStyle = '#07060b';
    g.fillRect(0, 0, W, H);
    g.globalAlpha = out;
    // 위아래 띠
    const bandH = 96 * e * us;
    const bg = g.createLinearGradient(0, H / 2 - bandH / 2, 0, H / 2 + bandH / 2);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(0.5, 'rgba(0,0,0,.62)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bg;
    g.fillRect(0, H / 2 - bandH / 2, W, bandH);

    g.translate(W / 2, H / 2);
    // 헤드라인·광채는 통째로 배율을 태운다 (폰에서 62px 글자는 화면상 20px 도 안 된다)
    const s = lerp(2.4, 1, e) * us;
    g.scale(s, s);
    g.globalAlpha = e * out;
    // 계속 반짝이면 눈이 피로하므로 SETTLE_HOLD(1.5초) 이후로는 맥동을 잦아들게 한다.
    const calm = clamp((ending.t - SETTLE_HOLD) / 0.8, 0, 1);
    const pulse = (1 - calm) * (0.5 + 0.5 * Math.sin(ending.t * 5.2));
    // 광채도 shadowBlur 대신 미리 구운 스프라이트로 낸다 (62px 텍스트 블러는 매우 비싸다)
    {
      const gw = 420, gh = 190;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = e * out * (0.16 + 0.34 * pulse);
      g.drawImage(glowSprite(256, col, 1, 0.05), -gw / 2, -gh / 2 - 10, gw, gh);
      g.restore();
    }
    text(g, label, 0, 6, { font: fnt('900', FS_ENDING), color: col, ow: 6, oc: 'rgba(8,6,12,.95)' });
    g.restore();

    if (ending.t > 0.3) {
      g.save();
      g.globalAlpha = clamp((ending.t - 0.3) / 0.4, 0, 1) * 0.85 * out;
      text(g, `전투 종료 · ${simTime.toFixed(1)}초`, W / 2, H / 2 + 62 * us,
        { font: fnt('', FS_ENDSUB * us), color: '#c9c2d4', ow: 3 * us });
      g.restore();
    }
  }

  /**
   * 개발용 단계별 프로파일러. **기본 꺼져 있고 꺼져 있으면 비용이 없다.**
   *
   *   r.__prof.acc = Object.create(null);
   *   r.__prof.on = true;
   *   r.__prof.flush = true;   // 단계마다 래스터를 강제로 끝낸다
   *   // ... 프레임을 돌린 뒤 r.__prof.acc 를 읽는다 (단계 -> 누적 ms)
   *
   * `flush` 가 핵심이다. 캔버스 2D는 명령을 모아 뒀다가 나중에 한꺼번에 래스터하므로
   * 그냥 재면 "명령을 쌓는 시간"만 잡히고(전체의 1/6 남짓) 진짜 비용이 어디 있는지 안 보인다.
   * 이 옵션을 켜야 단계별 **래스터 비용**까지 제대로 배분된다.
   */
  const PROF = { on: false, acc: null, t: 0, flush: false };
  const pm = () => { if (PROF.on) PROF.t = performance.now(); };
  const pe = (k) => {
    if (!PROF.on) return;
    if (PROF.flush) { try { ctx.getImageData(0, 0, 1, 1); } catch (e) { /* noop */ } }
    const n = performance.now(); (PROF.acc[k] = (PROF.acc[k] || 0) + (n - PROF.t)); PROF.t = n;
  };

  function draw() {
    pm();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 카메라는 절대 움직이지 않는다 (이동/흔들림/줌/회전 없음).
    ctx.save();
    // 배경은 여백까지 구워져 있으므로 장치 픽셀 1:1 로 그린다 (확대/축소 없음).
    // ※ `globalCompositeOperation = 'copy'` 로 바꿔 봤지만 **4배 느려졌다**(dpr2 에서
    //   1.05ms → 4.02ms). 'copy' 는 그리기 사각형 밖을 전부 지워야 해서 가속 경로를 벗어난다.
    //   실측 결과이므로 되돌리지 마라.
    if (backdrop) ctx.drawImage(backdrop, -BG_PAD, -BG_PAD, W + BG_PAD * 2, H + BG_PAD * 2);
    else { ctx.fillStyle = '#12101a'; ctx.fillRect(-BG_PAD, -BG_PAD, W + BG_PAD * 2, H + BG_PAD * 2); }
    pe('bg');
    drawAmbient(ctx);
    pe('amb');

    if (battle) {
      // 깊이 정렬: y가 큰(앞쪽) 유닛을 나중에 그린다.
      // 배열은 재사용한다 (매 프레임 filter 가 새 배열을 만들 이유가 없다)
      order.length = 0;
      for (const u of battle.units) { const v = vis.get(u.uid); if (v && !v.gone) order.push(u); }
      order.sort((a, b) => {
        const va = vis.get(a.uid), vb = vis.get(b.uid);
        return (posY(va) - posY(vb)) || (a.idx - b.idx);
      });
      pe('sort');

      for (const u of order) drawGroundRing(ctx, vis.get(u.uid));
      pe('rings');
      for (const u of order) {
        const v = vis.get(u.uid);
        drawShadow(ctx, v);
        drawUnit(ctx, v);
      }
      pe('units');
      fx.draw(ctx);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      pe('fx');

      for (const u of order) {
        const v = vis.get(u.uid);
        if (v.dieT >= 0) continue;
        drawPlate(ctx, v);
        drawBubble(ctx, v);
        if (u.stunUntil > battle.time) drawStunStars(ctx, v);
      }
      pe('plates');
    } else {
      fx.draw(ctx);
      pe('fx');
    }
    drawPops(ctx);
    ctx.restore();
    pe('pops');

    // 비네트 + 가장자리 펄스 (전체 화면 플래시는 눈이 피로해서 제거했다)
    if (vignette) ctx.drawImage(vignette, 0, 0, W, H);
    pe('vignette');
    drawEdgePulse(ctx);
    pe('edge');
    drawHud(ctx);
    pe('hud');
    drawEnding(ctx);
    ctx.globalAlpha = 1;
    pe('ending');
  }

  /* ── 루프 / 수명주기 ───────────────────────────────── */
  function tick(ts) {
    raf = requestAnimationFrame(tick);
    const dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60;
    lastTs = ts;
    update(dt);
    draw();
  }
  function start() {
    if (raf) return;
    lastTs = 0;
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastTs = 0;
  }
  function dispose() {
    stop();
    fx.clear();
    vis.clear();
    pops.length = 0;
    ambient.length = 0;
    logFns.length = 0;
    endFns.length = 0;
    order.length = 0;
    battle = null;
    // 구워 둔 오프스크린 캔버스도 놓아 준다 (전투를 여러 번 열고 닫아도 쌓이지 않게)
    backdrop = null;
    vignette = null;
    hudStrip = null;
    edgeSprites.clear();
    glows.clear();
  }

  function setSpeed(n) {
    speed = clamp(Number(n) || 1, 0.25, 8);
    return speed;
  }

  function resize(w, h) {
    W = Math.max(320, Math.round(w || W));
    H = Math.max(180, Math.round(h || H));
    layout();
  }

  layout();

  return {
    // 필수 API
    setBattle,
    update,
    draw,
    setSpeed,
    dispose,
    onLog(fn) { if (typeof fn === 'function') { logFns.push(fn); return () => { const i = logFns.indexOf(fn); if (i >= 0) logFns.splice(i, 1); }; } return () => {}; },
    // 편의 API
    start,
    stop,
    resize,
    setBiome,
    /**
     * 오버레이(이름표·HP 바·데미지 숫자·상단 HUD·승패 글자) 확대 배율.
     *
     * 캔버스는 `width:100%` 로 화면 폭에 맞춰 줄어들기 때문에, 폰 세로에서는 논리 12px 글자가
     * 화면에서 5px 도 안 된다. 이 배율은 **오버레이만** 키운다 — 유닛 스프라이트·진형·전투 연출은
     * 그대로다(스프라이트를 키우면 서로 겹치고 픽셀아트 배율이 깨진다).
     *
     * @param {number|null} n 1 = PC 기준(예전과 동일한 그림). 0/null 을 주면 표시 폭을 보고
     *                        스스로 정하는 자동 모드로 돌아간다(기본값).
     * @returns {number} 실제로 적용된 배율
     */
    setUiScale(n) {
      if (n == null || !(Number(n) > 0)) { uiAuto = true; lastClientW = -1; return syncUiScale(true); }
      uiAuto = false;
      return applyUiScale(n);
    },
    get uiScale() { return uiScale; },
    onEnd(fn) { if (typeof fn === 'function') { endFns.push(fn); return () => { const i = endFns.indexOf(fn); if (i >= 0) endFns.splice(i, 1); }; } return () => {}; },
    fieldToScreen: (x, y) => ({ x: f2x(x), y: f2y(y) }),
    /**
    /**
     * 마무리 연출까지 끝났는가.
     * UI는 `battle.finished` 만 보고 결과 화면으로 넘어가면 안 된다 — 그 시점엔 아직
     * 마지막 사망 연출과 승리 텍스트가 재생 중이다. 이 값이 true가 될 때까지 기다린다.
     */
    isSettled() {
      if (!battle) return true;
      if (!battle.finished) return false;
      if (!ending) return false;          // `end` 이벤트를 아직 소비하지 못했다
      return ending.t >= SETTLE_HOLD;
    },
    /**
     * UI가 자기 진행 오버레이(승/패 + 진행 버튼)를 띄우기 직전에 부른다.
     * 캔버스 승패 연출을 즉시 마무리 단계로 보내 글자가 겹치지 않게 한다.
     * (플레이어가 클릭으로 연출을 건너뛴 경우에도 이 경로를 탄다)
     */
    skipEnding() {
      if (ending && ending.t < SETTLE_HOLD) ending.t = SETTLE_HOLD;
    },
    get speed() { return speed; },
    set speed(n) { setSpeed(n); },
    get paused() { return paused; },
    set paused(p) { paused = !!p; },
    get running() { return !!raf; },
    get finished() { return !!(battle && battle.finished); },
    get canvas() { return canvas; },
    get fx() { return fx; },
    get width() { return W; },
    get height() { return H; },
    /** 개발용 단계별 프로파일러 (기본 비활성). 위 PROF 주석 참고 */
    __prof: PROF,
  };
}

export default createRenderer;
