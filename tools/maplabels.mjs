/**
 * 월드맵 라벨 겹침 계측기
 * ────────────────────────────────────────────────────────────────
 * "지도 글자들이 겹쳐서 잘 안 보인다"는 지적을 눈이 아니라 숫자로 확인하기 위한 도구.
 *
 * worldmap.js 의 라벨 배치 계산(px/py/scale/thin/폰트 크기)을 그대로 옮겨 놓고,
 * 각 라벨의 사각형을 만들어 서로 겹치는 쌍을 센다. 캔버스가 없어도 돌아가야 하므로
 * 글자 폭은 추정한다 (한글 = 1.0em, 그 외 = 0.55em — 한글 도시명이 대부분이라 오차가 작다).
 *
 * 실행: node tools/maplabels.mjs
 */
import { CITIES, REGIONS } from '../src/data/world.js';

const MAP_W = 1000;
const MAP_H = 700;
const PAD = 60;
const NODE_R = (tier) => 9 + (tier || 1) * 2.2;

const px = (x) => PAD + (x / MAP_W) * (MAP_W - PAD * 2);
const py = (y) => PAD + (y / MAP_H) * (MAP_H - PAD * 2);

/** 캔버스 없이 쓰는 글자 폭 추정 (CSS px) */
function textW(s, fs) {
  let w = 0;
  for (const ch of String(s)) w += /[ㄱ-힝가-힣]/.test(ch) ? fs : fs * 0.55;
  return w;
}

function neighborsOf(id) {
  const c = CITIES.find((x) => x.id === id);
  return (c && c.links ? c.links : []).map((l) => l.to);
}

/**
 * 한 화면 폭에서 그려지는 라벨 사각형 전부를 만든다.
 * @param {number} viewW  캔버스 CSS 폭
 * @param {string} here   현재 도시 id
 * @param {{regions:boolean, linkDays:boolean}} opt  각 라벨군을 그리는지
 */

/**
 * `worldmap.js placeLabel` 과 같은 후보 순서로 빈자리를 찾는다.
 * ★ 후보 목록이 저기와 어긋나면 도구가 거짓말을 한다 — 실제로 한 번 어긋났다(§31).
 * @returns {{x:number,y:number}|null} 왼쪽위 좌표. 자리가 없으면 null
 */
function placeBox(taken, cx, cy, w, h, scale) {
  const gap = 4 * scale;
  const side = w / 2 + 6 * scale;
  const diag = gap * 0.72;
  const dside = side * 0.72;
  const cands = [
    { x: cx, y: cy + gap },
    { x: cx, y: cy - gap - h },
    { x: cx + side, y: cy - h / 2 },
    { x: cx - side, y: cy - h / 2 },
    { x: cx + dside, y: cy + diag },
    { x: cx - dside, y: cy + diag },
    { x: cx + dside, y: cy - diag - h },
    { x: cx - dside, y: cy - diag - h },
    { x: cx, y: cy + gap + h + 5 },
    { x: cx, y: cy - gap - h * 2 - 5 },
    { x: cx + side * 1.35, y: cy - h / 2 },
    { x: cx - side * 1.35, y: cy - h / 2 },
  ];
  for (const p of cands) {
    const box = { x: p.x - w / 2 - 4 * scale, y: p.y - 1, w: w + 8 * scale, h: h + 3 };
    const hit = taken.some((o) => {
      const ox = Math.min(box.x + box.w, o.x + o.w) - Math.max(box.x, o.x);
      const oy = Math.min(box.y + box.h, o.y + o.h) - Math.max(box.y, o.y);
      return ox > 1 && oy > 1;
    });
    if (!hit) return { x: box.x + 4 * scale, y: box.y + 1 };
  }
  return null;
}

function layoutLabels(viewW, here, opt) {
  const scale = viewW / MAP_W;
  const thin = viewW < 560;
  const sx = (x) => px(x) * scale;
  const sy = (y) => py(y) * scale;
  const nodeR = (tier) => Math.max(thin ? 7 : 0, NODE_R(tier) * scale);
  const adj = new Set(neighborsOf(here));
  const out = [];

  // ── 지역 이름 (drawRegions)
  if (opt.regions) {
    for (const reg of REGIONS) {
      const cs = CITIES.filter((c) => c.regionId === reg.id);
      if (!cs.length) continue;
      const cx = cs.reduce((a, c) => a + c.x, 0) / cs.length;
      const cy = cs.reduce((a, c) => a + c.y, 0) / cs.length;
      const f1 = Math.max(10, Math.round(13 * scale));
      const f2 = Math.max(9, Math.round(10 * scale));
      const t2 = `${reg.biome} · ${reg.tier}등급`;
      out.push({ kind: 'region', t: reg.name, x: sx(cx) - textW(reg.name, f1) / 2, y: sy(cy) - 74 * scale - f1 * 0.8, w: textW(reg.name, f1), h: f1, fs: f1 });
      out.push({ kind: 'region', t: t2, x: sx(cx) - textW(t2, f2) / 2, y: sy(cy) - 60 * scale - f2 * 0.8, w: textW(t2, f2), h: f2, fs: f2 });
    }
  }

  // ── 경로 소요 일수 뱃지 (drawLinks)
  if (opt.linkDays) {
    for (const c of CITIES) {
      for (const lk of c.links || []) {
        const b = CITIES.find((x) => x.id === lk.to);
        if (!b) continue;
        const hot = c.id === here || lk.to === here;
        if (thin && opt.linkDays === 'hot' && !hot) continue;
        const mx = (sx(c.x) + sx(b.x)) / 2;
        const my = (sy(c.y) + sy(b.y)) / 2;
        const fs = Math.max(8, Math.round(9.5 * scale));
        const r = Math.max(1, 8.5 * scale);
        /* ★ 뱃지도 worldmap.js 처럼 **자리를 찾아** 놓는다 (간선 중점 고정이 아니다).
         *   자리가 없으면 안 그린다 — 저쪽도 그렇게 한다. 여기만 고정으로 두면
         *   도구가 «겹친다» 고 보고하는데 게임은 안 겹치는 상태가 된다. */
        const spot = placeBox(out, mx, my - r, r * 2, r * 2, scale);
        if (!spot) continue;
        out.push({ kind: 'day', t: String(lk.days), x: spot.x, y: spot.y, w: r * 2, h: r * 2, fs });
      }
    }
  }

  // ── 도시 이름 + 거리 (drawNodes → flushLabels)
  // worldmap.js 와 같은 규칙: 중요한 것부터 자리를 잡고, 아래가 막히면 위, 둘 다 막히면 포기.
  const rank = (c) => (c.id === here ? 0 : adj.has(c.id) ? 3 : 4);
  // 지역명·일수 뱃지가 도시 라벨보다 먼저 자리를 잡는다 (worldmap.js 의 그리기 순서와 같다)
  const placed = opt.place ? out.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h })) : [];
  const fits = (r) => !placed.some((p) => {
    const ox = Math.min(r.x + r.w, p.x + p.w) - Math.max(r.x, p.x);
    const oy = Math.min(r.y + r.h, p.y + p.h) - Math.max(r.y, p.y);
    return ox > 1 && oy > 1;
  });

  const queue = [];
  for (const c of CITIES) {
    const isHere = c.id === here;
    const isSel = c.id === opt.selected;
    if (opt.place && thin && !isHere && !isSel && !adj.has(c.id)) continue;
    const fs = thin ? 13 : Math.max(10, Math.round(12 * scale));
    const fs2 = thin ? 11 : Math.max(9, Math.round(10 * scale));
    const sub = isHere ? '현재 위치' : '3일';
    queue.push({
      prio: isSel ? 1 : rank(c), c, isHere, sub, fs, fs2,
      x: sx(c.x), y: sy(c.y), r: nodeR(c.tier || 1),
      w: Math.max(textW(c.name, fs), textW(sub, fs2)), h: fs + 2 + fs2,
      force: isHere || isSel,
    });
  }
  queue.sort((a, b) => a.prio - b.prio);

  for (const q of queue) {
    /* ★ `worldmap.js placeLabel` 의 후보 목록을 그대로 옮겨 적은 곳이다.
     *   실제로 한 번 어긋났다 — 게임 쪽 후보를 6 → 12 로 늘렸는데 여기가 6 그대로라
     *   개선이 측정에 전혀 안 잡혔다. **저기를 고치면 여기도 고쳐야 한다.** */
    const gap = q.r + 4 * scale;
    const side = q.w / 2 + q.r + 6 * scale;
    const diag = gap * 0.72;
    const dside = side * 0.72;
    const cands = [
      { x: q.x, y: q.y + gap },
      { x: q.x, y: q.y - gap - q.h },
      { x: q.x + side, y: q.y - q.h / 2 },
      { x: q.x - side, y: q.y - q.h / 2 },
      { x: q.x + dside, y: q.y + diag },
      { x: q.x - dside, y: q.y + diag },
      { x: q.x + dside, y: q.y - diag - q.h },
      { x: q.x - dside, y: q.y - diag - q.h },
      { x: q.x, y: q.y + gap + q.h + 5 },
      { x: q.x, y: q.y - gap - q.h * 2 - 5 },
      { x: q.x + side * 1.35, y: q.y - q.h / 2 },
      { x: q.x - side * 1.35, y: q.y - q.h / 2 },
    ];
    const boxAt = (p) => ({ x: p.x - q.w / 2 - 4 * scale, y: p.y - 1, w: q.w + 8 * scale, h: q.h + 3 });
    const canvasH = MAP_H * scale;
    const inView = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= viewW && b.y + b.h <= canvasH;
    let pos = null;
    if (!opt.place) {
      pos = cands[0];   // 수정 전 재현: 자리 경쟁 없이 무조건 노드 아래
    } else {
      for (const cand of cands) if (inView(boxAt(cand)) && fits(boxAt(cand))) { pos = cand; break; }
      if (!pos && q.force) pos = cands.find((c) => inView(boxAt(c))) || cands[0];
    }
    if (!pos) continue;
    placed.push(boxAt(pos));
    const w1 = textW(q.c.name, q.fs);
    const w2 = textW(q.sub, q.fs2);
    out.push({ kind: 'city', t: q.c.name, x: pos.x - w1 / 2 - 4 * scale, y: pos.y - 1, w: w1 + 8 * scale, h: q.fs + 3, fs: q.fs });
    out.push({ kind: 'city', t: q.sub, x: pos.x - w2 / 2 - 4 * scale, y: pos.y + q.fs + 1, w: w2 + 8 * scale, h: q.fs2 + 3, fs: q.fs2 });
  }
  return out;
}

/**
 * 같은 자리에 같은 글자가 두 번 그려지는 건 겹침이 아니라 **중복 draw** 다.
 * (링크가 A→B, B→A 양쪽에 정의돼 있어 일수 뱃지가 두 번 찍힌다.)
 * 눈에는 하나로 보이므로 겹침 집계에서 뺀다 — 대신 개수는 따로 보고한다.
 */
function dedupe(rects) {
  const seen = new Set();
  const out = [];
  let dup = 0;
  for (const r of rects) {
    const k = `${r.kind}|${r.t}|${Math.round(r.x)}|${Math.round(r.y)}`;
    if (seen.has(k)) { dup++; continue; }
    seen.add(k);
    out.push(r);
  }
  out.dupCount = dup;
  return out;
}

function overlaps(rects) {
  const hits = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) hits.push({ a, b, ox, oy });
    }
  }
  return hits;
}

/* ─────────────────────────── 리포트 ─────────────────────────── */

const WIDTHS = [
  ['폰 360px', 316],   // 360 뷰포트에서 지도 캔버스가 실제로 갖는 CSS 폭
  ['폰 390px', 346],
  ['태블릿', 700],
  ['PC', 1000],
];

/** 한 상황(폭·현재도시·선택도시)에서 겹침을 센다 */
function measure(viewW, here, selected, place) {
  const opt = place
    ? { regions: viewW >= 560, linkDays: viewW < 560 ? false : 'all', place: true, selected }
    : { regions: true, linkDays: 'all', place: false, selected };
  const rects = dedupe(layoutLabels(viewW, here, opt));
  return { rects, hits: overlaps(rects) };
}

let fail = 0;
for (const [label, viewW] of WIDTHS) {
  console.log(`\n══ ${label} (캔버스 ${viewW}px, 축척 ${(viewW / MAP_W).toFixed(2)}) ══`);

  // 한 자리만 보면 운 좋게 통과할 수 있다 — 현재 도시 x 선택 도시를 전수로 돈다.
  const canvasH = MAP_H * (viewW / MAP_W);
  /** 캔버스 밖으로 삐져나간 라벨 — 잘려서 안 보이므로 겹침만큼 나쁘다 */
  const clipped = (rects) => rects.filter((r) =>
    r.kind === 'city' && (r.x < -0.5 || r.y < -0.5 || r.x + r.w > viewW + 0.5 || r.y + r.h > canvasH + 0.5));

  let before = 0, after = 0, cut = 0, worstCase = null, worstCut = null, minLabels = 1e9;
  let cases = 0;
  for (const h of CITIES) {
    for (const s of [null, ...neighborsOf(h.id)]) {
      cases++;
      before += measure(viewW, h.id, s, false).hits.length;
      const r = measure(viewW, h.id, s, true);
      after += r.hits.length;
      const cl = clipped(r.rects);
      cut += cl.length;
      if (cl.length && !worstCut) worstCut = { here: h.name, t: cl[0].t };
      minLabels = Math.min(minLabels, r.rects.length);
      if (r.hits.length && (!worstCase || r.hits.length > worstCase.n)) {
        worstCase = { n: r.hits.length, here: h.name, sel: s, ex: r.hits[0] };
      }
    }
  }
  console.log(`  상황 ${cases}가지 (현재 도시 × 선택 도시 전수)`);
  console.log(`  수정 전  겹침 합계 ${before}쌍`);
  console.log(`  수정 후  겹침 합계 ${after}쌍 · 화면밖 ${cut}개 · 최소 표시 라벨 ${minLabels}개`);
  if (worstCase) {
    console.log(`      ↳ 최악: ${worstCase.here}에서 ${worstCase.n}쌍 — "${worstCase.ex.a.t}" ✕ "${worstCase.ex.b.t}"`);
  }
  if (worstCut) console.log(`      ↳ 잘림: ${worstCut.here}에서 "${worstCut.t}"`);
  const ok = after === 0 && cut === 0;
  if (!ok) fail++;
  console.log(`  → ${ok ? 'PASS' : 'FAIL'}`);
}

console.log(`\n${fail === 0 ? '전부 PASS' : `${fail}개 폭에서 아직 겹침`}`);
process.exit(fail === 0 ? 0 : 1);
