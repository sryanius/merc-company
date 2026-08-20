// 주점 — 클래스를 지정해서 고용한다. 등급은 계약하는 그 순간에 무작위로 결정된다.
// 도박성이 이 화면의 핵심이므로 등급 추첨 연출에 힘을 준다.
//
// ★ 이 화면은 도시 평판(0~REP_MAX, 지금 300)에 묶여 있다.
//   - 평판 REP_TAVERN_MIN(10) 미만이면 고용 자체가 잠긴다 → 낯선 도시에서는 의뢰부터 받아야 한다.
//   - 평판이 오르면 등급 확률표가 실제로 좋아진다 (merc.gradeOdds 의 opts.rep).
//   - 도시마다 특화 클래스가 있고, 그 클래스는 S·A 확률이 크게 뛴다 (opts.specialty).
//     저티어 도시를 순회할 이유가 여기서 나온다.
import { el, num, clamp } from '../core/util.js';
import { rng } from '../core/rng.js';
import { GRADE_COLOR } from '../art/palette.js';
import { getSprite, drawSpriteFrame } from '../art/spritegen.js';
import { ARCHETYPES, BASE_CLASSES, getClass } from '../data/classes.js';
import { getCity } from '../data/world.js';
// 평판/특화/확률 API는 다른 모듈에서 나중에 붙는 것들이라 이름 import 하면
// 없을 때 모듈 전체가 죽는다. 네임스페이스로 받아 존재할 때만 호출한다.
import * as World from '../data/world.js';
import { state, addGold, addMerc, addLog, refreshCity, save } from '../game/state.js';
import * as GameState from '../game/state.js';
import { GRADES, GRADE_UPKEEP, createMerc, gradeRoll, gradeChances, hireCost, mercRecipe, mercStats, upkeepOf } from '../game/merc.js';
import * as Merc from '../game/merc.js';
import { addToSquad, createSquad, SQUAD_SIZE } from '../game/squad.js';
import { josa } from '../game/gear.js';
import { go, refresh, toast, modal } from './app.js';

export const meta = { id: 'tavern', title: '주점' };

/** 미리보기에 쓰는 대기 프레임 */
const IDLE_FRAMES = ['idle0', 'idle1', 'idle2', 'idle3'];
const SPRITE_SCALE = 3;
const PREVIEW_W = 32 * SPRITE_SCALE;
const PREVIEW_H = 40 * SPRITE_SCALE;

const STAT_ROWS = [['hp', '체력'], ['atk', '공격'], ['def', '방어'], ['res', '저항'], ['spd', '속도']];

/** 평판 구간 이름 — 도시 화면과 같은 어휘를 쓴다 */
const REP_TIERS = [
  { min: 75, name: '전설의 이름', color: 'var(--gold)' },
  { min: 50, name: '명망 높음', color: 'var(--leaf)' },
  { min: 25, name: '믿을 만함', color: 'var(--steel)' },
  { min: 10, name: '얼굴은 안다', color: 'var(--ink-dim)' },
  { min: 0, name: '무명', color: 'var(--ink-faint)' },
];
const repTier = (v) => REP_TIERS.find((t) => v >= t.min) || REP_TIERS[REP_TIERS.length - 1];

/* ─────────────────────────── 화면 수명 관리 ─────────────────────────── */

let previews = [];      // {canvas, sprite, phase}
let rafId = 0;
const timers = new Set();
/** 성장 경로(계보)를 펼쳐 둔 1차 클래스 id. 고용 후 refresh 로 다시 그려도 펼침 상태를 유지한다. */
const expandedPaths = new Set();

function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
  timers.add(id);
  return id;
}

export function dispose() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  previews = [];
  for (const id of timers) clearTimeout(id);
  timers.clear();
}

/* ─────────────────── 평판 · 정원 · 특화 조회 (전부 방어적) ─────────────────── */

/** state.js 상수를 읽되, 아직 없는 빌드면 설계값으로 대체한다 */
function knob(name, fallback) {
  const v = Number(GameState[name]);
  return Number.isFinite(v) ? v : fallback;
}

/** 주점이 열리는 최소 평판 */
const repNeed = () => knob('REP_TAVERN_MIN', 10);

/** 이 도시의 평판 (0~REP_MAX). 기록이 없으면 0 */
function repOf(cityId) {
  if (typeof GameState.getRep === 'function') {
    try {
      const v = Number(GameState.getRep(cityId));
      if (Number.isFinite(v)) return clamp(Math.round(v), 0, 100);
    } catch (e) { console.warn('[tavern] getRep 실패', e); }
  }
  const v = Number(state.reputation?.[cityId]);
  return Number.isFinite(v) ? clamp(Math.round(v), 0, 100) : 0;
}

/** 이 도시 주점을 쓸 수 있는가 */
function tavernGate(cityId) {
  const rep = repOf(cityId);
  const need = repNeed();
  if (typeof GameState.canUseTavern === 'function') {
    try {
      const r = GameState.canUseTavern(cityId);
      if (r && typeof r.ok === 'boolean') {
        return { ok: r.ok, reason: r.reason || '', rep: Number.isFinite(r.rep) ? r.rep : rep, need: Number.isFinite(r.need) ? r.need : need };
      }
    } catch (e) { console.warn('[tavern] canUseTavern 실패', e); }
  }
  return {
    ok: rep >= need,
    reason: rep >= need ? '' : `평판 ${need} 이상이 필요하다. (현재 ${rep})`,
    rep,
    need,
  };
}

/** 단원 정원 */
function rosterCap() {
  const v = Number(state.rosterCap);
  if (Number.isFinite(v) && v > 0) return Math.round(v);
  return knob('ROSTER_CAP_START', 20);
}

/** 단원을 한 명 더 받을 수 있는가 */
function hireGate() {
  if (typeof GameState.canHireMore === 'function') {
    try {
      const r = GameState.canHireMore(state);
      if (r && typeof r.ok === 'boolean') {
        return { ok: r.ok, reason: r.reason || '', count: Number(r.count) || state.roster.length, cap: Number(r.cap) || rosterCap() };
      }
    } catch (e) { console.warn('[tavern] canHireMore 실패', e); }
  }
  const cap = rosterCap();
  const count = state.roster.length;
  return {
    ok: count < cap,
    reason: count < cap ? '' : `단원 정원이 가득 찼다. (${count}/${cap})`,
    count,
    cap,
  };
}

/** 이 도시가 배출하는 1차 클래스 id 목록 */
function specialtyOf(cityId) {
  if (typeof World.citySpecialty === 'function') {
    try {
      const a = World.citySpecialty(cityId);
      if (Array.isArray(a)) return a.slice();
    } catch (e) { console.warn('[tavern] citySpecialty 실패', e); }
  }
  const c = getCity(cityId);
  return Array.isArray(c?.specialty) ? c.specialty.slice() : [];
}

/**
 * 등급 확률(%) 표. gradeOdds(합 1)를 우선 쓴다 — S 확률이 0.5% 미만인 구간까지
 * 보여줘야 "평판을 올리면 실제로 달라진다"가 눈에 들어온다.
 * @param {number} tier
 * @param {{rep?:number, specialty?:boolean}} opts
 * @returns {{F:number,...,S:number}} 0~100 퍼센트
 */
function oddsOf(tier, opts = {}) {
  if (typeof Merc.gradeOdds === 'function') {
    try {
      const o = Merc.gradeOdds(tier, opts);
      if (o) {
        const out = {};
        for (const g of GRADES) out[g] = (Number(o[g]) || 0) * 100;
        return out;
      }
    } catch (e) { console.warn('[tavern] gradeOdds 실패', e); }
  }
  const c = (gradeChances ? gradeChances(tier, opts) : null) || {};
  const out = {};
  for (const g of GRADES) out[g] = Number(c[g]) || 0;
  return out;
}

/** 0~100 퍼센트 → 표기 문자열. 작은 값도 0%로 뭉개지 않는다. */
function pctText(v) {
  const n = Number(v) || 0;
  if (n <= 0) return '0%';
  if (n >= 10) return `${Math.round(n)}%`;
  if (n >= 1) return `${n.toFixed(1)}%`;
  if (n >= 0.05) return `${Math.round(n * 100) / 100}%`;
  return '<0.05%';
}

/* ─────────────────────────── 스타일 (1회 주입) ─────────────────────────── */

function injectStyle() {
  if (document.getElementById('tavern-style')) return;
  document.head.appendChild(el('style', {
    id: 'tavern-style',
    text: `
.tv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.tv-card{display:flex;flex-direction:column;gap:8px;cursor:default}
.tv-card.off{opacity:.5}
.tv-card.spec{border-color:var(--gold-dim);box-shadow:0 0 0 1px rgba(224,180,74,.16) inset}
.tv-top{display:flex;gap:10px}
.tv-box{width:${PREVIEW_W}px;height:${PREVIEW_H}px;flex:0 0 auto}
.tv-box canvas{width:100%;height:100%;display:block}
.tv-stat{display:grid;grid-template-columns:34px 1fr 40px;gap:6px;align-items:center;font-size:11px}
.tv-stat .bar{height:5px}
.tv-chances{display:flex;gap:6px;flex-wrap:wrap}
.tv-chip{border:1px solid currentColor;border-radius:5px;padding:3px 9px;text-align:center;min-width:52px}
.tv-chip b{display:block;font-size:15px;line-height:1.2}
.tv-chip span{display:block;font-size:10px;color:var(--ink-dim)}
.tv-roll{text-align:center;min-width:300px}
.tv-grade{font-size:76px;font-weight:900;line-height:1.15;letter-spacing:.04em;font-family:var(--mono);
  text-shadow:0 0 18px currentColor;transition:none}
.tv-grade.hit{animation:tvPop .45s cubic-bezier(.2,1.6,.4,1)}
@keyframes tvPop{0%{transform:scale(.4);opacity:.2}60%{transform:scale(1.25)}100%{transform:scale(1)}}
.tv-detail{transition:opacity .3s;margin-top:6px}
.tv-shine{border-radius:8px;padding:10px;animation:tvShine 1.4s ease-in-out infinite alternate}
@keyframes tvShine{from{box-shadow:0 0 0 1px currentColor inset,0 0 10px -2px currentColor}
  to{box-shadow:0 0 0 2px currentColor inset,0 0 26px 0 currentColor}}
.tv-kv{display:flex;justify-content:space-between;gap:12px;font-size:12px;padding:2px 0}

/* 평판 잠금 배너 — 화면 최상단 */
.tv-lock{display:flex;gap:18px;align-items:center;flex-wrap:wrap;
  padding:14px 18px;border:1px solid var(--bad);border-left-width:4px;border-radius:var(--radius);
  background:linear-gradient(180deg,rgba(207,90,90,.15),rgba(207,90,90,.04))}
.tv-lock .lk-main{flex:1 1 320px;min-width:0}
.tv-lock .lk-title{font-weight:800;font-size:16px;color:#f0b4b4}
.tv-lock .lk-acts{display:flex;gap:8px;flex-wrap:wrap}

/* 평판 바 */
.tv-repbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.tv-repbar .bar{flex:1 1 180px;min-width:140px;height:9px;position:relative}
.tv-repbar .bar > i{background:linear-gradient(90deg,#5a4a2a,var(--gold))}
.tv-repbar .mark{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--bad);opacity:.85}
.tv-repnum{font-family:var(--mono);font-weight:800;font-size:15px;white-space:nowrap}

/* 확률 비교표 */
.tv-odds{width:100%;border-collapse:collapse;font-size:12px}
.tv-odds th,.tv-odds td{padding:4px 6px;text-align:right;border-bottom:1px solid var(--line-soft);
  font-family:var(--mono);white-space:nowrap}
.tv-odds th:first-child,.tv-odds td:first-child{text-align:left;font-family:var(--font)}
.tv-odds thead th{color:var(--ink-faint);font-weight:700}
.tv-odds tr.now td{background:rgba(224,180,74,.09);color:var(--ink)}
.tv-odds tr.now td:first-child{font-weight:800;color:var(--gold)}
.tv-odds tr.spec td:first-child{color:var(--gold-dim);font-weight:700}
.tv-odds td.dim{color:var(--ink-faint)}

/* 특화 배지 */
.tv-spec{display:inline-block;padding:0 7px;border-radius:999px;font-size:10px;font-weight:800;
  line-height:1.8;white-space:nowrap;background:var(--gold-dim);color:#1a1408}
.tv-specline{display:flex;gap:6px;flex-wrap:wrap;align-items:center}

/* 성장 경로(계보) 미리보기 — 이 1차가 어떤 2·3·4차로 자라는지 접었다 편다 */
.tv-pathbtn{align-self:flex-start}
.tv-path{display:none;flex-direction:column;gap:3px;margin-top:6px;padding-top:8px;
  border-top:1px dashed var(--line-soft)}
.tv-path.open{display:flex}
.tv-path .tv-pintro{font-size:10.5px;color:var(--ink-faint);margin-bottom:2px}
.tv-prow{display:flex;align-items:center;gap:6px;font-size:11px;line-height:1.35;min-width:0}
.tv-ptier{flex:0 0 auto;font-size:9px;font-weight:800;padding:0 6px;border-radius:999px;
  border:1px solid currentColor;white-space:nowrap}
.tv-pname{color:var(--ink-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tv-pkind{flex:0 0 auto;font-size:9px;color:var(--ink-faint);white-space:nowrap}

/* 확률표(조건 + F~S 7열)는 폰 폭을 넘는다. 페이지가 아니라 이 래퍼 안에서만 가로로 민다. */
.tv-oddswrap{max-width:100%;overflow-x:auto}
.tv-scrollhint{display:none}

/* ══════════════════ 모바일 대응 ══════════════════
 * 전부 @media 안에만 있다 — 1280px 레이아웃은 바뀌지 않는다.
 * ≤900  클래스 카드 최소폭을 줄여 2열을 유지 (태블릿 세로 768 포함)
 * ≤767  1열 · 터치 타겟 40px 이상 · 글자 12px 하한 · 확률표 스크롤 안내
 *       (767 = css/style.css 의 공용 모바일 기준선. 어긋나면 어중간한 폭이 생긴다) */
@media (max-width:900px){
  .tv-grid{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
}

@media (max-width:767px){
  /* .tiny/.tag/.row 는 공용 규칙이 이미 처리한다. 여기서는 이 화면 고유 클래스만 손본다. */
  .tv-screen .btn.sm,.tv-roll .btn.sm{min-height:40px;padding:8px 12px;font-size:12px}

  .tv-grid{grid-template-columns:minmax(0,1fr);gap:10px}
  .tv-stat{font-size:12px;grid-template-columns:38px 1fr 42px}
  .tv-chip{min-width:0;flex:1 1 62px}
  .tv-chip span{font-size:12px}
  .tv-spec{font-size:12px}
  .tv-pintro,.tv-prow,.tv-ptier,.tv-pkind{font-size:12px}
  .tv-odds{font-size:12px}
  .tv-oddswrap{overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
  .tv-scrollhint{display:block}

  .tv-lock{padding:12px 14px;gap:12px}
  .tv-lock .lk-main{flex:1 1 100%}
  .tv-lock .lk-title{font-size:15px}
  .tv-lock .lk-acts{width:100%}
  .tv-lock .lk-acts .btn{flex:1 1 auto;min-height:48px}

  .tv-repbar .bar{flex:1 1 100%;min-width:0}
  /* 고용 연출 모달 — 340px 안에 들어와야 한다 */
  .tv-roll{min-width:0}
  .tv-grade{font-size:62px}
}
`,
  }));
}

/* ─────────────────────────── 스프라이트 미리보기 ─────────────────────────── */

function makePreview(recipe) {
  const canvas = el('canvas', { width: PREVIEW_W, height: PREVIEW_H });
  const box = el('div', { class: 'sprite-box tv-box' }, canvas);
  let sprite = null;
  try { sprite = getSprite(recipe); } catch (e) { console.warn('[tavern] 스프라이트 생성 실패', e); }
  const entry = { canvas, sprite, phase: Math.floor(Math.random() * IDLE_FRAMES.length) };
  previews.push(entry);
  drawPreview(entry, 0);
  return { box, entry };
}

function removePreview(entry) {
  const i = previews.indexOf(entry);
  if (i >= 0) previews.splice(i, 1);
}

function drawPreview(entry, frameIdx) {
  const ctx = entry.canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
  // 발밑 그림자
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(PREVIEW_W / 2, PREVIEW_H - 7, 20, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (!entry.sprite) return;
  const f = IDLE_FRAMES[(frameIdx + entry.phase) % IDLE_FRAMES.length];
  drawSpriteFrame(ctx, entry.sprite, f, PREVIEW_W / 2, 38 * SPRITE_SCALE, { scale: SPRITE_SCALE });
}

function startPreviewLoop() {
  let last = 0;
  let acc = 0;
  let frameIdx = 0;
  const tick = (now) => {
    rafId = requestAnimationFrame(tick);
    if (!last) last = now;
    acc += Math.min(0.2, (now - last) / 1000);
    last = now;
    if (acc < 0.19) return;
    acc = 0;
    frameIdx = (frameIdx + 1) % IDLE_FRAMES.length;
    for (const p of previews) drawPreview(p, frameIdx);
  };
  rafId = requestAnimationFrame(tick);
}

/* ─────────────────────────── 표시용 계산 ─────────────────────────── */

/** 아키타입 기준값 * 클래스 보정 (Lv1, 등급 보정 없음) */
function archStats(cls) {
  const a = ARCHETYPES[cls.arch] || {};
  const mods = cls.mods || {};
  const out = {};
  for (const [k] of STAT_ROWS) out[k] = Math.round((a[k] || 0) * (mods[k] ?? 1));
  out.crit = Math.round((a.crit || 0) * (mods.crit ?? 1));
  out.eva = Math.round((a.eva || 0) * (mods.eva ?? 1));
  return out;
}

function statMaxima(classes) {
  const max = {};
  for (const [k] of STAT_ROWS) max[k] = 1;
  for (const c of classes) {
    const s = archStats(c);
    for (const [k] of STAT_ROWS) max[k] = Math.max(max[k], s[k]);
  }
  return max;
}

const gradeTag = (g) => el('span', { class: 'tag', style: { color: GRADE_COLOR[g] || '#999' }, text: `${g}등급` });

/* ─────────────────────────── 렌더 ─────────────────────────── */

export function render(root) {
  injectStyle();
  const city = getCity(state.cityId);
  if (!city) {
    root.appendChild(el('div', { class: 'panel' }, el('h3', { text: '주점' }), el('div', { class: 'muted', text: '현재 도시를 알 수 없습니다.' })));
    return;
  }
  if (Array.isArray(city.services) && !city.services.includes('tavern')) {
    root.appendChild(el('div', { class: 'panel' },
      el('h3', { text: '주점' }),
      el('div', { class: 'muted', text: `${city.name}에는 용병을 구할 만한 주점이 없다. 다른 도시를 찾아보자.` })));
    return;
  }

  refreshCity(city.id);
  const tier = city.tier || 1;
  const gate = tavernGate(city.id);
  const cap = hireGate();
  const spec = specialtyOf(city.id);
  const offers = (state.tavern[city.id] && state.tavern[city.id].list) || [];
  const offerOf = (classId) => offers.find((o) => o.classId === classId) || null;

  // 특화 클래스를 앞에 세운다 — 이 도시에 온 이유가 맨 위에 보여야 한다.
  const classes = (BASE_CLASSES || []).map(getClass).filter(Boolean)
    .sort((a, b) => (spec.includes(b.id) ? 1 : 0) - (spec.includes(a.id) ? 1 : 0));
  const maxima = statMaxima(classes);

  const ctx = { city, tier, gate, cap, spec };

  // tv-screen = 모바일 규칙(글자 크기·터치 타겟)을 이 화면 안으로만 한정하는 표식이다.
  const wrap = el('div', { class: 'col tv-screen' });
  const lock = gate.ok ? null : lockPanel(ctx);
  if (lock) wrap.appendChild(lock);
  const capWarn = gate.ok && !cap.ok ? capPanel(cap) : null;
  if (capWarn) wrap.appendChild(capWarn);
  wrap.appendChild(headerPanel(ctx, offers));
  wrap.appendChild(oddsPanel(ctx));
  wrap.appendChild(el('div', { class: 'tv-grid', style: { marginTop: '12px' } },
    classes.map((cls) => classCard(cls, offerOf(cls.id), ctx, maxima))));
  root.appendChild(wrap);

  startPreviewLoop();
}

/* ---------- 평판 잠금 ---------- */

/** 평판이 모자라 고용이 막혔을 때. 무엇을 해야 하는지를 이 배너 안에서 끝낸다. */
function lockPanel({ city, gate }) {
  const short = Math.max(0, gate.need - gate.rep);
  // F 의뢰 하나가 +2 (state.REP_QUEST_GAIN). 몇 건이면 열리는지 바로 알려준다.
  const gainTable = GameState.REP_QUEST_GAIN || { F: 2, E: 3, D: 4, C: 5, B: 6, A: 8, S: 10 };
  const fGain = Number(gainTable.F) || 2;
  const eGain = Number(gainTable.E) || 3;
  const needF = Math.ceil(short / Math.max(1, fGain));
  const needE = Math.ceil(short / Math.max(1, eGain));

  return el('div', { class: 'tv-lock' },
    el('div', { class: 'lk-main' },
      el('div', { class: 'lk-title', text: `${city.name}의 주점은 아직 우리에게 자리를 내주지 않는다` }),
      el('div', { class: 'muted', style: { marginTop: '4px' } },
        '이 도시에서는 아직 당신들의 이름이 알려지지 않았다. 의뢰를 수행해 평판을 쌓아라.'),
      el('div', { class: 'tv-repbar', style: { marginTop: '10px' } },
        el('span', { class: 'faint tiny', text: '평판' }),
        el('div', { class: 'bar' }, el('i', { style: { width: `${clamp(Math.round((gate.rep / Math.max(1, gate.need)) * 100), 0, 100)}%`, background: 'linear-gradient(90deg,#7a3a3a,var(--bad))' } })),
        el('span', { class: 'tv-repnum', style: { color: 'var(--bad)' }, text: `${gate.rep} / ${gate.need}` })),
      el('div', { class: 'faint tiny', style: { marginTop: '6px' },
        text: `${short} 더 필요하다 — F랭크 의뢰 ${needF}건(성공 +${fGain}) 또는 E랭크 ${needE}건(+${eGain})이면 문이 열린다. 실패하면 오히려 깎인다.` })),
    el('div', { class: 'lk-acts' },
      el('button', { class: 'btn primary lg', onClick: () => go('quests') }, '의뢰소로 간다'),
      el('button', { class: 'btn', onClick: () => go('city') }, '도시로')));
}

/** 정원이 꽉 찼을 때 */
function capPanel(cap) {
  return el('div', { class: 'tv-lock', style: { borderColor: 'var(--gold-dim)', background: 'linear-gradient(180deg,rgba(224,180,74,.12),rgba(224,180,74,.02))' } },
    el('div', { class: 'lk-main' },
      el('div', { class: 'lk-title', style: { color: 'var(--gold)' }, text: `단원 정원 ${cap.count}/${cap.cap} — 더는 받을 수 없다` }),
      el('div', { class: 'muted tiny', style: { marginTop: '4px' },
        text: '숙소가 가득 찼다. 용병단 화면에서 숙소를 넓히거나, 데리고 있을 필요가 없는 단원을 내보내야 한다.' })),
    el('div', { class: 'lk-acts' },
      el('button', { class: 'btn primary', onClick: () => go('company') }, '용병단 화면에서 확장')));
}

/* ---------- 머리말 ---------- */

function headerPanel({ city, tier, gate, cap, spec }, offers) {
  const openCount = offers.filter((o) => !o.hired).length;
  const upkeep = GameState.dailyUpkeep(state);
  const t = repTier(gate.rep);
  const specNames = spec.map((id) => getClass(id)).filter(Boolean);

  /* ★ 상한을 화면에 박아 두면 안 된다. 실제로 상한을 100 → 300 으로 올렸을 때
   *   여기만 100 으로 남아 «101 / 100» 이라는 말이 안 되는 표시가 나왔다. */
  const repMax = Number(GameState.REP_MAX) || 300;
  const pct = (v) => clamp((v / repMax) * 100, 0, 100);

  const repRow = el('div', { class: 'tv-repbar', style: { marginTop: '8px' } },
    el('span', { class: 'faint tiny', style: { minWidth: '58px' }, text: '도시 평판' }),
    el('div', { class: 'bar' },
      el('i', { style: { width: `${pct(gate.rep)}%` } }),
      // 주점 개방선 표시
      el('span', { class: 'mark', style: { left: `${pct(gate.need)}%` }, title: `주점 개방선 ${gate.need}` })),
    el('span', { class: 'tv-repnum', style: { color: t.color }, text: `${gate.rep} / ${repMax}` }),
    el('span', { class: 'tag', style: { color: t.color }, text: t.name }),
    /* ★ 감쇠를 안 알려 주면 «왜 줄었지?» 가 된다. 평판이 바닥보다 높을 때만 쓴다 —
     *   바닥 아래는 안 깎이므로 경고할 게 없다. */
    (Number(GameState.REP_DECAY_PER_DAY) || 0) > 0 && gate.rep > (Number(GameState.REP_DECAY_FLOOR) || 0)
      ? el('span', {
        class: 'tiny',
        style: { color: 'var(--ember)' },
        title: `이 도시를 떠나 있으면 하루 ${GameState.REP_DECAY_PER_DAY}씩 준다. ${GameState.REP_DECAY_FLOOR} 아래로는 안 내려간다.`,
        text: `자리를 비우면 하루 −${GameState.REP_DECAY_PER_DAY} (${GameState.REP_DECAY_FLOOR}까지)`,
      })
      : null,
    gate.ok
      ? el('span', { class: 'tiny', style: { color: 'var(--ok)' }, text: '주점 개방' })
      : el('span', { class: 'tiny', style: { color: 'var(--bad)' }, text: `주점 잠김 (${gate.need} 필요)` }));

  const specRow = specNames.length
    ? el('div', { class: 'tv-specline', style: { marginTop: '8px' } },
      el('span', { class: 'faint tiny', style: { minWidth: '58px' }, text: '이 도시의 명물' }),
      specNames.map((c) => el('span', { class: 'tv-spec', text: c.name })),
      el('span', { class: 'muted tiny', text: '— S 등급은 그 클래스의 명물 도시에서만 나온다. 여기서는 고등급 확률도 1.5배다.' }))
    : el('div', { class: 'faint tiny', style: { marginTop: '8px' }, text: '이 도시가 특별히 배출하는 클래스는 없다.' });

  return el('div', { class: 'panel' },
    el('div', { class: 'row spread center wrap', style: { gap: '14px' } },
      el('div', {},
        el('div', { style: { fontWeight: '700', fontSize: '16px' } }, `${city.name} 주점`,
          el('span', { class: 'tag', style: { color: 'var(--gold)', marginLeft: '8px' }, text: `주점 등급 ${tier}` })),
        el('div', { class: 'tiny muted' }, '술기운과 소문이 도는 자리. 클래스를 골라 계약하지만, 그자의 그릇은 손도장을 찍기 전엔 아무도 모른다.')),
      el('div', { class: 'row', style: { gap: '18px' } },
        kv('모집 중', `${openCount}명`),
        kv('단원', `${cap.count} / ${cap.cap}`, cap.ok ? '' : 'var(--bad)'),
        kv('일일 임금', `${num(upkeep)}G`))),
    repRow,
    specRow,
    // 고용가·일당 표기 안내 (레벨 상한 80·4차 시대) — 여기 숫자는 전부 갓 뽑은 Lv1 1차 기준이다.
    el('div', { class: 'faint tiny', style: { marginTop: '8px' },
      text: '고용가와 일당은 갓 계약한 Lv1 기준이다. 레벨이 오르고 전직할수록 일당도 함께 올라 만렙 4차는 초기의 여러 배가 된다 — 성장이 느려진 지금은 높은 등급일수록 오래 키워 값을 한다.' }));
}

const kv = (k, v, color) => el('div', { class: 'col', style: { gap: '2px', alignItems: 'flex-end' } },
  el('span', { class: 'tiny faint', text: k }),
  el('span', { class: 'num', style: { fontWeight: '700', color: color || 'var(--ink)' }, text: v }));

/* ---------- 등급 확률표 ---------- */

/**
 * 지금 이 도시에서 실제로 굴러가는 확률을 그대로 보여준다.
 * 평판 0 / 현재 / 만점을 나란히 놓아 "평판을 올리면 표가 달라진다"를 눈으로 확인시킨다.
 */
function oddsPanel({ tier, gate, spec }) {
  const rep = gate.rep;
  const now = oddsOf(tier, { rep });
  const hasSpec = spec.length > 0;

  const zero = oddsOf(tier, { rep: 0 });
  /* ★ 비교 행은 «상한» 이어야 의미가 있다. 100 을 박아 두면 상한이 300 이 된 뒤로는
   *   «지금(101)» 보다 낮은 값을 «목표» 라고 보여주게 된다 — 실제로 그랬다. */
  const repTop = Number(GameState.REP_MAX) || 300;
  const rows = [
    { label: '평판 0', odds: zero, cls: '' },
    { label: `평판 ${rep} (현재)`, odds: now, cls: 'now' },
    { label: `평판 ${repTop} (만점)`, odds: oddsOf(tier, { rep: repTop }), cls: '' },
  ];
  // 실효 티어는 1 아래로 못 내려간다 — 1등급 도시에서는 저평판 구간이 전부 같은 표가 된다.
  const flatLow = GRADES.every((g) => Math.abs((zero[g] || 0) - (now[g] || 0)) < 0.005);
  if (hasSpec) {
    rows.push({ label: `평판 ${rep} · 명물 클래스`, odds: oddsOf(tier, { rep, specialty: true }), cls: 'spec' });
    rows.push({ label: `평판 ${repTop} · 명물 클래스`, odds: oddsOf(tier, { rep: repTop, specialty: true }), cls: 'spec' });
  }

  const table = el('table', { class: 'tv-odds' },
    el('thead', {}, el('tr', {},
      el('th', { text: '조건' }),
      GRADES.map((g) => el('th', { style: { color: GRADE_COLOR[g] }, text: g })))),
    el('tbody', {}, rows.map((r) => el('tr', { class: r.cls },
      el('td', { text: r.label }),
      GRADES.map((g) => el('td', {
        class: (r.odds[g] || 0) > 0 ? '' : 'dim',
        text: pctText(r.odds[g]),
      }))))));

  // 저티어 도시를 순회할 이유 — 5등급 도시의 일반 확률과 직접 비교한다.
  // S 는 **명물 클래스에서만** 나온다. 대도시라도 일반 클래스는 S 가 0% 이므로,
  // 비교 문구는 "대도시 대비"가 아니라 "명물이냐 아니냐"를 알려주는 쪽이 맞다.
  const repTop2 = Number(GameState.REP_MAX) || 300;
  const bestS = hasSpec ? oddsOf(tier, { rep: repTop2, specialty: true }).S : 0;
  const nowSpecS = hasSpec ? oddsOf(tier, { rep, specialty: true }).S : 0;
  const compare = el('div', { class: 'tiny', style: { marginTop: '8px', color: hasSpec ? 'var(--ok)' : 'var(--ink-dim)' } },
    hasSpec
      ? `S 등급은 명물 클래스에서만 나온다 — 지금 ${pctText(nowSpecS)}, 평판 ${repTop2}이면 ${pctText(bestS)}까지 오른다. 다른 클래스는 여기서 아무리 뽑아도 S가 나오지 않는다.`
      : '이 도시에는 명물 클래스가 없어 S 등급이 나오지 않는다. S를 원한다면 그 클래스의 명물 도시로 가야 한다.');

  const chips = el('div', { class: 'tv-chances', style: { marginTop: '10px' } },
    GRADES.map((g) => el('div', {
      class: 'tv-chip',
      style: { color: GRADE_COLOR[g], opacity: now[g] > 0 ? '1' : '.35' },
    }, el('b', { text: g }), el('span', { text: pctText(now[g]) }))));

  return el('div', { class: 'panel', style: { marginTop: '12px' } },
    el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
      el('h3', { style: { margin: '0' }, text: '등급 확률' }),
      el('span', { class: 'tiny faint', text: `주점 등급 ${tier} · 평판 ${rep} 반영` })),
    chips,
    el('div', { class: 'sep' }),
    // 8열짜리 표다. 폰에서는 페이지가 아니라 이 래퍼 안에서만 좌우로 밀린다.
    el('div', { class: 'tv-oddswrap' }, table),
    el('div', { class: 'tv-scrollhint faint tiny', style: { marginTop: '4px' },
      text: '← 표를 좌우로 밀면 F~S 전부 보인다. 위의 등급 칩은 지금 조건의 확률이다.' }),
    compare,
    flatLow
      ? el('div', { class: 'tiny faint', style: { marginTop: '4px' },
        text: `실효 주점 등급은 ${tier} 아래로 내려가지 않는다 — 이 도시에서는 평판 ${Math.max(rep, 10)} 이하 구간의 표가 모두 같다. 그 위로 올려야 표가 움직인다.` })
      : null,
    el('div', { class: 'tiny faint', style: { marginTop: '6px' },
      text: '주점 목록은 3일마다 새로 채워진다. 등급이 높은 용병은 임금도 그만큼 비싸다.' }));
}

/* ---------- 성장 경로(계보) 미리보기 ---------- */

const PATH_TIER_NAME = { 2: '2차', 3: '3차', 4: '4차' };
const PATH_TIER_COLOR = { 2: 'var(--steel)', 3: 'var(--leaf)', 4: 'var(--gold)' };

/** 4차 갈래(정점 apex / 심연 abyss)를 이름 규칙으로 읽는다. 4차가 아니면 null. */
function t4Branch(id) {
  const s = String(id || '');
  if (s.endsWith('_apex')) return { kind: '정점', color: 'var(--ember)' };
  if (s.endsWith('_abyss')) return { kind: '심연', color: 'var(--arcane)' };
  return null;
}

/** cls 의 하위 전직(2·3·4차)을 깊이우선으로 나열한다. depth 0 = 2차. */
function descendants(cls, depth, out) {
  for (const nx of (cls.next || []).map(getClass).filter(Boolean)) {
    out.push({ cls: nx, depth });
    descendants(nx, depth + 1, out);
  }
}

/**
 * 이 1차 클래스가 어떤 2·3·4차로 자라는지 접었다 펼 수 있는 계보 미리보기.
 * 105종이 되면서 "이 클래스를 뽑으면 뭐가 되는가"가 고용 선택의 핵심 정보가 됐다.
 */
function growthPath(cls) {
  const rows = [];
  descendants(cls, 0, rows);
  if (!rows.length) return null;
  const count = (t) => rows.filter((r) => (r.cls.tier || 0) === t).length;

  const open = expandedPaths.has(cls.id);
  const list = el('div', { class: `tv-path${open ? ' open' : ''}` });
  list.appendChild(el('div', { class: 'tv-pintro',
    text: `${cls.name} → 2차 ${count(2)} · 3차 ${count(3)} · 4차 ${count(4)}가지 정점` }));
  for (const { cls: c, depth } of rows) {
    const br = t4Branch(c.id);
    list.appendChild(el('div', { class: 'tv-prow', style: { marginLeft: `${depth * 12}px` } },
      el('span', { class: 'tv-ptier', style: { color: PATH_TIER_COLOR[c.tier] || 'var(--ink-faint)' }, text: PATH_TIER_NAME[c.tier] || `${c.tier}차` }),
      el('span', { class: 'tv-pname', style: br ? { color: br.color } : {}, text: c.name }),
      br ? el('span', { class: 'tv-pkind', text: br.kind }) : null));
  }

  const label = (o) => (o ? '성장 경로 접기 ▴' : '성장 경로 미리보기 ▾');
  const btn = el('button', { class: 'btn sm ghost tv-pathbtn' }, label(open));
  btn.addEventListener('click', () => {
    const nowOpen = list.classList.toggle('open');
    if (nowOpen) expandedPaths.add(cls.id); else expandedPaths.delete(cls.id);
    btn.textContent = label(nowOpen);
  });

  return el('div', { class: 'col', style: { gap: '4px' } }, btn, list);
}

/* ---------- 클래스 카드 ---------- */

function classCard(cls, offer, ctx, maxima) {
  const { city, tier, gate, cap, spec } = ctx;
  const isSpec = spec.includes(cls.id);
  const stats = archStats(cls);
  const cost = offer ? offer.cost : hireCost(cls.id, 'C', 1);
  const { box } = makePreview(cls.sprite || {});

  const mine = oddsOf(tier, { rep: gate.rep, specialty: isSpec });
  const plain = oddsOf(tier, { rep: gate.rep });
  const topNow = (mine.S || 0) + (mine.A || 0);
  const topPlain = (plain.S || 0) + (plain.A || 0);
  const ratio = topPlain > 0 ? topNow / topPlain : 0;

  const statBlock = el('div', { class: 'col', style: { gap: '3px', flex: '1', minWidth: '0' } },
    STAT_ROWS.map(([k, label]) => el('div', { class: 'tv-stat' },
      el('span', { class: 'faint', text: label }),
      el('div', { class: 'bar' }, el('i', { style: { width: `${Math.round((stats[k] / maxima[k]) * 100)}%` } })),
      el('span', { class: 'num muted', style: { textAlign: 'right' }, text: String(stats[k]) }))));

  // "이 카드를 고르면 실제로 어떤 등급이 나오는가" — 특화의 이득을 숫자로 못 박는다.
  const oddsLine = el('div', { class: 'tiny', style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
    el('span', { style: { color: GRADE_COLOR.S } }, `S ${pctText(mine.S)}`),
    el('span', { style: { color: GRADE_COLOR.A } }, `A ${pctText(mine.A)}`),
    el('span', { class: 'faint' }, `A 이상 ${pctText(topNow)}`),
    isSpec && ratio > 1
      ? el('span', { style: { color: 'var(--gold)', fontWeight: '700' }, text: `A 이상 ×${Math.round(ratio * 10) / 10} (일반 클래스 대비)` })
      : null);

  let btn;
  if (!gate.ok) {
    btn = el('button', { class: 'btn', disabled: true, title: gate.reason }, `평판 ${gate.rep}/${gate.need}`);
  } else if (offer && offer.hired) {
    btn = el('button', { class: 'btn', disabled: true }, '고용 완료');
  } else if (!offer) {
    btn = el('button', { class: 'btn', disabled: true }, '오늘은 없음');
  } else if (!cap.ok) {
    btn = el('button', { class: 'btn', disabled: true, title: cap.reason }, `정원 ${cap.count}/${cap.cap}`);
  } else {
    btn = el('button', {
      class: 'btn primary',
      onClick: () => tryHire(cls, offer, city, ctx),
    }, `고용 · ${num(cost)}G`);
  }

  const available = !!offer && !offer.hired && gate.ok && cap.ok;

  return el('div', { class: `card tv-card ${available ? '' : 'off'}${isSpec ? ' spec' : ''}` },
    el('div', { class: 'row spread center' },
      el('div', { style: { fontWeight: '700' } }, cls.name,
        el('span', { class: 'tiny faint', style: { marginLeft: '6px' }, text: '1차' }),
        isSpec ? el('span', { class: 'tv-spec', style: { marginLeft: '6px' }, text: '이 도시의 명물' }) : null),
      el('span', { class: 'tag', style: { color: 'var(--steel)' }, text: cls.role || '용병' })),
    el('div', { class: 'tv-top' }, box, statBlock),
    el('div', { class: 'tiny muted', style: { minHeight: '32px' }, text: cls.desc || '' }),
    oddsLine,
    el('div', { class: 'row spread center tiny' },
      el('span', { class: 'faint', text: `치명 ${stats.crit}% · 회피 ${stats.eva}% · ${cls.range === 'ranged' ? '원거리' : '근접'}` }),
      el('span', { class: 'faint', text: available ? `일당 ${GRADE_UPKEEP.F}~${GRADE_UPKEEP.S}G (등급별)` : '' })),
    el('div', { class: 'row spread center' },
      el('span', { class: 'num', style: { color: 'var(--gold)', fontWeight: '700' }, text: `${num(cost)}G` }),
      btn),
    growthPath(cls));
}

/* ─────────────────────────── 고용 ─────────────────────────── */

function tryHire(cls, offer, city, ctx) {
  // 화면을 그린 뒤 상태가 바뀌었을 수 있으니 눌린 순간에 다시 검사한다.
  const gate = tavernGate(city.id);
  if (!gate.ok) {
    toast(gate.reason || `이 도시의 주점은 평판 ${gate.need} 이상부터 열린다. (현재 ${gate.rep})`, 'bad');
    refresh();
    return;
  }
  if (!offer || offer.hired) { toast('이미 계약이 끝난 자리다.', 'bad'); return; }
  const cap = hireGate();
  if (!cap.ok) {
    toast(`${cap.reason || `단원 정원이 가득 찼다. (${cap.count}/${cap.cap})`} 용병단 화면에서 숙소를 넓혀라.`, 'bad');
    return;
  }
  if (state.gold < offer.cost) {
    toast(`골드가 ${num(offer.cost - state.gold)}G 모자란다.`, 'bad');
    return;
  }

  // 주의: `ctx.spec || specialtyOf(...)` 로 쓰면 안 된다. **빈 배열은 truthy** 라서
  // ctx.spec 이 [] 인 순간 폴백이 죽고 특화가 조용히 사라진다(확률표는 특화를 보여주는데
  // 실제 추첨만 일반이 되는, 가장 찾기 어려운 종류의 버그다). 배열인지로 판단한다.
  const specList = Array.isArray(ctx?.spec) && ctx.spec.length ? ctx.spec : specialtyOf(city.id);
  const isSpec = specList.includes(cls.id);

  // 상태 반영은 연출 전에 끝낸다 (도중에 창을 닫아도 결과가 사라지지 않도록)
  addGold(-offer.cost);
  // 평판·특화를 그대로 추첨에 태운다. opts 를 생략하면 예전과 같은 확률이 나온다.
  const grade = gradeRoll(city.tier || 1, rng, { rep: gate.rep, specialty: isSpec });
  const merc = createMerc({ classId: cls.id, grade, level: 1, rng, day: state.day });
  merc.hiredDay = state.day;
  offer.hired = true;
  addMerc(merc);
  addLog(`${city.name} 주점에서 ${cls.name} ${merc.name}${josa(merc.name, '을/를')} ${num(offer.cost)}G에 고용했다. (${grade}등급${isSpec ? ' · 이 도시의 명물' : ''})`);
  try { save(); } catch (e) { console.warn('[tavern] 저장 실패', e); }

  openHireModal(cls, merc, city, isSpec);
}

function openHireModal(cls, merc, city, isSpec) {
  const gradeNode = el('div', { class: 'tv-grade', style: { color: GRADE_COLOR.F }, text: 'F' });
  const msgNode = el('div', { class: 'muted tiny', text: '계약서에 손도장을 찍는다...' });
  const detail = el('div', { class: 'tv-detail', style: { opacity: '0' } });
  const body = el('div', { class: 'tv-roll' },
    el('div', { class: 'tiny faint' }, `${city.name} 주점 · ${cls.name} 계약`,
      isSpec ? el('span', { class: 'tv-spec', style: { marginLeft: '6px' }, text: '이 도시의 명물' }) : null),
    gradeNode, msgNode, detail);

  let modalPreview = null;
  modal({
    title: '고용',
    body,
    actions: [{ label: '확인', kind: 'primary' }],
    onClose: () => {
      if (modalPreview) removePreview(modalPreview);
      refresh();
      suggestPlacement(merc);
    },
  });

  spinGrade(gradeNode, merc.grade, () => {
    msgNode.textContent = gradeMessage(merc.grade);
    const { box, entry } = makePreview(mercRecipe(merc, state));
    modalPreview = entry;
    detail.appendChild(revealBlock(merc, cls, box));
    detail.style.opacity = '1';
    if (merc.grade === 'A' || merc.grade === 'S') {
      detail.classList.add('tv-shine');
      detail.style.color = GRADE_COLOR[merc.grade];
      toast(`${merc.grade}등급! ${merc.name}${josa(merc.name, '이/가')} 용병단에 합류했다.`, 'good');
    } else {
      toast(`${merc.name}${josa(merc.name, '을/를')} 고용했다. (${merc.grade}등급)`, merc.grade === 'F' ? 'bad' : '');
    }
  });
}

/** 등급 글자를 F부터 주르륵 굴리다가 서서히 멈춘다 */
function spinGrade(node, finalGrade, onDone) {
  const flashy = finalGrade === 'A' || finalGrade === 'S';
  const total = 400 + Math.floor(rng.next() * 500) + (flashy ? 420 : 0);
  let elapsed = 0;
  let i = 0;

  const step = () => {
    if (elapsed >= total) {
      node.textContent = finalGrade;
      node.style.color = GRADE_COLOR[finalGrade];
      node.classList.remove('hit');
      void node.offsetWidth;   // 애니메이션 재시작
      node.classList.add('hit');
      onDone();
      return;
    }
    const g = GRADES[i++ % GRADES.length];
    node.textContent = g;
    node.style.color = GRADE_COLOR[g];
    const ratio = elapsed / total;
    const interval = 38 + 150 * ratio * ratio;
    elapsed += interval;
    later(step, interval);
  };
  step();
}

function gradeMessage(g) {
  switch (g) {
    case 'S': return '전설적인 재목이다. 이런 자를 만나는 건 평생 한 번 있을까 말까 하다.';
    case 'A': return '주점 안이 조용해졌다. 손대면 베일 것 같은 자다.';
    case 'B': return '눈빛이 살아 있다. 값은 했다.';
    case 'C': return '무난하다. 밥값은 하겠지.';
    case 'D': return '평범하다. 뭐, 머릿수는 채운다.';
    case 'E': return '술값이 아깝다는 표정이다.';
    default: return '술기운에 손도장을 찍은 것 같다... 최악은 아니길.';
  }
}

function revealBlock(merc, cls, spriteBox) {
  const st = mercStats(merc, state);
  return el('div', { class: 'row', style: { gap: '14px', textAlign: 'left', marginTop: '8px' } },
    spriteBox,
    el('div', { class: 'col', style: { gap: '2px', flex: '1' } },
      el('div', { style: { fontWeight: '700', fontSize: '15px' } }, merc.name, ' ', gradeTag(merc.grade)),
      el('div', { class: 'tiny muted', text: `${cls.name} · Lv${merc.level} · ${cls.role || ''}` }),
      el('div', { class: 'sep', style: { margin: '6px 0' } }),
      el('div', { class: 'tv-kv' }, el('span', { class: 'faint', text: '체력 / 공격' }), el('span', { class: 'num', text: `${num(st.hp)} / ${num(st.atk)}` })),
      el('div', { class: 'tv-kv' }, el('span', { class: 'faint', text: '방어 / 저항' }), el('span', { class: 'num', text: `${num(st.def)} / ${num(st.res)}` })),
      el('div', { class: 'tv-kv' }, el('span', { class: 'faint', text: '속도 / 치명' }), el('span', { class: 'num', text: `${num(st.spd)} / ${st.crit}%` })),
      el('div', { class: 'tv-kv' }, el('span', { class: 'faint', text: '일당' }), el('span', { class: 'num', style: { color: 'var(--gold)' }, text: `${num(merc.upkeep || upkeepOf(merc))}G` }))));
}

/* ─────────────────────────── 부대 배치 제안 ─────────────────────────── */

function findEmptySlot() {
  for (const s of state.squads || []) {
    const i = (s.memberUids || []).indexOf(null);
    if (i >= 0) return { squad: s, index: i };
  }
  return null;
}

function suggestPlacement(merc) {
  if (!state.roster.some((m) => m.uid === merc.uid)) return;

  if (!(state.squads || []).length) {
    const sq = createSquad('제1부대', 'basic');
    state.squads.push(sq);
  }
  const spot = findEmptySlot();
  if (!spot) {
    toast('부대에 빈자리가 없다. 용병단 화면에서 편성을 손봐야 한다.');
    return;
  }

  modal({
    title: '부대 배치',
    body: el('div', {},
      el('div', { text: `${merc.name}${josa(merc.name, '을/를')} ${spot.squad.name} ${spot.index + 1}번 자리에 배치할까?` }),
      el('div', { class: 'tiny faint', style: { marginTop: '6px' }, text: `현재 인원 ${(spot.squad.memberUids || []).filter(Boolean).length} / ${SQUAD_SIZE}` })),
    actions: [
      { label: '나중에', kind: 'ghost' },
      {
        label: '배치',
        kind: 'primary',
        act: () => {
          const r = addToSquad(state, spot.squad.id, merc.uid, spot.index);
          toast(r.reason, r.ok ? 'good' : 'bad');
          try { save(); } catch (e) { console.warn('[tavern] 저장 실패', e); }
          refresh();
        },
      },
    ],
  });
}
