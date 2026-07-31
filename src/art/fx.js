// 전투 이펙트 / 파티클 / 투사체. SPEC §3.1 의 fx 이름과 1:1 대응한다.
//
//  - 좌표는 전부 **화면 픽셀 좌표**를 그대로 받는다 (렌더러가 변환해서 넘긴다).
//  - opts.dir : 이펙트가 뻗어나갈 방향 (+1 = 오른쪽, -1 = 왼쪽). 기본 +1.
//  - 데미지 숫자 팝업은 렌더러 담당. 여기서는 만들지 않는다.
//  - 시각용 난수는 전투 결정론과 무관해야 하므로 전역 rng 대신 전용 인스턴스를 쓴다.
import { RNG } from '../core/rng.js';
import { TAU, clamp } from '../core/util.js';

const R = new RNG(0x5eedf7);
const rf = (a, b) => R.float(a, b);
const ri = (a, b) => R.int(a, b);
const rp = (arr) => R.pick(arr);

/** 이펙트 팔레트 */
export const FX_COLORS = {
  blood: ['#c0392b', '#8e2a20', '#e05a4a', '#7a1f18'],
  spark: ['#ffffff', '#ffe9a8', '#ffc94a'],
  steel: ['#ffffff', '#dfe6f0', '#98a2b4'],
  arcane: ['#e8f6ff', '#8fd7ff', '#5aa8e8', '#3d7fb8'],
  fire: ['#fff0a8', '#ffd24a', '#ff8a2a', '#d1381f'],
  ice: ['#ffffff', '#d8f6ff', '#a8e8f0', '#5fb8e8'],
  holy: ['#fffdf0', '#ffe9a8', '#f0c65a', '#d1a63f'],
  shadow: ['#d9bcff', '#a06fd6', '#6a3aa8', '#2a1840'],
  nature: ['#e2ffb0', '#9be86a', '#5fae42', '#2f6b2a'],
  bolt: ['#ffffff', '#c7e6ff', '#7fb8ff', '#4a6fd6'],
  poison: ['#dcff8a', '#9be04a', '#5f9c2a', '#8a5fbf'],
  dust: ['#e0d5bd', '#b3a488', '#8a7c62'],
  wood: ['#c9a06a', '#8a6136', '#5a3d20'],
  stone: ['#c9c9d4', '#9a9aa8', '#6b6b7a'],
  heal: ['#ffffff', '#b6f5c0', '#5fd67a', '#2f9a5a'],
  buff: ['#fff4c0', '#ffd24a', '#ffffff'],
  crit: ['#ffffff', '#ffe9a8', '#ff9a3a'],
};
const C = FX_COLORS;

/** spawn() 이 인식하는 타입 */
export const FX_TYPES = [
  'hit', 'slash', 'pierce', 'arrow', 'bolt', 'fire', 'ice', 'holy', 'shadow',
  'nature', 'lightning', 'blunt', 'poison', 'buff', 'heal', 'death', 'crit', 'dust',
  // 타격감 보강용 국소 연출 (화면 전체를 건드리지 않는다)
  'impact', 'ring', 'shockwave', 'trail', 'shatter',
];
/** 엔진 쪽에서 다른 이름이 와도 무난히 매핑 */
const ALIAS = { magic: 'bolt', phys: 'hit', frost: 'ice', dark: 'shadow', earth: 'blunt', wind: 'nature', none: 'hit' };

/**
 * 동시 파티클 상한.
 *
 * 실측: 7대7 전투에서 예전 값(880)이 **거의 항상 포화**했다(p50 686 · p95 866).
 * 즉 상한이 "혹시 모를 안전장치"가 아니라 상시 동작하는 상태였고, 그 결과
 * ① 프레임 시간이 파티클 수에 그대로 끌려다녔고 ② 포화 중에 터진 **새 연출이 통째로
 * 버려졌다**(가장 나쁜 실패 방식 — 방금 터진 치명타가 안 보인다).
 * 그래서 생성 개수를 약 30% 줄여 평소에는 상한에 닿지 않게 하고, 상한에 닿았을 때는
 * 새 파티클을 버리는 대신 **오래된 것을 밀어낸다**(아래 emit 참조).
 */
const MAX_PARTICLES = 620;

// ── 파티클 기본값 ───────────────────────────────────────────────
function P(o) {
  return {
    shape: 'px', x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0,
    life: 0.4, max: 0.4, size: 2, col: '#ffffff', col2: null,
    alpha: 1, fade: 1, blend: false, shrink: false,
    rot: 0, vr: 0, wob: 0, wobF: 0, phase: 0,
    r0: 0, r1: 8, w: 2, a0: 0, a1: 0, ang: 0, len: 0.05, pts: null,
    ...o,
    max: o.life || 0.4,
  };
}

// ── 타입별 생성기 ───────────────────────────────────────────────
const SPAWN = {
  // 피 튀김 + 스파크
  hit(emit, x, y, o) {
    const d = o.dir, n = o.count || 6;
    for (let i = 0; i < n; i++) {
      emit(P({
        shape: 'px', x: x + rf(-3, 3), y: y + rf(-6, 5),
        vx: d * rf(20, 150) + rf(-40, 40), vy: rf(-200, -30), g: 640, drag: 1.1,
        size: ri(2, 3), col: rp(C.blood), life: rf(0.3, 0.55), fade: 0.5,
      }));
    }
    for (let i = 0; i < 2; i++) {
      emit(P({
        shape: 'streak', x, y: y + rf(-4, 4), vx: d * rf(100, 250), vy: rf(-170, 70),
        len: 0.05, size: 2, col: rp(C.spark), life: rf(0.1, 0.18), blend: true,
      }));
    }
    emit(P({ shape: 'ring', x, y, r0: 2, r1: 12, w: 3, col: '#ffffff', life: 0.16, blend: true }));
  },

  // 호를 그리는 참격선
  slash(emit, x, y, o) {
    const d = o.dir;
    const m = (deg) => ((d > 0 ? deg : 180 - deg) * Math.PI) / 180;
    const r = 15 * o.scale;
    const cx = x - d * 6, cy = y - 2;
    emit(P({ shape: 'arc', x: cx, y: cy, r, a0: m(-115), a1: m(45), w: 4.5, col: '#ffffff', life: 0.2, fade: 0.55, blend: true }));
    emit(P({ shape: 'arc', x: cx, y: cy, r: r + 3, a0: m(-105), a1: m(52), w: 2, col: '#ffe9a8', life: 0.28, fade: 0.7, blend: true }));
    for (let i = 0; i < 4; i++) {
      emit(P({
        shape: 'px', x: x + rf(-4, 4), y: y + rf(-7, 6), vx: d * rf(40, 190), vy: rf(-140, 70),
        g: 320, size: 2, col: rp(C.steel), life: rf(0.15, 0.32), fade: 0.6,
      }));
    }
    for (let i = 0; i < 2; i++) {
      emit(P({ shape: 'px', x: x + rf(-3, 3), y: y + rf(-4, 4), vx: d * rf(10, 70), vy: rf(-90, -10), g: 600, size: 2, col: rp(C.blood), life: rf(0.25, 0.4), fade: 0.5 }));
    }
  },

  // 관통: 직선 섬광 + 파편
  pierce(emit, x, y, o) {
    const d = o.dir;
    emit(P({ shape: 'streak', x, y, vx: d * 540, vy: 0, len: 0.055, size: 3, col: '#ffffff', life: 0.14, blend: true }));
    emit(P({ shape: 'streak', x, y, vx: d * 420, vy: 0, len: 0.07, size: 1.5, col: '#c7e6ff', life: 0.22, blend: true }));
    for (let i = 0; i < 4; i++) {
      emit(P({
        shape: 'tri', x, y, vx: d * rf(60, 280), vy: rf(-140, 140), g: 280,
        rot: rf(0, TAU), vr: rf(-10, 10), size: rf(2, 3.5), col: rp(C.steel), life: rf(0.2, 0.38), fade: 0.5,
      }));
    }
    emit(P({ shape: 'ring', x, y, r0: 1, r1: 10, w: 2, col: '#dfe6f0', life: 0.15, blend: true }));
    for (let i = 0; i < 3; i++) {
      emit(P({ shape: 'px', x, y, vx: -d * rf(20, 90), vy: rf(-120, 0), g: 620, size: 2, col: rp(C.blood), life: rf(0.25, 0.45), fade: 0.5 }));
    }
  },

  // 화살 명중: 나무 파편 잔상
  arrow(emit, x, y, o) {
    const d = o.dir;
    emit(P({ shape: 'streak', x, y, vx: d * 380, vy: rf(-30, 30), len: 0.05, size: 2, col: '#ffffff', life: 0.12, blend: true }));
    for (let i = 0; i < 5; i++) {
      emit(P({
        shape: 'px', x, y, vx: -d * rf(20, 160) + rf(-30, 30), vy: rf(-170, -10), g: 580,
        size: ri(1, 2), col: rp(C.wood), life: rf(0.2, 0.42), fade: 0.5,
      }));
    }
    for (let i = 0; i < 3; i++) {
      emit(P({ shape: 'px', x, y, vx: d * rf(30, 130), vy: rf(-90, 50), g: 420, size: 2, col: rp(C.spark), life: rf(0.1, 0.2), blend: true }));
    }
    for (let i = 0; i < 2; i++) {
      emit(P({ shape: 'px', x, y, vx: rf(-60, 60), vy: rf(-80, 0), g: 640, size: 2, col: rp(C.blood), life: rf(0.2, 0.35), fade: 0.5 }));
    }
  },

  // 마법탄 작렬
  bolt(emit, x, y, o) {
    emit(P({ shape: 'ring', x, y, r0: 2, r1: 20 * o.scale, w: 3, col: '#c7e6ff', life: 0.26, blend: true }));
    emit(P({ shape: 'orb', x, y, size: 7 * o.scale, col: '#ffffff', col2: '#7fb8ff', life: 0.16, shrink: true, blend: true }));
    for (let i = 0; i < 8; i++) {
      const a = rf(0, TAU), sp = rf(50, 190);
      emit(P({
        shape: 'px', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, g: 130, drag: 1.6,
        size: ri(2, 3), col: rp(C.bolt), life: rf(0.25, 0.5), fade: 0.6, blend: true,
      }));
    }
  },

  // 화염: 위로 솟는 불티
  fire(emit, x, y, o) {
    emit(P({ shape: 'orb', x, y, size: 9 * o.scale, col: '#ffd24a', col2: '#ff6a1f', life: 0.18, shrink: true, blend: true }));
    emit(P({ shape: 'ring', x, y, r0: 3, r1: 22 * o.scale, w: 3, col: '#ff8a2a', life: 0.3, blend: true }));
    for (let i = 0; i < 10; i++) {
      emit(P({
        shape: 'orb', x: x + rf(-6, 6), y: y + rf(-5, 5),
        vx: rf(-70, 70), vy: rf(-150, -35), g: -55, drag: 1.4,
        size: rf(1.5, 3.5), col: rp(C.fire), life: rf(0.35, 0.8), fade: 0.6,
        shrink: true, blend: true, wob: 90, wobF: rf(7, 13), phase: rf(0, TAU),
      }));
    }
    for (let i = 0; i < 3; i++) {
      emit(P({ shape: 'px', x, y, vx: rf(-120, 120), vy: rf(-60, 40), g: 420, size: 2, col: '#5a4038', life: rf(0.3, 0.6), fade: 0.4 }));
    }
  },

  // 냉기: 결정 파편 + 서리 링
  ice(emit, x, y, o) {
    emit(P({ shape: 'ring', x, y, r0: 3, r1: 21 * o.scale, w: 2.5, col: '#a8e8f0', life: 0.32, blend: true }));
    emit(P({ shape: 'orb', x, y, size: 6 * o.scale, col: '#ffffff', col2: '#5fb8e8', life: 0.14, shrink: true, blend: true }));
    for (let i = 0; i < 6; i++) {
      const a = rf(0, TAU), sp = rf(60, 170);
      emit(P({
        shape: 'flake', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, g: 300, drag: 0.9,
        rot: rf(0, TAU), vr: rf(-7, 7), size: rf(2.5, 4.5), col: rp(C.ice), life: rf(0.35, 0.6), fade: 0.5,
      }));
    }
    for (let i = 0; i < 4; i++) {
      emit(P({ shape: 'px', x: x + rf(-8, 8), y: y + rf(-8, 8), vx: rf(-20, 20), vy: rf(-40, -5), g: 60, size: 2, col: '#d8f6ff', life: rf(0.3, 0.6), fade: 0.7, blend: true }));
    }
  },

  // 신성: 위로 솟는 빛 + 광륜
  holy(emit, x, y, o) {
    emit(P({ shape: 'ring', x, y, r0: 4, r1: 24 * o.scale, w: 3, col: '#ffe9a8', life: 0.35, blend: true }));
    emit(P({ shape: 'ring', x, y, r0: 1, r1: 13 * o.scale, w: 2, col: '#fffdf0', life: 0.22, blend: true }));
    for (let i = 0; i < 5; i++) {
      emit(P({ shape: 'ray', x, y, ang: (-90 + (i - 2) * 26) * Math.PI / 180, r0: 3, r1: rf(20, 34), size: 3, col: '#fffdf0', life: rf(0.2, 0.32), blend: true }));
    }
    for (let i = 0; i < 7; i++) {
      emit(P({
        shape: 'cross', x: x + rf(-9, 9), y: y + rf(-4, 8), vx: rf(-25, 25), vy: rf(-95, -35), g: -20,
        size: rf(2.5, 4.5), col: rp(C.holy), life: rf(0.45, 0.85), fade: 0.6, blend: true,
      }));
    }
  },

  // 암흑: 빨려드는 어둠 + 보랏빛 잔재
  shadow(emit, x, y, o) {
    emit(P({ shape: 'orb', x, y, size: 11 * o.scale, col: '#2a1840', col2: '#6a3aa8', life: 0.3, shrink: true }));
    emit(P({ shape: 'ring', x, y, r0: 22 * o.scale, r1: 3, w: 3, col: '#a06fd6', life: 0.3, blend: true }));
    for (let i = 0; i < 8; i++) {
      const a = rf(0, TAU), sp = rf(30, 120);
      emit(P({
        shape: 'orb', x: x + Math.cos(a) * rf(4, 14), y: y + Math.sin(a) * rf(4, 12),
        vx: Math.cos(a) * sp * 0.4, vy: Math.sin(a) * sp * 0.4 - 25, g: -25, drag: 1.2,
        size: rf(1.5, 3.5), col: rp(C.shadow), life: rf(0.35, 0.7), fade: 0.7, shrink: true,
        wob: 70, wobF: rf(5, 10), phase: rf(0, TAU),
      }));
    }
  },

  // 자연: 흩날리는 잎사귀
  nature(emit, x, y, o) {
    emit(P({ shape: 'ring', x, y, r0: 3, r1: 19 * o.scale, w: 2.5, col: '#9be86a', life: 0.3, blend: true }));
    for (let i = 0; i < 7; i++) {
      const a = rf(0, TAU), sp = rf(40, 130);
      emit(P({
        shape: 'tri', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 55, g: 160, drag: 1.1,
        rot: rf(0, TAU), vr: rf(-8, 8), size: rf(2.5, 4), col: rp(C.nature), life: rf(0.5, 0.95), fade: 0.5,
        wob: 110, wobF: rf(4, 9), phase: rf(0, TAU),
      }));
    }
    for (let i = 0; i < 4; i++) {
      emit(P({ shape: 'px', x: x + rf(-8, 8), y: y + rf(-8, 4), vx: rf(-20, 20), vy: rf(-60, -15), g: -10, size: 2, col: '#e2ffb0', life: rf(0.4, 0.7), fade: 0.6, blend: true }));
    }
  },

  // 번개: 위에서 내리꽂히는 지그재그
  lightning(emit, x, y, o) {
    for (let k = 0; k < 3; k++) {
      const pts = [];
      const h = rf(34, 52), seg = 7;
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        pts.push({ x: (1 - t) * rf(-10, 10) + rf(-5, 5) * (1 - t), y: -h * (1 - t) });
      }
      pts[seg].x = 0; pts[seg].y = 0;
      emit(P({ shape: 'bolt', x, y, pts, size: k === 0 ? 3 : 1.5, col: k === 0 ? '#ffffff' : rp(C.bolt), life: rf(0.1, 0.2), blend: true }));
    }
    emit(P({ shape: 'ring', x, y, r0: 2, r1: 20 * o.scale, w: 3, col: '#c7e6ff', life: 0.2, blend: true }));
    for (let i = 0; i < 6; i++) {
      const a = rf(0, TAU), sp = rf(90, 260);
      emit(P({ shape: 'streak', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, len: 0.04, size: 2, col: rp(C.bolt), life: rf(0.08, 0.18), blend: true }));
    }
  },

  // 둔기: 충격파 링 + 파편
  blunt(emit, x, y, o) {
    emit(P({ shape: 'ring', x, y, r0: 2, r1: 26 * o.scale, w: 4, col: '#ffffff', life: 0.24, blend: true }));
    emit(P({ shape: 'ring', x, y, r0: 2, r1: 17 * o.scale, w: 3, col: '#c9c9d4', life: 0.34 }));
    for (let i = 0; i < 6; i++) {
      emit(P({
        shape: 'px', x: x + rf(-4, 4), y: y + rf(-4, 4), vx: rf(-180, 180), vy: rf(-210, -50),
        g: 720, size: ri(2, 4), col: rp(C.stone), life: rf(0.3, 0.55), fade: 0.5,
      }));
    }
    for (let i = 0; i < 4; i++) {
      emit(P({ shape: 'px', x, y: y + rf(0, 6), vx: rf(-140, 140), vy: rf(-30, 10), g: 90, drag: 2, size: ri(2, 4), col: rp(C.dust), life: rf(0.35, 0.6), fade: 0.7, alpha: 0.7 }));
    }
  },

  // 독: 부글거리는 거품
  poison(emit, x, y, o) {
    emit(P({ shape: 'ring', x, y, r0: 3, r1: 16 * o.scale, w: 2.5, col: '#9be04a', life: 0.3, blend: true }));
    for (let i = 0; i < 8; i++) {
      emit(P({
        shape: 'orb', x: x + rf(-8, 8), y: y + rf(-4, 8), vx: rf(-25, 25), vy: rf(-70, -20),
        g: -18, drag: 1.1, size: rf(1.5, 4), col: rp(C.poison), life: rf(0.5, 1.0), fade: 0.5,
        wob: 60, wobF: rf(4, 8), phase: rf(0, TAU), alpha: 0.9,
      }));
    }
    for (let i = 0; i < 3; i++) {
      emit(P({ shape: 'px', x: x + rf(-6, 6), y, vx: rf(-40, 40), vy: rf(-40, 10), g: 300, size: 2, col: '#5f9c2a', life: rf(0.3, 0.6), fade: 0.5 }));
    }
  },

  // 강화: 발밑에서 위로 솟는 입자
  buff(emit, x, y, o) {
    const col = o.color ? [o.color, '#ffffff'] : C.buff;
    emit(P({ shape: 'ring', x, y, r0: 16 * o.scale, r1: 4, w: 3, col: col[0], life: 0.4, blend: true }));
    for (let i = 0; i < 8; i++) {
      const a = rf(0, TAU), rr = rf(5, 14);
      emit(P({
        shape: 'orb', x: x + Math.cos(a) * rr, y: y + rf(-2, 10),
        vx: Math.cos(a) * 8, vy: rf(-100, -45), g: -30, drag: 0.6,
        size: rf(1.5, 3), col: rp(col), life: rf(0.55, 0.95), fade: 0.55, blend: true,
        wob: 80, wobF: rf(5, 10), phase: rf(0, TAU),
      }));
    }
    for (let i = 0; i < 3; i++) {
      emit(P({ shape: 'ray', x, y: y - 8, ang: (-90 + rf(-40, 40)) * Math.PI / 180, r0: 2, r1: rf(14, 26), size: 2.5, col: col[0], life: rf(0.25, 0.4), blend: true }));
    }
  },

  // 회복: 솟아오르는 십자 + 빛
  heal(emit, x, y, o) {
    emit(P({ shape: 'ring', x, y, r0: 18 * o.scale, r1: 5, w: 3, col: '#5fd67a', life: 0.45, blend: true }));
    emit(P({ shape: 'orb', x, y: y - 12, size: 10 * o.scale, col: '#b6f5c0', col2: '#5fd67a', life: 0.3, shrink: true, blend: true }));
    for (let i = 0; i < 7; i++) {
      emit(P({
        shape: 'cross', x: x + rf(-11, 11), y: y + rf(-4, 8), vx: rf(-15, 15), vy: rf(-95, -40),
        g: -22, size: rf(2.5, 5), col: rp(C.heal), life: rf(0.5, 0.95), fade: 0.55, blend: true,
        wob: 50, wobF: rf(4, 8), phase: rf(0, TAU),
      }));
    }
  },

  // 사망: 실루엣이 흩어짐
  death(emit, x, y, o) {
    const col = o.color ? [o.color, '#6b6b7a', '#3a3646'] : ['#8a8a96', '#6b6b7a', '#4a4656'];
    for (let i = 0; i < 12; i++) {
      emit(P({
        shape: 'px', x: x + rf(-9, 9), y: y + rf(-30, 0), vx: rf(-40, 40), vy: rf(-60, -10),
        g: 30, drag: 0.8, size: ri(2, 3), col: rp(col), life: rf(0.5, 1.1), fade: 0.85, alpha: 0.9,
        wob: 50, wobF: rf(3, 7), phase: rf(0, TAU),
      }));
    }
    for (let i = 0; i < 4; i++) {
      emit(P({ shape: 'px', x: x + rf(-8, 8), y: y + rf(-8, 2), vx: rf(-70, 70), vy: rf(-30, 10), g: 260, size: 2, col: rp(C.blood), life: rf(0.3, 0.6), fade: 0.5 }));
    }
    emit(P({ shape: 'ring', x, y: y - 14, r0: 3, r1: 22, w: 2, col: '#c9c9d4', life: 0.35, alpha: 0.8 }));
  },

  // 치명타: 방사형 섬광
  crit(emit, x, y, o) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      emit(P({
        shape: 'ray', x, y, ang: (i / n) * TAU + rf(-0.1, 0.1), r0: 3, r1: rf(18, 34),
        size: rf(2, 4), col: rp(C.crit), life: rf(0.16, 0.28), blend: true,
      }));
    }
    emit(P({ shape: 'ring', x, y, r0: 2, r1: 26, w: 4, col: '#ffe9a8', life: 0.2, blend: true }));
    emit(P({ shape: 'orb', x, y, size: 8, col: '#ffffff', col2: '#ffc94a', life: 0.14, shrink: true, blend: true }));
    for (let i = 0; i < 4; i++) {
      emit(P({ shape: 'px', x, y, vx: rf(-200, 200), vy: rf(-220, -40), g: 620, size: ri(2, 3), col: rp(C.spark), life: rf(0.2, 0.4), fade: 0.5 }));
    }
  },

  // 착지/돌진 먼지
  dust(emit, x, y, o) {
    const d = o.dir, n = o.count || 5;
    for (let i = 0; i < n; i++) {
      emit(P({
        shape: 'px', x: x + rf(-5, 5), y: y + rf(-3, 1), vx: -d * rf(20, 110) + rf(-25, 25), vy: rf(-45, -5),
        g: 110, drag: 2.4, size: ri(2, 4), col: rp(C.dust), life: rf(0.3, 0.6), fade: 0.8, alpha: 0.75,
      }));
    }
    emit(P({ shape: 'ring', x, y, r0: 2, r1: 14, w: 2, col: '#d9cdb4', life: 0.22, alpha: 0.6 }));
  },

  /* ── 타격감 보강용 국소 연출 ─────────────────────────────────
     전부 "타격 지점 주변"에서만 일어난다. 화면 전체를 흔들거나 밀지 않는다.
     (플레이어가 흔들림에 눈이 아프다고 해서 흔들림을 대체하려고 넣은 것들이다) */

  // 타격 순간 튀는 국소 섬광 + 파편. crit 이면 더 굵고 멀리 튄다.
  impact(emit, x, y, o) {
    const d = o.dir, crit = !!o.crit, s = o.scale || 1;
    const n = o.count || (crit ? 10 : 6);
    for (let i = 0; i < n; i++) {
      const a = rf(-1.15, 1.15);
      const sp = rf(140, 330) * (crit ? 1.35 : 1);
      emit(P({
        shape: 'streak', x: x + rf(-2, 2), y: y + rf(-3, 3),
        vx: d * Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        len: 0.045, size: rf(1.5, 3), col: rp(crit ? C.crit : C.spark),
        life: rf(0.08, 0.19), blend: true,
      }));
    }
    // 중심 코어 — 아주 짧게 번쩍이고 사라진다
    emit(P({
      shape: 'orb', x, y, size: (crit ? 11 : 7) * s,
      col: '#ffffff', col2: crit ? '#ffc94a' : '#ffe9a8',
      life: crit ? 0.15 : 0.10, shrink: true, blend: true,
    }));
  },

  // 범용 확산 링 하나. opts.color / opts.scale 로 조절한다.
  ring(emit, x, y, o) {
    const s = o.scale || 1;
    emit(P({
      shape: 'ring', x, y, r0: 2 * s, r1: 30 * s, w: 3.5,
      col: o.color || '#ffffff', life: 0.28, blend: true,
    }));
  },

  // 충격파 링 — 타격 지점에서 퍼지며 사라진다.
  // 치명타는 이중 링 + 방사형 스파이크로 크게 터진다.
  shockwave(emit, x, y, o) {
    const crit = !!o.crit, s = o.scale || 1;
    const col = o.color || (crit ? '#ffe9a8' : '#ffffff');
    emit(P({
      shape: 'ring', x, y, r0: 3 * s, r1: (crit ? 52 : 32) * s, w: crit ? 5 : 3.4,
      col, life: crit ? 0.34 : 0.24, blend: true,
    }));
    if (!crit) return;
    // 안쪽 링 (조금 늦게 사라져 두께감을 만든다)
    emit(P({ shape: 'ring', x, y, r0: 2 * s, r1: 30 * s, w: 3, col: '#ffffff', life: 0.22, blend: true }));
    // 바깥 링 (얇고 넓게 퍼진다)
    emit(P({ shape: 'ring', x, y, r0: 8 * s, r1: 74 * s, w: 2, col: '#ffc94a', life: 0.42, blend: true, alpha: 0.75 }));
    const n = 8;
    for (let i = 0; i < n; i++) {
      emit(P({
        shape: 'ray', x, y, ang: (i / n) * TAU + rf(-0.09, 0.09),
        r0: 8 * s, r1: rf(34, 58) * s, size: rf(2.5, 4.5),
        col: rp(C.crit), life: rf(0.17, 0.3), blend: true,
      }));
    }
  },

  // 무기 궤적 — 근접 스윙이 지나간 자리에 남는 호 잔상 (2~3프레임)
  trail(emit, x, y, o) {
    const d = o.dir, s = o.scale || 1;
    const m = (deg) => ((d > 0 ? deg : 180 - deg) * Math.PI) / 180;
    const r = 26 * s;
    emit(P({
      shape: 'arc', x, y, r, a0: m(-118), a1: m(42), w: 6,
      col: o.color || '#ffffff', life: 0.10, fade: 0.95, blend: true,
    }));
    emit(P({
      shape: 'arc', x, y, r: r + 5, a0: m(-108), a1: m(34), w: 2.5,
      col: o.color2 || '#ffe9a8', life: 0.17, fade: 0.95, blend: true, alpha: 0.7,
    }));
  },

  // 처치 파편 — 흰 실루엣 번쩍(렌더러 담당) 뒤에 흩어지는 조각들
  shatter(emit, x, y, o) {
    const col = o.color ? [o.color, '#e8e2d8', '#8a8a96'] : ['#e8e2d8', '#b9b2c4', '#8a8a96'];
    for (let i = 0; i < 14; i++) {
      const a = rf(-Math.PI, 0);
      const sp = rf(50, 210);
      emit(P({
        shape: 'tri', x: x + rf(-10, 10), y: y + rf(-46, -4),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - rf(10, 60), g: 430, drag: 0.6,
        rot: rf(0, TAU), vr: rf(-9, 9), size: rf(1.6, 3.6), col: rp(col),
        life: rf(0.45, 0.95), fade: 0.6,
      }));
    }
    for (let i = 0; i < 5; i++) {
      emit(P({
        shape: 'px', x: x + rf(-8, 8), y: y + rf(-30, -2), vx: rf(-60, 60), vy: rf(-80, -10),
        g: 380, size: ri(2, 3), col: rp(C.blood), life: rf(0.3, 0.6), fade: 0.5,
      }));
    }
    emit(P({ shape: 'ring', x, y: y - 16, r0: 4, r1: 46, w: 3, col: '#ffffff', life: 0.28, blend: true }));
  },
};

/** 이 타입들은 스스로 치명타 연출을 갖고 있으므로 crit 버스트를 겹치지 않는다 */
const SKIP_AUTO_CRIT = { crit: 1, impact: 1, ring: 1, shockwave: 1, trail: 1, shatter: 1 };

// ── 투사체 ──────────────────────────────────────────────────────

/** 종류별 기본 속도(px/s) / 포물선 높이(px) / 잔상 색 키 */
const PROJ = {
  arrow: { speed: 560, arc: 10, trail: 'wood' },
  bolt: { speed: 460, arc: 0, trail: 'arcane' },
  fire: { speed: 380, arc: 6, trail: 'fire' },
  ice: { speed: 430, arc: 4, trail: 'ice' },
  holy: { speed: 400, arc: 8, trail: 'holy' },
  shadow: { speed: 340, arc: 6, trail: 'shadow' },
  nature: { speed: 360, arc: 12, trail: 'nature' },
  lightning: { speed: 1400, arc: 0, trail: null },
  poison: { speed: 330, arc: 14, trail: 'poison' },
  blunt: { speed: 320, arc: 22, trail: 'dust' },
  pierce: { speed: 620, arc: 0, trail: 'steel' },
  slash: { speed: 520, arc: 0, trail: 'steel' },
  heal: { speed: 340, arc: 16, trail: 'heal' },
  buff: { speed: 340, arc: 16, trail: 'buff' },
};

/**
 * 투사체 생성. from/to 는 화면 픽셀 좌표 {x,y}.
 * 반환된 객체는 스스로 update(dt) 하며 도착하면 true 를 돌려준다.
 * (렌더러는 p.x / p.y / p.angle 만 읽어도 된다)
 */
export function createProjectile(kind, from, to, opts = {}) {
  const k = ALIAS[kind] || kind;
  const cfg = PROJ[k] || PROJ.bolt;
  const sx = from.x, sy = from.y, tx = to.x, ty = to.y;
  const dist = Math.hypot(tx - sx, ty - sy) || 1;
  const speed = opts.speed || cfg.speed;
  return {
    kind: k, sx, sy, tx, ty, x: sx, y: sy,
    t: 0, dur: Math.max(0.05, dist / speed), dist,
    arc: opts.arc == null ? cfg.arc : opts.arc,
    angle: Math.atan2(ty - sy, tx - sx),
    rot: 0, spin: opts.spin || 0,
    scale: opts.scale || 1,
    color: opts.color || null,
    dir: tx >= sx ? 1 : -1,
    trail: opts.trail === false ? null : (opts.trail || cfg.trail),
    impact: opts.impact !== false,
    onHit: opts.onHit || null,
    arrived: false, dead: false, _tr: 0,
    update(dt) {
      if (this.dead) return true;
      this.t += dt;
      const u = clamp(this.t / this.dur, 0, 1);
      const px = this.x, py = this.y;
      this.x = this.sx + (this.tx - this.sx) * u;
      this.y = this.sy + (this.ty - this.sy) * u - this.arc * 4 * u * (1 - u);
      const dx = this.x - px, dy = this.y - py;
      if (dx || dy) this.angle = Math.atan2(dy, dx);
      this.rot += this.spin * dt;
      if (u >= 1) { this.arrived = true; this.dead = true; return true; }
      return false;
    },
  };
}

function trailParticle(emit, p) {
  const pal = C[p.trail] || C.arcane;
  if (p.trail === 'wood' || p.trail === 'steel' || p.trail === 'dust') {
    emit(P({
      shape: 'px', x: p.x + rf(-1, 1), y: p.y + rf(-1, 1), vx: 0, vy: 0,
      size: 2, col: rp(pal), life: 0.14, fade: 1, alpha: 0.55,
    }));
    return;
  }
  emit(P({
    shape: 'orb', x: p.x + rf(-1.5, 1.5), y: p.y + rf(-1.5, 1.5),
    vx: rf(-12, 12), vy: rf(-20, 4), size: rf(1.5, 3) * p.scale,
    col: p.color || rp(pal), life: rf(0.18, 0.34), fade: 1, shrink: true, blend: true,
  }));
}

function drawProjectile(ctx, p) {
  const pal = C[p.trail] || C.arcane;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = 1;
  switch (p.kind) {
    case 'arrow': {
      ctx.rotate(p.angle);
      ctx.strokeStyle = '#8a6136'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(5, 0); ctx.stroke();
      ctx.strokeStyle = '#dfe6f0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(9, 0); ctx.stroke();
      ctx.strokeStyle = '#e4dfd0'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-9, 0); ctx.lineTo(-12, -3); ctx.moveTo(-9, 0); ctx.lineTo(-12, 3);
      ctx.stroke();
      break;
    }
    case 'pierce': case 'slash': {
      ctx.rotate(p.angle);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(7, 0); ctx.stroke();
      ctx.strokeStyle = '#c7e6ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(9, 0); ctx.stroke();
      break;
    }
    case 'lightning': {
      ctx.rotate(p.angle);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-18, 0);
      for (let i = -14; i <= 6; i += 5) ctx.lineTo(i, (i % 10 === 0 ? -3 : 3));
      ctx.lineTo(8, 0); ctx.stroke();
      break;
    }
    case 'ice': {
      ctx.rotate(p.angle + p.rot);
      ctx.fillStyle = '#d8f6ff';
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(0, -4); ctx.lineTo(-6, 0); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#5fb8e8'; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(0, 0, 6 * p.scale, 0, TAU); ctx.fill();
      break;
    }
    case 'blunt': {
      ctx.fillStyle = '#8a7c62';
      ctx.beginPath(); ctx.arc(0, 0, 4 * p.scale, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c9c9d4';
      ctx.beginPath(); ctx.arc(-1, -1, 2 * p.scale, 0, TAU); ctx.fill();
      break;
    }
    case 'nature': {
      ctx.rotate(p.rot + p.angle);
      ctx.fillStyle = '#5fae42';
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
      break;
    }
    default: {
      // 마법탄류: 코어 + 글로우
      ctx.globalCompositeOperation = 'lighter';
      const r = 4 * p.scale;
      ctx.fillStyle = p.color || pal[2] || pal[1];
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(0, 0, r * 2.2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = pal[1];
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.fillStyle = pal[0];
      ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// ── 파티클 그리기 ───────────────────────────────────────────────

/** 작은 반지름이면 사각형, 크면 원. (원 패스 생성 비용을 줄이는 대체 그리기) */
const BLOB_MIN_R = 2.2;
function blob(ctx, x, y, r) {
  if (r < BLOB_MIN_R) {
    const q = r * 1.7724539;               // √π — 원과 넓이가 같은 정사각형 한 변
    ctx.fillRect(x - q * 0.5, y - q * 0.5, q, q);
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/**
 * 파티클 한 개를 그린다.
 * **합성 모드(globalCompositeOperation)는 여기서 건드리지 않는다** — draw() 가
 * 일반/가산 두 묶음으로 나눠 각각 한 번씩만 설정한다. 파티클마다 합성 모드를 토글하면
 * (한 프레임에 600~880개) 상태 전환이 그만큼 일어나 드로우 배치가 계속 끊긴다.
 */
function drawParticle(ctx, p) {
  const t = p.life / p.max; // 1 -> 0
  const a = p.alpha * Math.min(1, t / p.fade);
  if (a <= 0.02) return;
  ctx.globalAlpha = a;
  const s = p.shrink ? Math.max(0.4, p.size * t) : p.size;
  const u = 1 - t;

  switch (p.shape) {
    case 'px': {
      const q = Math.max(1, Math.round(s));
      ctx.fillStyle = p.col;
      ctx.fillRect(Math.round(p.x - q / 2), Math.round(p.y - q / 2), q, q);
      break;
    }
    case 'orb': {
      // 작은 구체는 원 대신 같은 넓이의 사각형으로 찍는다.
      // 반지름 2px 남짓에서 원/사각은 구분되지 않는데(게다가 도트 아트라 오히려 어울린다)
      // 원 패스는 프레임당 250개 넘게 쌓이면 무시 못 할 비용이 된다. 한 변 = s*√π.
      if (p.col2) {
        ctx.globalAlpha = a * 0.4;
        ctx.fillStyle = p.col2;
        blob(ctx, p.x, p.y, s * 2);
        ctx.globalAlpha = a;
      }
      ctx.fillStyle = p.col;
      blob(ctx, p.x, p.y, Math.max(0.5, s));
      break;
    }
    case 'streak': {
      ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1, s);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * p.len, p.y - p.vy * p.len);
      ctx.stroke();
      break;
    }
    case 'ray': {
      const r1 = p.r0 + (p.r1 - p.r0) * (1 - (1 - u) * (1 - u));
      const r0 = p.r0 + (r1 - p.r0) * 0.45;
      ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1, p.size * t);
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(p.ang) * r0, p.y + Math.sin(p.ang) * r0);
      ctx.lineTo(p.x + Math.cos(p.ang) * r1, p.y + Math.sin(p.ang) * r1);
      ctx.stroke();
      break;
    }
    case 'ring': {
      const r = p.r0 + (p.r1 - p.r0) * (1 - (1 - u) * (1 - u));
      ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(0.6, p.w * t);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, Math.abs(r)), 0, TAU); ctx.stroke();
      break;
    }
    case 'arc': {
      const sweep = Math.min(1, u * 1.3);
      const head = p.a0 + (p.a1 - p.a0) * sweep;
      const tail = p.a0 + (p.a1 - p.a0) * Math.max(0, sweep - 0.5);
      ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1, p.w * (0.35 + 0.65 * t));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, tail, head, p.a1 < p.a0);
      ctx.stroke();
      break;
    }
    case 'cross': {
      const w = Math.max(1, s * 0.36);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - s / 2, p.y - w / 2, s, w);
      ctx.fillRect(p.x - w / 2, p.y - s / 2, w, s);
      break;
    }
    case 'tri': {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.moveTo(s, 0); ctx.lineTo(-s * 0.7, -s * 0.7); ctx.lineTo(-s * 0.7, s * 0.7);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      break;
    }
    case 'flake': {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.strokeStyle = p.col; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const ang = (i * Math.PI) / 3;
        ctx.moveTo(-Math.cos(ang) * s, -Math.sin(ang) * s);
        ctx.lineTo(Math.cos(ang) * s, Math.sin(ang) * s);
      }
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'bolt': {
      ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1, p.size);
      ctx.beginPath();
      const pts = p.pts;
      ctx.moveTo(p.x + pts[0].x, p.y + pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(p.x + pts[i].x, p.y + pts[i].y);
      ctx.stroke();
      break;
    }
    default: break;
  }
}

// ── 시스템 ──────────────────────────────────────────────────────

/**
 * 파티클/투사체 시스템 생성.
 * @returns {{spawn:Function, projectile:Function, update:Function, draw:Function, clear:Function, count:number}}
 */
export function createFxSystem() {
  const parts = [];
  const projs = [];
  // 합성 모드별 그리기 순번 (매 프레임 재사용 — 배열을 새로 만들지 않는다)
  const plain = [];
  const additive = [];
  // 상한 포화 시 밀어낼 자리 (라운드로빈). 항상 0번만 덮어쓰면 방금 넣은 것을 다시 지운다.
  let evictAt = 0;
  const emit = (p) => {
    if (parts.length < MAX_PARTICLES) { parts.push(p); return; }
    // 새 연출을 버리는 대신 이미 떠 있던 것을 하나 밀어낸다
    evictAt = (evictAt + 1) % parts.length;
    parts[evictAt] = p;
  };

  function spawn(type, x, y, opts = {}) {
    const t = SPAWN[type] ? type : (SPAWN[ALIAS[type]] ? ALIAS[type] : 'hit');
    const o = {
      dir: opts.dir === -1 ? -1 : 1,
      scale: opts.scale || 1,
      count: opts.count || 0,
      color: opts.color || null,
      color2: opts.color2 || null,
      power: opts.power || 1,
      crit: !!opts.crit,
    };
    SPAWN[t](emit, x, y, o);
    if (opts.crit && !SKIP_AUTO_CRIT[t]) SPAWN.crit(emit, x, y, o);
    return t;
  }

  function projectile(kind, from, to, opts = {}) {
    const p = createProjectile(kind, from, to, opts);
    projs.push(p);
    return p;
  }

  function update(dt) {
    const d = Math.min(dt, 0.05);
    // 죽은 파티클은 splice 대신 **한 번의 앞당김(compaction)** 으로 걷어낸다.
    // splice 는 호출마다 뒤쪽 전체를 옮기므로 파티클이 수백 개일 때 O(n^2) 가 된다.
    // 이 방식은 O(n) 이고 생성 순서(= 겹침 순서)도 그대로 보존한다.
    let w = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.life -= d;
      if (p.life <= 0) continue;
      if (p.g) p.vy += p.g * d;
      if (p.drag) { const f = Math.max(0, 1 - p.drag * d); p.vx *= f; p.vy *= f; }
      p.x += p.vx * d;
      p.y += p.vy * d;
      if (p.wob) { p.phase += p.wobF * d; p.x += Math.sin(p.phase) * p.wob * d; }
      if (p.vr) p.rot += p.vr * d;
      parts[w++] = p;
    }
    parts.length = w;
    for (let i = projs.length - 1; i >= 0; i--) {
      const p = projs[i];
      const done = p.update(d);
      if (p.trail) {
        // 잔상 간격. 0.022 → 0.03 (투사체 하나가 상시 띄우는 파티클 수를 3분의 1 줄인다)
        p._tr += d;
        while (p._tr >= 0.03) { p._tr -= 0.03; trailParticle(emit, p); }
      }
      if (done) {
        projs.splice(i, 1);
        if (p.impact) spawn(p.kind, p.tx, p.ty, { dir: p.dir, color: p.color, scale: p.scale });
        if (p.onHit) p.onHit(p);
      }
    }
  }

  function draw(ctx) {
    if (!parts.length && !projs.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 합성 모드로 두 묶음을 나눠 각각 한 번씩만 설정한다 (파티클마다 토글하지 않는다).
    // 가산(blend) 파티클이 일반 파티클 위에 오는데, 불티/섬광이 핏자국 위에 얹히는
    // 자연스러운 순서라 연출은 그대로다.
    plain.length = 0;
    additive.length = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      (p.blend ? additive : plain).push(p);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < plain.length; i++) drawParticle(ctx, plain[i]);
    if (additive.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < additive.length; i++) drawParticle(ctx, additive[i]);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < projs.length; i++) drawProjectile(ctx, projs[i]);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  function clear() { parts.length = 0; projs.length = 0; }

  return {
    spawn, projectile, update, draw, clear,
    get count() { return parts.length + projs.length; },
    get particles() { return parts; },
    get projectiles() { return projs; },
  };
}
