// tools/openpose.mjs — OpenPose(body-25 중 body-18) 골격 그림을 **좌표에서 직접** 그린다. HANDOFF §166.
//
//   node tools/openpose.mjs --pose=swing_sword --w=896 --h=1152 --out=pose.png
//   node tools/openpose.mjs --list                     # 자세 목록
//   node tools/openpose.mjs --sheet=out.png            # 전 자세를 한 장에 (눈으로 확인용)
//
// ★ 왜 직접 그리나
//   ControlNet 은 «사람 그림» 이 아니라 **막대 골격 그림**을 본다. 그 그림을 얻는 흔한 길은
//   전처리기(DWPose·OpenPose estimator)를 돌리는 것인데, 그러려면 모델을 더 받아야 하고
//   결과가 원본 그림에 딸려 온다 — 우리는 **없는 자세**(공격)를 만들고 싶은 것이라 원본이 없다.
//   좌표를 손으로 적으면 모델도 안 받고, 자세가 **결정적**이고, 무기별로 골라 쓸 수 있다.
//
// ★ 규약 (OpenPose body-18)
//   점 18개: 0 코 · 1 목 · 2 오른어깨 · 3 오른팔꿈치 · 4 오른손 · 5 왼어깨 · 6 왼팔꿈치 · 7 왼손
//            8 오른골반 · 9 오른무릎 · 10 오른발 · 11 왼골반 · 12 왼무릎 · 13 왼발
//            14 오른눈 · 15 왼눈 · 16 오른귀 · 17 왼귀
//   «오른/왼» 은 **그림 속 인물 기준**이다 (보는 사람의 왼쪽이 인물의 오른쪽).
//   선 19개와 점·선 색은 OpenPose 가 쓰는 값 그대로다 — ControlNet 이 그 색으로 부위를 읽는다.
//   좌표는 0~1 정규화(가로·세로)로 적고, 그릴 때 폭·높이를 곱한다.

import fs from 'node:fs';
import path from 'node:path';
import { encodePng } from './lib/png.mjs';

/** 선 잇기 — [점A, 점B] 18점 기준. OpenPose 원본 순서. */
const LIMBS = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10],
  [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];
/** 선 색 (OpenPose 표준) — 순서는 LIMBS 와 짝이다 */
const LIMB_COLOR = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0],
  [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255],
  [170, 0, 255], [255, 0, 255], [255, 0, 170],
];
/** 점 색 (OpenPose 표준) — 18개 */
const POINT_COLOR = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0],
  [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255],
  [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85],
];

/**
 * 자세 목록 — 값은 18점의 [x, y] (0~1). null 이면 «안 보이는 점» (그리지 않는다).
 *
 * ★ 공통 규약: 발이 y≈0.95, 머리가 y≈0.08 — 우리 그림틀(전신, 발이 바닥)과 같다.
 *   무게중심(목 1번)은 x≈0.5 근처에 두되, 내지르는 자세는 앞쪽으로 옮긴다.
 * ★ 인물은 **보는 사람 쪽을 살짝 향한다**(3/4). 그래서 어깨·골반 폭이 좌우 비대칭이다.
 */
/**
 * ★ 기준 골격 — 여기서 팔·다리만 덮어써서 자세를 만든다.
 *
 *   비율은 애니 전신 기준으로 잡았다 (첫 판은 머리가 전신의 7% 라 모델이 «작은 머리» 를 그렸다):
 *     머리 꼭대기 ≈ 0.04 · 코 0.10 · 목 0.19 · 골반 0.50 · 무릎 0.72 · 발목 0.94
 *     어깨 폭 ±0.075 · 골반 폭 ±0.045 · 위팔 0.115 · 아래팔 0.11 (전신 대비)
 *   ControlNet 은 이 점 사이 «거리» 로 몸 크기를 읽는다 — 머리가 작으면 작은 머리를 그린다.
 */
const BASE = {
  0: [0.500, 0.100],  1: [0.500, 0.190],
  2: [0.575, 0.205],  3: [0.600, 0.320],  4: [0.610, 0.430],
  5: [0.425, 0.205],  6: [0.400, 0.320],  7: [0.390, 0.430],
  8: [0.545, 0.500],  9: [0.555, 0.720], 10: [0.565, 0.940],
  11: [0.455, 0.500], 12: [0.445, 0.720], 13: [0.435, 0.940],
  14: [0.522, 0.088], 15: [0.478, 0.088], 16: [0.545, 0.098], 17: [0.455, 0.098],
};
/** 기준에서 몇 점만 바꾼다. 머리(0·14~17)는 목과 함께 통째로 옮긴다. */
function pose(over = {}, headDx = 0, headDy = 0) {
  const pts = [];
  for (let i = 0; i < 18; i++) {
    let p = over[i] || BASE[i];
    if (!over[i] && (i === 0 || i === 1 || i >= 14)) p = [p[0] + headDx, p[1] + headDy];
    pts.push([...p]);
  }
  return pts;
}

/**
 * 자세 목록. `pts` 는 18점 [x, y] (0~1, 그림 속 인물 기준의 좌/우).
 * 공통: 발이 y≈0.94, 머리 꼭대기 y≈0.04 — 우리 그림틀(전신·발이 바닥)과 같다.
 */
export const POSES = {
  swing_sword: {
    desc: '검 내려베기 — 몸을 앞으로 접고 오른팔을 머리 뒤까지 (깊은 런지)',
    pts: pose({ 1: [0.520, 0.235], 2: [0.590, 0.250], 5: [0.445, 0.250],
      3: [0.665, 0.150], 4: [0.640, 0.035],                 // 오른팔이 머리 뒤로 완전히
      6: [0.395, 0.330], 7: [0.500, 0.290],                 // 왼손은 자루 아래를 받친다
      8: [0.565, 0.520], 9: [0.690, 0.700], 10: [0.790, 0.930],   // 앞다리 크게 내딛고
      11: [0.475, 0.520], 12: [0.335, 0.760], 13: [0.180, 0.930] }, 0.02, 0.045),
  },
  swing_great: {
    desc: '대검 머리 위 양손 — 다리 크게 벌리고 허리 낮춤',
    pts: pose({ 1: [0.500, 0.225], 2: [0.585, 0.240], 5: [0.415, 0.240],
      3: [0.640, 0.135], 4: [0.575, 0.030],                 // 양손이 머리 훨씬 위에서 만난다
      6: [0.360, 0.135], 7: [0.520, 0.035],
      8: [0.550, 0.520], 9: [0.665, 0.715], 10: [0.760, 0.935],
      11: [0.450, 0.520], 12: [0.335, 0.715], 13: [0.235, 0.935] }, 0, 0.03),
  },
  thrust: {
    desc: '창 찌르기 — 앞다리 깊게 굽히고 뒷다리 곧게, 양손이 자루를 앞으로',
    pts: pose({ 1: [0.440, 0.250], 2: [0.510, 0.262], 5: [0.370, 0.262],
      3: [0.640, 0.285], 4: [0.800, 0.300],                 // 오른팔 끝까지 앞으로
      6: [0.315, 0.320], 7: [0.470, 0.310],                 // 왼손은 자루 뒤를 잡는다
      8: [0.480, 0.530], 9: [0.640, 0.690], 10: [0.780, 0.930],   // 앞다리 깊은 런지
      11: [0.395, 0.530], 12: [0.265, 0.760], 13: [0.130, 0.930] }, -0.055, 0.055),
  },
  draw_bow: {
    desc: '활 당기기 (왼팔 전방 직선, 오른손 턱 옆)',
    pts: pose({ 3: [0.585, 0.265], 4: [0.545, 0.185],       // 오른손을 턱 옆으로
      6: [0.320, 0.215], 7: [0.215, 0.225],                 // 왼팔 앞으로 곧게
      9: [0.580, 0.720], 10: [0.605, 0.940],
      12: [0.420, 0.720], 13: [0.395, 0.940] }),
  },
  aim_crossbow: {
    desc: '석궁 겨누기 — 양팔을 눈높이로 앞으로 뻗고 옆으로 선다',
    pts: pose({ 1: [0.470, 0.200], 2: [0.545, 0.212], 5: [0.400, 0.212],
      3: [0.655, 0.205], 4: [0.775, 0.185],                 // 오른팔 앞으로 곧게
      6: [0.500, 0.235], 7: [0.700, 0.200],                 // 왼손이 총열 아래를 받친다
      8: [0.520, 0.505], 9: [0.610, 0.715], 10: [0.690, 0.935],
      11: [0.430, 0.505], 12: [0.330, 0.730], 13: [0.240, 0.935] }, -0.03, 0.005),
  },
  cast_staff: {
    desc: '지팡이 시전 (오른손 어깨 높이로 세워 잡고 왼손 앞)',
    pts: pose({ 3: [0.645, 0.275], 4: [0.665, 0.155],
      6: [0.355, 0.300], 7: [0.275, 0.345],
      9: [0.575, 0.720], 10: [0.595, 0.940],
      12: [0.425, 0.720], 13: [0.405, 0.940] }),
  },
  cast_wand: {
    desc: '완드 시전 (오른손 전방)',
    pts: pose({ 3: [0.655, 0.240], 4: [0.760, 0.255],
      6: [0.370, 0.315], 7: [0.450, 0.355],
      9: [0.580, 0.720], 10: [0.605, 0.940],
      12: [0.420, 0.720], 13: [0.390, 0.940] }, -0.015, 0),
  },
  stab_dagger: {
    desc: '단검 찌르기 (오른손 낮게 전방, 낮은 자세)',
    pts: pose({ 1: [0.470, 0.215], 2: [0.545, 0.230], 5: [0.395, 0.230],
      3: [0.630, 0.300], 4: [0.735, 0.335],
      6: [0.330, 0.320], 7: [0.395, 0.375],
      8: [0.515, 0.520], 9: [0.620, 0.735], 10: [0.710, 0.940],
      11: [0.425, 0.520], 12: [0.330, 0.740], 13: [0.250, 0.940] }, -0.03, 0.025),
  },
  claw_strike: {
    desc: '클로 격타 (양팔 전방, 격투 자세)',
    pts: pose({ 3: [0.650, 0.285], 4: [0.735, 0.330],
      6: [0.350, 0.300], 7: [0.415, 0.370],
      9: [0.590, 0.725], 10: [0.640, 0.940],
      12: [0.410, 0.725], 13: [0.350, 0.940] }, -0.015, 0.005),
  },
  swing_axe: {
    desc: '도끼 후리기 — 몸을 크게 비틀고 양손을 어깨 위 반대편으로',
    pts: pose({ 1: [0.480, 0.230], 2: [0.555, 0.242], 5: [0.410, 0.242],
      3: [0.690, 0.215], 4: [0.775, 0.105],                 // 오른팔이 머리 옆 위로
      6: [0.395, 0.300], 7: [0.585, 0.185],                 // 왼손도 자루 위쪽
      8: [0.530, 0.520], 9: [0.660, 0.710], 10: [0.760, 0.935],
      11: [0.440, 0.520], 12: [0.320, 0.730], 13: [0.215, 0.935] }, -0.02, 0.035),
  },
  swing_scythe: {
    desc: '낫 후리기 (양손, 몸 비틀기)',
    pts: pose({ 3: [0.650, 0.300], 4: [0.700, 0.400],
      6: [0.360, 0.320], 7: [0.605, 0.375],
      9: [0.590, 0.720], 10: [0.635, 0.940],
      12: [0.415, 0.720], 13: [0.360, 0.940] }, -0.015, 0),
  },
  shield_bash: {
    desc: '방패 밀치기 (왼손 전방, 오른손 무기)',
    pts: pose({ 3: [0.625, 0.290], 4: [0.665, 0.195],
      6: [0.310, 0.265], 7: [0.220, 0.280],
      8: [0.520, 0.505], 9: [0.615, 0.725], 10: [0.685, 0.940],
      11: [0.430, 0.505], 12: [0.350, 0.725], 13: [0.285, 0.940] }, -0.025, 0.005),
  },
};

/** 무기(equip[0]) → 자세. 없는 것은 claw_strike. */
export const POSE_FOR_WEAPON = {
  sword: 'swing_sword', katana: 'swing_sword', rapier: 'thrust',
  greatsword: 'swing_great', greataxe: 'swing_great', hammer: 'swing_great',
  axe: 'swing_axe', mace: 'swing_axe',
  spear: 'thrust', pike: 'thrust', halberd: 'thrust',
  bow: 'draw_bow', longbow: 'draw_bow', crossbow: 'aim_crossbow',
  staff: 'cast_staff', wand: 'cast_wand', tome: 'cast_wand', orb: 'cast_wand',
  dagger: 'stab_dagger', twindagger: 'stab_dagger',
  scythe: 'swing_scythe', claw: 'claw_strike', shield: 'shield_bash',
};

/** 굵은 선 하나 (안티에일리어싱 없음 — ControlNet 은 색만 본다) */
function line(buf, W, H, x0, y0, x1, y1, col, width) {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  const r = width / 2;
  for (let i = 0; i <= n; i++) {
    const cx = x0 + (dx * i) / n, cy = y0 + (dy * i) / n;
    for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
      for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if ((xx - cx) ** 2 + (yy - cy) ** 2 > r * r) continue;
        const o = (yy * W + xx) * 4;
        buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
      }
    }
  }
}

function dot(buf, W, H, cx, cy, col, r) {
  for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
    for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if ((xx - cx) ** 2 + (yy - cy) ** 2 > r * r) continue;
      const o = (yy * W + xx) * 4;
      buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
    }
  }
}

/**
 * 골격 그림 하나. 배경은 검정 (OpenPose 규약).
 * @param {number[][]} pts 18점 [x,y] 정규화 좌표 (null 이면 안 그린다)
 */
export function renderPose(pts, W, H, opts = {}) {
  const limbW = opts.limbWidth || Math.max(4, Math.round(W / 100));
  const dotR = opts.dotRadius || Math.max(3, Math.round(W / 130));
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) buf[i * 4 + 3] = 255;      // 검정 불투명
  const px = (p) => (p ? [p[0] * W, p[1] * H] : null);
  LIMBS.forEach(([a, b], i) => {
    const pa = px(pts[a]), pb = px(pts[b]);
    if (!pa || !pb) return;
    line(buf, W, H, pa[0], pa[1], pb[0], pb[1], LIMB_COLOR[i], limbW);
  });
  pts.forEach((p, i) => { const q = px(p); if (q) dot(buf, W, H, q[0], q[1], POINT_COLOR[i], dotR); });
  return buf;
}

/* ─────────────────────────── CLI ─────────────────────────── */
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const args = process.argv.slice(2);
  const arg = (k, d) => { const h = args.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
  const flag = (k) => args.includes(`--${k}`);
  const W = Number(arg('w', 896)), H = Number(arg('h', 1152));

  if (flag('list')) {
    for (const [k, v] of Object.entries(POSES)) console.log(`${k.padEnd(16)} ${v.desc}`);
    console.log('\n무기 → 자세:');
    for (const [k, v] of Object.entries(POSE_FOR_WEAPON)) console.log(`  ${k.padEnd(12)} ${v}`);
    process.exit(0);
  }

  const sheet = arg('sheet', '');
  if (sheet) {
    const keys = Object.keys(POSES);
    const cw = Math.round(W / 3), ch = Math.round(H / 3);
    const cols = 4, rows = Math.ceil(keys.length / cols);
    const SW = cols * cw, SH = rows * ch;
    const out = new Uint8ClampedArray(SW * SH * 4);
    for (let i = 0; i < SW * SH; i++) out[i * 4 + 3] = 255;
    keys.forEach((k, i) => {
      const b = renderPose(POSES[k].pts, cw, ch, { limbWidth: Math.max(3, Math.round(cw / 90)), dotRadius: Math.max(2, Math.round(cw / 120)) });
      const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const s = (y * cw + x) * 4, d = ((oy + y) * SW + ox + x) * 4;
        out[d] = b[s]; out[d + 1] = b[s + 1]; out[d + 2] = b[s + 2]; out[d + 3] = 255;
      }
    });
    fs.writeFileSync(sheet, encodePng(SW, SH, Buffer.from(out.buffer)));
    console.log(`${sheet} ${SW}x${SH} · ${keys.length}자세: ${keys.join(', ')}`);
    process.exit(0);
  }

  const name = arg('pose', '');
  const p = POSES[name];
  if (!p) { console.error(`자세 이름이 필요하다 (--list 로 확인): ${name}`); process.exit(1); }
  const out = arg('out', `${name}.png`);
  const buf = renderPose(p.pts, W, H);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, encodePng(W, H, Buffer.from(buf.buffer)));
  console.log(`${out} ${W}x${H} · ${name} (${p.desc})`);
}
