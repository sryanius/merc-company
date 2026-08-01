// 세로 전투(폰) 검증 — 헤드리스 계산기. 실패 시 exit 1. (12차 세션 신설)
//
// 무엇을 재는가
//   A. 캔버스 CSS 크기 / 스프라이트의 **화면상** 폭 (목표 64 CSS px 이상)
//   B. 7대7 초기 진형에서 유닛끼리 얼마나 겹치는가 (12진형 전수 · 세로 vs PC 비교)
//   C. 이름표·데미지 숫자 등 오버레이 글자의 화면상 크기 (목표 12 CSS px 이상)
//   D. PC(1280px) 회귀 — 캔버스·매핑·배율이 예전 값 그대로인가
//
// ── 이 파일은 세 곳의 계산을 그대로 옮긴 것이다. 원본을 고치면 여기도 고쳐라
//   · `src/ui/battle.js  stageSpec()`      캔버스 논리 크기
//   · `src/battle/renderer.js layout()/f2x/f2y/autoUiScale()`  화면 매핑 · 오버레이 배율
//   · `src/art/spritegen.js drawSpriteFrame()`  스프라이트가 차지하는 사각형
//   브라우저 실측(`tools/portraitaudit.js`)과 값이 어긋나면 **여기가 틀린 것이다.**
//
// 사용법
//   node tools/portrait.mjs
//   node tools/portrait.mjs --verbose      진형별 상세
//
import { FORMATIONS } from '../src/data/formations.js';

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');

/* ───────────────────────────────── 상수 (원본과 같은 값이어야 한다) */

/** ui/battle.js */
const NARROW_PX = 767;
const PHONE_SPRITE_PX = 70;
const PHONE_W_MIN = 340, PHONE_W_MAX = 640;
const PHONE_H_MIN = 360, PHONE_H_MAX = 1100;

/** battle/renderer.js */
const SPRITE_SCALE = 3;
const FIELD_W = 100, FIELD_H = 60;
const PORTRAIT_ASPECT = 0.72;
const P_EDGE = 0.06, P_GAPH = 0.095;
const P_FEET0 = 0.38, P_FEET1 = 0.955;
const UI_MAX = 2.2, UI_AIM_WIDE = 0.95, UI_AIM_TALL = 1.22;
const FS_NAME = 12, FS_LV = 10, FS_TIME = 14, FS_SPEED = 12, FS_BANNER = 13;
/** 가장 작은 데미지 팝업 계수 (renderer.js addPop 의 size 인자 최솟값) */
const POP_MIN_SIZE = 0.86;

/** art/spritegen.js */
const SPRITE_W = 32, SPRITE_H = 40, FOOT_Y = 38;
/**
 * 스프라이트 셀(32x40) 안에서 **실제로 칠해지는** 몸통 상자.
 * 브라우저 실측값이다 (`tools/portraitaudit.js` 의 alphaBox 를 7대7 14기에 돌린 결과 —
 * 폭 15~23 / 높이 35~39 논리 px, 중앙값 21x37). 여기서는 **최댓값**을 쓴다(보수적).
 * 겹침을 32x40 셀 기준으로만 재면 실제로 보이는 것보다 훨씬 심하게 나오므로 이 상자로도 함께 잰다.
 */
const BODY = { w: 23, h: 39 };

/* ───────────────────────────────── CSS 박스 모델
   전투 캔버스의 표시 폭 = 뷰포트 - (#screen 좌우 패딩) - (.panel 테두리) - (.battle-stage 테두리).
   css/style.css 실측:
     폰(≤767) #screen 좌우 padding = max(10px, safe) = 10  / PC = 18
     .panel 테두리 1px x2 · .battle-stage 테두리 1px x2
   PC 는 세로 스크롤바(::-webkit-scrollbar width:10px)가 붙는다 — 실측 1280 -> 1230.
   전부 브라우저 실측으로 맞춰 둔 값이다(§15.1 표). */
function canvasCssWidth(vw) {
  if (vw > NARROW_PX) return vw - 10 /* 스크롤바 */ - 18 * 2 - 2 - 2;
  return vw - 10 * 2 - 2 - 2;
}

/* ───────────────────────────────── ui/battle.js stageSpec() */

/**
 * 캔버스 논리 크기.
 * @param {number} vw 뷰포트 폭
 * @param {number} stageCssH 캔버스가 쓸 수 있는 세로 공간(CSS px). 폰에서만 쓴다.
 */
function stageSpec(vw, stageCssH) {
  if (vw > NARROW_PX) return { w: 1280, h: 560 };
  const dispW = Math.max(240, canvasCssWidth(vw));
  const w = clamp(Math.round((dispW * 96) / PHONE_SPRITE_PX / 10) * 10, PHONE_W_MIN, PHONE_W_MAX);
  const scale = dispW / w;
  const h = clamp(Math.round(stageCssH / scale / 10) * 10, PHONE_H_MIN, PHONE_H_MAX);
  return { w, h };
}

/* ───────────────────────────────── battle/renderer.js layout() */

function makeMap(W, H, cssW) {
  const portrait = H >= W * PORTRAIT_ASPECT;
  let GY0, GY1, GX0, GX1, PGAP = 0, PK = 0;
  if (portrait) {
    const slope = ((P_FEET1 - P_FEET0) * H) / 44;
    GY0 = Math.round(P_FEET0 * H - 8 * slope);
    GY1 = Math.round(GY0 + 60 * slope);
    const edge = Math.round(W * P_EDGE);
    PGAP = Math.round(W * P_GAPH);
    PK = (W / 2 - edge - PGAP) / 36;
    GX0 = edge; GX1 = W - edge;
  } else {
    GY0 = Math.round(H * 0.44);
    GY1 = Math.round(H * 0.985);
    GX0 = Math.round(Math.min(90, W * 0.06));
    GX1 = W - GX0;
  }
  const f2x = (fx) => {
    if (!portrait) return GX0 + (fx / FIELD_W) * (GX1 - GX0);
    const c = W / 2, d = fx - 50;
    if (d >= -6 && d <= 6) return c + (d / 6) * PGAP;
    return c + (d < 0 ? -1 : 1) * (PGAP + (Math.abs(d) - 6) * PK);
  };
  const f2y = (fy) => GY0 + (fy / FIELD_H) * (GY1 - GY0);
  const disp = cssW / W;                                    // 논리 1px -> CSS px
  const uiScale = clamp((portrait ? UI_AIM_TALL : UI_AIM_WIDE) / disp, 1, UI_MAX);
  return { portrait, GX0, GX1, GY0, GY1, PGAP, PK, f2x, f2y, disp, uiScale, W, H };
}

/* ───────────────────────────────── 유닛 사각형 */

/** 엔진의 슬롯 -> 필드 좌표 변환 (battle/engine.js makeUnit). 여기는 절대 바꾸지 않는다. */
const fieldPos = (slot, side) => ({
  x: side === 'ally' ? 44 - slot.x * 36 : 56 + slot.x * 36,
  y: 8 + slot.y * 44,
});

/**
 * 유닛이 화면에서 차지하는 사각형(CSS px).
 * `drawSpriteFrame` 은 발밑(x, y)을 기준으로 셀을 그린다: 좌상단 = (x - dw/2, y - FOOT_Y*scale).
 */
function unitRect(map, fp, box) {
  const cx = map.f2x(fp.x), fy = map.f2y(fp.y);
  const dw = SPRITE_W * SPRITE_SCALE, dh = SPRITE_H * SPRITE_SCALE;
  const left = cx - dw / 2, top = fy - FOOT_Y * SPRITE_SCALE;
  // 셀 안에서 몸통 상자는 가로 가운데 · 발밑에 붙어 있다
  const bw = box.w * SPRITE_SCALE, bh = box.h * SPRITE_SCALE;
  const bx = box === BODY ? cx - bw / 2 : left;
  const by = box === BODY ? top + (dh - bh) : top;
  const w = box === BODY ? bw : dw, h = box === BODY ? bh : dh;
  return { x: bx * map.disp, y: by * map.disp, w: w * map.disp, h: h * map.disp };
}

function overlapRatio(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

/** 7대7 초기 진형의 겹침 통계 */
function overlapStats(map, formationId, box) {
  const f = FORMATIONS[formationId];
  const rects = [];
  for (const side of ['ally', 'enemy']) {
    for (const s of f.slots) rects.push(unitRect(map, fieldPos(s, side), box));
  }
  let pairs = 0, max = 0, over50 = 0, over30 = 0;
  let minGapX = Infinity;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const v = overlapRatio(rects[i], rects[j]);
      if (v > 0) { pairs++; if (v > max) max = v; if (v > 0.5) over50++; if (v > 0.3) over30++; }
    }
  }
  // 같은 진영·같은 열에서 가장 가까운 두 유닛의 중심 거리 (얼마나 촘촘한가)
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const d = Math.hypot((rects[i].x - rects[j].x), (rects[i].y - rects[j].y));
      if (d < minGapX) minGapX = d;
    }
  }
  return { pairs, max, over50, over30, minCenterDist: minGapX };
}

/* ───────────────────────────────── 유틸 */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const f2 = (n) => Math.round(n * 100) / 100;

let fails = 0, checks = 0;
function check(ok, label, detail) {
  checks++;
  if (!ok) fails++;
  console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
}
const head = (s) => console.log(`\n── ${s}`);

/* ───────────────────────────────── 기준 뷰포트
   stageCssH 는 브라우저 실측값이다 (HUD 2줄 + 전투 바 2줄 + 로그 토글 + 하단 탭 바를 뺀 나머지).
   실측: 360x800 -> 캔버스 CSS 504 / 390x844 -> 549. 여기서 다시 논리 높이를 역산한다. */
const VIEWS = [
  { name: '360x800 (안드로이드 보급형)', vw: 360, vh: 800, stageCssH: 504 },
  { name: '390x844 (iPhone)', vw: 390, vh: 844, stageCssH: 549 },
];

console.log('용병단 — 세로 전투(폰) 검증');
console.log('='.repeat(64));

/* A. 캔버스 · 스프라이트 크기 */
head('A. 캔버스 CSS 크기와 스프라이트의 화면상 폭 (목표 ≥ 64 CSS px)');
const maps = {};
for (const v of VIEWS) {
  const cssW = canvasCssWidth(v.vw);
  const sp = stageSpec(v.vw, v.stageCssH);
  const map = makeMap(sp.w, sp.h, cssW);
  maps[v.vw] = map;
  const spriteCss = SPRITE_W * SPRITE_SCALE * map.disp;
  const bodyCss = BODY.w * SPRITE_SCALE * map.disp;
  console.log(`   ${v.name}`);
  console.log(`     캔버스 논리 ${sp.w}x${sp.h} · CSS ${f2(cssW)}x${f2(sp.h * map.disp)} · 표시배율 ${f2(map.disp)}`);
  check(map.portrait, `세로 매핑으로 전환 (H/W ${f2(sp.h / sp.w)} ≥ ${PORTRAIT_ASPECT})`);
  check(spriteCss >= 64, `스프라이트 셀 ${f2(spriteCss)} CSS px`, `몸통 ${f2(bodyCss)} px`);
  check(sp.h * map.disp <= v.vh, `캔버스가 화면 세로를 넘지 않는다 (${f2(sp.h * map.disp)} ≤ ${v.vh})`);
}

/* B. 겹침 */
head('B. 7대7 초기 진형 겹침 — 12진형 전수 (겹침비 = 교집합/작은 쪽 넓이)');
const pcMap = makeMap(1280, 560, canvasCssWidth(1280));
const ids = Object.keys(FORMATIONS);
function sweep(map) {
  let worstCell = 0, worstBody = 0, sum50 = 0, sumPairs = 0, worstId = '';
  const rows = [];
  for (const id of ids) {
    const c = overlapStats(map, id, { w: SPRITE_W, h: SPRITE_H });
    const b = overlapStats(map, id, BODY);
    rows.push({ id, cell: c, body: b });
    if (c.max > worstCell) worstCell = c.max;
    if (b.max > worstBody) { worstBody = b.max; worstId = id; }
    sum50 += b.over50; sumPairs += b.pairs;
  }
  return { worstCell, worstBody, worstId, sum50, sumPairs, rows };
}
const pcSweep = sweep(pcMap);
for (const v of VIEWS) {
  const s = sweep(maps[v.vw]);
  console.log(`   ${v.name}`);
  console.log(`     몸통 겹침: 최대 ${f2(s.worstBody)} (${s.worstId}) · 0.5 초과 ${s.sum50}쌍 · 겹치는 쌍 합계 ${s.sumPairs}`);
  console.log(`     셀 겹침  : 최대 ${f2(s.worstCell)}`);
  // 판정 기준: **PC 보다 나빠지지 않는다.** PC 는 플레이어가 이미 받아들인 기준선이다.
  check(s.worstBody <= pcSweep.worstBody + 0.02,
    `최대 몸통 겹침이 PC 이하 (세로 ${f2(s.worstBody)} vs PC ${f2(pcSweep.worstBody)})`);
  check(s.sum50 <= pcSweep.sum50,
    `0.5 초과 겹침 쌍이 PC 이하 (세로 ${s.sum50} vs PC ${pcSweep.sum50})`);
  if (VERBOSE) {
    for (const r of s.rows) {
      console.log(`       ${FORMATIONS[r.id].name.padEnd(6)} 몸통 max ${f2(r.body.max).toFixed(2)} · >0.5 ${r.body.over50} · 셀 max ${f2(r.cell.max).toFixed(2)}`);
    }
  }
}
console.log(`   PC 1280 기준선: 몸통 최대 ${f2(pcSweep.worstBody)} (${pcSweep.worstId}) · 0.5 초과 ${pcSweep.sum50}쌍`);

/* C. 오버레이 글자 */
head('C. 오버레이 글자의 화면상 크기 (목표 ≥ 12 CSS px)');
for (const v of VIEWS) {
  const m = maps[v.vw];
  const px = (base) => Math.max(8, Math.round(base * m.uiScale)) * m.disp;
  const items = [
    ['이름표', FS_NAME], ['Lv', FS_LV], ['남은 시간', FS_TIME],
    ['배속', FS_SPEED], ['진영 배너', FS_BANNER],
    ['데미지 숫자', 15], ['가장 작은 팝업', 15 * POP_MIN_SIZE],
  ];
  const worst = Math.min(...items.map(([, b]) => px(b)));
  console.log(`   ${v.name} · uiScale ${f2(m.uiScale)}`);
  console.log(`     ${items.map(([n, b]) => `${n} ${f2(px(b))}`).join(' · ')}`);
  check(worst >= 12, `가장 작은 글자 ${f2(worst)} CSS px`);
  // HP 바는 글자가 아니다 — 수치만 보고한다 (판정 대상 아님)
  const bw = Math.round(clamp(m.PK * 12, 40, 66)) * m.disp;
  const bh = Math.max(6, Math.round(6 * m.uiScale * 0.8)) * m.disp;
  console.log(`     HP 바 ${f2(bw)}x${f2(bh)} CSS px (판정 대상 아님 — PC 는 ${f2(58 * pcMap.disp)}x${f2(6 * pcMap.disp)})`);
}

/* D. PC 회귀 */
head('D. PC 1280px 회귀 — 예전 값 그대로인가');
{
  const sp = stageSpec(1280, 0);
  check(sp.w === 1280 && sp.h === 560, `캔버스 논리 ${sp.w}x${sp.h}`, '예전 값 1280x560');
  check(pcMap.portrait === false, '세로 매핑을 타지 않는다', `H/W ${f2(560 / 1280)} < ${PORTRAIT_ASPECT}`);
  check(pcMap.uiScale === 1, `uiScale ${pcMap.uiScale}`, '1 이면 모든 오버레이가 예전 상수 그대로다');
  check(pcMap.GX0 === 77 && pcMap.GX1 === 1203, `GX0/GX1 ${pcMap.GX0}/${pcMap.GX1}`, '예전 값 77/1203');
  check(pcMap.GY0 === 246 && pcMap.GY1 === 552, `GY0/GY1 ${pcMap.GY0}/${pcMap.GY1}`, '예전 값 246/552');
  const px = SPRITE_W * SPRITE_SCALE * pcMap.disp;
  check(px > 90, `스프라이트 셀 ${f2(px)} CSS px`, `표시배율 ${f2(pcMap.disp)}`);
  // 필드 -> 화면 매핑이 단순 선형인지 (조각별 매핑을 타면 PC 그림이 달라진다)
  const lin = [0, 25, 50, 75, 100].map((x) => f2(pcMap.f2x(x)));
  const step = f2(lin[1] - lin[0]);
  check(lin.every((_, i) => i === 0 || f2(lin[i] - lin[i - 1]) === step), `f2x 가 등간격 선형 (${lin.join(' / ')})`);
}

/* 결과 */
console.log(`\n${'─'.repeat(64)}`);
if (fails) {
  console.log(`❌ ${fails}건 실패 / 검사 ${checks}건`);
  process.exit(1);
}
console.log(`✅ 전부 통과 — 검사 ${checks}건`);
