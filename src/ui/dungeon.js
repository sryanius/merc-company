// 던전 화면 — 개요 / 10웨이브 계단 / 출전 부대 선택 / 전투 인계 / 웨이브 정산.
//
// [이 화면의 규칙 — 설계 C]
//  - 던전은 도시가 아니라 **월드맵의 별도 노드**다. 여기로는 `ui/worldmap.js` 가 보낸다
//    (`go('dungeon', {dungeonId})`).
//  - 그 달의 **N주차에는 N번 던전만** 열린다. 닫힌 던전도 정보는 볼 수 있고 입장만 막힌다.
//  - 던전 하나 = 10웨이브, **웨이브마다 보스**. 보스를 잡을 때마다 세트 조각이 하나 떨어진다
//    (1~5 방어구 / 6~8 장신구 / 9~10 무기·왼손).
//  - **다음 도전은 항상 1웨이브부터다.** 진행도(최고 도달 웨이브)는 기록용일 뿐 시작점이 아니다.
//    한 번의 런 안에서만 웨이브가 이어지고, 그 사이 체력은 회복되지 않는다.
//  - 전투는 `go('battle', {...})` 로 넘긴다. `ui/battle.js` 는 이 화면이 고치지 않는다 —
//    필요한 정보는 전부 params 로 넘기고, 전투 화면이 던전을 모르는 빌드에서도 굴러가도록
//    **웨이브 하나씩** 보내고 돌아온 뒤 여기서 정산한다 (아래 「런 정산」 참조).
import { el, num, clamp } from '../core/util.js';
import { RNG, rng } from '../core/rng.js';
import { createBattle, setSkillResolver } from '../battle/engine.js';
import { getSkill } from '../data/skills.js';
import { state, save } from '../game/state.js';
import * as GameState from '../game/state.js';
import * as DungeonData from '../data/dungeons.js';
import * as Dungeon from '../game/dungeon.js';
import * as Sets from '../data/sets.js';
import * as Gear from '../game/gear.js';
import { getEnemy } from '../data/enemies.js';
import { getClass } from '../data/classes.js';
import { canDeploy, squadMembers } from '../game/squad.js';
import { mercPower, isWounded } from '../game/merc.js';
import { GRADE_COLOR } from '../art/palette.js';
import { go, toast, modal } from './app.js';

export const meta = { id: 'dungeon', title: '던전' };

/* ─────────────────────────── 표기 상수 ─────────────────────────── */

const ARCH_NAME = {
  tank: '방패', fighter: '전사', lancer: '창병', archer: '궁수',
  rogue: '도적', mage: '마법사', healer: '치유사',
};
const MYTHIC_COLOR = (typeof Sets.MYTHIC_COLOR === 'string' && Sets.MYTHIC_COLOR) || '#ff5f3a';
const MYTHIC_GLOW = (typeof Sets.MYTHIC_GLOW === 'string' && Sets.MYTHIC_GLOW) || '#ffd27a';
const MYTHIC_NAME = (typeof Sets.MYTHIC_NAME === 'string' && Sets.MYTHIC_NAME) || '신화';
const SLOT_LABEL = { ...(Sets.SLOT_LABEL || {}), ...(Gear.SLOT_NAME || {}) };
const BIOME_NAME = {
  plains: '평야', forest: '숲', mountain: '산악', desert: '사막',
  swamp: '늪지', coast: '해안', tundra: '설원', cave: '동굴',
};
/** 웨이브 구간별 드랍 안내 (설계 C) */
const DROP_BANDS = [
  { from: 1, to: 5, name: '방어구', hint: '머리·상의·하의·장갑·신발' },
  { from: 6, to: 8, name: '장신구', hint: '목걸이·반지 1·반지 2' },
  { from: 9, to: 10, name: '무기·왼손', hint: '오른손(무기)·왼손' },
];

/* ─────────────────────────── 예상 도달 ───────────────────────────
 * ★ 전투력 비율로 승률을 근사하지 마라. 실제로 재 보고 버린 방법이다.
 *   비율 근사식(“ratio 0.89 = 반반” + 웨이브당 감쇠 0.943)을 실측과 맞춰 봤더니
 *   같은 자리에서 부호가 반대로 나왔다 (얼어붙은 성채, Lv80 4차 tank/lancer 7인, 시드 16):
 *
 *     세트 조각   전투력    근사식 예측(1웨이브)   실측 승률(웨이브별, 조건부)
 *      0칸        49,964    “반반 50%”            w1 0%  — 근사식이 정반대
 *      3칸        69,114    —                     w1·w2 100% / w3 6%
 *      5칸        79,166    —                     w1~w4 100% / w5 0%
 *      7칸        91,295    —                     w1~w6 100% / w7 69% / w8 0%
 *     10칸       110,648    —                     w1~w10 전부 100%
 *
 *   승률 곡선이 거의 계단 함수라 50% 지점을 상수 하나로 못 잡고, 무엇보다 **웨이브 사이
 *   체력 소모가 이길 때마다 다르다** — 압승하면 거의 안 깎이고 신승하면 반쯤 깎인다.
 *   감쇠 계수 하나로는 위 다섯 줄을 동시에 만족시킬 수 없다(직접 맞춰 보고 포기했다).
 *
 * 그래서 **진짜 전투를 돌린다.** 웨이브 하나가 8ms 라 10웨이브 3회가 0.25초다.
 * 상태는 건드리지 않는다 — 단원 HP/상태를 스냅샷 떠서 끝나면 되돌린다.
 * 시드는 실제 전투 시드와 **일부러 다르게** 굴린다. 같은 시드를 쓰면 오늘 들어갈 전투의
 * 결과를 미리 보는 셈이라(던전 시드는 날짜 단위로 고정이다) 도전 자체가 무의미해진다. */
const DRY_TRIALS = 3;

/** 승률(%) → 표기 밴드 */
const BANDS = [
  { min: 100, label: '확실', color: 'var(--ok)' },
  { min: 67, label: '유리', color: 'var(--leaf)' },
  { min: 34, label: '반반', color: 'var(--steel)' },
  { min: 1, label: '위험', color: 'var(--ember)' },
  { min: -Infinity, label: '불가', color: 'var(--bad)' },
];
const bandFor = (pct) => BANDS.find((b) => pct >= b.min) || BANDS[BANDS.length - 1];

/** 폰처럼 좁은 화면인가. 위 @media 와 반드시 같은 기준이어야 한다 */
function isNarrow() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia) return window.matchMedia('(max-width: 767px)').matches;
  } catch (e) { /* 아래 폴백 */ }
  return (window.innerWidth || 1280) <= 767;
}

/* ─────────────────────────── 화면 상태 ─────────────────────────── */

/** 지금 보고 있는 던전 id */
let viewId = null;
/** 고른 출전 부대 id */
let squadId = null;
/**
 * 전투 화면에 넘긴 웨이브. 돌아오면 여기서 정산한다.
 * 화면을 나갔다 와도 살아 있어야 하므로 모듈 스코프에 둔다 (dispose 에서 지우지 않는다).
 */
let RUN = null;
/** 방금 끝난 웨이브 결과 배너 */
let LAST = null;

const CSS = `
.dg-head { display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; }
.dg-tabs { display:flex; gap:6px; flex-wrap:wrap; }
.dg-tab { display:flex; align-items:center; gap:6px; padding:5px 10px; border:1px solid var(--line);
  border-radius:var(--radius); background:var(--bg-2); color:var(--ink-dim); font-size:12px; cursor:pointer; }
.dg-tab .gem { width:10px; height:10px; transform:rotate(45deg); border-radius:2px; border:1px solid rgba(0,0,0,.5); }
.dg-tab.on { color:var(--ink); border-color:var(--gold-dim); background:linear-gradient(180deg, rgba(224,180,74,.12), var(--bg-2)); }
.dg-tab.locked { opacity:.55; }
.dg-cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:12px; align-items:start; }
.dg-note { border-left:3px solid var(--gold-dim); background:rgba(224,180,74,.07); padding:8px 10px; border-radius:0 4px 4px 0; }
.dg-note.bad { border-left-color:var(--bad); background:rgba(207,90,90,.08); }
.dg-note.good { border-left-color:var(--ok); background:rgba(111,174,122,.08); }
.dg-note.myth { border-left-color:${MYTHIC_COLOR}; background:rgba(255,95,58,.08); }
/* 10웨이브 계단.
   mobile-ok: 760px 고정폭이지만 (1) 항상 .dg-stairs-wrap (overflow-x:auto) 안에만 들어가고
   (2) 폰(isNarrow)에서는 계단 대신 .dg-rows 세로 목록을 그려 DOM 에 아예 없다.
   실측 360x800 에서 .dg-stairs 0개 / .dg-rows .dg-row 10개. */
.dg-stairs-wrap { overflow-x:auto; padding-bottom:4px; }
.dg-stairs { display:grid; grid-template-columns:repeat(10, minmax(0,1fr)); gap:6px; align-items:end; min-width:760px; }
.dg-step { display:flex; flex-direction:column; gap:4px; justify-content:flex-end; }
.dg-step .col { position:relative; border:1px solid var(--line); border-top-left-radius:4px; border-top-right-radius:4px;
  background:linear-gradient(180deg, var(--bg-3), var(--bg-1)); overflow:hidden; }
.dg-step .col i { position:absolute; left:0; right:0; bottom:0; display:block; }
.dg-step.done .col { border-color:var(--gold-dim); }
.dg-step.next .col { border-color:var(--gold); box-shadow:0 0 0 1px var(--gold-dim) inset; }
.dg-step .no { font-weight:800; font-size:12px; text-align:center; }
.dg-step .cap { text-align:center; line-height:1.25; }
.dg-legend { display:flex; gap:12px; flex-wrap:wrap; }
.dg-legend span { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--ink-dim); }
.dg-legend i { width:9px; height:9px; border-radius:2px; display:block; }
/* 세트 단계 */
.dg-tier { display:flex; gap:8px; align-items:flex-start; padding:6px 8px; border-radius:4px; background:var(--bg-2); }
.dg-tier .k { flex:0 0 46px; font-weight:800; text-align:center; }
.dg-tier.on { background:linear-gradient(90deg, rgba(255,95,58,.14), var(--bg-2)); }
/* 부대 카드 */
.dg-squads { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px; }
.dg-sq { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-2); padding:10px; cursor:pointer; }
.dg-sq.on { border-color:var(--gold); box-shadow:0 0 0 1px var(--gold-dim) inset; }
.dg-sq.off { opacity:.5; cursor:not-allowed; }
.dg-go { display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:center; padding:12px;
  border:1px solid var(--line); border-top-color:var(--gold-dim); border-radius:var(--radius);
  background:linear-gradient(180deg, rgba(13,11,18,.55), var(--bg-1)); }
/* 10웨이브 — 폰에서는 계단(가로) 대신 세로 목록으로 편다 */
.dg-rows { display:flex; flex-direction:column; gap:6px; }
.dg-row { display:flex; gap:10px; align-items:center; padding:8px 10px;
  border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-2); }
.dg-row.done { border-color:var(--gold-dim); }
.dg-row.next { border-color:var(--gold); box-shadow:0 0 0 1px var(--gold-dim) inset; }
.dg-row .no { flex:0 0 36px; text-align:center; font-weight:800; font-size:13px; }
.dg-row .grow { flex:1; min-width:0; }
.dg-rowbar { height:6px; border-radius:3px; background:var(--bg-3); overflow:hidden; }
.dg-rowbar > i { display:block; height:100%; }

/* ───────── 모바일 (폰 세로 기준 360x800) ───────── */
@media (max-width:767px) {
  .dg-cols { grid-template-columns:1fr; }
  .dg-squads { grid-template-columns:1fr; }
  /* 주차 탭 4개 — 한 줄에 넣으면 글자가 뭉개진다. 2x2 로 접고 터치 타겟을 키운다 */
  .dg-tabs { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
  .dg-tab { min-height:44px; justify-content:center; padding:8px 10px; }
  .dg-go { flex-direction:column; align-items:stretch; padding:10px; }
  .dg-go .btn.lg { width:100%; padding:14px 18px; font-size:16px; }
  .dg-go .tiny { text-align:center; }
  /* 터치 타겟 40px 하한 */
  .dg-head .btn.sm, .dg-note .btn.sm { min-height:40px; padding:8px 14px; font-size:13px; }
  .dg-tier .k { flex:0 0 40px; }
  .dg-sq { padding:12px; }
  /* 범례(확실·가능·미개방)가 11px 이라 폰에서 안 읽혔다 — 실측으로 잡았다 */
  .dg-legend span { font-size:12px; }
  .dg-brief .dg-brief-tail { flex:1 1 100%; min-width:0; text-align:left; }
}

/* 태블릿 세로(701~1024px) — 레이아웃은 PC 그대로 두고 터치 타겟만 키운다.
   실측 768x1024 에서 주차 탭이 28px 높이라 손가락으로 누르기 어려웠다. 1280px 에는 안 걸린다. */
@media (min-width:768px) and (max-width:1024px) {
  .dg-tab { min-height:44px; }
}
`;

function injectStyle() {
  if (document.getElementById('dungeon-style')) return;
  document.head.appendChild(el('style', { id: 'dungeon-style', text: CSS }));
}

/* ─────────────────────────── 던전 조회 (방어적) ─────────────────────────── */

function dungeonList() {
  if (Array.isArray(DungeonData.DUNGEON_LIST)) return DungeonData.DUNGEON_LIST;
  if (DungeonData.DUNGEONS && typeof DungeonData.DUNGEONS === 'object') return Object.values(DungeonData.DUNGEONS);
  return [];
}
function getDungeon(id) {
  if (!id) return null;
  if (typeof DungeonData.getDungeon === 'function') return DungeonData.getDungeon(id);
  return dungeonList().find((d) => d.id === id) || null;
}
const wavesOf = (d) => Math.max(1, Math.round((d && d.waves) || 10));

function openWeek(day = state.day) {
  try {
    if (typeof GameState.openDungeonWeek === 'function') return clamp(GameState.openDungeonWeek(day), 1, 4);
    if (typeof GameState.calendar === 'function') return clamp(GameState.calendar(day).week, 1, 4);
  } catch (e) { /* 폴백 */ }
  const n = Math.max(1, Math.floor(Number(day) || 1));
  return clamp(Math.floor(((n - 1) % 28) / 7) + 1, 1, 4);
}
function dayLabel(day = state.day) {
  try {
    if (typeof GameState.calendarLabel === 'function') return GameState.calendarLabel(day);
  } catch (e) { /* 폴백 */ }
  return `${num(day)}일차`;
}
/** `{ok, reason}` — 이 던전에 지금 들어갈 수 있는가 */
function entry(d) {
  if (!d) return { ok: false, reason: '그런 던전은 없다.' };
  try {
    if (typeof Dungeon.canEnter === 'function') {
      const r = Dungeon.canEnter(state, d.id);
      if (r && typeof r === 'object') return { ok: !!r.ok, reason: r.reason || '' };
    }
  } catch (e) { /* 폴백 */ }
  const w = openWeek();
  return d.week === w
    ? { ok: true, reason: '' }
    : { ok: false, reason: `${d.name} — ${d.week}주차에만 열린다. 지금은 ${w}주차다.` };
}
function daysUntilOpen(d) {
  if (!d || entry(d).ok) return 0;
  for (let i = 1; i <= 28; i++) if (openWeek(state.day + i) === d.week) return i;
  return 0;
}
function progressOf(d) {
  if (!d) return { bestWave: 0, clearedAt: null };
  try {
    if (typeof Dungeon.dungeonProgress === 'function') return Dungeon.dungeonProgress(state, d.id);
  } catch (e) { /* 폴백 */ }
  try {
    if (typeof GameState.getDungeonProgress === 'function') return GameState.getDungeonProgress(d.id, state);
  } catch (e) { /* 폴백 */ }
  const e = state.dungeons ? state.dungeons[d.id] : null;
  const best = Math.floor(Number(e && e.bestWave));
  return { bestWave: Number.isFinite(best) && best > 0 ? best : 0, clearedAt: (e && e.clearedAt) || null };
}

/**
 * 던전의 세트 정의.
 * ★ `data/dungeons.js` 의 setId 와 `data/sets.js` 의 세트 id 가 어긋난 조합이 있어
 *   (steelwall↔ironrampart / starshot↔starseeker) 주차로도 한 번 더 찾는다.
 */
function setOf(d) {
  if (!d) return null;
  try {
    if (typeof Sets.getSet === 'function') {
      const s = Sets.getSet(d.setId);
      if (s) return s;
    }
    if (typeof Sets.setForWeek === 'function') return Sets.setForWeek(d.week) || null;
  } catch (e) { /* 무시 */ }
  return null;
}
const setIdOf = (d) => (setOf(d) || {}).id || (d && d.setId) || null;
const setNameOf = (d) => (setOf(d) || {}).name || (d && d.setName) || '미확인 세트';
const setColorOf = (d) => (setOf(d) || {}).color || MYTHIC_COLOR;
function archsOf(d) {
  const s = setOf(d);
  return (s && s.archs) || (d && d.archs) || [];
}
function archLabel(d) {
  const a = archsOf(d);
  if (a.length >= 7) return '전 아키타입';
  return a.map((x) => ARCH_NAME[x] || x).join(' · ') || '제한 없음';
}
/** 웨이브(0-based)의 층주 이름 */
function bossName(d, i) {
  try {
    if (typeof Dungeon.bossForWave === 'function') {
      const e = getEnemy(Dungeon.bossForWave(d.id, i));
      if (e) return e.name;
    }
  } catch (err) { /* 무시 */ }
  return '층의 주인';
}
/** 웨이브(0-based)에서 나올 수 있는 슬롯 */
function dropSlots(i) {
  try {
    if (typeof Dungeon.dropSlotsForWave === 'function') return Dungeon.dropSlotsForWave(i) || [];
  } catch (e) { /* 폴백 */ }
  const band = DROP_BANDS.find((b) => i + 1 >= b.from && i + 1 <= b.to) || DROP_BANDS[0];
  return band.from === 1 ? ['head', 'body', 'legs', 'hands', 'feet']
    : band.from === 6 ? ['neck', 'ring1', 'ring2'] : ['weapon', 'offhand'];
}
const bandOf = (waveNo) => DROP_BANDS.find((b) => waveNo >= b.from && waveNo <= b.to) || DROP_BANDS[0];

/* ─────────────────────────── 세트 드랍 폴백 ───────────────────────────
 * `game/dungeon.js` 는 세트 실물 생성을 items/gear 에 위임하고, 실패하면 **아무것도 주지 않는다**.
 * 지금 빌드에서 그 경로가 끊겨 있으면(세트 베이스 미등록 등) 보스를 잡아도 손이 빈다.
 * 그래서 정상 경로를 먼저 시험해 보고, 그게 물건을 못 만들 때만 `sets.js setPieceItem` 으로
 * 대신 만들어 준다. 정상 경로가 살아 있으면 null 을 돌려줘 그쪽에 양보한다 —
 * 나중에 gear 쪽이 고쳐져도 이 폴백이 그 결과를 덮어쓰지 않는다.
 */
let dropFactoryInstalled = false;
function ensureDropFactory() {
  if (dropFactoryInstalled) return;
  dropFactoryInstalled = true;
  if (typeof Dungeon.setDungeonDropFactory !== 'function' || typeof Sets.setPieceItem !== 'function') return;
  Dungeon.setDungeonDropFactory((ctx) => {
    if (!ctx || !ctx.slot) return null;
    // 1) 정상 경로가 만들 수 있으면 양보한다 (임시 RNG로 시험만 해 본다)
    try {
      if (typeof Gear.rollSetItem === 'function') {
        const probe = Gear.rollSetItem({
          setId: ctx.setId, slot: ctx.slot, ilvl: ctx.ilvl || 80, rng: new RNG(1),
        });
        if (probe) return null;
      }
    } catch (e) { /* 폴백으로 진행 */ }
    // 2) 세트 id 를 sets.js 어휘로 맞춘 뒤 직접 만든다
    let sid = ctx.setId;
    if (!Sets.getSet || !Sets.getSet(sid)) {
      const d = getDungeon(ctx.dungeonId);
      const alt = d && typeof Sets.setForWeek === 'function' ? Sets.setForWeek(d.week) : null;
      sid = (alt && alt.id) || sid;
    }
    try {
      return Sets.setPieceItem(sid, ctx.slot, ctx.ilvl || 80) || null;
    } catch (e) {
      console.warn('[dungeon] 세트 조각 생성 실패', e);
      return null;
    }
  });
}

/* ─────────────────────────── 전투력 / 예측 ─────────────────────────── */

/** `merc.js mercPower` 와 같은 가중치. 아군·적을 같은 자로 재야 비교가 성립한다. */
function statPower(s) {
  if (!s) return 0;
  return s.hp * 0.14 + s.atk * 2.6 + s.def * 1.5 + s.res * 1.3 + s.spd * 1.6
    + s.crit * 2.2 + s.critDmg * 0.5 + s.eva * 1.8;
}

/** 던전별 웨이브 적 전투력 (정적 데이터라 한 번만 계산한다) */
const foeCache = new Map();
function foePowers(d) {
  if (!d) return [];
  if (foeCache.has(d.id)) return foeCache.get(d.id);
  const out = [];
  for (let i = 0; i < wavesOf(d); i++) {
    let p = 0;
    try {
      const defs = typeof Dungeon.dungeonEnemyDefs === 'function' ? Dungeon.dungeonEnemyDefs(d.id, i) : [];
      p = (defs || []).reduce((a, u) => a + statPower(u && u.stats), 0);
    } catch (e) { p = 0; }
    out.push(Math.round(p));
  }
  foeCache.set(d.id, out);
  return out;
}

/** 실제로 출전할 인원(부상자 제외)의 전투력 합 */
function allyPower(id) {
  let ms = [];
  try { ms = (canDeploy(state, id) || {}).deployable || []; } catch (e) { ms = []; }
  if (!ms.length) {
    try { ms = (squadMembers(state, id) || []).filter((m) => !isWounded(m, state.day)); } catch (e) { ms = []; }
  }
  return ms.reduce((a, m) => a + mercPower(m, state), 0);
}

/* ── 실전 시뮬레이션 ── */

let resolverReady = false;
function ensureResolver() {
  // 엔진은 스킬 해석기를 등록해 줘야 스킬을 쓴다. 전투 화면을 한 번도 안 거쳤을 수 있으므로
  // 여기서도 등록한다 (같은 함수를 다시 넣는 것이라 전투 화면과 충돌하지 않는다).
  if (resolverReady) return;
  resolverReady = true;
  try { setSkillResolver(getSkill); } catch (e) { console.warn('[dungeon] 스킬 해석기 등록 실패', e); }
}

/** 결과 캐시. 부대·장비·날짜가 그대로면 다시 돌리지 않는다 (한 번이 0.25초라 매 렌더 돌리면 버벅인다) */
const dryCache = new Map();
function dryKey(d, id) {
  const ms = squadMembers(state, id) || [];
  const sig = ms.map((m) => `${m.uid}:${m.hp}:${m.status}:${Object.values(m.equipment || {}).filter(Boolean).length}`).join(',');
  return `${d.id}|${id}|${state.day}|${allyPower(id)}|${sig}`;
}

/**
 * 실제 전투 엔진으로 10웨이브를 끝까지 시험 삼아 돌린다.
 * **상태를 바꾸지 않는다** — 단원 HP/상태는 스냅샷을 떠서 반드시 되돌린다.
 * @returns {{ally:number, reach:number, trials:number, ok:boolean,
 *            waves:Array<{no,foe,tried,wins,pct,band}>}}
 */
function forecast(d, id) {
  const ally = id ? allyPower(id) : 0;
  const foes = foePowers(d);
  const total = wavesOf(d);
  const blank = {
    ally, reach: 0, trials: 0, ok: false,
    waves: foes.map((foe, i) => ({ no: i + 1, foe, tried: 0, wins: 0, pct: 0, band: BANDS[BANDS.length - 1] })),
  };
  if (!id || !ally) return blank;

  const key = dryKey(d, id);
  if (dryCache.has(key)) return dryCache.get(key);

  const members = squadMembers(state, id) || [];
  const snap = members.map((m) => ({ m, hp: m.hp, status: m.status, maxHp: m.maxHp }));
  const stat = foes.map((foe, i) => ({ no: i + 1, foe, tried: 0, wins: 0, pct: 0, band: BANDS[BANDS.length - 1] }));
  const restore = () => { for (const s of snap) { s.m.hp = s.hp; s.m.status = s.status; s.m.maxHp = s.maxHp; } };

  let reachSum = 0;
  let ok = false;
  try {
    ensureResolver();
    for (let t = 0; t < DRY_TRIALS; t++) {
      restore();                       // 매 시행은 지금 이 순간의 부대 상태에서 출발한다
      for (let i = 0; i < total; i++) {
        const cfg = Dungeon.dungeonBattleDefs(state, d.id, i, id);
        // ★ 실제 전투 시드를 그대로 쓰면 오늘 들어갈 전투의 답을 미리 보여 주는 꼴이다. 어긋나게 굴린다.
        cfg.seed = (((cfg.seed >>> 0) ^ Math.imul(t + 1, 2654435761)) >>> 0);
        cfg.record = false;
        const b = createBattle(cfg);
        const res = b.run();
        stat[i].tried++;
        // 웨이브 사이에는 회복이 없다 — 남은 HP 를 그대로 다음 웨이브로 넘긴다 (게임과 같은 규칙)
        for (const u of b.units) {
          if (u.side !== 'ally') continue;
          const m = members.find((x) => x.uid === u.uid);
          if (m) m.hp = Math.max(1, Math.round(u.alive ? u.hp : 1));
        }
        if (res.winner !== 'ally') break;
        stat[i].wins++;
        reachSum += 1;
      }
      ok = true;
    }
  } catch (e) {
    console.warn('[dungeon] 예상 도달 시뮬 실패', e);
  } finally {
    restore();
  }

  for (const w of stat) {
    w.pct = w.tried ? Math.round((w.wins / w.tried) * 100) : 0;
    w.band = w.tried ? bandFor(w.pct) : BANDS[BANDS.length - 1];
  }
  const out = { ally, reach: ok ? reachSum / DRY_TRIALS : 0, trials: ok ? DRY_TRIALS : 0, ok, waves: stat };
  if (ok) {
    // 키에 날짜·HP가 섞여 있어 한 세션에서 계속 늘어난다. 오래된 것부터 통째로 버린다.
    if (dryCache.size > 24) dryCache.clear();
    dryCache.set(key, out);
  }
  return out;
}

/* ─────────────────────────── 부대 ─────────────────────────── */

function deployInfo(id) {
  const members = squadMembers(state, id) || [];
  const hurt = members.filter((m) => isWounded(m, state.day));
  let res = null;
  try { res = canDeploy(state, id); } catch (e) { console.warn('[dungeon] canDeploy 실패', e); }
  if (!res || typeof res !== 'object') res = { ok: false, reason: '출전 여부를 확인할 수 없다.' };
  const list = Array.isArray(res.deployable) ? res.deployable : null;
  return {
    ok: !!res.ok,
    reason: res.reason || '',
    members,
    benched: Array.isArray(res.benched) ? res.benched : hurt,
    fit: list ? list.length : Math.max(0, members.length - hurt.length),
  };
}

/** 이 부대가 낀 이 세트의 평균 조각 수 (설계 B — 풀세트 기준은 용병별 최대 칸) */
function setWorn(d, id) {
  const sid = setIdOf(d);
  const ms = squadMembers(state, id) || [];
  if (!sid || !ms.length) return { avg: 0, best: 0, max: 10 };
  let total = 0;
  let best = 0;
  let max = 10;
  for (const m of ms) {
    let rows = [];
    try { rows = typeof Gear.setProgress === 'function' ? Gear.setProgress(m, state) || [] : []; } catch (e) { rows = []; }
    const hit = rows.find((r) => r.setId === sid);
    const n = hit ? hit.count : 0;
    if (hit && Number.isFinite(hit.max)) max = hit.max;
    total += n;
    best = Math.max(best, n);
  }
  return { avg: total / ms.length, best, max };
}

/** 지금 고른(또는 고를 만한) 부대 */
function pickSquad() {
  const squads = state.squads || [];
  const sel = squads.find((s) => s && s.id === squadId);
  if (sel) return sel;
  const ok = squads.find((s) => deployInfo(s.id).ok);
  return ok || squads[0] || null;
}

/* ─────────────────────────── 런 정산 ───────────────────────────
 * 이 화면은 웨이브를 **하나씩** 전투 화면에 넘긴다. 돌아오면 그 결과를 여기서 읽어
 * `applyDungeonResult` 로 진행도·드랍을 반영한다.
 *
 * 결과를 아는 방법은 세 가지이며, 위에서부터 우선한다:
 *  1) 전투 화면이 `onDungeonWave` 훅을 불러 줬다 (던전을 아는 빌드).
 *  2) 전투 화면이 이미 정산했다 — 진행도가 올랐거나 새 세트 아이템이 들어왔다.
 *     이때는 **다시 정산하지 않는다** (드랍이 두 번 나오면 안 된다).
 *  3) 둘 다 아니면 전투 로그와 단원 상태로 승패를 판정하고 여기서 정산한다.
 */

function beginRun(d, id, waveIndex) {
  const dep = deployInfo(id);
  const members = dep.members || [];
  RUN = {
    dungeonId: d.id,
    squadId: id,
    waveIndex,
    waveNo: waveIndex + 1,
    total: wavesOf(d),
    title: `${d.name} ${waveIndex + 1}/${wavesOf(d)}웨이브`,
    day: state.day,
    bestBefore: progressOf(d).bestWave,
    itemsBefore: new Set((state.items || []).map((it) => it && it.uid)),
    memberUids: members.map((m) => m.uid),
    // 전투가 **실제로 벌어졌는지** 판정하는 근거. 전투 화면은 참가자 전원의 `battles` 를 1 올린다.
    // 이게 없으면 전투 화면이 오류로 죽었을 때도 "이겼다"고 추정해 세트 조각을 공짜로 준다.
    battlesBefore: members.reduce((a, m) => { a[m.uid] = m.battles || 0; return a; }, {}),
    // 로그는 최신이 앞(index 0)이다. 출발 시점의 맨 앞 항목을 표식으로 들고 있다가
    // 승패를 읽을 때 **그보다 새 항목만** 본다. 같은 웨이브를 여러 번 돌면 예전 전투의
    // 결과 줄이 그대로 남아 있어서, 표식이 없으면 옛 승리를 이번 승리로 오독한다.
    logMark: (state.log || [])[0] || null,
    reported: null,
    settled: false,
  };
}

/** 넘긴 웨이브가 실제로 치러졌는가 (참가자 중 한 명이라도 전투 횟수가 늘었는가) */
function didFight(run) {
  const before = run.battlesBefore || {};
  return run.memberUids.some((u) => {
    const m = (state.roster || []).find((x) => x.uid === u);
    return !!m && (m.battles || 0) > (before[u] || 0);
  });
}

/** 전투 화면이 던전을 아는 빌드라면 이 훅으로 결과를 알려 준다 */
function reportRun(info) {
  if (!RUN || RUN.settled) return;
  RUN.reported = info && typeof info === 'object' ? info : { win: !!info };
}

/**
 * 전투 로그로 승패를 읽는다 (전투 화면이 던전을 모를 때의 마지막 수단).
 * 전투 화면은 끝날 때 반드시 `${제목} — 습격을 물리쳤다 / 밀려나 후퇴했다` 를 남긴다.
 *
 * ★ 못 읽으면 **추측하지 않고 null** 을 돌려준다. 예전에는 "한 명이라도 서 있으면 승리"로
 *   추정했는데, 그 규칙이면 살아남은 채 밀려난 패배가 승리로 둔갑해 세트 조각이 공짜로 나온다.
 *   틀린 승리는 되돌릴 수 없고, 틀린 판정을 아예 안 하면 다시 도전하면 그만이다.
 * @returns {boolean|null}
 */
function inferWin(run) {
  const lines = state.log || [];
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const e = lines[i];
    if (e && e === run.logMark) break;     // 여기서부터는 출발 전에 쌓인 옛 기록이다
    const t = (e && e.text) || '';
    if (!t.includes(run.title)) continue;
    if (t.includes('물리') || t.includes('돌파') || t.includes('승리')) return true;
    if (t.includes('밀려') || t.includes('후퇴') || t.includes('물러')) return false;
  }
  return null;
}

/** 대기 중인 런을 정산하고 배너용 결과를 만든다 */
function settleRun() {
  const run = RUN;
  if (!run || run.settled) return null;
  run.settled = true;
  RUN = null;

  const d = getDungeon(run.dungeonId);
  if (!d) return null;

  const after = progressOf(d);
  const fresh = (state.items || []).filter((it) => it && !run.itemsBefore.has(it.uid));
  const freshSet = fresh.filter((it) => it && it.setId);
  const handled = !!run.reported || after.bestWave > run.bestBefore || freshSet.length > 0;

  // 전투 화면이 아무 말도 없고 흔적도 없다면 **전투가 없었던 것**이다 (화면 로드 실패, 뒤로가기 등).
  // 여기서 승패를 추정하면 싸우지도 않고 세트 조각을 받게 된다 — 조용히 없던 일로 한다.
  if (!handled && !didFight(run)) return null;

  let win;
  let item = freshSet[0] || null;

  if (run.reported) {
    win = !!(run.reported.win != null ? run.reported.win : run.reported.winner === 'ally');
    item = run.reported.item || item;
  } else if (handled) {
    win = true;   // 진행도가 오르거나 세트가 들어왔다 = 전투 화면이 이겨서 이미 정산했다
  } else {
    const verdict = inferWin(run);
    if (verdict == null) return null;   // 승패를 못 읽었다 — 없던 일로 둔다 (위 주석 참조)
    win = verdict;
    const survivors = run.memberUids.filter((u) => {
      const m = (state.roster || []).find((x) => x.uid === u);
      return !!m && (m.hp || 0) > 0 && m.status !== 'wounded';
    });
    try {
      // 단원 HP·부상은 전투 화면이 이미 처리했다 → settleMercs:false
      const res = Dungeon.applyDungeonResult(
        state, d.id, run.waveIndex,
        { winner: win ? 'ally' : 'enemy', survivors, squadId: run.squadId },
        { settleMercs: false, squadId: run.squadId, rng },
      );
      if (res && res.ok) item = res.item || null;
    } catch (e) {
      console.warn('[dungeon] 던전 결과 반영 실패', e);
    }
  }

  const progress = progressOf(d);
  // ★ 방금 치른 웨이브 번호는 **넘길 때 정한 값**이다. 최고 기록(bestWave)으로 덮으면
  //   예전에 7층까지 갔던 던전에서 1웨이브를 깨자마자 "8웨이브로 계속"이 뜬다.
  //   전투 화면이 여러 웨이브를 이어 돌린 빌드에서만 그쪽이 보고한 번호를 믿는다.
  const reportedNo = run.reported && Number.isFinite(run.reported.waveNo)
    ? clamp(Math.round(run.reported.waveNo), 1, run.total) : 0;
  const waveNo = reportedNo || run.waveNo;
  const out = {
    dungeonId: d.id,
    waveNo,
    total: run.total,
    win,
    item,
    bestWave: progress.bestWave,
    cleared: progress.clearedAt != null,
    next: win && waveNo < run.total ? waveNo : 0,   // 이어서 도전할 웨이브 번호 (0 = 런 종료)
    squadId: run.squadId,
  };
  try { save(); } catch (e) { console.warn('[dungeon] 저장 실패', e); }
  return out;
}

/* ─────────────────────────── 렌더 ─────────────────────────── */

export function dispose() { /* rAF·타이머 없음. RUN 은 화면을 나가도 살아 있어야 한다 */ }

export function render(root, params = {}) {
  injectStyle();
  ensureDropFactory();

  // 전투에서 돌아왔다면 먼저 정산한다 (배너로 결과를 보여준다)
  const settled = settleRun();
  if (settled) LAST = settled;

  const list = dungeonList();
  if (!list.length) {
    root.appendChild(el('div', { class: 'panel col' },
      el('h3', { text: '던전' }),
      el('div', { class: 'muted', text: '알려진 던전이 없다. (data/dungeons.js 를 확인해라)' }),
      el('button', { class: 'btn', onClick: () => go('world') }, '월드맵으로')));
    return;
  }

  const wanted = params.dungeonId || (LAST && LAST.dungeonId) || viewId;
  const d = getDungeon(wanted) || list.find((x) => entry(x).ok) || list[0];
  viewId = d.id;
  if (LAST && LAST.dungeonId !== d.id) LAST = null;

  const sq = pickSquad();
  squadId = sq ? sq.id : null;

  /* ★ "다음 웨이브로 계속" — 전투 결과 화면에서 넘어온 경우.
   * 정산(settleRun)은 위에서 이미 끝났다. 여기서 곧바로 다음 웨이브로 들어가면
   * 플레이어는 이 화면을 사실상 보지 않고 웨이브를 이어서 돌게 된다.
   * **정산을 건너뛰지 않는 것이 핵심이다** — 진행도·세트 조각이 이 화면에서만 반영된다.
   *
   * 자동 진입을 막아야 하는 경우가 셋 있다:
   *   · 방금 졌다            → 이어서 갈 이유가 없다
   *   · 마지막 웨이브였다     → 더 갈 곳이 없다
   *   · 출전 조건이 깨졌다    → 전멸·부상으로 세울 인원이 없다 (그냥 화면을 보여 준다)
   */
  // 정산은 이제 전투 결과 화면(onResult)에서 이미 끝났다 — 그때 LAST 가 채워진다.
  // settleRun() 은 여기서 null 을 돌려주므로 LAST 를 함께 본다.
  const outcome = settled || LAST;
  if (params.autoNext && outcome && outcome.win && outcome.next > 0) {
    // settled.next 는 "이어서 도전할 웨이브 번호"(1-based, 0이면 런 종료)다.
    // 방금 깬 웨이브가 N번(1-based)이면 다음 웨이브의 0-based 인덱스도 N이다.
    const nextIdx = outcome.next;
    const dep = squadId ? deployInfo(squadId) : null;
    if (dep && dep.ok) {
      LAST = null;                                       // 배너를 남기지 않는다 (바로 전투로 넘어간다)
      /* ★ 반드시 다음 틱으로 미룬다.
       * render() 는 app.js 의 go() 안에서 실행 중이고, go() 는 `busy` 플래그로
       * **중첩 호출을 조용히 무시**한다. 여기서 곧바로 enterWave → go('battle') 을 부르면
       * 아무 일도 안 일어난 채 던전 화면에 남는다(실제로 그렇게 막혔다).
       * 아래 '들어간다' 버튼이 setTimeout 을 쓰는 이유도 같다. */
      setTimeout(() => enterWave(d, squadId, nextIdx, root), 0);
      return;
    }
  }

  root.appendChild(el('div', { class: 'col' },
    headerPanel(d, root),
    LAST ? outcomePanel(d, root) : null,
    el('div', { class: 'dg-cols' }, setPanel(d), briefPanel(d)),
    stairsPanel(d),
    deployPanel(d, root)));
}

function rerender(root) {
  root.innerHTML = '';
  render(root, { dungeonId: viewId });
}

/* ── 머리말 ── */

function headerPanel(d, root) {
  const e = entry(d);
  const prog = progressOf(d);
  const total = wavesOf(d);
  const color = setColorOf(d);
  const wait = daysUntilOpen(d);

  const tabs = el('div', { class: 'dg-tabs' }, dungeonList().slice()
    .sort((a, b) => (a.week || 0) - (b.week || 0))
    .map((x) => {
      const open = entry(x).ok;
      return el('button', {
        class: `dg-tab ${x.id === d.id ? 'on' : ''} ${open ? '' : 'locked'}`,
        title: open ? '이번 주 개방' : `${x.week}주차에 열린다`,
        onClick: () => { viewId = x.id; LAST = null; rerender(root); },
      },
        el('i', { class: 'gem', style: { background: setColorOf(x) } }),
        `${x.week}주차 ${x.name}`,
        open ? el('span', { style: { color: 'var(--gold)' }, text: '●' }) : el('span', { class: 'faint', text: '🔒' }));
    }));

  return el('div', { class: 'panel col' },
    el('div', { class: 'dg-head' },
      el('div', { class: 'col', style: { gap: '4px', minWidth: '260px' } },
        el('h3', { style: { margin: '0' } },
          el('span', { style: { color }, text: '◆ ' }), d.name),
        el('div', { class: 'faint tiny', text: `${BIOME_NAME[d.biome] || ''} · ${total}웨이브 · 웨이브마다 보스가 버틴다` }),
        el('div', { class: 'muted tiny', style: { maxWidth: '640px' }, text: d.desc || '' })),
      el('div', { class: 'col', style: { gap: '4px', alignItems: 'flex-end' } },
        el('div', { class: 'faint tiny', text: dayLabel() }),
        el('div', {
          style: { fontWeight: '800', color: e.ok ? 'var(--gold)' : 'var(--bad)' },
          text: e.ok ? `개방 중 — ${d.week}주차` : `잠김 — ${d.week}주차에 열림${wait ? ` (${wait}일 뒤)` : ''}`,
        }),
        el('div', { class: 'tiny muted', text: `최고 도달 ${prog.bestWave}/${total}${prog.clearedAt ? ` · ${num(prog.clearedAt)}일차 완주` : ''}` }),
        el('button', { class: 'btn sm ghost', style: { marginTop: '4px' }, onClick: () => go('world') }, '월드맵으로'))),
    tabs,
    e.ok ? null : el('div', { class: 'dg-note bad tiny' }, e.reason || `${d.week}주차에만 들어갈 수 있다.`));
}

/* ── 방금 웨이브 결과 ── */

function outcomePanel(d, root) {
  const o = LAST;
  const total = o.total || wavesOf(d);
  const body = el('div', { class: 'col', style: { gap: '6px' } },
    el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
      el('div', { style: { fontWeight: '800', fontSize: '16px', color: o.win ? 'var(--gold)' : 'var(--bad)' },
        text: o.win ? `${o.waveNo}웨이브 돌파` : `${o.waveNo}웨이브에서 물러났다` }),
      el('div', { class: 'tiny muted', text: `최고 도달 ${o.bestWave}/${total}${o.cleared ? ' · 완주' : ''}` })),
    o.item
      ? el('div', { class: 'tiny' },
          el('span', { class: 'faint', text: '드랍 — ' }),
          el('span', { style: { color: MYTHIC_COLOR, fontWeight: '700' }, text: `${o.item.name}` }),
          el('span', { class: 'faint', text: ` (${MYTHIC_NAME} · ${SLOT_LABEL[o.item.slot] || o.item.slot})` }))
      : el('div', { class: 'tiny faint', text: o.win ? '보스는 쓰러졌지만 손에 남은 것은 없었다.' : '전리품은 없다.' }),
    o.win && o.next
      ? el('div', { class: 'tiny muted', text: `체력은 회복되지 않는다. 이대로 ${o.next + 1}웨이브로 밀고 들어갈지, 물러나 정비할지 고른다.` })
      : el('div', { class: 'tiny muted', text: '다음 도전은 다시 1웨이브부터다. 진행도는 기록으로만 남는다.' }));

  return el('div', { class: `panel col dg-note ${o.win ? 'myth' : 'bad'}` },
    body,
    el('div', { class: 'row wrap', style: { gap: '8px' } },
      el('button', { class: 'btn sm ghost', onClick: () => { LAST = null; rerender(root); } }, '확인')));
}

/* ── 세트 ── */

function setPanel(d) {
  const set = setOf(d);
  const color = setColorOf(d);
  const sid = setIdOf(d);
  const owned = (state.items || []).filter((it) => it && it.setId === sid);
  const slots = new Set(owned.map((it) => it.slot));
  const sq = pickSquad();
  // 세트 효과는 "창고에 몇 개 있느냐"가 아니라 **한 용병이 몇 칸을 끼고 있느냐**로 켜진다.
  const worn = sq ? setWorn(d, sq.id) : { avg: 0, best: 0, max: 10 };

  const tiers = [];
  const bonuses = (set && (set.bonuses || set.bonus)) || {};
  for (const k of ['3', '5', '7', 'full']) {
    const b = bonuses[k] != null ? bonuses[k] : bonuses[Number(k)];
    if (!b) continue;
    const need = k === 'full' ? worn.max : Number(k);
    const on = worn.best >= need;
    tiers.push(el('div', { class: `dg-tier ${on ? 'on' : ''}` },
      el('span', { class: 'k', style: { color: on ? color : 'var(--ink-faint)' }, text: k === 'full' ? `풀 ${need}` : `${k}칸` }),
      el('span', { class: 'tiny', style: { color: on ? 'var(--ink)' : 'var(--ink-dim)' },
        text: b.desc || b.specialLabel || '스탯이 오른다.' })));
  }

  return el('div', { class: 'panel col' },
    el('h3', {}, el('span', { style: { color }, text: setNameOf(d) }),
      el('span', { class: 'tag', style: { marginLeft: '8px', color: MYTHIC_COLOR }, text: MYTHIC_NAME })),
    set && set.desc ? el('div', { class: 'muted tiny', text: set.desc }) : null,
    el('div', { class: 'row spread center tiny' },
      el('span', { class: 'faint', text: '착용 가능' }),
      el('span', { style: { fontWeight: '700' }, text: archLabel(d) })),
    el('div', { class: 'row spread center tiny' },
      el('span', { class: 'faint', text: '보유 조각' }),
      el('span', { class: 'num', style: { fontWeight: '700', color: slots.size ? color : 'var(--ink-faint)' },
        text: `${slots.size}/10칸 (${owned.length}개)` })),
    el('div', { class: 'row spread center tiny' },
      el('span', { class: 'faint', text: '최다 착용 (출전 부대)' }),
      el('span', { class: 'num', style: { fontWeight: '700', color: worn.best ? color : 'var(--ink-faint)' },
        text: `${worn.best}칸` })),
    el('div', { class: 'sep' }),
    el('div', { class: 'tiny faint', text: '드랍 구간' }),
    el('div', { class: 'col', style: { gap: '3px' } },
      DROP_BANDS.map((b) => el('div', { class: 'row spread center tiny' },
        el('span', { class: 'muted', text: `${b.from}~${b.to}웨이브` }),
        el('span', { text: b.name }),
        el('span', { class: 'faint', text: b.hint })))),
    tiers.length
      ? el('div', { class: 'col', style: { gap: '4px' } },
          el('div', { class: 'tiny faint', style: { marginTop: '6px' }, text: '세트 효과 — 풀세트 기준은 그 용병이 낄 수 있는 칸 수다 (양손무기면 9칸)' }),
          tiers)
      : null);
}

/* ── 난이도 경고 ── */

function briefPanel(d) {
  const sq = pickSquad();
  const f = forecast(d, sq ? sq.id : null);
  const worn = sq ? setWorn(d, sq.id) : { avg: 0, best: 0, max: 10 };
  const w1 = f.waves[0] || { foe: 0, pct: 0, wins: 0, tried: 0, band: BANDS[BANDS.length - 1] };
  const dep = sq ? deployInfo(sq.id) : null;

  const lines = [];
  lines.push(el('div', { class: 'row spread center tiny' },
    el('span', { class: 'faint', text: '출전 전투력' }),
    el('span', { class: 'num', style: { fontWeight: '700' }, text: f.ally ? num(f.ally) : '—' })));
  lines.push(el('div', { class: 'row spread center tiny' },
    el('span', { class: 'faint', text: '1웨이브 적' }),
    el('span', { class: 'num', style: { fontWeight: '700' }, text: num(w1.foe) })));
  lines.push(el('div', { class: 'row spread center tiny' },
    el('span', { class: 'faint', text: '세트 착용 (평균)' }),
    el('span', { class: 'num', style: { fontWeight: '700', color: worn.avg ? setColorOf(d) : 'var(--ink-faint)' },
      text: `${worn.avg.toFixed(1)}칸 / 최대 ${worn.max}` })));
  lines.push(el('div', { class: 'row spread center tiny' },
    el('span', { class: 'faint', text: '1웨이브 승률' }),
    el('span', { style: { fontWeight: '800', color: w1.band ? w1.band.color : 'var(--ink-faint)' },
      text: f.ok ? `${w1.band.label} (${w1.wins}/${w1.tried})` : '—' })));
  lines.push(el('div', { class: 'row spread center tiny' },
    el('span', { class: 'faint', text: '예상 도달' }),
    el('span', {
      style: { fontWeight: '800', color: f.reach >= 8 ? 'var(--ok)' : f.reach >= 4 ? 'var(--steel)' : f.reach >= 1 ? 'var(--ember)' : 'var(--bad)' },
      text: f.ok ? `${f.reach.toFixed(1)}웨이브` : (f.ally ? '측정 실패' : '부대 없음'),
    })));

  return el('div', { class: 'panel col' },
    el('h3', { text: '난이도' }),
    el('div', { class: 'dg-note bad tiny' },
      '이곳은 만렙 4차 7인을 기준으로 짜여 있다. 세트 조각이 하나도 없으면 1웨이브부터가 벽이고, '
      + '거기서 운 좋게 이겨도 2웨이브는 사실상 불가능하다 — 웨이브를 넘어도 체력이 회복되지 않는데 '
      + '적은 더 세지기 때문이다. 한 층씩 조각을 모아 다시 오는 것이 정상 진행이다.'),
    el('div', { class: 'col', style: { gap: '3px' } }, lines),
    dep && !dep.ok ? el('div', { class: 'dg-note bad tiny' }, dep.reason) : null,
    dep && dep.ok && dep.benched.length
      ? el('div', { class: 'dg-note tiny' }, `부상자 ${dep.benched.length}명은 자동으로 빠진다. ${dep.fit}명으로 들어간다.`)
      : null,
    el('div', { class: 'tiny faint' },
      f.ok
        ? `예상은 지금 이 부대로 던전을 ${f.trials}번 시험 삼아 끝까지 돌려 본 결과다 (체력 인계까지 실제와 같다). `
          + '표본이 작으니 경계선에서는 흔들린다. 실제 전투는 다른 시드로 굴러간다.'
        : '지금은 예상을 낼 수 없다. 부대를 고르면 실제 전투를 시험 삼아 돌려 본다.'));
}

/* ── 10웨이브 계단 ── */

/**
 * 좁은 화면용 세로 목록.
 * 가로 계단(min-width 760px)은 폰에서 자기 컨테이너 안에서 옆으로 스크롤해야만 볼 수 있고,
 * 층주 이름·드랍 슬롯이 `title` 툴팁에만 있어 **터치로는 아예 읽을 수 없다.**
 * 세로로 펴면서 툴팁에 있던 내용을 전부 본문으로 끌어낸다.
 */
function stairsRows(d, f, prog, nextWave) {
  const total = wavesOf(d);
  const rows = [];
  for (let i = 0; i < total; i++) {
    const no = i + 1;
    const done = prog.bestWave >= no;
    const band = bandOf(no);
    const w = f.waves[i] || { pct: 0, wins: 0, tried: 0, band: BANDS[BANDS.length - 1], foe: 0 };
    const slotNames = dropSlots(i).map((s) => SLOT_LABEL[s] || s).join(' · ');

    rows.push(el('div', { class: `dg-row ${done ? 'done' : ''} ${no === nextWave ? 'next' : ''}` },
      el('span', {
        class: 'no',
        style: { color: done ? 'var(--gold)' : no === nextWave ? 'var(--ink)' : 'var(--ink-faint)' },
        text: done ? `✔ ${no}` : String(no),
      }),
      el('div', { class: 'grow col', style: { gap: '3px' } },
        el('div', { class: 'row spread center', style: { gap: '8px' } },
          el('span', { style: { fontWeight: '700' }, text: bossName(d, i) }),
          el('span', {
            class: 'tiny',
            style: { fontWeight: '800', color: w.band.color, whiteSpace: 'nowrap' },
            text: f.ok && w.tried ? `${w.band.label} ${w.wins}/${w.tried}` : '—',
          })),
        el('div', { class: 'dg-rowbar' },
          el('i', { style: { width: `${clamp(w.pct, 0, 100)}%`, background: w.band.color } })),
        el('div', { class: 'faint tiny', text: `${band.name} — ${slotNames}` }))));
  }
  return el('div', { class: 'dg-rows' }, rows);
}

function stairsPanel(d) {
  const total = wavesOf(d);
  const prog = progressOf(d);
  const sq = pickSquad();
  const f = forecast(d, sq ? sq.id : null);
  const color = setColorOf(d);
  const nextWave = LAST && LAST.win && LAST.next ? LAST.next + 1 : 1;

  if (isNarrow()) {
    return el('div', { class: 'panel col' },
      el('div', { class: 'col', style: { gap: '2px' } },
        el('h3', { style: { margin: '0' }, text: `${total}웨이브` }),
        el('div', { class: 'tiny muted', text: `✔ 표시 = 지금까지 돌파한 웨이브(${prog.bestWave}/${total}). 다음 도전은 1웨이브부터다.` })),
      stairsRows(d, f, prog, nextWave),
      el('div', { class: 'dg-legend' },
        BANDS.map((b) => el('span', {}, el('i', { style: { background: b.color } }), b.label))));
  }

  const steps = [];
  for (let i = 0; i < total; i++) {
    const no = i + 1;
    const done = prog.bestWave >= no;
    const band = bandOf(no);
    const w = f.waves[i] || { pct: 0, band: BANDS[BANDS.length - 1], foe: 0 };
    const h = Math.round(46 + i * 9);   // 계단: 뒤로 갈수록 높아진다
    const slotNames = dropSlots(i).map((s) => SLOT_LABEL[s] || s).join(' · ');

    // 기둥 = 그 웨이브. 높이는 계단처럼 뒤로 갈수록 커지고, 안쪽 채움은 예상 승률이다.
    const pillar = el('div', {
      class: 'col',
      style: {
        height: `${h}px`, position: 'relative', overflow: 'hidden',
        border: '1px solid var(--line)', borderRadius: '4px 4px 0 0',
        background: done
          ? `linear-gradient(180deg, ${color}, rgba(8,6,13,.92))`
          : 'linear-gradient(180deg, var(--bg-3), var(--bg-1))',
        borderColor: no === nextWave ? 'var(--gold)' : done ? 'var(--gold-dim)' : 'var(--line)',
        boxShadow: no === nextWave ? '0 0 0 1px var(--gold-dim) inset' : 'none',
      },
    },
      el('i', {
        style: {
          position: 'absolute', left: '0', right: '0', bottom: '0',
          height: `${clamp(w.pct, 0, 100)}%`,
          background: w.band.color, opacity: done ? '.25' : '.45',
        },
      }));

    steps.push(el('div', { class: `dg-step ${done ? 'done' : ''} ${no === nextWave ? 'next' : ''}` },
      el('div', { class: 'cap tiny faint', title: `층의 주인: ${bossName(d, i)}`, text: bossName(d, i) }),
      pillar,
      el('div', { class: 'no', style: { color: done ? 'var(--gold)' : no === nextWave ? 'var(--ink)' : 'var(--ink-faint)' },
        text: done ? `✔ ${no}` : `${no}` }),
      el('div', {
        class: 'cap tiny', style: { color: w.band.color },
        title: f.ok && w.tried ? `시험 ${w.tried}회 중 ${w.wins}회 돌파` : '부대를 골라야 잴 수 있다',
        text: f.ok && w.tried ? `${w.band.label} ${w.wins}/${w.tried}` : '—',
      }),
      el('div', { class: 'cap tiny faint', title: slotNames, text: band.name })));
  }

  return el('div', { class: 'panel col' },
    el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
      el('h3', { style: { margin: '0' }, text: `${total}웨이브` }),
      el('div', { class: 'tiny muted', text: `채워진 칸 = 지금까지 돌파한 웨이브(${prog.bestWave}/${total}). 다음 도전은 1웨이브부터 시작한다.` })),
    el('div', { class: 'dg-stairs-wrap' }, el('div', { class: 'dg-stairs' }, steps)),
    el('div', { class: 'dg-legend' },
      BANDS.map((b) => el('span', {}, el('i', { style: { background: b.color } }), b.label)),
      el('span', {}, el('i', { style: { background: color } }), '돌파한 웨이브')));
}

/* ── 출전 ── */

function deployPanel(d, root) {
  const e = entry(d);
  const total = wavesOf(d);
  const resume = LAST && LAST.win && LAST.next && LAST.dungeonId === d.id ? LAST.next : 0;
  const startIdx = resume;                 // 0-based. 이어가기면 방금 깬 웨이브 번호가 곧 다음 인덱스
  const squads = state.squads || [];

  const cards = squads.map((s) => {
    const dep = deployInfo(s.id);
    const power = allyPower(s.id);
    const on = s.id === squadId;
    return el('div', {
      class: `dg-sq ${on ? 'on' : ''} ${dep.ok ? '' : 'off'}`,
      onClick: () => { if (!dep.ok) { toast(dep.reason || '출전할 수 없습니다.', 'bad'); return; } squadId = s.id; rerender(root); },
    },
      el('div', { class: 'row spread center' },
        el('span', { style: { fontWeight: '700', color: on ? 'var(--gold)' : 'var(--ink)' }, text: s.name }),
        el('span', { class: 'tiny', style: { color: dep.ok ? 'var(--ok)' : 'var(--bad)' }, text: dep.ok ? '출전 가능' : '불가' })),
      el('div', { class: 'tiny faint', text: `${dep.fit}/${dep.members.length}명 · 전투력 ${num(power)}` }),
      dep.ok ? null : el('div', { class: 'tiny', style: { color: 'var(--bad)' }, text: dep.reason }),
      el('div', { class: 'row wrap', style: { gap: '4px', marginTop: '4px' } },
        (dep.members || []).slice(0, 7).map((m) => {
          const c = getClass(m.classId);
          return el('span', {
            class: 'tag',
            style: { color: GRADE_COLOR[m.grade] || 'var(--ink-dim)', opacity: isWounded(m, state.day) ? '.45' : '1' },
            title: `${m.name} · ${c ? c.name : ''} Lv${m.level}`,
            text: `${m.name.slice(0, 4)}`,
          });
        })));
  });

  const sq = pickSquad();
  const dep = sq ? deployInfo(sq.id) : null;
  const canGo = !!(e.ok && sq && dep && dep.ok);
  const label = startIdx > 0 ? `${startIdx + 1}웨이브로 계속 진격` : '1웨이브 돌입';

  return el('div', { class: 'panel col' },
    el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
      el('h3', { style: { margin: '0' }, text: '출전 부대' }),
      el('div', { class: 'tiny muted', text: '부대를 골라 던전에 넣는다. 웨이브를 넘어도 체력은 회복되지 않는다.' })),
    squads.length ? el('div', { class: 'dg-squads' }, cards)
      : el('div', { class: 'muted tiny', text: '부대가 없다. 용병단 화면에서 부대를 만들어라.' }),
    startIdx > 0
      ? el('div', { class: 'dg-note tiny' },
          `${startIdx}웨이브까지 밀어냈다. 이어서 ${startIdx + 1}웨이브로 들어간다 — 여기서 물러나면 다음 도전은 1웨이브부터다.`)
      : null,
    el('div', { class: 'dg-go' },
      el('button', {
        class: 'btn primary lg',
        disabled: !canGo,
        onClick: () => askEnter(d, sq, startIdx, root),
      }, label),
      startIdx > 0
        ? el('button', { class: 'btn lg', onClick: () => { LAST = null; rerender(root); } }, '물러난다 (정비)')
        : null,
      el('span', { class: 'tiny faint', text: e.ok ? `${total}웨이브 · 보스마다 세트 조각 1개` : e.reason })));
}

function askEnter(d, sq, waveIndex, root) {
  if (!d || !sq) return;
  const e = entry(d);
  if (!e.ok) { toast(e.reason || '지금은 들어갈 수 없다.', 'bad'); return; }
  const dep = deployInfo(sq.id);
  if (!dep.ok) { toast(dep.reason || '출전할 수 없습니다.', 'bad'); return; }

  const total = wavesOf(d);
  const f = forecast(d, sq.id);
  const w = f.waves[waveIndex] || { pct: 0, band: BANDS[BANDS.length - 1], foe: 0 };
  const band = bandOf(waveIndex + 1);

  modal({
    title: `${d.name} — ${waveIndex + 1}/${total}웨이브`,
    body: el('div', { class: 'col', style: { gap: '10px', minWidth: 'min(420px, 76vw)' } },
      row('출전 부대', `${sq.name} (${dep.fit}명)`),
      row('층의 주인', bossName(d, waveIndex)),
      row('드랍 예정', `${band.name} — ${dropSlots(waveIndex).map((s) => SLOT_LABEL[s] || s).join(' / ')}`, setColorOf(d)),
      row('예상', f.ok ? `${w.band.label} · 시험 ${w.wins}/${w.tried} 승` : '측정 불가', w.band.color),
      el('div', { class: 'sep' }),
      el('div', { class: 'muted tiny', text: '이기면 그 자리에서 세트 조각이 하나 떨어지고, 이어서 다음 웨이브로 들어갈 수 있다. 지면 이번 도전은 끝이다 (다음에는 다시 1웨이브부터).' }),
      dep.benched.length ? el('div', { class: 'dg-note tiny' }, `부상자 ${dep.benched.length}명은 자동으로 빠진다.`) : null,
      f.ok && w.pct < 50 ? el('div', { class: 'dg-note bad tiny' }, '지금 전력으로는 넘기 어렵다. 조각을 더 모아 오는 편이 낫다.') : null),
    actions: [
      { label: '취소', kind: 'ghost' },
      { label: '들어간다', kind: 'primary', act: () => { setTimeout(() => enterWave(d, sq.id, waveIndex, root), 0); } },
    ],
  });
}

const row = (k, v, color) => el('div', { class: 'row spread center' },
  el('span', { class: 'faint tiny', text: k }),
  el('span', { class: 'num', style: { fontWeight: '700', color: color || 'var(--ink)' }, text: v }));

/**
 * 웨이브 하나를 전투 화면에 넘긴다.
 *
 * ★ `ui/battle.js` 는 이 화면이 고치지 않는다. 던전을 아는 빌드가 통째로 이어 돌릴 수 있도록
 *   던전 정보(dungeon/dungeonId/waveIndex/waveCount/onDungeonWave)를 전부 params 에 실어 보내고,
 *   그렇지 않은 빌드에서는 **웨이브 하나만** 치르고 `returnTo:'dungeon'` 으로 돌아온다.
 *   돌아온 뒤의 정산은 `settleRun()` 이 맡는다.
 */
async function enterWave(d, id, waveIndex, root) {
  const total = wavesOf(d);
  const wi = clamp(Math.round(waveIndex || 0), 0, total - 1);
  let cfg = null;
  try {
    cfg = Dungeon.dungeonBattleDefs(state, d.id, wi, id);
  } catch (e) {
    console.error('[dungeon] 던전 전투 구성 실패', e);
    toast('던전 전투를 구성하지 못했습니다.', 'bad');
    return;
  }
  if (!cfg || !(cfg.allies || []).length) { toast('싸울 수 있는 단원이 없습니다.', 'bad'); return; }
  if (!(cfg.enemies || []).length) { toast('던전의 적을 세우지 못했습니다.', 'bad'); return; }

  beginRun(d, id, wi);
  LAST = null;

  await go('battle', {
    battleCfg: cfg,
    title: `${d.name} ${wi + 1}/${total}웨이브`,
    rank: 'S',
    biome: d.biome,
    squadId: id,
    days: 0,
    reward: { gold: 0, exp: 0, renown: 0 },   // 던전 보상은 세트 조각뿐이다 (의뢰 경제와 분리)
    returnTo: 'dungeon',
    returnParams: { dungeonId: d.id },
    // ★ 승리하면 결과 화면에 "다음 웨이브" 가 뜬다. 누르면 던전 화면을 **거쳐서** 넘어간다 —
    //   정산(진행도·세트 조각)이 이 화면에서만 일어나기 때문에 건너뛰면 보상이 날아간다.
    //   던전 화면은 autoNext 를 보면 정산 직후 다음 웨이브로 바로 들어간다.
    continueLabel: wi + 1 < total ? `${wi + 2}웨이브로 계속` : null,
    continueParams: { dungeonId: d.id, autoNext: true },
    // ── 던전 정보 (전투 화면이 던전을 아는 빌드용)
    dungeon: true,
    dungeonId: d.id,
    setId: setIdOf(d),
    setName: setNameOf(d),
    waveIndex: wi,
    waveCount: total,
    waveNo: wi + 1,
    bossName: bossName(d, wi),
    dropSlots: dropSlots(wi),
    dropBand: bandOf(wi + 1).name,
    onDungeonWave: reportRun,
    /* ★ 전투 화면이 결과를 확정한 **그 자리에서** 정산한다.
     * 예전에는 던전 화면에 다시 들어와야 settleRun 이 돌아서, 도시로 나가 버리면
     * "드랍했다는 말도 없이 나중에 장비창에 세트템이 생겨 있는" 상태가 됐다.
     * 여기서 정산하면 세트 조각이 전투 결과 화면의 전리품 칸에 바로 뜬다.
     * settleRun 은 run.settled 로 막혀 있어 이중 정산이 안 된다. */
    onResult: () => {
      const res = settleRun();
      if (res) LAST = res;
      return { items: res && res.item ? [res.item] : [] };
    },
  });

  showBattleBrief(d, wi, total);
}

/**
 * 전투 화면 위에 던전 브리핑 띠를 얹는다.
 *
 * ★ `ui/battle.js` 는 **고치지 않는다** (다른 화면도 쓰는 파일이다). 전투 화면은 상단 바에
 *   `얼어붙은 성채 3/10웨이브` 까지만 보여 주므로, 층주와 드랍 예정 슬롯이 안 보인다.
 *   그래서 전투 화면이 다 그려진 뒤 `#screen` 맨 앞에 안내 띠만 한 줄 덧붙인다.
 *   전투 화면이 결과창을 그릴 때 `root.innerHTML=''` 로 스스로 지우므로 뒤처리도 필요 없다.
 *   전투 화면이 안 떴으면(로드 실패) 아무것도 하지 않는다.
 */
function showBattleBrief(d, wi, total) {
  const host = document.getElementById('screen');
  if (!host || !host.querySelector('.battle-stage')) return;   // 전투 화면이 아니다 — 손대지 않는다
  if (host.querySelector('.dg-brief')) return;

  const color = setColorOf(d);
  const band = bandOf(wi + 1);
  const brief = el('div', {
    class: 'panel dg-brief row wrap center',
    style: {
      gap: '10px 16px', marginBottom: '10px', padding: '8px 12px',
      borderColor: color, background: 'linear-gradient(90deg, rgba(255,95,58,.10), var(--bg-1))',
    },
  },
    el('span', { style: { color, fontWeight: '800' }, text: `◆ ${d.name}` }),
    el('span', { class: 'tag', style: { color: 'var(--gold)' }, text: `${wi + 1} / ${total} 웨이브` }),
    el('span', { class: 'tiny' },
      el('span', { class: 'faint', text: '층의 주인 ' }),
      el('span', { style: { fontWeight: '700' }, text: bossName(d, wi) })),
    el('span', { class: 'tiny' },
      el('span', { class: 'faint', text: '드랍 예정 ' }),
      el('span', { style: { color, fontWeight: '700' }, text: band.name }),
      el('span', { class: 'faint', text: ` (${dropSlots(wi).map((s) => SLOT_LABEL[s] || s).join(' / ')})` })),
    el('span', { class: 'tiny faint dg-brief-tail', style: { flex: '1', minWidth: '160px', textAlign: 'right' },
      text: '이기면 세트 조각 1개. 지면 이번 도전은 끝이다 (다음엔 1웨이브부터).' }));

  host.insertBefore(brief, host.firstChild);
}
