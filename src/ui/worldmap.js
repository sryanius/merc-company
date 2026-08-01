// 월드맵 — Canvas로 그리는 도시 노드/도로망. 클릭하면 경로를 계산해 이동한다.
// 이동 중에는 data/world.js 의 TRAVEL_EVENTS 에서 사건이 하나 터질 수 있다.
//
// ★ 던전 노드 (설계 C)
//   던전은 **도시가 아니다.** 지도 위에 도시와 확실히 다른 모양(마름모 관문)으로 따로 그린다.
//   그 달의 N주차에는 N번 던전만 열리고(state.js openDungeonWeek), 나머지는 잠금 표시가 붙는다.
//   던전 노드를 누르면 날짜를 쓰지 않고 `go('dungeon', {dungeonId})` 로 던전 화면을 연다 —
//   이동에 일수를 먹이면 출발과 도착의 **주차가 달라져** 방금 열려 있던 던전이 닫혀 버린다.
import { el, num, clamp, lerp } from '../core/util.js';
import { rng } from '../core/rng.js';
import {
  state, advanceDays, refreshCity, addLog, addGold, addItem, rollLoot,
} from '../game/state.js';
// 달력·던전 진행도 API는 나중에 붙은 것들이라 이름 import 하면 없는 빌드에서 모듈이 통째로 죽는다.
// 네임스페이스로 받아 있을 때만 쓴다.
import * as GameState from '../game/state.js';
import * as DungeonData from '../data/dungeons.js';
import * as DungeonGame from '../game/dungeon.js';
import * as Sets from '../data/sets.js';
import {
  CITIES, REGIONS, getCity, getRegion, cityRegion, cityBiome,
  travelDays, pathBetween, linkDays, neighbors,
  TRAVEL_EVENTS, rollTravelEvent,
} from '../data/world.js';
import { buildEnemySquad } from '../data/enemies.js';
import { questBattleDefs } from '../game/quest.js';
import { canDeploy, squadMembers } from '../game/squad.js';
import { isWounded } from '../game/merc.js';
import { go, toast, modal } from './app.js';

export const meta = { id: 'world', title: '월드맵' };

/* ─────────────────────────── 지도 규격 ─────────────────────────── */

const MAP_W = 1000;
const MAP_H = 700;
const PAD = 46;               // 논리 좌표 여백 (라벨이 잘리지 않도록)
const NODE_R = (tier) => 7 + clamp(tier, 1, 5) * 1.9;

const BIOME_COLOR = {
  plains: '#8fae5a', forest: '#3f8a55', mountain: '#8a90a4', desert: '#c9a24b',
  swamp: '#5d7a4a', coast: '#3f8ab5', tundra: '#8fc4d6', cave: '#7a6a8a',
};
const BIOME_NAME = {
  plains: '평야', forest: '숲', mountain: '산악', desert: '사막',
  swamp: '늪지', coast: '해안', tundra: '설원', cave: '동굴',
};
const SERVICE_NAME = { tavern: '주점', shop: '상점', guild: '의뢰소', smith: '대장간' };
/** 캔버스 폰트 — canvas 2D는 CSS 변수를 해석하지 못하므로 실제 패밀리를 적는다. */
const FONT = '"Pretendard","Malgun Gothic","맑은 고딕",system-ui,sans-serif';

/* ── 던전 노드 규격 ─────────────────────────────────────────────────────
 * 도시는 **원**, 던전은 **마름모 관문**이다. 색까지 계열을 나눠 한눈에 구분되게 한다
 * (도시 = 지형색 / 던전 = 세트색 + 붉은 금빛 테두리). */
const DUNGEON_R = 15;
/** 세트 색을 못 찾았을 때 쓰는 기본 던전색 */
const DUNGEON_COLOR = '#c2603f';
/** 신화 등급 색 — 전설(주황)과 구분되는 붉은 금빛 */
const MYTHIC_COLOR = (typeof Sets.MYTHIC_COLOR === 'string' && Sets.MYTHIC_COLOR) || '#ff5f3a';
const MYTHIC_GLOW = (typeof Sets.MYTHIC_GLOW === 'string' && Sets.MYTHIC_GLOW) || '#ffd27a';
/** 아키타입 한국어 (던전 세트 착용 제한 표기) */
const ARCH_NAME = {
  tank: '방패', fighter: '전사', lancer: '창병', archer: '궁수',
  rogue: '도적', mage: '마법사', healer: '치유사',
};
/** 웨이브 구간별 드랍 슬롯 안내 (설계 C) */
const DROP_BANDS = [
  { from: 1, to: 5, label: '방어구 5칸' },
  { from: 6, to: 8, label: '장신구 3칸' },
  { from: 9, to: 10, label: '무기 · 왼손' },
];

const CSS = `
.wm-stage { position:relative; border:1px solid var(--line); border-radius:var(--radius); overflow:hidden;
  background:radial-gradient(120% 90% at 50% 0%, #1b1626 0%, #0b0910 70%); }
.wm-stage canvas { display:block; width:100%; height:auto; cursor:pointer; }
.wm-tip { position:absolute; pointer-events:none; z-index:5; min-width:170px; max-width:260px;
  background:rgba(20,17,28,.96); border:1px solid var(--line); border-radius:var(--radius);
  padding:8px 10px; box-shadow:var(--shadow); transform:translate(-50%, -100%); }
.wm-tip.hidden { display:none; }
.wm-tip .nm { font-weight:700; }
.wm-legend { display:flex; gap:14px; flex-wrap:wrap; }
.wm-legend .lg { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--ink-dim); }
.wm-legend .dot { width:10px; height:10px; border-radius:50%; border:1px solid rgba(0,0,0,.5); }
.wm-cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:12px; align-items:start; }
.wm-route { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
.wm-route .leg { color:var(--ink-faint); font-size:11px; }
.wm-ev { border-left:3px solid var(--gold-dim); background:rgba(224,180,74,.07); padding:8px 10px; border-radius:4px; }
.wm-ev.bad { border-left-color:var(--bad); background:rgba(207,90,90,.08); }
.wm-ev.good { border-left-color:var(--ok); background:rgba(111,174,122,.08); }
/* 던전 목록 (지도 옆) */
.wm-dg { display:flex; gap:10px; align-items:center; padding:8px 10px; border:1px solid var(--line);
  border-radius:var(--radius); background:var(--bg-2); }
.wm-dg.open { border-color:var(--gold-dim); background:linear-gradient(90deg, rgba(224,180,74,.09), var(--bg-2)); }
.wm-dg.locked { opacity:.6; }
.wm-dg .gem { width:16px; height:16px; flex:0 0 16px; transform:rotate(45deg); border-radius:3px;
  border:1px solid rgba(0,0,0,.55); }
.wm-dg .nm { font-weight:700; }
.wm-dg .grow { flex:1; min-width:0; }
.wm-dg-bar { height:5px; border-radius:3px; background:var(--bg-3); overflow:hidden; margin-top:4px; }
.wm-dg-bar > i { display:block; height:100%; }
/* 터치 안내는 hover 가 없는 기기에서만 띄운다 (PC에서는 사족이다) */
.wm-touchhint { display:none; }

/* ───────── 모바일 (폰 세로 기준 360x800) ───────── */
@media (hover:none) {
  .wm-touchhint { display:block; }
}
@media (max-width:767px) {
  .wm-cols { grid-template-columns:1fr; }
  .wm-tip { max-width:min(260px, 84vw); }
  .wm-tip .tiny { font-size:12px; }
  .wm-legend .lg { font-size:12px; }
  /* 이동 경로의 'N일' 표기. 11px 은 폰 하한(12px) 미달이었다 */
  .wm-route .leg { font-size:12px; }
  /* 터치 타겟 40px 하한. .btn.sm 쪽이 더 구체적이라 클래스를 겹쳐 특이도를 맞춘다 */
  .wm-dg { padding:10px; min-height:52px; }
  .btn.sm.wm-go { min-height:40px; padding:8px 14px; font-size:13px; }
  .wm-nb { padding:6px 0; }
}
`;

/* ─────────────────────────── 화면 상태 ─────────────────────────── */

let canvas = null;
let ctx = null;
let stage = null;
let tip = null;
let raf = 0;
let hoverId = null;
let hoverDgId = null;   // 던전 노드 호버 (도시 hoverId 와 섞이면 경로 계산이 깨진다)
let selectedId = null;
let selectedDgId = null; // 터치에서 "한 번 눌러 고른" 던전 (hover 가 없는 기기용)
let clock = 0;
let lastTs = 0;
let viewW = MAP_W;   // 현재 캔버스의 CSS 픽셀 폭
let scale = 1;       // 논리 → CSS 픽셀
let traveling = false;
let allCityEl = null;  // 전체 도시 목록 패널 (좁은 화면에서만 보인다)

/* ─────────────────────────── 모바일 판정 ───────────────────────────
 * 지도는 도시 14개 + 던전 4개를 한 화면에 밀어 넣는다. 폰 폭(360)에서는 축척이 1/3 이하로
 * 떨어져 **라벨이 서로 겹쳐 아무것도 못 읽고, 노드가 손가락보다 작다.**
 * 그래서 좁은 화면에서는 (1) 라벨을 꼭 필요한 것만 그리고 (2) 노드 크기·판정에 하한을 둔다. */

/** 지도가 좁은가. 뷰포트가 아니라 **캔버스 실제 폭**으로 판단한다 (라벨 밀도의 문제라서) */
const narrowMap = () => viewW < 560;

/** hover 가 없는 입력인가 (폰·태블릿). 툴팁에만 정보를 두면 안 되므로 탭 흐름으로 바꾼다 */
function noHover() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try { return window.matchMedia('(hover: none)').matches; } catch (e) { return false; }
}

/** 도시 노드 반지름 (CSS px). 좁은 화면에서는 하한을 둬 손가락으로 누를 수 있게 한다 */
const nodeR = (tier) => Math.max(narrowMap() ? 7 : 0, NODE_R(tier) * scale);
/** 던전 노드 반지름 (CSS px) */
const dungeonR = () => Math.max(narrowMap() ? 13 : 0, DUNGEON_R * scale);
/** 터치 판정 반지름 — 보이는 크기와 무관하게 최소 22px(도시)/26px(던전)은 잡아 준다 */
const pickPad = () => (noHover() || narrowMap() ? 14 : 8 * scale);

/* ─────────────────────────── 좌표 변환 ─────────────────────────── */

const px = (x) => PAD + (x / MAP_W) * (MAP_W - PAD * 2);
const py = (y) => PAD + (y / MAP_H) * (MAP_H - PAD * 2);

/** 논리 좌표 → 화면(CSS) 좌표 */
const sx = (x) => px(x) * scale;
const sy = (y) => py(y) * scale;

/* ─────────────────────────── 던전 조회 (전부 방어적) ───────────────────────────
 * 던전 관련 API는 이번 확장에서 새로 붙은 것들이다. 모듈이 아직 없거나 이름이 다를 때도
 * 월드맵이 통째로 죽지 않도록 전부 "있으면 쓰고 없으면 직접 계산" 형태로 감싼다. */

/** 던전 정의 배열 (주차 순). 데이터가 없으면 빈 배열 */
function dungeonList() {
  if (Array.isArray(DungeonData.DUNGEON_LIST)) return DungeonData.DUNGEON_LIST;
  if (DungeonData.DUNGEONS && typeof DungeonData.DUNGEONS === 'object') return Object.values(DungeonData.DUNGEONS);
  return [];
}

/** 오늘의 개방 주차 1~4 */
function openWeek(day = state.day) {
  try {
    if (typeof GameState.openDungeonWeek === 'function') return clamp(GameState.openDungeonWeek(day), 1, 4);
    if (typeof GameState.calendar === 'function') return clamp(GameState.calendar(day).week, 1, 4);
  } catch (e) { /* 아래 폴백 */ }
  const d = Math.max(1, Math.floor(Number(day) || 1));
  return clamp(Math.floor(((d - 1) % 28) / 7) + 1, 1, 4);
}

/** `3년 7월 2주차 (245일차)` */
function dayLabel(day = state.day) {
  try {
    if (typeof GameState.calendarLabel === 'function') return GameState.calendarLabel(day);
  } catch (e) { /* 아래 폴백 */ }
  return `${num(day)}일차`;
}

/** 그 던전이 지금 열려 있는가 */
function isOpen(d) {
  if (!d) return false;
  try {
    if (typeof DungeonGame.canEnter === 'function') return !!(DungeonGame.canEnter(state, d.id) || {}).ok;
  } catch (e) { /* 아래 폴백 */ }
  return d.week === openWeek();
}

/** 그 던전이 열릴 때까지 남은 일수 (지금 열려 있으면 0) */
function daysUntilOpen(d) {
  if (!d || isOpen(d)) return 0;
  for (let i = 1; i <= 28; i++) if (openWeek(state.day + i) === d.week) return i;
  return 0;
}

/** 진행도 `{bestWave, clearedAt}` */
function progressOf(d) {
  if (!d) return { bestWave: 0, clearedAt: null };
  try {
    if (typeof DungeonGame.dungeonProgress === 'function') return DungeonGame.dungeonProgress(state, d.id);
  } catch (e) { /* 아래 폴백 */ }
  try {
    if (typeof GameState.getDungeonProgress === 'function') return GameState.getDungeonProgress(d.id, state);
  } catch (e) { /* 아래 폴백 */ }
  const e = state.dungeons ? state.dungeons[d.id] : null;
  const best = Math.floor(Number(e && e.bestWave));
  return { bestWave: Number.isFinite(best) && best > 0 ? best : 0, clearedAt: (e && e.clearedAt) || null };
}

/**
 * 던전의 세트 정의.
 * ★ `dungeons.js` 의 setId 와 `sets.js` 의 세트 id 가 어긋나 있는 경우가 있어
 *   (steelwall↔ironrampart / starshot↔starseeker) 주차로도 한 번 더 찾아본다.
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

/** 세트 표기명 / 색 */
const setNameOf = (d) => (setOf(d) || {}).name || d.setName || '미확인 세트';
const setColorOf = (d) => (setOf(d) || {}).color || DUNGEON_COLOR;

/** 착용 가능 아키타입 한국어 목록 */
function archLabel(d) {
  const s = setOf(d);
  const archs = (s && s.archs) || (d && d.archs) || [];
  if (archs.length >= 7) return '전 아키타입';
  return archs.map((a) => ARCH_NAME[a] || a).join(' · ') || '제한 없음';
}

/** 총 웨이브 수 */
const wavesOf = (d) => Math.max(1, Math.round((d && d.waves) || 10));

/* ─────────────────────────── 렌더 진입 ─────────────────────────── */

function injectStyle() {
  if (document.getElementById('worldmap-style')) return;
  document.head.appendChild(el('style', { id: 'worldmap-style', text: CSS }));
}

export function render(root) {
  injectStyle();
  traveling = false;
  hoverId = null;
  hoverDgId = null;
  selectedId = null;
  selectedDgId = null;

  canvas = el('canvas');
  tip = el('div', { class: 'wm-tip hidden' });
  stage = el('div', { class: 'wm-stage' }, canvas, tip);
  ctx = canvas.getContext('2d');

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);

  const cur = getCity(state.cityId);
  const openD = dungeonList().find((d) => isOpen(d)) || null;
  root.appendChild(el('div', { class: 'col' },
    el('div', { class: 'panel col' },
      el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
        el('div', {},
          el('h3', { style: { margin: '0 0 2px' }, text: '월드맵' }),
          el('div', { class: 'muted tiny', text: '도시를 클릭하면 최단 경로로 이동한다. 이동 일수만큼 날짜가 흐르고 임금이 나간다.' }),
          el('div', { class: 'faint tiny', text: '◆ 던전은 도시가 아니다. 그 주에 열린 던전만 들어갈 수 있고, 던전으로 향하는 데는 날짜를 쓰지 않는다.' }),
          // 폰에는 hover 가 없다 — 툴팁에만 있던 정보를 탭으로 볼 수 있다고 알려 준다
          el('div', { class: 'tiny wm-touchhint', style: { color: 'var(--gold-dim)' },
            text: '한 번 누르면 정보와 경로를 보고, 같은 곳을 한 번 더 누르면 출발한다.' })),
        el('div', { class: 'row center wrap', style: { gap: '14px' } },
          el('div', { class: 'col', style: { gap: '2px', alignItems: 'flex-end' } },
            el('span', { class: 'faint tiny', text: '현재 위치' }),
            el('span', { style: { fontWeight: '700', color: 'var(--gold)' }, text: cur ? cur.name : '—' })),
          el('div', { class: 'col', style: { gap: '2px', alignItems: 'flex-end' } },
            el('span', { class: 'faint tiny', text: dayLabel() }),
            el('span', {
              style: { fontWeight: '700', color: openD ? setColorOf(openD) : 'var(--ink-faint)' },
              text: openD ? `${openWeek()}주차 개방 — ${openD.name}` : '열린 던전 없음',
            })))),
      stage,
      legend()),
    el('div', { class: 'wm-cols' },
      neighborPanel(),
      // 좁은 화면에서만 보인다. 여기서 narrowMap() 을 못 쓰는 이유는 viewW 가 아직
      // layout() 전이라 이전 값이기 때문 — 그래서 항상 만들어 두고 layout() 이 표시를 정한다.
      (allCityEl = allCityPanel()),
      dungeonPanel(),
      routeHelpPanel())));

  layout();                  // 내부에서 draw()까지 한다 (탭이 숨겨져 rAF가 멈춰 있어도 한 장은 남는다)
  window.addEventListener('resize', layout);
  lastTs = 0;
  raf = requestAnimationFrame(loop);
}

export function dispose() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  hoverDgId = null;
  selectedDgId = null;
  window.removeEventListener('resize', layout);
  if (canvas) {
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseleave', onLeave);
    canvas.removeEventListener('click', onClick);
  }
  canvas = null; ctx = null; stage = null; tip = null;
  // 이동 확인/도착 모달이 다음 화면 위에 남지 않도록 정리한다.
  const layer = document.getElementById('modal-layer');
  if (layer) layer.innerHTML = '';
}

function legend() {
  return el('div', { class: 'wm-legend' },
    REGIONS.map((r) => el('span', { class: 'lg' },
      el('i', { class: 'dot', style: { background: BIOME_COLOR[r.biome] || '#888' } }),
      `${r.name} (${r.tier}등급)`)),
    dungeonList().length
      ? el('span', { class: 'lg', style: { color: 'var(--ink-dim)' } },
          el('i', {
            class: 'dot',
            style: {
              background: MYTHIC_COLOR, borderRadius: '2px', transform: 'rotate(45deg)',
              boxShadow: `0 0 6px ${MYTHIC_GLOW}`,
            },
          }),
          '◆ 던전 (그 주차에만 개방)')
      : null);
}

/* ─────────────────────────── 던전 목록 패널 ─────────────────────────── */

function dungeonPanel() {
  const list = dungeonList();
  if (!list.length) {
    return el('div', { class: 'panel col' },
      el('h3', { text: '던전' }),
      el('div', { class: 'faint tiny', text: '알려진 던전이 없다.' }));
  }
  const week = openWeek();
  const rows = list.slice().sort((a, b) => (a.week || 0) - (b.week || 0)).map((d) => {
    const open = isOpen(d);
    const prog = progressOf(d);
    const total = wavesOf(d);
    const color = setColorOf(d);
    const wait = daysUntilOpen(d);
    return el('div', {
      class: `wm-dg ${open ? 'open' : 'locked'}`,
      style: { cursor: 'pointer' },
      onClick: () => askDungeon(d.id),
    },
      el('i', { class: 'gem', style: { background: color, boxShadow: open ? `0 0 8px ${color}` : 'none' } }),
      el('div', { class: 'grow col', style: { gap: '2px' } },
        el('div', { class: 'row spread center', style: { gap: '8px' } },
          el('span', { class: 'nm', style: { color: open ? 'var(--ink)' : 'var(--ink-dim)' }, text: d.name }),
          el('span', {
            class: 'tiny',
            style: { color: open ? 'var(--gold)' : 'var(--ink-faint)' },
            text: open ? '이번 주 개방' : `${d.week}주차에 열림${wait ? ` · ${wait}일 뒤` : ''}`,
          })),
        el('div', { class: 'faint tiny', text: `${setNameOf(d)} · ${archLabel(d)}` }),
        el('div', { class: 'wm-dg-bar' },
          el('i', { style: { width: `${Math.round((prog.bestWave / total) * 100)}%`, background: color } })),
        el('div', { class: 'faint tiny', text: `최고 도달 ${prog.bestWave}/${total}${prog.clearedAt ? ' · 완주' : ''}` })));
  });
  return el('div', { class: 'panel col' },
    el('h3', { text: `던전 — ${week}주차` }),
    el('div', { class: 'muted tiny', text: '주차마다 한 곳만 열린다. 웨이브마다 보스가 있고, 잡을 때마다 세트 조각이 하나 떨어진다.' }),
    el('div', { class: 'col', style: { gap: '8px' } }, rows));
}

/* ─────────────────────────── 사이드 패널 ─────────────────────────── */

function neighborPanel() {
  const rows = neighbors(state.cityId).map((lk) => {
    const c = getCity(lk.to);
    if (!c) return null;
    const reg = getRegion(c.regionId);
    return el('div', { class: 'row spread center wm-nb', style: { gap: '10px' } },
      el('div', {},
        el('div', { style: { fontWeight: '600' }, text: c.name },
          el('span', { class: 'faint tiny', text: ` ${c.tier}등급` })),
        el('div', { class: 'faint tiny', text: `${reg ? reg.name : ''} · ${lk.days}일` })),
      el('button', {
        class: 'btn sm wm-go', onClick: () => askTravel(c.id),
      }, '이동'));
  }).filter(Boolean);

  return el('div', { class: 'panel col' },
    el('h3', { text: '인접 도시' }),
    rows.length ? el('div', { class: 'col', style: { gap: '8px' } }, rows)
      : el('div', { class: 'faint tiny', text: '연결된 길이 없다.' }));
}

/* ─────────────────────────── 전체 도시 목록 ───────────────────────────
 * 폰에서는 라벨이 겹쳐 못 읽으므로 지도에 이름을 4~5개만 띄운다(위 flushLabels 참고).
 * 그러면 나머지 도시는 **이름 없는 점**이 되어 찍어 보기 전에는 어딘지 알 수 없다.
 * 그래서 좁은 화면에서는 지도 아래에 전체 목록을 깔아, 이름으로 골라 갈 수 있게 한다. */

function allCityPanel() {
  const here = state.cityId;
  const rows = CITIES
    .map((c) => ({ c, days: travelDays(here, c.id) }))
    .sort((a, b) => {
      if (a.c.id === here) return -1;
      if (b.c.id === here) return 1;
      const ad = Number.isFinite(a.days) ? a.days : 1e9;
      const bd = Number.isFinite(b.days) ? b.days : 1e9;
      return ad - bd;
    })
    .map(({ c, days }) => {
      const isHere = c.id === here;
      const reg = getRegion(c.regionId);
      const reachable = Number.isFinite(days);
      return el('div', { class: 'row spread center wm-nb', style: { gap: '10px' } },
        el('div', { class: 'grow' },
          el('div', { style: { fontWeight: '600', color: isHere ? 'var(--gold)' : 'var(--ink)' }, text: c.name },
            el('span', { class: 'faint tiny', text: ` ${c.tier}등급` })),
          el('div', { class: 'faint tiny', text: `${reg ? reg.name : ''} · ${isHere ? '현재 위치' : reachable ? `${days}일` : '길 없음'}` })),
        isHere || !reachable
          ? el('span', { class: 'faint tiny', text: isHere ? '여기' : '—' })
          : el('button', { class: 'btn sm wm-go', onClick: () => askTravel(c.id) }, '이동'));
    });

  return el('div', { class: 'panel col' },
    el('h3', { text: '전체 도시' }),
    el('div', { class: 'muted tiny', text: '지도가 좁아 이름을 다 띄우지 못한다. 여기서 골라도 된다.' }),
    el('div', { class: 'col', style: { gap: '8px' } }, rows));
}

function routeHelpPanel() {
  const upkeep = state.roster.reduce((a, m) => a + (m.upkeep || 0), 0);
  const wounded = state.roster.filter((m) => isWounded(m, state.day));
  return el('div', { class: 'panel col' },
    el('h3', { text: '원정 준비' }),
    el('div', { class: 'muted tiny' }, `하루 임금 ${num(upkeep)}G · 보유 ${num(state.gold)}G — 임금만으로 ${upkeep ? Math.floor(state.gold / upkeep) : '∞'}일 버틴다.`),
    wounded.length
      ? el('div', { class: 'wm-ev bad tiny' }, `부상자 ${wounded.length}명. 이동 중 습격당하면 남은 인원만으로 싸워야 한다.`)
      : el('div', { class: 'wm-ev good tiny' }, '전원 출전 가능. 먼 길도 견딜 만하다.'),
    el('div', { class: 'faint tiny' }, '먼 길일수록 노상 사건이 일어날 확률이 높다. 산적·늑대·탈영병은 그 자리에서 전투가 벌어진다.'));
}

/* ─────────────────────────── 캔버스 레이아웃 ─────────────────────────── */

function layout() {
  if (!canvas || !stage) return;
  // 하한을 컨테이너보다 크게 잡으면 캔버스가 스테이지를 삐져나온다 (폰에서 가로 스크롤의 원인).
  // 320 → 280 으로 낮춰 아주 좁은 기기에서도 넘치지 않게 한다.
  const w = Math.max(280, stage.clientWidth || MAP_W);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  viewW = w;
  scale = w / MAP_W;
  const h = MAP_H * scale;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 지도가 좁아 라벨을 솎아낼 때만 전체 도시 목록을 띄운다 (넓으면 지도에 다 보이므로 중복)
  if (allCityEl) allCityEl.style.display = narrowMap() ? '' : 'none';
  draw(); // 크기를 바꾸면 캔버스가 비므로 즉시 다시 그린다
}

function loop(ts) {
  if (!canvas) return;
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  clock += dt;
  if (stage && Math.abs((stage.clientWidth || viewW) - viewW) > 1) layout();
  draw();
  raf = requestAnimationFrame(loop);
}

/* ─────────────────────────── 그리기 ─────────────────────────── */

function draw() {
  if (!ctx) return;
  const W = viewW;
  const H = MAP_H * scale;
  ctx.clearRect(0, 0, W, H);

  drawBackground(W, H);
  resetLabels();
  drawRegions();    // 지역명 → 일수 뱃지 → 도시/던전 라벨 순으로 자리를 잡는다.
  drawLinks();      // 먼저 그려지는 쪽이 자리를 선점하고, 나중 것이 그 자리를 피한다.
  drawNodes();
  drawDungeons();   // 던전은 도시 위에 그린다 (가장 눈에 띄어야 한다)
  flushLabels();    // 라벨은 노드를 다 그린 뒤 우선순위대로 자리를 잡아 맨 위에 얹는다
}

function drawBackground(W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#171225');
  g.addColorStop(1, '#0a080f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 옅은 격자 (지도 느낌)
  ctx.save();
  ctx.strokeStyle = 'rgba(232,226,216,.035)';
  ctx.lineWidth = 1;
  const step = 50 * scale;
  ctx.beginPath();
  for (let x = 0; x <= W; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); }
  for (let y = 0; y <= H; y += step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); }
  ctx.stroke();
  ctx.restore();
}

/** 지역별 색 얼룩 + 지역명 */
function drawRegions() {
  for (const reg of REGIONS) {
    const cities = CITIES.filter((c) => c.regionId === reg.id);
    if (!cities.length) continue;
    const color = BIOME_COLOR[reg.biome] || '#888';
    ctx.save();
    for (const c of cities) {
      const r = (95 + (c.tier || 1) * 9) * scale;
      const g = ctx.createRadialGradient(sx(c.x), sy(c.y), 0, sx(c.x), sy(c.y), r);
      g.addColorStop(0, hexA(color, 0.22));
      g.addColorStop(0.55, hexA(color, 0.1));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx(c.x), sy(c.y), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 지역 이름은 **넓은 화면에서만** 쓴다.
    //
    // 폰에서는 1000x700 지도가 316px 폭으로 눌린다. 여기에 지역 7개 x 2줄(14개)을 더 얹으면
    // 도시 이름과 뒤엉켜 하나도 못 읽는다 — 실제로 플레이어가 "지도 글자들이 겹쳐서
    // 잘 안 보인다"고 지적한 원인이 이것이다(도시 라벨은 이미 thin 으로 솎아내고 있었는데
    // 지역 라벨만 그 규칙에서 빠져 있었다).
    // 지역 정보는 색 얼룩으로 이미 구분되고, 자세한 건 도시를 누르면 나온다.
    if (narrowMap()) continue;

    const cx = cities.reduce((a, c) => a + c.x, 0) / cities.length;
    const cy = cities.reduce((a, c) => a + c.y, 0) / cities.length;
    ctx.save();
    const f1 = Math.max(10, Math.round(13 * scale));
    const f2 = Math.max(9, Math.round(10 * scale));
    const sub = `${BIOME_NAME[reg.biome] || ''} · ${reg.tier}등급`;
    ctx.textAlign = 'center';

    // 지역명은 배경 글씨지만 자리는 차지한다 — 찜해 둬야 도시 라벨이 이 위를 피한다.
    ctx.font = `700 ${f1}px ${FONT}`;
    const w1 = ctx.measureText(reg.name).width;
    ctx.font = `${f2}px ${FONT}`;
    const w2 = ctx.measureText(sub).width;
    placedLabels.push({ x: sx(cx) - w1 / 2, y: sy(cy) - 74 * scale - f1, w: w1, h: f1 + 2 });
    placedLabels.push({ x: sx(cx) - w2 / 2, y: sy(cy) - 60 * scale - f2, w: w2, h: f2 + 2 });

    ctx.font = `700 ${f1}px ${FONT}`;
    ctx.fillStyle = hexA(color, 0.5);
    ctx.fillText(`${reg.name}`, sx(cx), sy(cy) - 74 * scale);
    ctx.font = `${f2}px ${FONT}`;
    ctx.fillStyle = hexA(color, 0.32);
    ctx.fillText(sub, sx(cx), sy(cy) - 60 * scale);
    ctx.restore();
  }
}

/** 현재 선택된 목적지까지의 경로 (호버/선택 우선) */
function activePath() {
  const target = hoverId && hoverId !== state.cityId ? hoverId : selectedId;
  if (!target || target === state.cityId) return [];
  return pathBetween(state.cityId, target);
}

function drawLinks() {
  const path = activePath();
  const onPath = new Set();
  for (let i = 0; i < path.length - 1; i++) onPath.add(key(path[i], path[i + 1]));

  const seen = new Set();
  for (const c of CITIES) {
    for (const lk of c.links || []) {
      const k = key(c.id, lk.to);
      if (seen.has(k)) continue;
      seen.add(k);
      const b = getCity(lk.to);
      if (!b) continue;
      const hot = onPath.has(k);

      ctx.save();
      ctx.lineCap = 'round';
      if (hot) {
        ctx.strokeStyle = 'rgba(224,180,74,.85)';
        ctx.lineWidth = Math.max(2, 3.2 * scale);
        ctx.setLineDash([10 * scale, 7 * scale]);
        ctx.lineDashOffset = -clock * 26 * scale;
        ctx.shadowColor = 'rgba(224,180,74,.5)';
        ctx.shadowBlur = 8 * scale;
      } else {
        ctx.strokeStyle = 'rgba(160,150,180,.22)';
        ctx.lineWidth = Math.max(1, 1.6 * scale);
      }
      ctx.beginPath();
      ctx.moveTo(sx(c.x), sy(c.y));
      ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
      ctx.restore();

      // 소요 일수 표기.
      // 폰에서는 아예 안 그린다. 경로가 20여 개라 지도가 숫자 뱃지로 덮이는데,
      // 정작 **같은 정보가 도시 라벨 둘째 줄("3일")에 이미 있다.** 중복을 지우는 쪽이
      // 겹침도 줄고 읽기도 쉽다 (계측: 뱃지가 도시 이름을 가리는 겹침이 360px에서 3쌍).
      if (narrowMap()) continue;

      const mx = lerp(sx(c.x), sx(b.x), 0.5);
      const my = lerp(sy(c.y), sy(b.y), 0.5);
      const br = 8.5 * scale;
      // 뱃지가 놓인 자리를 먼저 찜해 둔다 — 도시 라벨이 이 위에 겹치지 않도록.
      placedLabels.push({ x: mx - br, y: my - br, w: br * 2, h: br * 2 });
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, br, 0, Math.PI * 2);
      ctx.fillStyle = hot ? 'rgba(58,45,20,.95)' : 'rgba(16,13,23,.85)';
      ctx.fill();
      ctx.strokeStyle = hot ? 'rgba(224,180,74,.8)' : 'rgba(160,150,180,.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = `700 ${Math.max(8, Math.round(9.5 * scale))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = hot ? '#f2dfa8' : 'rgba(200,192,212,.6)';
      ctx.fillText(String(lk.days), mx, my + 0.5);
      ctx.restore();
    }
  }
}

function drawNodes() {
  const here = state.cityId;
  const adj = new Set(neighbors(here).map((l) => l.to));
  const thin = narrowMap();

  // 라벨은 **중요한 것부터** 자리를 잡아야 한다 (placeLabel 은 선착순이다).
  // 노드 자체는 어떤 순서로 그려도 같으므로 이 정렬 하나로 둘 다 해결된다.
  const rank = (c) => (c.id === here ? 0 : c.id === selectedId ? 1 : c.id === hoverId ? 2 : adj.has(c.id) ? 3 : 4);
  const ordered = CITIES.slice().sort((a, b) => rank(a) - rank(b));

  for (const c of ordered) {
    const isHere = c.id === here;
    const days = travelDays(here, c.id);
    const reachable = Number.isFinite(days);
    const hovered = c.id === hoverId;
    const color = BIOME_COLOR[cityBiome(c.id)] || '#888';
    const r = nodeR(c.tier || 1);
    const x = sx(c.x);
    const y = sy(c.y);
    const alpha = isHere ? 1 : hovered ? 1 : adj.has(c.id) ? 0.92 : reachable ? 0.62 : 0.28;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 현재 위치 맥동 후광
    if (isHere) {
      const pulse = 1 + Math.sin(clock * 2.2) * 0.14;
      const g = ctx.createRadialGradient(x, y, r, x, y, r * 3.4 * pulse);
      g.addColorStop(0, 'rgba(224,180,74,.42)');
      g.addColorStop(1, 'rgba(224,180,74,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.4 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // 노드 본체
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const fill = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    fill.addColorStop(0, mix(color, '#ffffff', 0.35));
    fill.addColorStop(1, mix(color, '#0b0910', 0.55));
    ctx.fillStyle = fill;
    ctx.fill();

    // tier = 테두리 두께/색
    ctx.lineWidth = Math.max(1, (1 + (c.tier || 1) * 0.45) * scale);
    ctx.strokeStyle = isHere ? '#e0b44a' : hovered ? '#e8e2d8' : mix(color, '#ffffff', 0.25);
    ctx.stroke();

    if (isHere) {
      ctx.beginPath();
      ctx.arc(x, y, r + 4 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(224,180,74,.75)';
      ctx.lineWidth = Math.max(1, 1.4 * scale);
      ctx.stroke();
    }

    // 라벨 — 좁은 화면에서는 14개를 전부 쓰면 서로 겹쳐 하나도 못 읽는다.
    // 현재 위치 / 고른 곳 / 바로 갈 수 있는 이웃만 남긴다 (나머지는 눌러야 뜬다).
    const show = !thin || isHere || hovered || c.id === selectedId || adj.has(c.id);
    if (show) {
      const fs = thin ? 13 : Math.max(10, Math.round(12 * scale));
      const fs2 = thin ? 11 : Math.max(9, Math.round(10 * scale));
      ctx.font = `${isHere ? '700 ' : '600 '}${fs}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const sub = isHere ? '현재 위치' : reachable ? `${days}일` : '길 없음';
      const tw = ctx.measureText(c.name).width;
      ctx.font = `${fs2}px ${FONT}`;
      const sw = ctx.measureText(sub).width;
      ctx.font = `${isHere ? '700 ' : '600 '}${fs}px ${FONT}`;

      // 이름 + 거리 두 줄을 한 덩어리로 놓는다. 현재 위치와 직접 고른 곳은 무슨 일이 있어도 보여 준다.
      // 실제로 그리는 건 flushLabels 다 — 던전 라벨과 자리를 같이 나눠야 하기 때문.
      const must = isHere || c.id === selectedId || hovered;
      const nameFont = `${isHere ? '700 ' : '600 '}${fs}px ${FONT}`;
      const nameCol = isHere ? '#f2dfa8' : hovered ? '#ffffff' : '#e8e2d8';
      const subCol = isHere ? 'rgba(224,180,74,.9)' : 'rgba(167,157,176,.85)';
      queueLabel(rank(c), {
        x, y, r, w: Math.max(tw, sw), h: fs + 2 + fs2, force: must,
        draw: (lx, ty) => {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.font = nameFont;
          boxedText(c.name, lx, ty, fs, nameCol);
          ctx.font = `${fs2}px ${FONT}`;
          boxedText(sub, lx, ty + fs + 2, fs2, subCol);
          ctx.restore();
        },
      });
    }

    ctx.restore();
  }
}

/* ─────────────────────────── 던전 노드 ───────────────────────────
 * 도시는 원, 던전은 **마름모 관문**이다. 열린 던전만 밝게 그리고 나머지는
 * 어둡게 + 자물쇠 + `N주차에 열림` 을 붙인다. */

function drawDungeons() {
  const thin = narrowMap();
  for (const d of dungeonList()) {
    const x = sx(d.x);
    const y = sy(d.y);
    const r = dungeonR();
    const open = isOpen(d);
    const hovered = d.id === hoverDgId || d.id === selectedDgId;
    const color = setColorOf(d);
    const prog = progressOf(d);
    const total = wavesOf(d);

    ctx.save();
    ctx.globalAlpha = open ? 1 : hovered ? 0.8 : 0.4;

    // 열린 던전은 맥동하는 붉은 금빛 후광을 두른다 (도시의 금색 후광과 색이 다르다)
    if (open) {
      const pulse = 1 + Math.sin(clock * 2.6) * 0.16;
      const g = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 3.1 * pulse);
      g.addColorStop(0, hexA(MYTHIC_COLOR, 0.4));
      g.addColorStop(0.6, hexA(MYTHIC_COLOR, 0.12));
      g.addColorStop(1, hexA(MYTHIC_COLOR, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.1 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // 본체 — 마름모
    diamondPath(x, y, r);
    const fill = ctx.createLinearGradient(x, y - r, x, y + r);
    fill.addColorStop(0, mix(color, '#ffffff', open ? 0.42 : 0.18));
    fill.addColorStop(1, mix(color, '#08060d', 0.62));
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = Math.max(1, (open ? 2.2 : 1.4) * scale);
    ctx.strokeStyle = open ? (hovered ? '#ffe7b0' : MYTHIC_GLOW) : mix(color, '#0b0910', 0.35);
    ctx.stroke();

    // 안쪽 관문 (아치형 어두운 구멍)
    ctx.beginPath();
    const gw = r * 0.42;
    const gh = r * 0.62;
    ctx.moveTo(x - gw, y + gh);
    ctx.lineTo(x - gw, y - gh * 0.1);
    ctx.quadraticCurveTo(x, y - gh * 1.15, x + gw, y - gh * 0.1);
    ctx.lineTo(x + gw, y + gh);
    ctx.closePath();
    ctx.fillStyle = open ? 'rgba(10,4,6,.82)' : 'rgba(8,7,12,.7)';
    ctx.fill();
    if (open) {
      ctx.strokeStyle = hexA(MYTHIC_GLOW, 0.55);
      ctx.lineWidth = Math.max(1, 1 * scale);
      ctx.stroke();
    }

    // 완주 표시 — 관문 위 작은 별
    if (prog.clearedAt) drawStar(x, y - r * 1.02, r * 0.34, '#f2dfa8');
    // 잠김 표시 — 자물쇠
    if (!open) drawLock(x, y, r * 0.5);

    // 라벨 3줄: 던전 이름 / 세트 이름 · 개방 주차 / 최고 도달 웨이브.
    // 어디에 붙일지(아래/위/좌우)는 placeLabel 이 정한다 — 화면 밖과 겹침을 같이 피한다.
    // 잠긴 던전도 최고 기록은 보여 준다 — "다음 주에 어디까지 이어서 밀지"를 지도에서 바로 재도록.
    // 좁은 화면에서는 3줄 x 4곳이면 지도를 덮는다 — 열린 곳/고른 곳만 이름 한 줄로 줄인다
    // (나머지 정보는 눌렀을 때 툴팁과 옆 던전 목록에 전부 있다).
    const lines = thin ? (open || hovered ? 1 : 0) : 3;
    if (lines > 0) {
      const fs = thin ? 13 : Math.max(10, Math.round(12 * scale));
      const fs2 = thin ? 11 : Math.max(9, Math.round(10 * scale));
      ctx.font = `700 ${fs}px ${FONT}`;
      const w1 = ctx.measureText(d.name).width;
      const l2 = `${setNameOf(d)} · ${open ? '이번 주 개방' : `${d.week}주차에 열림`}`;
      const l3 = `최고 ${prog.bestWave}/${total}${prog.clearedAt ? ' 완주' : ''}`;
      ctx.font = `${fs2}px ${FONT}`;
      const w = lines >= 3 ? Math.max(w1, ctx.measureText(l2).width, ctx.measureText(l3).width) : w1;
      const h = lines >= 3 ? fs + fs2 * 2 + 4 : fs;

      // 이번 주 열린 던전은 그 주의 핵심 콘텐츠다 — 도시 이름보다 먼저 자리를 잡는다.
      queueLabel(open || hovered ? -1 : 3.5, {
        x, y, r, w, h, force: open || hovered,
        draw: (lx, nameY) => {
          ctx.save();
          ctx.globalAlpha = open ? 1 : hovered ? 0.8 : 0.4;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.font = `700 ${fs}px ${FONT}`;
          boxedText(d.name, lx, nameY, fs, open ? '#ffd9a8' : '#b9b0c4');
          if (lines >= 3) {
            ctx.font = `${fs2}px ${FONT}`;
            boxedText(l2, lx, nameY + fs + 2, fs2, open ? hexA(color, 0.95) : 'rgba(150,140,166,.85)');
            boxedText(l3, lx, nameY + fs + fs2 + 4, fs2, open ? '#e8e2d8' : 'rgba(140,131,155,.8)');
          }
          ctx.restore();
        },
      });
    }

    ctx.restore();
  }
}

/* ─────────────────────────── 라벨 자리 잡기 ───────────────────────────
 * 폰에서는 축척이 0.32까지 떨어져 노드 사이가 30px밖에 안 되는데 글자는 13px로 고정이다.
 * 그래서 라벨을 무조건 노드 아래에 찍으면 옆 도시 라벨과 반드시 겹친다
 * (계측: 360px 폭에서 8쌍 — tools/maplabels.mjs).
 *
 * 해결은 **자리 경쟁**이다. 중요한 라벨부터 순서대로 자리를 잡고, 이미 찬 자리와 겹치면
 * 위쪽을 시도하고, 그것도 막히면 그 라벨은 포기한다. 포기해도 정보가 사라지진 않는다 —
 * 노드를 누르면 이름·거리·시설이 전부 패널에 뜬다.
 *
 * 우선순위: 현재 위치 > 고른 곳 > 가리킨 곳 > 열린 던전 > 이웃 도시 > 나머지 */

/** 이번 프레임에 이미 자리를 잡은 라벨 사각형들 */
let placedLabels = [];
/** 아직 자리를 못 정한 라벨들 (우선순위대로 flushLabels 에서 처리) */
let labelQueue = [];

/** 프레임 시작마다 비운다 */
function resetLabels() { placedLabels = []; labelQueue = []; }

/**
 * 라벨을 그리는 대신 **예약**한다. 도시와 던전이 그리는 순서(던전이 위)와
 * 자리를 잡는 순서(중요한 것 먼저)가 서로 다르기 때문에 한 번 모았다가 처리한다.
 * @param {number} prio 낮을수록 먼저 자리를 잡는다
 * @param {(top:number)=>void} draw 확정된 y 를 받아 실제로 그리는 함수
 */
function queueLabel(prio, o) { labelQueue.push({ prio, ...o }); }

/** 예약된 라벨을 우선순위대로 배치하고 그린다 */
function flushLabels() {
  labelQueue.sort((a, b) => a.prio - b.prio);
  for (const l of labelQueue) {
    const p = placeLabel(l.x, l.y, l.r, l.w, l.h, l.force);
    if (p) l.draw(p.x, p.y);   // 자리가 좌우로 밀렸을 수 있으므로 x 도 받아 쓴다
  }
  labelQueue = [];
}

/** 이 사각형이 이미 찬 자리와 겹치지 않는가 */
function labelFits(r) {
  for (const p of placedLabels) {
    const ox = Math.min(r.x + r.w, p.x + p.w) - Math.max(r.x, p.x);
    const oy = Math.min(r.y + r.h, p.y + p.h) - Math.max(r.y, p.y);
    if (ox > 1 && oy > 1) return false;
  }
  return true;
}

/**
 * 노드 라벨을 놓을 y 를 고른다. 아래 → 위 순으로 시도한다.
 * @returns {number|null} 라벨 첫 줄의 top y. 자리가 없으면 null (= 그리지 않음)
 */
function placeLabel(x, y, nodeR, w, h, force) {
  const gap = nodeR + 4 * scale;
  const side = w / 2 + nodeR + 6 * scale;

  // 아래를 가장 선호하고, 막히면 위 → 좌우 → 더 멀리 순으로 밀어낸다.
  // 후보가 아래/위 둘뿐이면 도시가 붙어 있는 폰에서 금방 자리가 동나 라벨이 사라진다.
  const cands = [
    { x, y: y + gap },
    { x, y: y - gap - h },
    { x: x + side, y: y - h / 2 },
    { x: x - side, y: y - h / 2 },
    { x, y: y + gap + h + 5 },
    { x, y: y - gap - h * 2 - 5 },
  ];
  const boxAt = (p) => ({ x: p.x - w / 2 - 4 * scale, y: p.y - 1, w: w + 8 * scale, h: h + 3 });

  // 캔버스 밖으로 나가면 잘려서 안 보인다 — 겹침만큼이나 나쁘다.
  // (예전에는 던전 라벨만 `d.y < MAP_H*0.88` 로 아래/위를 뒤집어 이걸 피하고 있었다.
  //  이제는 도시·던전 모두 여기서 한꺼번에 거른다.)
  const canvasH = MAP_H * scale;
  const inView = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= viewW && b.y + b.h <= canvasH;

  // 빈자리를 먼저 찾는다 — force 라벨도 마찬가지다.
  // (force 가 자리 검사를 통째로 건너뛰면 "현재 위치"와 "고른 곳"이 서로 겹칠 수 있다.)
  for (const p of cands) {
    const b = boxAt(p);
    if (inView(b) && labelFits(b)) { placedLabels.push(b); return p; }
  }
  if (!force) return null;

  // 반드시 보여야 하는 라벨은 겹쳐서라도 그린다 — 안 보이는 것보다 낫다.
  // 다만 화면 밖은 그려도 안 보이므로, 그나마 화면 안에 들어오는 후보를 고른다.
  const p = cands.find((q) => inView(boxAt(q))) || cands[0];
  placedLabels.push(boxAt(p));
  return p;
}

/** 라벨 뒤에 어두운 판을 깔아 배경과 겹쳐도 읽히게 한다 */
function boxedText(text, x, y, fs, color) {
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(6,4,10,.78)';
  ctx.fillRect(x - w / 2 - 4 * scale, y - 1, w + 8 * scale, fs + 3);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function diamondPath(x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

function drawStar(x, y, r, color) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px2 = x + Math.cos(rad) * rr;
    const py2 = y + Math.sin(rad) * rr;
    if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawLock(x, y, s) {
  ctx.save();
  ctx.strokeStyle = 'rgba(232,226,216,.75)';
  ctx.fillStyle = 'rgba(232,226,216,.75)';
  ctx.lineWidth = Math.max(1, s * 0.22);
  ctx.beginPath();
  ctx.arc(x, y - s * 0.22, s * 0.38, Math.PI, 0);   // 고리
  ctx.stroke();
  ctx.fillRect(x - s * 0.55, y - s * 0.2, s * 1.1, s * 0.78);  // 몸통
  ctx.restore();
}

/* ─────────────────────────── 색 유틸 ─────────────────────────── */

function hexA(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function hexRgb(hex) {
  const h = String(hex).replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0];
}
function mix(a, b, t) {
  const A = hexRgb(a); const B = hexRgb(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** append 는 null을 "null" 문자열로 넣어버리므로 걸러서 붙인다 */
function add(host, ...kids) {
  for (const k of kids.flat(9)) if (k) host.appendChild(k);
  return host;
}

/* ─────────────────────────── 입력 ─────────────────────────── */

function pickCity(ev) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;
  let best = null;
  let bestD = Infinity;
  const pad = pickPad();
  for (const c of CITIES) {
    const d = Math.hypot(sx(c.x) - mx, sy(c.y) - my);
    // 손가락은 노드보다 크다 — 터치에서는 최소 22px 를 잡아 준다
    const r = Math.max(nodeR(c.tier || 1) + pad, noHover() ? 22 : 0);
    if (d < r && d < bestD) { bestD = d; best = c; }
  }
  return best ? { city: best, mx, my } : null;
}

/** 던전 노드 히트 테스트 (마름모지만 판정은 원으로 넉넉하게) */
function pickDungeon(ev) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;
  let best = null;
  let bestD = Infinity;
  const pad = pickPad();
  for (const d of dungeonList()) {
    const dist = Math.hypot(sx(d.x) - mx, sy(d.y) - my);
    const r = Math.max(dungeonR() + pad, noHover() ? 26 : 0);
    if (dist < r && dist < bestD) { bestD = dist; best = d; }
  }
  return best ? { dungeon: best, mx, my } : null;
}

function onMove(ev) {
  // 터치 기기에서도 탭 직전에 mousemove 가 한 번 오는 브라우저가 있다.
  // 그걸 hover 로 처리하면 툴팁이 깜빡이고 선택 상태와 엇갈린다 — 탭 흐름에 맡긴다.
  if (noHover()) return;
  // 던전이 도시보다 위에 그려지므로 판정도 던전이 먼저다.
  const dg = pickDungeon(ev);
  if (dg) {
    hoverDgId = dg.dungeon.id;
    hoverId = null;
    if (canvas) canvas.style.cursor = 'pointer';
    showDungeonTip(dg.dungeon, dg.mx, dg.my);
    return;
  }
  hoverDgId = null;
  const hit = pickCity(ev);
  hoverId = hit ? hit.city.id : null;
  if (canvas) canvas.style.cursor = hit ? 'pointer' : 'default';
  if (!hit) { hideTip(); return; }
  showTip(hit.city, hit.mx, hit.my);
}

function onLeave() {
  hoverId = null;
  hoverDgId = null;
  hideTip();
}

/**
 * 클릭 / 탭.
 *
 * hover 가 있는 기기(PC)에서는 예전 그대로 — 한 번 누르면 바로 확인 모달이 뜬다.
 * hover 가 없는 기기(폰)에서는 **두 단계**로 나눈다: 첫 탭은 고르기(툴팁 + 경로 + 라벨),
 * 같은 곳을 다시 탭하면 진행. 마우스를 올려야만 보이던 정보를 탭으로 볼 수 있게 하고,
 * 손가락으로 잘못 짚어 엉뚱한 도시로 떠나는 사고도 막는다.
 */
function onClick(ev) {
  const touch = noHover();
  const dg = pickDungeon(ev);
  if (dg) {
    const d = dg.dungeon;
    if (touch && selectedDgId !== d.id) {
      selectedDgId = d.id;
      hoverDgId = d.id;
      selectedId = null;
      hoverId = null;
      showDungeonTip(d, dg.mx, dg.my);
      return;
    }
    selectedDgId = null;
    askDungeon(d.id);
    return;
  }
  const hit = pickCity(ev);
  if (!hit) {
    // 빈 곳을 탭하면 선택을 푼다 (경로 하이라이트·툴팁 정리)
    if (touch) { selectedId = null; selectedDgId = null; hoverDgId = null; hideTip(); }
    return;
  }
  const id = hit.city.id;
  if (touch && selectedId !== id) {
    selectedId = id;
    selectedDgId = null;
    hoverDgId = null;
    showTip(hit.city, hit.mx, hit.my);
    return;
  }
  selectedId = id;
  if (id === state.cityId) { toast('이미 이 도시에 있습니다.'); return; }
  askTravel(id);
}

function hideTip() { if (tip) tip.classList.add('hidden'); }

function showTip(city, mx, my) {
  if (!tip) return;
  const reg = cityRegion(city.id);
  const days = travelDays(state.cityId, city.id);
  const quests = state.quests?.[city.id]?.list;
  const services = (city.services || []).map((s) => SERVICE_NAME[s] || s).join(' · ') || '없음';

  tip.innerHTML = '';
  tip.append(
    el('div', { class: 'nm', style: { color: BIOME_COLOR[cityBiome(city.id)] || 'var(--ink)' }, text: city.name }),
    el('div', { class: 'faint tiny', text: `${reg ? reg.name : ''} · ${BIOME_NAME[cityBiome(city.id)] || ''}` }),
    el('div', { class: 'tiny', style: { marginTop: '4px' } },
      el('span', { class: 'faint', text: '등급 ' }),
      el('span', { style: { color: 'var(--gold)' }, text: '★'.repeat(clamp(city.tier || 1, 0, 5)) + '☆'.repeat(clamp(5 - (city.tier || 1), 0, 5)) })),
    el('div', { class: 'tiny muted', text: `시설: ${services}` }),
    el('div', { class: 'tiny muted', text: `의뢰: ${quests ? `${quests.length}건` : '미확인'}` }),
    el('div', { class: 'tiny', style: { marginTop: '4px', color: 'var(--gold)' }, text: city.id === state.cityId ? '현재 위치' : Number.isFinite(days) ? `이동 ${days}일` : '갈 수 없다' }),
    // 폰에는 hover 가 없다 — 다음에 뭘 해야 하는지 툴팁 안에서 말해 준다
    noHover() && city.id !== state.cityId
      ? el('div', { class: 'tiny', style: { marginTop: '2px', color: 'var(--ink-faint)' }, text: '한 번 더 누르면 출발' })
      : null,
  );
  // ★ 이 줄이 없어서 도시 툴팁이 한 번 숨겨지면 다시 뜨지 않았다 (던전 툴팁에만 있었다).
  tip.classList.remove('hidden');
  placeTip(mx, my);
}

/** 던전 노드 툴팁 */
function showDungeonTip(d, mx, my) {
  if (!tip) return;
  const open = isOpen(d);
  const prog = progressOf(d);
  const total = wavesOf(d);
  const wait = daysUntilOpen(d);
  const color = setColorOf(d);

  tip.innerHTML = '';
  tip.append(
    el('div', { class: 'nm', style: { color }, text: `◆ ${d.name}` }),
    el('div', { class: 'faint tiny', text: `${BIOME_NAME[d.biome] || ''} · ${total}웨이브 · 웨이브마다 보스` }),
    el('div', { class: 'tiny', style: { marginTop: '4px' } },
      el('span', { class: 'faint', text: '세트 ' }),
      el('span', { style: { color, fontWeight: '700' }, text: setNameOf(d) })),
    el('div', { class: 'tiny muted', text: `착용: ${archLabel(d)}` }),
    el('div', { class: 'tiny muted', text: `드랍: ${DROP_BANDS.map((b) => `${b.from}~${b.to} ${b.label}`).join(' / ')}` }),
    el('div', { class: 'tiny', style: { marginTop: '4px' }, text: `최고 도달 ${prog.bestWave}/${total}${prog.clearedAt ? ' · 완주' : ''}` }),
    el('div', {
      class: 'tiny',
      style: { marginTop: '2px', color: open ? 'var(--gold)' : 'var(--ink-faint)', fontWeight: '700' },
      text: open
        ? (noHover() ? '이번 주 개방 — 한 번 더 누르면 들어간다' : '이번 주 개방 — 클릭하면 들어간다')
        : `${d.week}주차에 열린다${wait ? ` (${wait}일 뒤)` : ''}`,
    }),
  );
  tip.classList.remove('hidden');
  placeTip(mx, my);
}

function placeTip(mx, my) {
  if (!tip) return;
  const w = tip.offsetWidth || 180;
  const left = clamp(mx, w / 2 + 6, Math.max(w / 2 + 6, viewW - w / 2 - 6));
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(tip.offsetHeight + 6, my - 16)}px`;
}

/* ─────────────────────────── 던전 진입 확인 ─────────────────────────── */

/**
 * 던전 노드를 눌렀을 때. 이동 확인 후 `go('dungeon', {dungeonId})`.
 * **날짜를 쓰지 않는다** — 이동에 일수를 먹이면 도착했을 때 주차가 바뀌어
 * 방금 열려 있던 던전이 닫히는 모순이 생긴다 (파일 상단 주석 참조).
 */
function askDungeon(dungeonId) {
  if (traveling) return;
  const d = dungeonList().find((x) => x.id === dungeonId);
  if (!d) { toast('그런 던전은 없다.', 'bad'); return; }

  const open = isOpen(d);
  const prog = progressOf(d);
  const total = wavesOf(d);
  const color = setColorOf(d);
  const wait = daysUntilOpen(d);
  const cur = getCity(state.cityId);

  const body = el('div', { class: 'col', style: { gap: '10px', minWidth: 'min(420px, 76vw)' } },
    el('div', { class: 'muted tiny', text: d.desc || '' }),
    el('div', { class: 'sep' }),
    row('세트', setNameOf(d), color),
    row('착용 가능', archLabel(d)),
    row('구성', `${total}웨이브 · 웨이브마다 보스`),
    row('최고 도달', `${prog.bestWave}/${total}${prog.clearedAt ? ' (완주)' : ''}`),
    row('개방', open ? `이번 주 (${d.week}주차)` : `${d.week}주차`, open ? 'var(--gold)' : 'var(--bad)'),
    row('오늘', dayLabel()),
    el('div', { class: 'faint tiny', text: `출발지 ${cur ? cur.name : '—'} — 던전행에는 날짜를 쓰지 않는다. 그 주 안에 다녀오는 원정이다.` }),
    open
      ? el('div', { class: 'wm-ev tiny' }, '보스를 잡을 때마다 세트 조각이 하나 떨어진다. 1~5웨이브 방어구 / 6~8 장신구 / 9~10 무기·왼손.')
      : el('div', { class: 'wm-ev bad tiny' }, `지금은 들어갈 수 없다. ${d.week}주차가 되어야 문이 열린다${wait ? ` (${wait}일 뒤)` : ''}. 정보만 확인할 수 있다.`),
  );

  modal({
    title: `${d.name}${open ? '' : ' (잠김)'}`,
    body,
    actions: [
      { label: '취소', kind: 'ghost' },
      {
        label: open ? '던전으로 향한다' : '정보만 본다',
        kind: open ? 'primary' : '',
        act: () => { setTimeout(() => enterDungeon(d.id), 0); },
      },
    ],
  });
}

/** 던전 화면으로. 라우터에 화면이 없으면 조용히 죽지 않고 사유를 알린다. */
async function enterDungeon(dungeonId) {
  try {
    await go('dungeon', { dungeonId });
  } catch (e) {
    console.error('[worldmap] 던전 화면 진입 실패', e);
    toast('던전 화면을 열지 못했습니다.', 'bad');
  }
}

/* ─────────────────────────── 이동 확인 ─────────────────────────── */

function askTravel(toId) {
  if (traveling) return;
  const from = state.cityId;
  if (toId === from) { toast('이미 이 도시에 있습니다.'); return; }
  const path = pathBetween(from, toId);
  const days = travelDays(from, toId);
  if (!path.length || !Number.isFinite(days)) { toast('그 도시로 가는 길이 없습니다.', 'bad'); return; }

  const dest = getCity(toId);
  const upkeep = state.roster.reduce((a, m) => a + (m.upkeep || 0), 0) * days;
  const wounded = state.roster.filter((m) => isWounded(m, state.day));
  const evChance = Math.round(eventChance(days) * 100);

  const route = el('div', { class: 'wm-route' });
  path.forEach((id, i) => {
    const c = getCity(id);
    if (i > 0) route.append(el('span', { class: 'leg', text: `—${linkDays(path[i - 1], id) ?? '?'}일→` }));
    route.append(el('span', {
      style: { fontWeight: i === 0 || i === path.length - 1 ? '700' : '400', color: i === path.length - 1 ? 'var(--gold)' : 'var(--ink)' },
      text: c ? c.name : id,
    }));
  });

  modal({
    title: `${dest.name}(으)로 이동`,
    body: el('div', { class: 'col', style: { gap: '10px' } },
      route,
      el('div', { class: 'sep' }),
      row('총 소요', `${days}일`),
      row('도착 일차', `${num(state.day + days)}일차`),
      row('기간 중 임금', `${num(upkeep)}G`, state.gold >= upkeep ? '' : 'var(--bad)'),
      row('노상 사건 확률', `약 ${evChance}%`),
      el('div', { class: 'muted tiny', text: dest.desc || '' }),
      wounded.length
        ? el('div', { class: 'wm-ev bad tiny' }, `부상자 ${wounded.length}명을 데리고 떠난다. 이동 중 습격을 받으면 위험하다.`)
        : null,
      state.gold < upkeep
        ? el('div', { class: 'wm-ev bad tiny' }, '임금을 감당할 골드가 부족하다. 밀린 임금만큼 명성이 깎인다.')
        : null),
    actions: [
      { label: '취소', kind: 'ghost' },
      // 모달 액션이 끝나면 app.js가 모달 레이어를 비우므로, 도착 모달은 한 틱 뒤에 띄운다.
      { label: '출발한다', kind: 'primary', act: () => { setTimeout(() => doTravel(toId), 0); } },
    ],
  });
}

function row(k, v, color) {
  return el('div', { class: 'row spread center' },
    el('span', { class: 'faint tiny', text: k }),
    el('span', { class: 'num', style: { fontWeight: '700', color: color || 'var(--ink)' }, text: v }));
}

/** 경로 일수에 비례한 사건 발생 확률 */
const eventChance = (days) => clamp(0.16 + days * 0.12, 0, 0.85);

/* ─────────────────────────── 이동 실행 ─────────────────────────── */

function doTravel(toId) {
  if (traveling) return;
  traveling = true;

  const fromCity = getCity(state.cityId);
  const dest = getCity(toId);
  const days = travelDays(state.cityId, toId);
  if (!dest || !Number.isFinite(days)) { traveling = false; return; }

  addLog(`${fromCity ? fromCity.name : '어딘가'}을(를) 떠나 ${dest.name}(으)로 향한다. (${days}일 여정)`);

  // 목적지 기준으로 사건을 굴린다 (변경으로 갈수록 험해진다).
  state.cityId = toId;

  let ev = null;
  let res = null;
  if (rng.chance(eventChance(days))) {
    ev = rollTravelEvent(cityBiome(toId), rng) || (TRAVEL_EVENTS.length ? rng.pick(TRAVEL_EVENTS) : null);
    if (ev) {
      try { res = ev.apply(state, rng); } catch (e) { console.warn('[worldmap] 이벤트 처리 실패', e); res = null; }
    }
  }

  const gains = [];
  if (res) {
    if (res.gold) {
      addGold(res.gold);
      gains.push(res.gold > 0 ? `골드 +${num(res.gold)}` : `골드 -${num(-res.gold)}`);
    }
    if (res.itemRoll) {
      let it = null;
      try {
        it = rollLoot({ ilvl: res.itemRoll.ilvl, rarityBonus: res.itemRoll.rarityBonus || 0, rng });
      } catch (e) { console.warn('[worldmap] 전리품 생성 실패', e); }
      if (it) { addItem(it); gains.push(`전리품: ${it.name}`); }
    }
    addLog(`[노상] ${res.text}${gains.length ? ` (${gains.join(' · ')})` : ''}`);
  }

  advanceDays(days);
  try { refreshCity(toId, false); } catch (e) { console.warn('[worldmap] 도시 목록 갱신 실패', e); }
  addLog(`${dest.name}에 도착했다.`);

  const enc = res && res.battle ? prepareEncounter(res) : null;
  showArrival(dest, ev, res, gains, enc);
}

/** 조우 전투 준비. 출전할 부대가 없으면 null */
function prepareEncounter(res) {
  const squad = state.squads.find((s) => canDeploy(state, s.id).ok);
  if (!squad) return null;
  const b = res.battle;
  const level = clamp(Math.round(b.level || 1), 1, 60);
  // 노상 조우는 의뢰가 아니다. 출전 인원보다 크게 많은 적이 나오지 않도록 머릿수를 눌러 둔다.
  const headcount = squadMembers(state, squad.id).length;
  const count = clamp(b.count || 3, 1, Math.max(2, headcount + 1));
  let wave = null;
  try {
    wave = buildEnemySquad({
      biome: b.biome, tier: b.tier, level, count, boss: false, rng,
    }, rng);
  } catch (e) {
    console.warn('[worldmap] 조우 부대 생성 실패', e);
  }
  if (!wave || !wave.units || !wave.units.length) return null;

  const rankIdx = clamp(['F', 'E', 'D', 'C', 'B', 'A', 'S'].indexOf(b.rank || 'F'), 0, 6);
  // ui/battle.js 의 조우 모드는 quest가 아니라 battleCfg를 받는다.
  // questBattleDefs가 UnitDef 변환을 전부 해 주므로 의뢰 모양의 임시 객체를 하나 만들어 넘긴다.
  const quest = {
    id: `enc_${state.day}_${Math.floor(rng.next() * 1e6).toString(36)}`,
    name: b.name || '노상의 습격',
    type: '토벌',
    cityId: state.cityId,
    biome: b.biome,
    rank: b.rank || 'F',
    level,
    days: 0,
    waves: [{ units: wave.units, formationId: wave.formationId || 'basic' }],
    reward: { gold: 0, exp: 0, renown: 0, itemRolls: [] },
    desc: res.text,
    expiresDay: state.day,
    encounter: true,
  };

  let cfg = null;
  try { cfg = questBattleDefs(quest, 0, state, squad.id); } catch (e) { console.warn('[worldmap] 조우 전투 구성 실패', e); }
  if (!cfg || !(cfg.allies || []).length || !(cfg.enemies || []).length) return null;

  const reward = {
    gold: Math.round((45 + level * 11) * (1 + rankIdx * 0.35)),
    exp: Math.round(20 * Math.pow(level, 1.5) * 0.75),
    renown: 1 + Math.floor(rankIdx / 2),
  };
  return { quest, squad, cfg, reward };
}

function showArrival(dest, ev, res, gains, enc) {
  const body = el('div', { class: 'col', style: { gap: '10px' } });

  if (res) {
    add(body,
      el('div', { class: `wm-ev${res.battle ? ' bad' : (res.gold || 0) < 0 ? '' : ' good'}` },
        el('div', { style: { fontWeight: '700', marginBottom: '4px' }, text: ev ? ev.name : '노상의 사건' }),
        el('div', { class: 'muted tiny', text: res.text })),
      gains.length ? el('div', { class: 'tiny', style: { color: 'var(--gold)' }, text: gains.join(' · ') }) : null,
    );
  } else {
    add(body, el('div', { class: 'muted tiny', text: '별일 없이 길을 지났다.' }));
  }

  add(body,
    el('div', { class: 'sep' }),
    row('도착', dest.name),
    row('현재 일차', `${num(state.day)}일차`),
    row('보유 골드', `${num(state.gold)}G`, 'var(--gold)'),
  );

  if (res && res.battle && !enc) {
    add(body, el('div', { class: 'wm-ev tiny' },
      '출전할 수 있는 부대가 없어, 짐을 버리고 길을 돌아 무리를 피했다.'));
  }

  const arrive = () => { traveling = false; go('city'); };

  if (enc) {
    body.append(el('div', { class: 'tiny faint', text: '맞서 싸우면 전리품과 경험치를 얻는다. 우회하면 아무 일도 없었던 것이 된다.' }));
    modal({
      title: `노상 조우 — ${enc.quest.name}`,
      body,
      actions: [
        { label: '우회한다', kind: 'ghost', act: arrive },
        {
          label: `맞선다 (${enc.squad.name})`,
          kind: 'primary',
          act: () => {
            traveling = false;
            addLog(`[노상] ${enc.quest.name}와(과) 맞붙는다.`);
            go('battle', {
              battleCfg: enc.cfg,
              title: enc.quest.name,
              rank: enc.quest.rank,
              biome: enc.quest.biome,
              squadId: enc.squad.id,
              reward: enc.reward,
              days: 0,
              encounter: true,
              cityId: state.cityId,
              returnTo: 'city',
            });
          },
        },
      ],
      onClose: () => { if (traveling) arrive(); },
    });
    return;
  }

  modal({
    title: `${dest.name} 도착`,
    body,
    actions: [{ label: '도시로', kind: 'primary', act: arrive }],
    onClose: () => { if (traveling) arrive(); },
  });
}
