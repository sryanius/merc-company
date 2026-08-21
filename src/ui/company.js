// 용병단 관리 화면 — 부대 편성(진형 슬롯 그대로) / 진형 선택·구매 / 용병 상세·전직 / 로스터.
// 화면 모듈 계약: meta / render(root, params) / dispose()
//
// 배치 방식 (중요):
//   드래그는 "보조 수단"이다. 주 수단은 **클릭 2번**이다.
//     명부 카드 클릭 → 편성판 빈 칸 클릭   (또는 그 반대 순서로도 된다)
//   로스터가 길어 드래그 중 스크롤이 안 되는 문제 때문에 클릭 기반으로 전환했다.
//   드래그를 남겨 두되 화면 가장자리에서 자동 스크롤을 붙였다.
import { el, num, clamp, scaleStats } from '../core/util.js';
import { go, refresh, toast, modal } from './app.js';
import { state, addLog, addGold, save } from '../game/state.js';
import { getClass, classChain } from '../data/classes.js';
import { getSkill } from '../data/skills.js';
import { FORMATION_LIST, getFormation, formationMods, formationSummary, slotZoneOf } from '../data/formations.js';
import { GRADE_COLOR, RARITY_COLOR, RARITY_NAME } from '../art/palette.js';
/* ★ 단원 탭은 «세워 놓고 보는» 화면이라 **정면**이다 (전투만 옆모습). */
import { getShowcase, drawShowcase } from '../art/showcase.js';
import {
  GRADES, mercStats, mercRecipe, mercPower, baseStatsOf, expProgress,
  canPromote, promoteOptionsFor, promote, nextPromoteLevel, isWounded,
  TIER_MULT, expTotalTo, MAX_LEVEL,
} from '../game/merc.js';
import {
  SQUAD_SIZE, createSquad, disbandSquad, addToSquad, removeFromSquad, swapSlots,
  setFormation, squadSlots, squadMembers, squadPower, squadUpkeep,
} from '../game/squad.js';
import {
  SLOTS, SLOT_NAME, inventory, equippedItems, equipItem, unequipSlot,
  canEquip, equipIssue, itemStats, itemPower, weaponTypeName, josa,
} from '../game/gear.js';
// 부대 구매·정원 확장 API, 10슬롯 규칙, 세트(설계 B) API는 네임스페이스로 받는다.
// 명명 import 로 받으면 상대 모듈에 아직 그 export 가 없을 때 **모듈 링크 자체가 실패**해
// 화면이 통째로 안 뜬다. 네임스페이스로 받아 `typeof` 로 확인하고 쓰면 최악의 경우에도 폴백이 돈다.
import * as SquadAPI from '../game/squad.js';
import * as StateAPI from '../game/state.js';
import * as GearAPI from '../game/gear.js';
import * as ItemsAPI from '../data/items.js';
import * as SetsAPI from '../data/sets.js';
// 임금은 대기 인원 할인이 걸리므로 state.js 의 dailyUpkeep/upkeepOfMerc 를 쓴다 (유일한 출처)
import * as GameState from '../game/state.js';
import * as Pet from '../game/pet.js';

export const meta = { id: 'company', title: '용병단' };

/* ─────────────────────────── 상수 ─────────────────────────── */

const STAT_KEYS = ['hp', 'atk', 'def', 'res', 'spd', 'crit', 'critDmg', 'eva'];
/** 부대 합계에서 "평균"으로 보여줄 스탯 (나머지는 단순 합) */
const AVG_KEYS = ['spd', 'crit', 'critDmg', 'eva'];
const PCT_KEYS = new Set(['crit', 'critDmg', 'eva']);
const STAT_LABEL = {
  hp: '체력', atk: '공격', def: '방어', res: '저항',
  spd: '속도', crit: '치명', critDmg: '치명피해', eva: '회피',
};
const ZONE_LABEL = { front: '전열', mid: '중열', back: '후열' };
const ZONE_SHORT = { front: '전', mid: '중', back: '후' };
const ZONE_COLOR = { front: '#c9636f', mid: 'var(--gold)', back: 'var(--steel)' };
/** 전직 차수 표기·색 (1~4차). 4차는 각성 급이라 금색으로 못 박는다. */
const TIER_NAME = { 1: '1차', 2: '2차', 3: '3차', 4: '4차' };
const TIER_COLOR = { 1: 'var(--ink-faint)', 2: 'var(--steel)', 3: 'var(--leaf)', 4: 'var(--gold)' };

/** 아키타입 한국어 (세트 착용 제한 표기용) */
const ARCH_NAME = {
  tank: '방패', fighter: '전사', lancer: '창병', archer: '궁수',
  rogue: '도적', mage: '마법사', healer: '치유사',
};

/* ── 희귀도 0~5 (5 = 신화/세트) ──────────────────────────────────────────
 * `art/palette.js` 가 아직 5단계(0~4)일 수 있어 부족한 칸을 여기서 채운다.
 * data/items.js 가 6단계 표를 주면 언제나 그쪽이 이긴다. */
const MYTHIC = 5;
const MYTHIC_COLOR = SetsAPI.MYTHIC_COLOR || '#ff5f3a';
const MYTHIC_GLOW = SetsAPI.MYTHIC_GLOW || '#ffd27a';
const R_NAMES = rarityTable(ItemsAPI.RARITY_NAME, RARITY_NAME, SetsAPI.MYTHIC_NAME || '신화');
const R_COLORS = rarityTable(ItemsAPI.RARITY_COLOR, RARITY_COLOR, MYTHIC_COLOR);

function rarityTable(a, b, tail) {
  const src = (Array.isArray(a) && a.length > MYTHIC) ? a : (Array.isArray(b) ? b : []);
  const out = src.slice();
  while (out.length <= MYTHIC) out.push(tail);
  return out;
}

const rColor = (it) => (isMythic(it) ? MYTHIC_COLOR : R_COLORS[clamp(it?.rarity || 0, 0, MYTHIC)]);
const rName = (it) => R_NAMES[clamp(it?.rarity || 0, 0, MYTHIC)] || '일반';

/* ── 소속 부대 표시 ──
 * 부대가 5개 · 단원이 40명까지 늘어나면 "이 사람이 어느 부대였더라"를 매번 헷갈린다.
 * 부대마다 고정 색을 주고 카드 맨 위(이름 옆)에 배지로 박아 스캔이 되게 한다. */
const SQUAD_COLORS = ['#5b95d6', '#6fae7a', '#d18a4a', '#a86fd6', '#d16a8a'];
/** 부대 순서 기준 고정 색 (부대를 지워도 남은 부대 색이 흔들리지 않게 id 기준으로 잡는다) */
function squadColor(squadId) {
  const i = state.squads.findIndex((s) => s.id === squadId);
  return i < 0 ? 'var(--ink-faint)' : SQUAD_COLORS[i % SQUAD_COLORS.length];
}
/** 소속 배지 — 배치됐으면 `제1부대 3번`, 아니면 `미배치` */
function squadBadge(m, { compact = false } = {}) {
  const sq = m.squadId ? state.squads.find((s) => s.id === m.squadId) : null;
  if (!sq) {
    return el('span', { class: 'co-sqb none', text: '미배치' });
  }
  const away = typeof SquadAPI.isSquadAway === 'function' && SquadAPI.isSquadAway(sq, state.day);
  const col = squadColor(sq.id);
  return el('span', {
    class: `co-sqb${away ? ' away' : ''}`,
    style: { color: col, borderColor: col },
    title: away ? `${sq.name} — 원정 중` : sq.name,
  }, compact ? sq.name : `${sq.name} ${(m.slotIndex ?? 0) + 1}번`, away ? el('i', { text: '원정' }) : null);
}

/** 편성판 크기 (진형 슬롯이 서로 겹치지 않는 최소 여유로 맞춰 둔 값) */
const BOARD_H = 460;
const CELL_W = 76;
const CELL_H = 58;

/** 드래그 자동 스크롤 — 화면 가장자리 감지 폭(px)과 최대 속도(px/프레임) */
const EDGE_PX = 100;
const EDGE_SPEED = 18;

/* ── 모바일 판정 ────────────────────────────────────────────────
 * 레이아웃(1단 접기·축소)은 **폭**으로만 가른다 — 터치 되는 1280px 노트북에서
 * PC 레이아웃이 무너지면 안 되기 때문이다(모바일 대응 규칙 5).
 * 드래그 배치만은 **폭 또는 터치 입력**으로 끈다. 터치에서는 HTML5 드래그가
 * 애초에 시작되지 않고, 드래그 중에는 화면 스크롤이 막혀 폰에서 더 나쁘다. */
const NARROW_MQ = '(max-width: 767px)';
const TOUCH_MQ = '(hover: none) and (pointer: coarse)';
function mql(q) { try { return window.matchMedia(q); } catch { return null; } }
/** 좁은 화면(1단 레이아웃)인가 */
function isNarrow() { const m = mql(NARROW_MQ); return !!(m && m.matches); }
/** 터치 전용 기기인가 */
function isTouchOnly() { const m = mql(TOUCH_MQ); return !!(m && m.matches); }
/** 드래그 배치를 쓸 수 있는가 (모바일에서는 클릭 배치만 남긴다) */
const dragEnabled = () => !(isNarrow() || isTouchOnly());
/** 좁은 화면에서는 짧은 문구를 쓴다 */
const short = (narrowText, wideText) => (isNarrow() ? narrowText : wideText);

/** 넓은 표는 페이지가 아니라 자기 상자 안에서 가로 스크롤시킨다 (가로 스크롤 금지 규칙) */
const xs = (node) => el('div', { class: 'co-xs' }, node);

/**
 * 화면 **위쪽**에 붙어 있는 막대(HUD·내비)의 아래끝 — 스크롤 목표가 그 밑에 가려지지 않게.
 * 아래쪽에 고정된 막대(모바일 탭바)는 위 여백과 상관없으므로 세지 않는다.
 */
function topInset() {
  let h = 0;
  for (const id of ['hud', 'nav']) {
    const n = document.getElementById(id);
    if (!n) continue;
    const pos = getComputedStyle(n).position;
    if (pos !== 'sticky' && pos !== 'fixed') continue;
    const r = n.getBoundingClientRect();
    if (r.top <= 4 && r.bottom > 0) h = Math.max(h, Math.round(r.bottom));
  }
  return h;
}

/**
 * 좁은 화면에서 편성판/명부로 시선을 옮겨 준다.
 * 폰에서는 편성판 sticky 를 뺐기 때문에(화면을 절반이나 먹는다) 이게 그 대체 수단이다.
 * `behavior:'smooth'` 는 rAF 로 돌아가서 탭이 안 그려지는 상황에서 멈춰 버린다 — 즉시 이동한다.
 */
function scrollTo(selector) {
  if (!isNarrow()) return;
  const id = setTimeout(() => {
    timers.delete(id);
    const n = document.querySelector(selector);
    if (!n) return;
    const y = window.scrollY + n.getBoundingClientRect().top - topInset() - 6;
    window.scrollTo(0, Math.max(0, Math.round(y)));
  }, 0);
  timers.add(id);
}
const scrollToBoard = () => scrollTo('.co-boardpanel');
const scrollToRoster = () => scrollTo('.co-roster');

/* ── 확장 API 어댑터 ────────────────────────────────────────────
 * squad.js / state.js 가 아직 옛 버전이어도 이 화면이 죽지 않도록,
 * 값은 기본값으로 대체하고 함수는 있을 때만 부른다. */
const fnOf = (ns, name) => (ns && typeof ns[name] === 'function' ? ns[name] : null);
const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const MAX_SQUADS = numOr(SquadAPI.MAX_SQUADS, 5);
const SQUAD_COST_FALLBACK = [0, 0, 1500, 4000, 9000, 18000];
const ROSTER_CAP_START = numOr(StateAPI.ROSTER_CAP_START, 20);
const ROSTER_CAP_MAX = numOr(StateAPI.ROSTER_CAP_MAX, 40);
const ROSTER_CAP_STEP = numOr(StateAPI.ROSTER_CAP_STEP, 5);
const ROSTER_CAP_COST_FALLBACK = { 25: 1200, 30: 3000, 35: 6500, 40: 12000 };

/** 현재 단원 정원 (옛 세이브면 시작값으로 본다) */
function rosterCapOf() {
  const v = Math.round(Number(state.rosterCap));
  return Number.isFinite(v) && v > 0 ? clamp(v, ROSTER_CAP_START, ROSTER_CAP_MAX) : ROSTER_CAP_START;
}

/** n번째 부대를 만드는 데 드는 골드 */
function squadCostOf(nextCount) {
  const f = fnOf(SquadAPI, 'squadCost');
  if (f) return numOr(f(nextCount), 0);
  const i = clamp(Math.round(nextCount || 1), 0, SQUAD_COST_FALLBACK.length - 1);
  return SQUAD_COST_FALLBACK[i] || 0;
}

/** 부대를 하나 더 만들 수 있는가 → {ok, reason, cost, count, max} */
function addSquadCheck() {
  const count = Array.isArray(state.squads) ? state.squads.length : 0;
  const cost = squadCostOf(count + 1);
  const f = fnOf(SquadAPI, 'canAddSquad');
  if (f) {
    const r = f(state) || {};
    return {
      ok: !!r.ok,
      reason: r.reason || '',
      cost: numOr(r.cost, cost),
      count: numOr(r.count, count),
      max: numOr(r.max, MAX_SQUADS),
    };
  }
  if (count >= MAX_SQUADS) return { ok: false, reason: `부대는 최대 ${MAX_SQUADS}개까지 만들 수 있습니다.`, cost, count, max: MAX_SQUADS };
  if ((state.gold || 0) < cost) return { ok: false, reason: `골드가 부족합니다. (${num(cost)}G 필요)`, cost, count, max: MAX_SQUADS };
  return { ok: true, reason: '', cost, count, max: MAX_SQUADS };
}

/** 정원을 한 단계 늘릴 수 있는가 → {ok, reason, cost, nextCap} */
function expandRosterCheck() {
  const cap = rosterCapOf();
  const f = fnOf(StateAPI, 'canExpandRoster');
  if (f) {
    const r = f(state) || {};
    return { ok: !!r.ok, reason: r.reason || '', cost: numOr(r.cost, 0), nextCap: numOr(r.nextCap, cap) };
  }
  const nextCap = cap + ROSTER_CAP_STEP;
  if (cap >= ROSTER_CAP_MAX) return { ok: false, reason: `이미 최대 정원(${ROSTER_CAP_MAX}명)입니다.`, cost: 0, nextCap: cap };
  const costFn = fnOf(StateAPI, 'rosterCapCost');
  const cost = costFn ? numOr(costFn(nextCap), Infinity) : numOr(ROSTER_CAP_COST_FALLBACK[nextCap], Infinity);
  if (!Number.isFinite(cost)) return { ok: false, reason: '더 이상 정원을 늘릴 수 없습니다.', cost: 0, nextCap: cap };
  if ((state.gold || 0) < cost) return { ok: false, reason: `골드가 부족합니다. (${num(cost)}G 필요)`, cost, nextCap };
  return { ok: true, reason: '', cost, nextCap };
}

/** 부대의 원정 상태 → {away, days, returnDay, label, color} */
function squadStatus(sq) {
  const day = state.day || 1;
  const awayFn = fnOf(SquadAPI, 'isSquadAway');
  const inFn = fnOf(SquadAPI, 'squadReturnIn');
  const away = awayFn ? !!awayFn(sq, day) : !!(sq && sq.status === 'away' && (sq.returnDay || 0) > day);
  if (!away) return { away: false, days: 0, returnDay: 0, label: '대기', color: 'var(--leaf)' };
  const rd = Math.round(Number(sq && sq.returnDay) || 0) || day;
  const days = inFn ? Math.max(0, Math.round(numOr(inFn(sq, day), rd - day))) : Math.max(0, rd - day);
  return { away: true, days, returnDay: rd, label: `원정 중 · ${num(rd)}일차 복귀`, color: 'var(--gold)' };
}

/* ── 10슬롯 / 세트 어댑터 (설계 A·B) ───────────────────────────────────
 * gear.js / data/sets.js 의 새 API가 없어도 화면이 죽지 않게 전부 방어적으로 부른다. */

/** equipment 객체가 실제로 쓰는 키들 (옛 세이브 키가 남아 있어도 훑는다) */
function slotKeysOf(eq) {
  const keys = SLOTS.slice();
  if (eq && typeof eq === 'object') for (const k of Object.keys(eq)) if (!keys.includes(k)) keys.push(k);
  return keys;
}

/** 이 용병이 지금 왼손을 쓸 수 없는가 (= 양손 무기 착용 중) */
function offhandLockedOf(m) {
  const f = fnOf(GearAPI, 'offhandLocked');
  if (f) { try { return !!f(m, state); } catch { /* noop */ } }
  const w = itemByUid(m && m.equipment && m.equipment.weapon);
  const two = fnOf(GearAPI, 'isTwoHandedItem');
  return !!(w && two && two(w));
}

/** 이 용병이 낄 수 있는 칸 수 (양손무기면 9). 세트 "풀세트" 기준값이다 */
function equippableSlotCountOf(m) {
  const f = fnOf(GearAPI, 'equippableSlotCount');
  if (f) { try { return Math.max(1, Math.round(f(m, state))); } catch { /* noop */ } }
  return Math.max(1, SLOTS.length - (offhandLockedOf(m) ? 1 : 0));
}

/** 이 아이템이 들어갈 수 있는 대표 슬롯 (반지는 ring1) */
function slotOf(item) {
  const f = fnOf(GearAPI, 'primarySlot');
  if (f) { try { return f(item) || item?.slot || null; } catch { /* noop */ } }
  return item?.slot || null;
}

/** 그 슬롯이 이 아이템을 받는가 (반지 2칸·옛 슬롯까지 감안) */
function slotTakes(slot, item) {
  const f = fnOf(GearAPI, 'slotAccepts');
  if (f) { try { return !!f(slot, item); } catch { /* noop */ } }
  return !!(item && item.slot === slot);
}

/** 양손 무기인가 */
function isTwoHanded(item) {
  const f = fnOf(GearAPI, 'isTwoHandedItem');
  if (f) { try { return !!f(item); } catch { /* noop */ } }
  return false;
}

/** 아이템의 세트 id */
function setIdOfItem(item) {
  if (!item) return null;
  if (item.setId) return item.setId;
  const f = fnOf(GearAPI, 'setIdOf');
  if (f) { try { return f(item) || null; } catch { /* noop */ } }
  return null;
}

/** 신화(세트) 아이템인가 */
const isMythic = (it) => !!(it && ((it.rarity || 0) >= MYTHIC || it.mythic || setIdOfItem(it)));

/** 세트 정의 목록 (data/sets.js 우선) */
function setDefList() {
  if (Array.isArray(SetsAPI.SET_LIST) && SetsAPI.SET_LIST.length) return SetsAPI.SET_LIST.slice();
  if (SetsAPI.SETS && typeof SetsAPI.SETS === 'object') return Object.values(SetsAPI.SETS);
  return [];
}

/**
 * 세트 정의를 찾는다.
 * ⚠ `data/dungeons.js` 의 setId 와 `data/sets.js` 의 id 가 어긋난 세트가 있어 **이름으로도** 찾는다.
 */
function setDefFor(setId, setName = '') {
  const list = setDefList();
  const get = fnOf(SetsAPI, 'getSet');
  if (setId && get) { try { const d = get(setId); if (d) return d; } catch { /* noop */ } }
  if (setId) { const d = list.find((s) => s && s.id === setId); if (d) return d; }
  if (setName) { const d = list.find((s) => s && s.name === setName); if (d) return d; }
  const g = fnOf(GearAPI, 'setDefOf');
  if (setId && g) { try { const d = g(setId); if (d) return d; } catch { /* noop */ } }
  return null;
}

const setDefOfItem = (it) => (it ? setDefFor(setIdOfItem(it), it.setName || '') : null);

/**
 * 세트 정의를 UI 공용 형태로 정규화한다.
 * data/sets.js: `bonuses:{3,5,7,full}` = {stats,mods,special,specialLabel,desc}
 * gear.js     : `bonus:{...}`         = {stats,mods,specials:[]}
 */
function normSetDef(d) {
  if (!d) return null;
  const raw = d.bonuses || d.bonus || {};
  const keyNum = (k) => (k === 'full' || k === 'max' ? 999 : Number(k));
  const steps = Object.keys(raw)
    .filter((k) => k === 'full' || k === 'max' || Number.isFinite(Number(k)))
    .sort((a, b) => keyNum(a) - keyNum(b))
    .map((k) => {
      const b = raw[k] || {};
      const sp = Array.isArray(b.specials) ? b.specials : (b.special ? [b.special] : []);
      const first = sp[0];
      const spName = b.specialLabel
        || (first && typeof first === 'object' ? (first.label || first.name) : null)
        || null;
      const spDesc = (first && typeof first === 'object' ? first.desc : '') || '';
      return {
        key: (k === 'full' || k === 'max') ? 'full' : Number(k),
        stats: b.stats || {},
        mods: b.mods || {},
        specialName: spName,
        desc: b.desc || spDesc || '',
      };
    });
  return {
    id: d.id || '',
    name: d.name || d.id || '세트',
    desc: d.desc || '',
    archs: Array.isArray(d.archs) ? d.archs.slice() : null,
    color: d.color || MYTHIC_COLOR,
    steps,
  };
}

/** 단계 하나에 필요한 착용 개수 (`full` 은 그 용병의 최대 칸 수) */
const stepNeed = (key, full) => (key === 'full' ? full : Number(key) || 0);
const stepLabel = (key, full) => (key === 'full' ? `풀세트(${full})` : `${key}세트`);

/** 착용 중인 장비의 세트별 개수 */
function setCountsOf(equipment) {
  const m = new Map();
  const seen = new Set();
  for (const s of slotKeysOf(equipment)) {
    const u = equipment && equipment[s];
    if (!u || seen.has(u)) continue;
    seen.add(u);
    const it = itemByUid(u);
    const sid = it && setIdOfItem(it);
    if (sid) m.set(sid, (m.get(sid) || 0) + 1);
  }
  return m;
}

/**
 * 그 용병의 세트 진행도.
 * @returns {{max:number, sets:Array<{def:object, count:number, slots:string[]}>}}
 */
function setProgressOf(m) {
  const max = equippableSlotCountOf(m);
  const map = new Map();
  for (const s of SLOTS) {
    const it = itemByUid(m && m.equipment && m.equipment[s]);
    if (!it) continue;
    const sid = setIdOfItem(it);
    if (!sid) continue;
    const def = normSetDef(setDefOfItem(it))
      || { id: sid, name: it.setName || sid, desc: '', archs: null, color: MYTHIC_COLOR, steps: [] };
    if (!map.has(def.id)) map.set(def.id, { def, count: 0, slots: [] });
    const e = map.get(def.id);
    e.count++;
    e.slots.push(s);
  }
  return { max, sets: [...map.values()].sort((a, b) => b.count - a.count) };
}

/**
 * 이 세트가 그 용병의 아키타입을 위한 것인가 (설계 B의 아키타입 제한).
 * 판정 기준은 `data/sets.js` 다. **끼우는 것을 막지는 않는다** — 착용 가부는 gear.js 의 몫이라
 * 여기서는 "의도된 대상이 아니다"만 알려 준다.
 * @returns {string|null} 어긋날 때만 안내 문구
 */
function setArchWarn(m, item) {
  const sid = setIdOfItem(item);
  if (!sid) return null;
  const arch = (getClass(m && m.classId) || {}).arch;
  if (!arch) return null;
  const can = fnOf(SetsAPI, 'canWearSet');
  const d = normSetDef(setDefFor(sid, item.setName || ''));
  let ok = true;
  if (can) { try { ok = !!can(sid, arch); } catch { ok = true; } }
  else if (d && Array.isArray(d.archs) && d.archs.length) ok = d.archs.includes(arch);
  if (ok) return null;
  const names = d && d.archs && d.archs.length ? d.archs.map((a) => ARCH_NAME[a] || a).join('·') : '다른';
  return `${names} 계열 전용 세트 — 이 용병은 대상이 아니다`;
}

/* ─────────────────────────── 화면 상태 ─────────────────────────── */

let selectedSquadId = null;
let previewFormationId = null;
let drag = null;                       // { kind:'slot'|'roster', uid, index }
/**
 * 클릭 배치 선택 상태.
 *   { type:'merc', uid, from:'roster'|'slot', index }  — 배치할 용병을 고른 상태
 *   { type:'slot', index }                             — 채울 빈 자리를 고른 상태
 */
let picked = null;
let keepPick = false;                  // redraw() 중에는 선택을 유지한다
let leftScroll = 0;                    // 편성 열의 내부 스크롤 위치
const timers = new Set();
const rosterFilter = { classId: '', grade: '', tier: '', squadId: '', hideWounded: false, onlyFree: false, onlyPromotable: false, sort: 'power' };
/** 좁은 화면에서 필터·정렬 줄을 접어 둔다 (PC 에서는 항상 펼쳐진 상태로 보인다) */
let filtersOpen = false;

/** 기본값에서 벗어난 필터 개수 — 접혀 있어도 "지금 뭔가 걸려 있다"를 알 수 있게 */
function activeFilterCount() {
  let n = 0;
  for (const k of ['classId', 'grade', 'tier', 'squadId']) if (rosterFilter[k]) n++;
  for (const k of ['hideWounded', 'onlyFree', 'onlyPromotable']) if (rosterFilter[k]) n++;
  if (rosterFilter.sort !== 'power') n++;
  return n;
}

/** 전직 가능한가 (예외가 나도 목록이 죽지 않게 감싼다) */
function promotable(m) {
  try { return !!canPromote(m); } catch { return false; }
}

/** 일괄 해고용 다중 선택 (용병 uid) */
const marked = new Set();
/**
 * 부대에 배치된 용병까지 선택 대상에 넣을지.
 * 기본은 false — 실수로 주력을 잘라내는 사고를 막는다. 켜야만 체크박스가 열린다.
 */
let includeDeployed = false;

export function dispose() {
  for (const t of timers) clearInterval(t);
  timers.clear();
  drag = null;
  stopDragScroll();
  unbindGlobal();
  if (!keepPick) {
    picked = null;
    marked.clear();
    includeDeployed = false;
  }
  keepPick = false;
}

/** 선택 상태를 유지한 채 화면을 다시 그린다 (창 스크롤 위치도 되돌린다) */
function redraw() {
  keepPick = true;
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  refresh();
  window.scrollTo(0, y);
}

/* ─────────────────────────── 공용 소도구 ─────────────────────────── */

const gradeColor = (g) => GRADE_COLOR[g] || GRADE_COLOR.F;

/**
 * 확인 모달. `app.js confirmDlg` 와 동작은 같지만 본문에 `co-mbody` 를 달아
 * 이 화면 전용 모바일 규칙(전체화면화)이 걸리게 한다.
 */
function confirmBox(title, message, onYes, yesLabel = '확인') {
  modal({
    title,
    body: el('div', { class: 'col co-mbody' }, el('div', { text: message })),
    actions: [
      { label: '취소', kind: 'ghost' },
      { label: yesLabel, kind: 'primary', act: () => { onYes(); } },
    ],
  });
}

/** 모달 레이어를 즉시 비운다 (다른 화면으로 넘어갈 때) */
function closeModalLayer() {
  const layer = document.getElementById('modal-layer');
  if (layer) { layer.innerHTML = ''; layer.onclick = null; }
}
const fmtStat = (k, v) => (PCT_KEYS.has(k) ? `${Math.round(v * 10) / 10}%` : num(v));
const mercOf = (uid) => state.roster.find((m) => m.uid === uid) || null;

/** 스프라이트 한 프레임을 그린 캔버스 */
function spriteCanvas(recipe, scale = 1, frame = 'idle0') {
  const c = el('canvas', { width: 32 * scale, height: 40 * scale });
  try {
    const sp = getShowcase(recipe);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawShowcase(ctx, sp, frame, 16 * scale, 38 * scale, { scale });
  } catch (e) { console.warn('[company] 스프라이트 생성 실패', e); }
  return c;
}

/** idle 애니메이션이 도는 큰 스프라이트 */
function animatedSprite(recipe, scale = 3) {
  const c = el('canvas', { width: 32 * scale, height: 40 * scale });
  let sp = null;
  try { sp = getShowcase(recipe); } catch (e) { console.warn('[company] 스프라이트 생성 실패', e); }
  const ctx = c.getContext('2d');
  const seq = ['idle0', 'idle1', 'idle2', 'idle3'];
  let i = 0;
  const tick = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    if (sp) {
      ctx.imageSmoothingEnabled = false;
      drawShowcase(ctx, sp, seq[i % seq.length], 16 * scale, 38 * scale, { scale });
    }
    i++;
  };
  tick();
  const id = setInterval(tick, 200);
  timers.add(id);
  return { canvas: c, stop: () => { clearInterval(id); timers.delete(id); } };
}

/** 작은 스프라이트 액자 */
function miniPortrait(merc, scale = 1) {
  return el('div', { class: 'co-mini' }, spriteCanvas(mercRecipe(merc, state), scale));
}

function statDelta(k, d) {
  const v = PCT_KEYS.has(k) ? Math.round(d * 10) / 10 : Math.round(d);
  if (!v) return el('span', { class: 'faint', text: '—' });
  return el('span', {
    class: 'num',
    style: { color: v > 0 ? 'var(--ok)' : 'var(--bad)' },
    text: `${v > 0 ? '+' : ''}${PCT_KEYS.has(k) ? v : num(v)}${PCT_KEYS.has(k) ? '%' : ''}`,
  });
}

/** 진형 보정을 적용한 스탯 (표기용 반올림) */
function withMods(stats, mods) {
  const out = scaleStats(stats, mods || {});
  const r = {};
  for (const k of STAT_KEYS) r[k] = PCT_KEYS.has(k) ? Math.round((out[k] || 0) * 10) / 10 : Math.round(out[k] || 0);
  return r;
}

/** 용병이 지금 받고 있는 진형 보정 */
function formationModsOf(merc) {
  if (!merc || !merc.squadId || merc.slotIndex < 0) return {};
  const sq = state.squads.find((s) => s.id === merc.squadId);
  if (!sq) return {};
  const f = getFormation(sq.formationId);
  if (!f) return {};
  const c = getClass(merc.classId) || {};
  return formationMods(f, merc.slotIndex, { arch: c.arch, classId: merc.classId }) || {};
}

/* ─────────────────────────── 스타일 (이 화면 전용) ─────────────────────────── */

const STYLE_ID = 'company-style';
const CSS = `
/* 용병 상세 머리말의 이름 변경 아이콘 */
.co-rename { flex:0 0 auto; padding:2px 9px; font-size:14px; line-height:1.3; opacity:.8; }
.co-rename:hover { opacity:1; }
@media (max-width: 767px) { .co-rename { font-size:16px; padding:4px 11px; } }

/* 2단 레이아웃 — 왼쪽 편성판(고정), 오른쪽 명부(스크롤)
   좁은 화면에서는 co-left/co-right 를 display:contents 로 "녹여" 한 줄 그리드로 만든다.
   그래야 편성판의 sticky 기준 블록이 명부까지 포함하는 co-wrap 이 되어 끝까지 따라붙는다. */
.co-wrap{display:grid;gap:12px;align-items:start;grid-template-columns:minmax(0,1fr);}
.co-left,.co-right{display:contents;}
.co-boardpanel{order:1;position:sticky;top:var(--co-top,62px);z-index:6;
  max-height:58vh;overflow:auto;overscroll-behavior:contain;box-shadow:0 8px 18px rgba(0,0,0,.45);}
.co-roster{order:2;min-width:0;}
.co-totals{order:3;min-width:0;}
@media (min-width:1000px){
  .co-wrap{grid-template-columns:minmax(540px,1.12fr) minmax(300px,1fr);}
  .co-left,.co-right{display:flex;flex-direction:column;gap:12px;min-width:0;}
  .co-left{position:sticky;top:var(--co-top,62px);align-self:start;
    max-height:calc(100vh - var(--co-top,62px) - 10px);overflow:auto;overscroll-behavior:contain;padding-right:2px;}
  .co-boardpanel{position:static;max-height:none;overflow:visible;box-shadow:none;}
}

/* 부대 선택 바 */
.co-squads{display:flex;gap:8px;overflow-x:auto;padding-bottom:3px;flex:1 1 260px;min-width:0;}
.co-sq{flex:0 0 auto;min-width:130px;padding:6px 9px;border:1px solid var(--line);border-radius:6px;
  background:linear-gradient(180deg,var(--bg-2),var(--bg-1));cursor:pointer;transition:border-color .12s;}
.co-sq:hover{border-color:#5a4c72;}
.co-sq.on{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold-dim) inset;}

/* 편성판
   슬롯 카드 크기(--co-cw/--co-ch)는 좌표 계산식(bx/by)이 쓰는 값과 **같은 변수**다.
   그래서 미디어 쿼리에서 변수 하나만 줄이면 칸도 좌표도 같은 비율로 함께 작아진다. */
.co-board{--co-cw:${CELL_W}px;--co-ch:${CELL_H}px;
  position:relative;height:clamp(190px,30vh,${BOARD_H}px);border:1px solid var(--line-soft);border-radius:6px;overflow:hidden;
  background:linear-gradient(90deg,rgba(168,58,74,.13),rgba(0,0,0,0) 45%,rgba(63,111,181,.13));}
@media (min-width:1000px){ .co-board{height:clamp(340px,46vh,${BOARD_H}px);} }
.co-div{position:absolute;top:0;bottom:0;width:0;border-left:1px dashed var(--line-soft);}
.co-zlab{position:absolute;top:6px;transform:translateX(-50%);font-size:10px;letter-spacing:.14em;color:var(--ink-faint);}
.co-slot{position:absolute;transform:translate(-50%,-50%);width:var(--co-cw);height:var(--co-ch);
  display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
  border:1px solid var(--line);border-radius:5px;background:linear-gradient(180deg,var(--bg-2),var(--bg-1));
  cursor:pointer;user-select:none;transition:border-color .12s,transform .08s,background .12s;}
.co-slot:hover{border-color:#5a4c72;}
.co-slot.empty{border-style:dashed;justify-content:center;color:var(--ink-faint);background:rgba(255,255,255,.02);}
.co-slot.over{border-color:var(--gold);box-shadow:0 0 0 2px var(--gold-dim) inset;}
.co-slot[data-zone="front"]{border-top:2px solid rgba(201,99,111,.9);}
.co-slot[data-zone="mid"]{border-top:2px solid rgba(224,180,74,.75);}
.co-slot[data-zone="back"]{border-top:2px solid rgba(127,151,184,.9);}
.co-slot canvas{display:block;}
.co-slot .nm{font-size:10px;line-height:14px;max-width:calc(var(--co-cw) - 6px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;}
.co-slot .lv{position:absolute;top:2px;right:4px;font-size:9px;color:var(--ink-faint);}
.co-slot .ix{position:absolute;top:2px;left:4px;font-size:9px;color:var(--ink-faint);}
.co-slot .zn{position:absolute;top:2px;left:15px;font-size:9px;font-weight:700;letter-spacing:0;}
.co-slot .wd{position:absolute;bottom:16px;right:3px;font-size:9px;color:var(--bad);}
/* 상세 보기 버튼 — 더블클릭 대신 확실한 경로 */
.co-slot .co-info{position:absolute;bottom:2px;right:2px;width:17px;height:17px;padding:0;line-height:15px;
  font-size:11px;border-radius:50%;border:1px solid var(--line);background:var(--bg-3);color:var(--ink-dim);
  cursor:pointer;opacity:.72;transition:opacity .12s,color .12s,border-color .12s;}
.co-slot .co-info:hover{opacity:1;color:var(--gold);border-color:var(--gold-dim);}
/* 배치 대상 강조 */
.co-slot.can{border-style:solid;border-color:var(--gold);background:rgba(224,180,74,.14);animation:coPulse 1.15s ease-in-out infinite;}
.co-slot.swap{border-color:var(--steel);box-shadow:0 0 0 2px rgba(127,151,184,.4) inset;}
.co-slot.sel{border-color:var(--gold);box-shadow:0 0 0 2px var(--gold) inset;background:rgba(224,180,74,.14);}
@keyframes coPulse{0%,100%{box-shadow:0 0 0 0 rgba(224,180,74,0);}50%{box-shadow:0 0 0 3px rgba(224,180,74,.3);}}

/* 선택 안내 띠 */
/* min-height 는 초상화가 들어간 상태(44px + 패딩)에 맞춘 고정값이다.
   이게 없으면 용병을 고르는 순간 띠가 커지면서 편성판이 아래로 밀려,
   방금 누른 칸이 발밑에서 움직여 다음 클릭을 조준할 수 없다. */
.co-pickbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:7px 9px;border-radius:6px;
  min-height:72px;box-sizing:border-box;
  border:1px solid var(--gold-dim);background:rgba(224,180,74,.09);}

.co-mini{display:flex;align-items:flex-end;justify-content:center;width:40px;height:44px;flex:0 0 auto;
  background:radial-gradient(circle at 50% 85%,#221c2e,#100d17);border-radius:4px;overflow:hidden;}
.co-drop{outline:2px dashed var(--gold-dim);outline-offset:-5px;}
.co-in{background:var(--bg-1);border:1px solid var(--line);border-radius:5px;padding:5px 8px;color:var(--ink);}
.co-in:focus{outline:none;border-color:var(--gold-dim);}
.co-eq{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--line-soft);border-radius:5px;background:var(--bg-1);}
.co-pick{display:flex;align-items:center;gap:10px;padding:7px 9px;border:1px solid var(--line-soft);border-radius:5px;
  background:var(--bg-1);cursor:pointer;}
.co-pick:hover{border-color:var(--gold-dim);background:var(--bg-2);}
.co-promo{border:1px solid var(--line);border-radius:6px;padding:12px;background:linear-gradient(180deg,var(--bg-2),var(--bg-1));cursor:pointer;}
.co-promo.sel{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold-dim) inset;}
/* ★ 진형 효과는 **다 펼친다.** 예전에는 46px 로 잘라 스크롤을 달았는데,
   두 줄이 넘으면 나머지가 있는지조차 모른다 — 스크롤바가 얇아 눈에 안 띈다.
   효과 개수는 진형이 정하고 많아야 예닐곱 줄이라, 펼쳐도 판을 안 밀어낸다. */
.co-fx{display:flex;flex-wrap:wrap;gap:6px;}
.co-petrow{border-top:1px solid var(--line-soft);padding-top:7px;margin-top:2px;}
.co-pet{font-size:11px;}
@media (max-width: 767px){.co-pet{font-size:12px;}}
/* 소속 부대 배지 — 카드 맨 위 이름 옆. 부대별 고정 색이라 명부를 눈으로 훑어도 묶여 보인다 */
.co-sqb{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;
  border:1px solid currentColor;font-size:10px;font-weight:700;line-height:1.6;white-space:nowrap;}
.co-sqb.none{color:var(--ink-faint);border-style:dashed;}
.co-sqb i{font-style:normal;font-size:9px;opacity:.85;border-left:1px solid currentColor;padding-left:4px;}
.co-rcard{position:relative;}
.co-rcard.dragging{opacity:.45;}
.co-rcard.picked{border-color:var(--gold);box-shadow:0 0 0 2px var(--gold-dim) inset;}
.co-rcard.can{border-color:var(--gold-dim);animation:coPulse 1.25s ease-in-out infinite;}
/* 해고 대상으로 찍힌 카드 — 배치 선택(금색)과 확실히 구분되게 붉은 테두리 */
.co-rcard.marked{border-color:var(--bad);box-shadow:0 0 0 2px rgba(168,58,74,.38) inset;}

/* 정원 표시 / 일괄 선택 툴바 */
.co-strip{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:6px 9px;
  border:1px solid var(--line-soft);border-radius:6px;background:var(--bg-1);}
.co-cap{position:relative;flex:1 1 130px;min-width:110px;height:7px;border-radius:4px;
  background:rgba(0,0,0,.42);border:1px solid var(--line-soft);overflow:hidden;}
.co-cap>i{display:block;height:100%;background:linear-gradient(90deg,var(--leaf),var(--gold));}
.co-cap.full>i{background:linear-gradient(90deg,#a83a4a,var(--bad));}
.co-cb{width:15px;height:15px;flex:0 0 auto;accent-color:var(--gold);cursor:pointer;margin:0;}
.co-cb:disabled{cursor:not-allowed;opacity:.3;}
.co-chk{display:inline-flex;align-items:center;gap:5px;cursor:pointer;color:var(--ink-dim);user-select:none;}
.co-names{display:flex;flex-direction:column;gap:3px;max-height:230px;overflow:auto;
  border:1px solid var(--line-soft);border-radius:5px;padding:6px;background:var(--bg-1);}

/* 클래스 계보 (상세 화면) */
.co-lineage{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
.co-lin-node{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;
  border:1px solid var(--line);background:var(--bg-1);font-size:11px;white-space:nowrap;color:var(--ink-dim);}
.co-lin-node .co-lin-tier{font-size:9px;font-weight:800;letter-spacing:.02em;opacity:.9;}
.co-lin-node.cur{border-color:var(--gold);color:var(--ink);background:rgba(224,180,74,.12);
  font-weight:700;box-shadow:0 0 0 1px var(--gold-dim) inset;}
.co-lin-node.future{border-style:dashed;opacity:.6;}
.co-lin-arrow{color:var(--ink-faint);font-size:11px;}
.co-lin-or{color:var(--ink-faint);font-size:10px;margin:0 1px;}
.co-lin-branch{display:inline-flex;align-items:center;gap:3px;flex-wrap:wrap;}

/* 4차 각성 전직 연출 */
.co-awaken{display:flex;flex-direction:column;gap:2px;padding:9px 11px;border-radius:6px;
  border:1px solid var(--gold);background:linear-gradient(180deg,rgba(224,180,74,.14),rgba(224,180,74,.03));
  box-shadow:0 0 18px -6px var(--gold);}
.co-awaken b{color:var(--gold);letter-spacing:.04em;}
.co-promo.awaken{border-color:var(--gold-dim);
  box-shadow:0 0 0 1px var(--gold-dim) inset,0 0 16px -7px var(--gold);
  animation:coAwakenGlow 2s ease-in-out infinite alternate;}
@keyframes coAwakenGlow{from{box-shadow:0 0 0 1px var(--gold-dim) inset,0 0 10px -7px var(--gold);}
  to{box-shadow:0 0 0 1px var(--gold) inset,0 0 24px -3px var(--gold);}}
.co-promo.awaken.sel{border-color:var(--gold);
  box-shadow:0 0 0 2px var(--gold) inset,0 0 26px -2px var(--gold);animation:none;}
.co-kind{display:inline-block;padding:0 8px;border-radius:999px;font-size:10px;font-weight:800;
  line-height:1.7;border:1px solid currentColor;white-space:nowrap;}

/* ── 10슬롯 장비창 (설계 A) — 사람 실루엣 배치 ────────────────────────
   머리 위 / 목·상의 가운데 / 양손 좌우 / 하의·신발 아래 / 반지 옆 */
.co-doll{display:grid;gap:6px;grid-template-columns:repeat(3,minmax(0,1fr));
  grid-template-areas:
    "neck   head  ring1"
    "weapon body  offhand"
    "hands  legs  ring2"
    ".      feet  .";}
/* 좁은 화면에서는 실루엣을 버리고 **2열 목록형**으로 바꾼다.
   3열 실루엣은 360px 에서 칸이 90px 밑으로 내려가 이름이 한 글자도 안 보인다. */
@media (max-width:767px){
  .co-doll{grid-template-columns:repeat(2,minmax(0,1fr));
    grid-template-areas:
      "head   neck"
      "weapon offhand"
      "body   legs"
      "hands  feet"
      "ring1  ring2";}
}
.co-eqs{position:relative;display:flex;flex-direction:column;gap:1px;padding:5px 7px;min-height:54px;
  border:1px solid var(--line-soft);border-left:3px solid var(--line);border-radius:5px;background:var(--bg-1);
  cursor:pointer;overflow:hidden;transition:border-color .12s,background .12s;}
.co-eqs:hover{border-color:var(--gold-dim);background:var(--bg-2);}
.co-eqs.empty{border-style:dashed;background:rgba(255,255,255,.02);}
.co-eqs.locked{opacity:.5;cursor:help;border-style:dashed;}
.co-eqs.locked:hover{opacity:.75;border-color:var(--line);background:var(--bg-1);}
.co-eqs.myth{border-color:${MYTHIC_COLOR};background:linear-gradient(180deg,rgba(255,95,58,.12),rgba(0,0,0,0));
  box-shadow:0 0 12px -8px ${MYTHIC_GLOW};}
.co-eqs .sl{font-size:9px;letter-spacing:.06em;color:var(--ink-faint);}
.co-eqs .nm{font-size:11px;font-weight:700;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.co-eqs .sub{font-size:9px;color:var(--ink-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.co-eqs .co-off{position:absolute;top:2px;right:3px;width:16px;height:16px;padding:0;line-height:14px;
  font-size:10px;border-radius:50%;border:1px solid var(--line);background:var(--bg-3);color:var(--ink-dim);
  cursor:pointer;opacity:.7;transition:opacity .12s,color .12s,border-color .12s;}
.co-eqs .co-off:hover{opacity:1;color:var(--bad);border-color:var(--bad);}
.co-lock{padding:5px 9px;border-radius:5px;border:1px dashed var(--line);
  background:rgba(255,255,255,.03);color:var(--ink-dim);}

/* ── 세트 진행도 (설계 B) ──────────────────────────────────────────── */
.co-set{border:1px solid var(--line-soft);border-left:3px solid ${MYTHIC_COLOR};border-radius:6px;
  padding:8px 10px;background:linear-gradient(180deg,rgba(255,95,58,.07),rgba(0,0,0,0));
  display:flex;flex-direction:column;gap:5px;}
.co-setpips{display:flex;gap:3px;flex-wrap:wrap;}
.co-setpip{width:26px;height:17px;border-radius:3px;border:1px solid var(--line);background:var(--bg-0);
  font-size:9px;line-height:15px;text-align:center;color:var(--ink-faint);overflow:hidden;white-space:nowrap;}
.co-setpip.on{border-color:${MYTHIC_COLOR};color:${MYTHIC_GLOW};background:rgba(255,95,58,.18);font-weight:700;}
.co-setpip.lock{border-style:dashed;opacity:.45;}
.co-setstep{display:flex;flex-direction:column;gap:1px;padding:4px 8px;border-radius:4px;
  border-left:2px solid var(--line);}
.co-setstep.on{border-left-color:var(--gold);background:rgba(224,180,74,.09);}
.co-setstep.off{opacity:.4;}
.co-setnone{padding:7px 10px;border-radius:5px;border:1px dashed var(--line);
  background:rgba(255,255,255,.02);color:var(--ink-dim);}
.co-myth-tag{display:inline-flex;align-items:center;padding:0 7px;border-radius:999px;
  font-size:10px;font-weight:800;line-height:1.7;white-space:nowrap;
  color:${MYTHIC_GLOW};border:1px solid ${MYTHIC_COLOR};background:rgba(255,95,58,.12);}

/* 넓은 표는 페이지가 아니라 이 상자 안에서만 가로로 스크롤한다 */
.co-xs{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;}

/* 필터 접기 버튼은 폰에서만 나타난다 (PC 는 지금까지처럼 항상 펼쳐져 있다) */
.co-ftoggle{display:none;}
/* 해고 체크박스의 탭 영역 (여백은 음수 마진으로 상쇄해 배치를 흔들지 않는다) */
.co-cbwrap{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;cursor:pointer;}

/* ══════════════════════ 모바일 (≤767px) ══════════════════════
 * 여기 아래는 전부 미디어 쿼리 안이다 — 1280px PC 화면은 한 픽셀도 달라지지 않는다.
 *   ① 편성판 sticky 해제 (폰에서는 화면의 절반을 잡아먹는다)
 *   ② 슬롯 카드 + 좌표를 같은 변수로 함께 축소 → 비율 유지
 *   ③ 드래그는 JS 쪽에서 끄고 클릭 배치만 남긴다
 *   ④ 터치 타겟 40px · 글자 하한 12px
 *   ⑤ 모달을 거의 전체 화면으로
 */
@media (max-width:767px){
  .co-root{gap:10px;}
  .co-root .panel{padding:10px;}
  .co-root .panel>h3,.co-root .panel-title{margin:0 0 7px;font-size:12px;}

  /* ① sticky 해제 */
  .co-boardpanel{position:static;max-height:none;overflow:visible;box-shadow:none;}

  /* ② 편성판 축소 (칸·좌표가 같은 변수를 쓰므로 배치 비율이 그대로다) */
  .co-board{--co-cw:62px;--co-ch:${CELL_H}px;height:clamp(320px,46vh,420px);}
  .co-zlab{font-size:12px;letter-spacing:.06em;}
  .co-slot .nm{font-size:12px;line-height:15px;}
  .co-slot .ix,.co-slot .zn,.co-slot .lv,.co-slot .wd{font-size:12px;}
  .co-slot .zn{left:19px;}
  .co-slot .wd{bottom:1px;right:3px;}
  /* 62px 칸 안에 40px 터치 타겟을 또 넣을 수는 없다 —
     칸을 탭하면 안내 띠에 [상세] 버튼이 뜨므로 ⓘ 는 폰에서 숨긴다 */
  .co-slot .co-info{display:none;}

  /* ④ 터치 타겟 40px / 글자 하한 12px */
  .co-root .btn,.co-mbody .btn{min-height:40px;}
  .co-root .btn.sm,.co-mbody .btn.sm{min-height:40px;padding:8px 12px;font-size:13px;}
  .co-root .co-in,.co-mbody .co-in{min-height:40px;font-size:13px;padding:8px 9px;}
  .co-root .tiny,.co-mbody .tiny{font-size:12px;}
  .co-root .tag,.co-mbody .tag{font-size:12px;}
  .co-cb{width:22px;height:22px;}
  .co-cbwrap{padding:9px;margin:-9px;}
  .co-chk{min-height:40px;font-size:12px;}
  .co-sqb{max-width:100%;overflow:hidden;text-overflow:ellipsis;font-size:12px;}
  /* '원정'·'부상' 꼬리표. 11px 은 폰 하한(12px) 미달이었다 — 실측으로 잡았다 */
  .co-sqb i{font-size:12px;}
  .co-kind,.co-myth-tag{font-size:12px;}
  .co-lin-node,.co-lin-node .co-lin-tier,.co-lin-arrow,.co-lin-or{font-size:12px;}

  /* 선택 안내 띠 — 폰에서는 **편성판 아래**로 내린다 (flex order).
     PC 에서는 띠가 판 위에 있어서, 용병을 고르는 순간 띠가 커지며 판이 아래로 밀려
     "방금 누른 칸이 손끝에서 도망가는" 문제가 있었다(그래서 min-height 로 고정해 뒀다).
     아래로 내리면 띠가 커져도 판이 1px 도 안 움직인다 — 그래서 폰에서는
     고정 높이를 풀고 내용에 맞춰 줄일 수 있다. 엄지도 아래쪽이 닿기 편하다. */
  .co-boardpanel .co-board{order:4;}
  .co-boardpanel .co-pickbar{order:5;}
  .co-boardpanel .co-boardhint{order:6;}
  .co-pickbar{min-height:0;padding:6px 7px;gap:6px;}
  .co-pickbar .co-mini{width:32px;height:36px;}
  .co-pickbar>.col{flex:1 1 calc(100% - 46px) !important;min-width:0;}
  .co-pickbar .btn.sm{padding:8px 10px;flex:1 1 auto;}

  /* 접이식 필터 — 기본은 접힘. 펼치면 2칸씩 떨어져 손가락으로 고를 수 있다 */
  .co-ftoggle{display:inline-flex;align-items:center;justify-content:center;}
  .co-filters{display:none;flex-basis:100%;gap:8px;}
  .co-filters.open{display:flex;}
  .co-filters>*{flex:1 1 42%;min-width:0;}

  .co-sq{min-width:120px;}
  .co-strip{padding:8px;gap:8px;}
  .co-names{max-height:44vh;}

  /* 표: 칸을 좁히고, 그래도 넘치면 자기 상자 안에서만 가로 스크롤 */
  .co-root table.data th,.co-root table.data td,
  .co-mbody table.data th,.co-mbody table.data td{padding:5px 6px;font-size:12px;white-space:nowrap;}

  /* 상세/전직 모달 — 2단을 1단으로 접는다 */
  .co-dl,.co-dr{flex:1 1 100% !important;min-width:0 !important;}
  .co-promogrid{grid-template-columns:minmax(0,1fr) !important;}

  /* 10슬롯 장비창 (2열 목록형) */
  .co-eqs{min-height:64px;padding:7px 9px;}
  .co-eqs .sl{font-size:12px;}
  .co-eqs .nm{font-size:13px;}
  .co-eqs .sub{font-size:12px;}
  .co-eqs .co-off{width:40px;height:40px;line-height:38px;font-size:17px;border-radius:8px;opacity:1;top:1px;right:1px;}
  .co-eqs:has(.co-off){padding-right:48px;}

  /* 세트 진행도 */
  .co-setpip{width:40px;height:24px;font-size:12px;line-height:22px;}
  .co-setstep{padding:6px 8px;}

  /* ⑤ 모달을 거의 전체 화면으로.
     modal 의 wide 옵션이 인라인으로 min-width:760px 을 박기 때문에 !important 가 필요하다.
     :has() 로 **이 화면이 띄운 모달에만** 걸어 다른 화면 모듈과 부딪히지 않게 한다. */
  #modal-layer:has(.co-mbody){padding:8px;align-items:flex-start;}
  #modal-layer:has(.co-mbody)>.modal{min-width:0 !important;width:100%;max-width:100% !important;
    max-height:calc(100dvh - 16px);}
  /* mobile-ok: 여기 sticky 는 **모달 안쪽 스크롤 상자**에 붙는다 — 페이지가 아니라
     max-height:calc(100dvh - 16px) 짜리 모달 자신이 스크롤 컨테이너다. 제목/닫기 버튼이
     긴 단원 정보 아래로 사라지지 않게 하는 용도라 화면을 잡아먹지 않는다(실측 헤더 44px). */
  #modal-layer:has(.co-mbody)>.modal>header{padding:12px 14px;position:sticky;top:0;z-index:2;background:var(--bg-2);}
  #modal-layer:has(.co-mbody)>.modal>.body{padding:12px;}
  #modal-layer:has(.co-mbody)>.modal>footer{padding:10px 12px;position:sticky;bottom:0;z-index:2;background:var(--bg-1);}
}

/* 태블릿 세로(761~999px) — 1단 레이아웃이라 sticky 편성판이 화면을 너무 많이 먹는다.
   여기서는 sticky 를 유지하되 높이만 줄여 명부가 더 보이게 한다. */
@media (min-width:768px) and (max-width:999px){
  .co-boardpanel{max-height:50vh;}
}

/* 태블릿 세로(761~1024px) — 레이아웃은 PC 그대로 두고 **터치 타겟만** 키운다.
   실측 768x1024: 일괄 해고 체크박스 20x20, 장비 해제 x 버튼 16x16 이라 손가락으로 못 눌렀다.
   1280px 에는 어느 쪽으로도 걸리지 않는다. */
@media (min-width:768px) and (max-width:1024px){
  .co-chk{min-height:40px;}
  .co-cbwrap{padding:9px;margin:-9px;}
  /* x 버튼은 PC 에서 hover 로만 드러나는데 터치 기기에는 hover 가 없다 — 항상 보이게 하고 키운다 */
  .co-eqs .co-off{width:36px;height:36px;line-height:34px;font-size:16px;border-radius:6px;opacity:1;}
  .co-eqs:has(.co-off){padding-right:44px;}
}

/* 아주 좁은 폰(≤380px) — 칸을 한 단계 더 줄이고 열 표시를 뺀다.
   (열은 칸 위쪽 색 테두리와 편성판 상단의 전열/중열/후열 라벨로 여전히 읽힌다) */
@media (max-width:380px){
  .co-board{--co-cw:58px;}
  .co-slot .zn{display:none;}
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(el('style', { id: STYLE_ID, text: CSS }));
}

/** 상단 HUD 높이만큼 sticky 오프셋을 잡아 준다 (HUD가 줄바꿈되면 높이가 달라진다) */
function syncStickyTop() {
  const hud = document.getElementById('hud');
  const h = hud ? Math.round(hud.getBoundingClientRect().height) : 56;
  document.documentElement.style.setProperty('--co-top', `${h + 6}px`);
}

/* ─────────────────────────── 전역 이벤트 (Esc / 드래그 자동 스크롤) ─────────────────────────── */

let bound = false;
let dragVel = 0;
let dragTarget = null;
let dragRaf = 0;

function onKey(e) {
  if (e.key !== 'Escape' || !picked) return;
  picked = null;
  redraw();
}

/** 커서 아래에서 실제로 스크롤되는 요소를 찾는다 (없으면 window) */
function scrollableAt(node) {
  let n = node;
  while (n && n.nodeType === 1 && n !== document.body) {
    if (n.scrollHeight - n.clientHeight > 4) {
      const ov = getComputedStyle(n).overflowY;
      if (ov === 'auto' || ov === 'scroll') return n;
    }
    n = n.parentElement;
  }
  return null;
}

// 드래그 중에는 브라우저가 스크롤을 안 해 준다. 화면 위/아래 가장자리에 오면 직접 굴린다.
function onDocDragOver(e) {
  if (!drag) return;
  const h = window.innerHeight || 800;
  const y = e.clientY;
  let v = 0;
  if (y < EDGE_PX) v = -EDGE_SPEED * (1 - Math.max(0, y) / EDGE_PX);
  else if (y > h - EDGE_PX) v = EDGE_SPEED * (1 - Math.max(0, h - y) / EDGE_PX);
  dragVel = v;
  dragTarget = v ? scrollableAt(e.target) : null;
  if (v && !dragRaf) dragRaf = requestAnimationFrame(stepDragScroll);
}

function stepDragScroll() {
  dragRaf = 0;
  if (!drag || !dragVel) { dragVel = 0; return; }
  // 커서 아래 컨테이너를 먼저 굴리고, 그쪽이 끝까지 갔으면 창 전체를 굴린다
  let moved = false;
  if (dragTarget) {
    const before = dragTarget.scrollTop;
    dragTarget.scrollTop = before + dragVel;
    moved = dragTarget.scrollTop !== before;
  }
  if (!moved) window.scrollBy(0, dragVel);
  dragRaf = requestAnimationFrame(stepDragScroll);
}

function stopDragScroll() {
  dragVel = 0;
  dragTarget = null;
  if (dragRaf) cancelAnimationFrame(dragRaf);
  dragRaf = 0;
}

/** 폭 경계(1단↔2단)를 넘으면 다시 그린다 — 드래그 가능 여부·문구가 폭에 따라 달라진다 */
let narrowMql = null;
const onNarrowChange = () => { stopDragScroll(); drag = null; redraw(); };

function bindGlobal() {
  if (bound) return;
  document.addEventListener('keydown', onKey);
  document.addEventListener('dragover', onDocDragOver, true);
  document.addEventListener('dragend', stopDragScroll, true);
  document.addEventListener('drop', stopDragScroll, true);
  window.addEventListener('resize', syncStickyTop);
  narrowMql = mql(NARROW_MQ);
  if (narrowMql && narrowMql.addEventListener) narrowMql.addEventListener('change', onNarrowChange);
  bound = true;
}

function unbindGlobal() {
  if (!bound) return;
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('dragover', onDocDragOver, true);
  document.removeEventListener('dragend', stopDragScroll, true);
  document.removeEventListener('drop', stopDragScroll, true);
  window.removeEventListener('resize', syncStickyTop);
  if (narrowMql && narrowMql.removeEventListener) narrowMql.removeEventListener('change', onNarrowChange);
  narrowMql = null;
  bound = false;
}

/* ─────────────────────────── 진입점 ─────────────────────────── */

export function render(root, params = {}) {
  injectStyle();
  syncStickyTop();
  bindGlobal();
  if (params.squadId) selectedSquadId = params.squadId;
  ensureSelection();

  /* 다른 화면(장비 등)에서 단원을 지정해 들어온 경우 그 단원의 상세를 바로 연다.
   * render 는 go() 안에서 실행 중이고 모달은 별도 레이어라 직접 열어도 되지만,
   * 화면이 다 그려진 뒤에 뜨는 편이 자연스러워 다음 틱으로 미룬다. */
  if (params.mercUid) {
    const uid = params.mercUid;
    setTimeout(() => { try { openMercDetail(uid); } catch (e) { console.warn('[company] 단원 상세 열기 실패', e); } }, 0);
  }

  validatePick();
  pruneMarked();

  const left = el('div', { class: 'co-left' }, boardPanel(), totalsPanel());
  const right = el('div', { class: 'co-right' }, rosterPanel());
  left.addEventListener('scroll', () => { leftScroll = left.scrollTop; });

  root.appendChild(el('div', { class: 'col co-root' },
    squadBar(),
    el('div', { class: 'co-wrap' }, left, right)));

  left.scrollTop = leftScroll;
}

function ensureSelection() {
  if (!Array.isArray(state.squads)) state.squads = [];
  if (selectedSquadId && !state.squads.some((s) => s.id === selectedSquadId)) selectedSquadId = null;
  if (!selectedSquadId) selectedSquadId = state.squads[0] ? state.squads[0].id : null;
}
const currentSquad = () => state.squads.find((s) => s.id === selectedSquadId) || null;

/** 선택 상태가 아직 유효한지 확인하고, 자리 이동을 반영한다 */
function validatePick() {
  if (!picked) return;
  const sq = currentSquad();
  if (!sq) { picked = null; return; }
  if (picked.type === 'merc') {
    const m = mercOf(picked.uid);
    if (!m) { picked = null; return; }
    if (m.squadId === sq.id) { picked.from = 'slot'; picked.index = m.slotIndex; }
    else { picked.from = 'roster'; picked.index = -1; }
    return;
  }
  if (picked.type === 'slot') {
    if (!(picked.index >= 0 && picked.index < SQUAD_SIZE)) picked = null;
  }
}

/** 해고 선택에서 사라진 단원과 (허용이 꺼졌다면) 배치된 단원을 걷어낸다 */
function pruneMarked() {
  for (const uid of [...marked]) {
    const m = mercOf(uid);
    if (!m || (!includeDeployed && m.squadId)) marked.delete(uid);
  }
}

/** 카드 클릭과 겹치지 않는 체크박스 */
function checkbox(on, onChange, { disabled = false, title = '' } = {}) {
  const c = el('input', {
    type: 'checkbox',
    class: 'co-cb',
    disabled: !!disabled,
    title,
    onClick: (e) => e.stopPropagation(),
    onChange: (e) => { e.stopPropagation(); onChange(!!e.target.checked); },
  });
  c.checked = !!on;
  return c;
}

/* ─────────────────────────── 상단: 부대 선택 바 ─────────────────────────── */

function squadBar() {
  const bar = el('div', { class: 'panel col', style: { padding: '10px 12px', gap: '8px' } });

  const strip = el('div', { class: 'co-squads' });
  for (const sq of state.squads) {
    const count = sq.memberUids.filter(Boolean).length;
    const f = getFormation(sq.formationId);
    const st = squadStatus(sq);
    const chip = el('div', {
      class: `co-sq${sq.id === selectedSquadId ? ' on' : ''}`,
      onClick: () => { selectedSquadId = sq.id; previewFormationId = null; picked = null; redraw(); },
      onDragOver: (e) => { if (drag) { e.preventDefault(); chip.classList.add('co-drop'); } },
      onDragLeave: () => chip.classList.remove('co-drop'),
      onDrop: (e) => {
        e.preventDefault();
        chip.classList.remove('co-drop');
        if (!drag) return;
        const r = addToSquad(state, sq.id, drag.uid, null);
        drag = null;
        toast(r.reason, r.ok ? 'good' : 'bad');
        if (r.ok) { save(); redraw(); }
      },
    },
      el('div', { class: 'row spread center', style: { gap: '8px' } },
        el('b', { style: { fontSize: '12px' }, text: sq.name }),
        el('span', { class: 'tag', style: { color: count ? 'var(--leaf)' : 'var(--ink-faint)' }, text: `${count}/${SQUAD_SIZE}` })),
      el('div', { class: 'tiny faint', text: `${f ? f.name : '진형 없음'} · 전력 ${num(squadPower(state, sq.id))}` }),
      // 원정 상태는 항상 보인다 — 어느 부대가 나가 있는지 편성 화면에서 바로 알아야 한다
      el('div', { class: 'tiny', style: { color: st.color, fontWeight: st.away ? '700' : '400' }, text: st.label }));
    strip.appendChild(chip);
  }
  if (!state.squads.length) {
    strip.appendChild(el('div', { class: 'tiny muted', text: '아직 부대가 없습니다. 오른쪽에서 하나 만드세요.' }));
  }

  const sel = currentSquad();
  bar.appendChild(el('div', { class: 'row center wrap', style: { gap: '10px' } },
    el('span', { class: 'tiny faint', style: { flex: '0 0 auto' }, text: '부대' }),
    strip,
    el('div', { class: 'row center', style: { gap: '6px', flex: '0 0 auto' } },
      addSquadButton(),
      sel ? el('button', { class: 'btn sm ghost', onClick: () => renameSquad(sel) }, '이름') : null,
      sel ? el('button', { class: 'btn sm ghost danger', onClick: () => askDisband(sel) }, '해산') : null,
      /* ★ 펫 화면은 라우팅에 있었지만 **들어갈 길이 사실상 없었다** —
       *   용병 상세 모달 안쪽 장비 칸의 작은 버튼과 탑 화면뿐이라 아무도 못 찾았다
       *   (제작자가 "펫은 어디서 확인하지?" 라고 물었다).
       *   부대 편성 옆이 제자리다 — 펫은 부대에 배치하는 것이니까. */
      el('button', {
        class: 'btn sm ghost',
        title: '펫을 배치하고 관리한다',
        onClick: () => go('pets'),
      }, `펫 ${petCountLabel()}`))));

  const chk = addSquadCheck();
  const free = state.roster.filter((m) => !m.squadId).length;
  const cap = rosterCapOf();
  const full = state.roster.length >= cap;
  bar.appendChild(el('div', { class: 'row wrap tiny faint', style: { gap: '14px' } },
    el('span', { style: { color: 'var(--ink-dim)' }, text: `부대 ${chk.count} / ${MAX_SQUADS}` }),
    el('span', { style: full ? { color: 'var(--bad)', fontWeight: '700' } : {}, text: `단원 ${state.roster.length} / ${cap}` }),
    el('span', { style: free ? { color: 'var(--gold)' } : {}, text: `미배치 ${free}명` }),
    el('span', { text: `하루 임금 ${num(GameState.dailyUpkeep(state))}G` }),
    el('span', { text: `보유 진형 ${state.formations.length}종` }),
    chk.count >= MAX_SQUADS
      ? el('span', { style: { color: 'var(--ink-faint)' }, text: '최대 부대 수에 도달했다' })
      : el('span', { text: `다음 부대 창설비 ${num(chk.cost)}G` })));

  return bar;
}

/**
 * 편성판 아래 «이 부대의 펫» 줄.
 *
 * ★ 펫 화면이 따로 있는데도 여기 붙이는 이유 — **펫은 부대의 일부**다.
 *   편성을 짜면서 «지금 이 부대에 뭐가 붙어 있나» 를 보려고 화면을 옮겨야 하면
 *   편성 판단이 끊긴다 (제작자 지적: "부대 배치화면에서 같이 볼 수 있으면 좋겠다").
 *   자세한 관리(교체·방출)는 여전히 펫 화면이 한다 — 여기서는 **보여 주고 넘겨준다.**
 */
function squadPetRow(sq) {
  let pets = [];
  try { pets = Pet.squadPets(state, sq) || []; } catch (e) { pets = []; }
  const cap = (() => { try { return (Pet.petUidsOf(sq) || []).length || 3; } catch (e) { return 3; } })();

  const row = el('div', { class: 'row center wrap co-petrow', style: { gap: '6px' } },
    el('span', { class: 'tiny faint', style: { flex: '0 0 auto' }, text: '펫' }));

  if (!pets.length) {
    row.appendChild(el('span', { class: 'tiny muted', text: '배치된 펫이 없다 — 무한의 탑에서 얻는다' }));
  } else {
    for (const p of pets) {
      let label = '';
      let ability = '';
      try { label = Pet.petLabel(p) || ''; ability = Pet.petAbilityText(p) || ''; } catch (e) { /* 옛 세이브 */ }
      row.appendChild(el('span', {
        class: 'tag co-pet',
        style: { color: GRADE_COLOR[p.grade] || 'var(--ink)' },
        title: ability,
      }, label || `${p.grade || '?'} ${p.sid || '펫'}`));   // petLabel 이 등급을 이미 붙인다
    }
    if (pets.length < cap) {
      row.appendChild(el('span', { class: 'tiny faint', text: `빈 자리 ${cap - pets.length}` }));
    }
  }
  row.appendChild(el('button', {
    class: 'btn sm ghost', style: { marginLeft: 'auto', flex: '0 0 auto' },
    onClick: () => go('pets'),
  }, '펫 관리'));
  return row;
}

/** 보유 펫 수 — 버튼에 붙여 "펫이 있다"는 걸 화면에서 바로 알게 한다 */
function petCountLabel() {
  try {
    const all = Pet.allPets(state) || [];
    if (!all.length) return '';
    const placed = state.squads.reduce((a, sq) => a + (Pet.petUidsOf(sq) || []).filter(Boolean).length, 0);
    return placed < all.length ? `${placed}/${all.length}` : `${all.length}`;
  } catch (e) { return ''; }
}

/** ＋부대 버튼 — 다음 부대 비용을 그대로 붙이고, 못 사면 사유를 title 에 담아 비활성화한다 */
function addSquadButton() {
  const chk = addSquadCheck();
  const atMax = chk.count >= MAX_SQUADS;
  return el('button', {
    class: `btn sm${chk.ok ? ' primary' : ''}`,
    disabled: !chk.ok,
    title: atMax
      ? `최대 부대 수에 도달했다. (${MAX_SQUADS}부대)`
      : (chk.ok ? `${num(chk.cost)}G를 내고 부대를 하나 더 만든다` : (chk.reason || '부대를 더 만들 수 없습니다.')),
    onClick: askAddSquad,
  }, atMax ? `＋ 부대 (최대 ${MAX_SQUADS})` : `＋ 부대 (${num(chk.cost)}G)`);
}

/** 부대 창설 = 골드 구매. 비용·보유 골드·잔액을 보여주고 확인을 받는다 */
function askAddSquad() {
  const chk = addSquadCheck();
  if (chk.count >= MAX_SQUADS) {
    toast(`최대 부대 수에 도달했다. (${MAX_SQUADS}부대)`, 'bad');
    return;
  }
  const gold = Math.round(state.gold || 0);
  const after = gold - chk.cost;
  const input = el('input', { class: 'co-in', value: `제${chk.count + 1}부대`, maxlength: '16' });

  const line = (k, v, color) => el('div', { class: 'row spread center tiny' },
    el('span', { class: 'faint', text: k }),
    el('b', { class: 'num', style: color ? { color } : {}, text: v }));

  modal({
    title: '부대 창설',
    body: el('div', { class: 'col co-mbody' },
      el('div', { class: 'tiny muted', text: '부대를 늘리면 같은 날 여러 의뢰에 동시에 내보낼 수 있다. 대신 창설비가 들고, 채울 단원의 임금도 늘어난다.' }),
      el('div', { class: 'co-eq col', style: { gap: '4px' } },
        line('창설 비용', `${num(chk.cost)}G`, 'var(--gold)'),
        line('보유 골드', `${num(gold)}G`),
        line('창설 후 잔액', `${num(after)}G`, after < 0 ? 'var(--bad)' : ''),
        line('부대 수', `${chk.count} → ${chk.count + 1} / ${MAX_SQUADS}`)),
      el('div', { class: 'tiny faint', text: '부대 이름 (16자 이내)' }),
      input,
      chk.ok ? null : el('div', { class: 'tiny', style: { color: 'var(--bad)', fontWeight: '700' }, text: chk.reason })),
    actions: [
      { label: '취소', kind: 'ghost' },
      {
        label: chk.cost > 0 ? `${num(chk.cost)}G 지불하고 창설` : '창설',
        kind: 'primary',
        act: () => {
          const now = addSquadCheck();
          if (!now.ok) { toast(now.reason || '부대를 만들 수 없습니다.', 'bad'); return false; }
          const nm = (input.value || '').trim().slice(0, 16) || `제${now.count + 1}부대`;
          const buy = fnOf(SquadAPI, 'buySquad');
          let r;
          if (buy) {
            r = buy(state, nm) || { ok: false, reason: '부대 창설에 실패했습니다.' };
          } else {
            // 폴백: 구매 API가 없으면 여기서 직접 값을 치른다 (경로가 갈려도 골드는 반드시 나간다)
            if (now.cost > 0) addGold(-now.cost);
            const sq = createSquad(nm, state.formations[0] || 'basic');
            state.squads.push(sq);
            addLog(now.cost > 0 ? `${nm}${josa(nm)} 창설했다. (-${num(now.cost)}G)` : `${nm}${josa(nm)} 편성했다.`);
            r = { ok: true, reason: `${nm}${josa(nm)} 창설했습니다.`, squad: sq };
          }
          if (!r.ok) { toast(r.reason || '부대 창설에 실패했습니다.', 'bad'); return false; }
          const made = r.squad || state.squads[state.squads.length - 1];
          if (made) selectedSquadId = made.id;
          previewFormationId = null;
          picked = null;
          save();
          toast(r.reason, 'good');
          redraw();
          return true;
        },
      },
    ],
  });
}

/**
 * 용병 이름 변경.
 * 이름은 순수 표시용이다 — 세이브·전투 결과 키는 전부 `uid` 를 쓰므로 바꿔도 안전하다.
 */
function renameMerc(m) {
  const input = el('input', { class: 'co-in', value: m.name || '', maxlength: '16' });
  const orig = m.name;
  modal({
    title: '용병 이름 변경',
    body: el('div', { class: 'col co-mbody' },
      el('div', { class: 'tiny muted', text: '16자 이내로 입력하세요. 비우고 확인하면 원래 이름으로 되돌립니다.' }),
      input,
      el('div', { class: 'tiny faint', text: `현재: ${orig}` })),
    actions: [
      { label: '취소', kind: 'ghost' },
      {
        label: '변경',
        kind: 'primary',
        act: () => {
          const v = input.value.trim();
          if (!v) { toast('이름을 입력하세요.', 'bad'); return false; }
          m.name = v.slice(0, 16);
          save();
          redraw();
          toast(`${orig} → ${m.name}`, 'good');
          return true;
        },
      },
    ],
  });
}

function renameSquad(sq) {
  const input = el('input', { class: 'co-in', value: sq.name, maxlength: '16' });
  modal({
    title: '부대 이름 변경',
    body: el('div', { class: 'col co-mbody' },
      el('div', { class: 'tiny muted', text: '16자 이내로 입력하세요.' }),
      input),
    actions: [
      { label: '취소', kind: 'ghost' },
      {
        label: '변경',
        kind: 'primary',
        act: () => {
          const v = input.value.trim();
          if (!v) { toast('이름을 입력하세요.', 'bad'); return false; }
          sq.name = v.slice(0, 16);
          save();
          redraw();
          return true;
        },
      },
    ],
  });
}

function askDisband(sq) {
  confirmBox('부대 해산', `${sq.name}${josa(sq.name)} 해산합니다. 소속 용병은 미배치 상태가 됩니다.`, () => {
    const r = disbandSquad(state, sq.id);
    if (r.ok && selectedSquadId === sq.id) selectedSquadId = null;
    picked = null;
    toast(r.reason, r.ok ? 'good' : 'bad');
    save();
    redraw();
  }, '해산');
}

/* ─────────────────────────── 편성판 ─────────────────────────── */

function boardPanel() {
  const sq = currentSquad();
  const panel = el('div', { class: 'panel col co-boardpanel', style: { gap: '9px' } });

  if (!sq) {
    panel.append(
      el('h3', { text: '편성' }),
      el('div', { class: 'muted', text: '부대를 먼저 만들고 선택하세요.' }),
      el('div', {}, addSquadButton()));
    return panel;
  }

  const activeId = previewFormationId || sq.formationId;
  const f = getFormation(activeId) || getFormation('basic');
  const owned = state.formations.includes(f.id);

  panel.appendChild(el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
    el('h3', { class: 'panel-title', text: `${sq.name} 편성`, style: { margin: '0' } }),
    el('div', { class: 'row center', style: { gap: '8px' } },
      el('span', { class: 'tiny faint', text: '진형' }),
      formationSelect(sq, f))));

  // 선택 안내 (클릭 배치의 핵심 UI)
  const banner = pickBanner(sq, f);
  if (banner) panel.appendChild(banner);

  // 배치 도구
  panel.appendChild(actionRow(sq, owned));

  // 진형 요약
  const eff = el('div', { class: 'co-fx' });
  for (const line of formationSummary(f)) {
    eff.appendChild(el('span', {
      class: 'tag',
      style: { color: line === '보정 없음' ? 'var(--ink-faint)' : 'var(--steel)' },
      text: line,
    }));
  }
  panel.appendChild(el('div', { class: 'col', style: { gap: '5px' } },
    el('div', { class: 'tiny muted', text: f.desc || '' }),
    eff));

  if (!owned) {
    const canBuy = (state.gold || 0) >= (f.cost || 0);
    panel.appendChild(el('div', {
      class: 'row spread center wrap',
      style: {
        gap: '8px', padding: '8px 10px', borderRadius: '6px',
        border: '1px solid var(--gold-dim)', background: 'rgba(224,180,74,.07)',
      },
    },
      el('div', { class: 'tiny' },
        el('b', { style: { color: 'var(--gold)' }, text: '미리보기 · 미보유 진형' }),
        el('span', { class: 'muted', text: `  입수 경로: ${f.source || '상점'} · 가격 ${num(f.cost || 0)}G` })),
      el('div', { class: 'row', style: { gap: '6px' } },
        el('button', {
          class: 'btn sm primary', disabled: !canBuy,
          onClick: () => buyFormation(f),
        }, canBuy ? `${num(f.cost || 0)}G에 구매` : '골드 부족'),
        el('button', {
          class: 'btn sm ghost',
          onClick: () => { previewFormationId = null; redraw(); },
        }, '미리보기 종료'))));
  }

  panel.appendChild(board(sq, f, owned));
  panel.appendChild(squadPetRow(sq));
  panel.appendChild(el('div', {
    class: 'tiny faint co-boardhint',
    text: short(
      '왼쪽이 최전방입니다. 아래 명부에서 용병을 누른 뒤 칸을 누르면 배치됩니다. (빈 칸을 먼저 눌러도 됩니다)',
      '왼쪽이 최전방입니다. 명부에서 용병을 누르고 칸을 누르면 배치됩니다(빈 칸을 먼저 눌러도 됩니다). 칸을 두 번 누르면 상세 정보가 열립니다. 끌어다 놓기도 그대로 됩니다.'),
  }));
  return panel;
}

/** 선택 상태 안내 띠 — "어디에 배치할지 고르세요" + 취소 */
function pickBanner(sq, f) {
  // 선택했을 때만 띠를 끼워 넣으면 그 높이만큼 아래 내용이 통째로 밀린다.
  // 편성판을 클릭한 순간 슬롯이 발밑에서 움직여서 다음 클릭을 조준할 수 없었다(실제 피드백).
  // 아무것도 안 골랐을 때도 같은 높이의 안내 띠를 항상 자리에 둬서 레이아웃을 고정한다.
  if (!picked) {
    return el('div', { class: 'co-pickbar', style: { opacity: '.55' } },
      el('div', { class: 'col', style: { gap: '1px', flex: '1 1 160px', minWidth: '0' } },
        el('b', { text: '배치할 용병이나 자리를 고르세요' }),
        el('div', { class: 'tiny', text: short('사람이 있는 칸을 누르면 [상세]가 열립니다.', '칸의 ⓘ 를 누르면 상세 정보가 열립니다.') })));
  }

  if (picked.type === 'slot') {
    const zone = ZONE_LABEL[slotZoneOf(f, picked.index)] || '';
    return el('div', { class: 'co-pickbar' },
      el('div', { class: 'col', style: { gap: '1px', flex: '1 1 160px', minWidth: '0' } },
        el('b', { style: { color: 'var(--gold)' }, text: `${picked.index + 1}번 자리 (${zone}) 선택됨` }),
        el('div', { class: 'tiny', text: short('아래 명부에서 용병을 고르세요.', '아래 명부에서 이 자리에 넣을 용병을 고르세요.') })),
      el('button', { class: 'btn sm', onClick: () => autoFill() }, short('자동채움', '자동으로 채우기')),
      el('button', { class: 'btn sm ghost', onClick: () => { picked = null; redraw(); } }, '취소'));
  }

  const m = mercOf(picked.uid);
  if (!m) return null;
  const c = getClass(m.classId) || {};
  const hint = picked.from === 'slot'
    ? short('옮길 칸을 고르세요. (사람이 있으면 자리 교환)', '옮길 칸을 고르세요. 사람이 있는 칸을 고르면 자리를 맞바꿉니다.')
    : '배치할 칸을 고르세요.';
  return el('div', { class: 'co-pickbar' },
    miniPortrait(m),
    el('div', { class: 'col', style: { gap: '1px', flex: '1 1 160px', minWidth: '0' } },
      el('div', { class: 'row center wrap', style: { gap: '6px' } },
        el('b', { style: { color: gradeColor(m.grade) }, text: m.name }),
        el('span', { class: 'tiny faint', text: `${c.name || m.classId} · ${c.rank === 2 ? '후열형' : '전열형'}` })),
      el('div', { class: 'tiny', style: { color: 'var(--gold)' }, text: isNarrow() ? hint : `${hint} (Esc로 취소)` })),
    el('button', { class: 'btn sm primary', onClick: () => placeToFirstEmpty(m.uid) }, short('빈자리', '빈 자리에')),
    picked.from === 'slot'
      ? el('button', {
        class: 'btn sm ghost danger',
        onClick: () => {
          const r = removeFromSquad(state, sq.id, m.uid);
          picked = null;
          toast(r.reason, r.ok ? 'good' : 'bad');
          if (r.ok) save();
          redraw();
        },
      }, short('빼기', '부대에서 빼기'))
      : null,
    el('button', { class: 'btn sm ghost', onClick: () => openMercDetail(m.uid) }, '상세'),
    el('button', { class: 'btn sm ghost', onClick: () => { picked = null; redraw(); } }, '취소'));
}

/** 자동 채우기 / 전원 해제 */
function actionRow(sq, owned) {
  const slots = squadSlots(state, sq.id);
  const emptyCount = slots.filter((m) => !m).length;
  const freeCount = state.roster.filter((m) => !m.squadId).length;
  return el('div', { class: 'row wrap center', style: { gap: '6px' } },
    el('button', {
      class: 'btn sm primary',
      disabled: !owned || !emptyCount || !freeCount,
      title: '미배치 인원을 전투력 순으로, 클래스 성향(전열/후열)에 맞춰 빈 칸에 넣는다',
      onClick: autoFill,
    }, `빈 슬롯 자동 채우기 (${Math.min(emptyCount, freeCount)}명)`),
    el('button', {
      class: 'btn sm ghost',
      disabled: emptyCount === SQUAD_SIZE,
      onClick: clearSquad,
    }, '전원 해제'),
    el('span', { class: 'tiny faint', text: `빈 자리 ${emptyCount}칸 · 미배치 ${freeCount}명` }));
}

function formationSelect(sq, active) {
  const sel = el('select', {
    class: 'co-in',
    onChange: (e) => {
      const id = e.target.value;
      if (state.formations.includes(id)) {
        previewFormationId = null;
        const r = setFormation(state, sq.id, id);
        toast(r.reason, r.ok ? 'good' : 'bad');
        save();
      } else {
        previewFormationId = id;
      }
      redraw();
    },
  });
  for (const f of FORMATION_LIST) {
    const owned = state.formations.includes(f.id);
    sel.appendChild(el('option', {
      value: f.id,
      selected: f.id === active.id,
      text: owned ? `${f.name} (${f.tier}급)` : `🔒 ${f.name} — ${num(f.cost || 0)}G`,
    }));
  }
  return sel;
}

function buyFormation(f) {
  if (state.formations.includes(f.id)) return;
  const cost = f.cost || 0;
  if ((state.gold || 0) < cost) { toast('골드가 부족합니다.', 'bad'); return; }
  addGold(-cost);
  state.formations.push(f.id);
  addLog(`진형 「${f.name}」${josa(f.name)} ${num(cost)}G에 사들였다.`);
  previewFormationId = null;
  const sq = currentSquad();
  if (sq) setFormation(state, sq.id, f.id);
  save();
  toast(`${f.name} 진형을 손에 넣었습니다.`, 'good');
  redraw();
}

/** 슬롯 중심 좌표를 % 계산식으로 (칸이 판 밖으로 나가지 않게 안쪽으로 눌러 넣는다)
 *  칸 크기는 `.co-board` 의 --co-cw/--co-ch 를 그대로 읽는다 —
 *  미디어 쿼리가 변수를 줄이면 칸과 좌표가 **같은 비율로** 함께 작아진다. */
const bx = (v) => `calc(var(--co-cw, ${CELL_W}px) / 2 + ${v} * (100% - var(--co-cw, ${CELL_W}px)))`;
const by = (v) => `calc(var(--co-ch, ${CELL_H}px) / 2 + ${v} * (100% - var(--co-ch, ${CELL_H}px)))`;

function board(sq, f, owned) {
  const wrap = el('div', { class: 'co-board' });
  wrap.append(
    el('div', { class: 'co-div', style: { left: bx(0.34) } }),
    el('div', { class: 'co-div', style: { left: bx(0.66) } }),
    el('div', { class: 'co-zlab', style: { left: bx(0.17), color: ZONE_COLOR.front }, text: '◀ 전열' }),
    el('div', { class: 'co-zlab', style: { left: bx(0.50) }, text: '중열' }),
    el('div', { class: 'co-zlab', style: { left: bx(0.83), color: ZONE_COLOR.back }, text: '후열' }));

  const members = squadSlots(state, sq.id);
  f.slots.forEach((slot, i) => {
    wrap.appendChild(slotCell(sq, f, i, slot, members[i], owned));
  });
  return wrap;
}

function slotCell(sq, f, i, slot, merc, owned = true) {
  const zone = slotZoneOf(f, i);
  // 배치 대상 강조: 용병을 골랐으면 빈 칸(can)/사람 있는 칸(swap), 자리를 골랐으면 그 칸(sel)
  let mark = '';
  if (picked && picked.type === 'merc' && owned) {
    if (picked.from === 'slot' && picked.index === i) mark = ' sel';
    else mark = merc ? ' swap' : ' can';
  } else if (picked && picked.type === 'slot' && picked.index === i) {
    mark = ' sel';
  }

  const cell = el('div', {
    class: `co-slot${merc ? '' : ' empty'}${mark}`,
    style: { left: bx(slot.x), top: by(slot.y), zIndex: String(10 + i), opacity: owned ? '1' : '.75' },
    data: { zone },
    // 모바일에서는 드래그를 끈다 — 드래그 중 스크롤이 막혀 긴 명부를 다룰 수 없다
    draggable: merc && owned && dragEnabled() ? 'true' : false,
    title: merc
      ? `${merc.name} · ${ZONE_LABEL[zone]} · 클릭해서 옮기기 / 두 번 클릭하면 상세`
      : `${i + 1}번 자리 · ${ZONE_LABEL[zone]} · 클릭해서 이 자리 고르기`,
    onDragStart: (e) => {
      if (!merc || !owned || !dragEnabled()) { e.preventDefault(); return; }
      drag = { kind: 'slot', uid: merc.uid, index: i };
      try { e.dataTransfer.setData('text/plain', merc.uid); e.dataTransfer.effectAllowed = 'move'; } catch { /* noop */ }
    },
    onDragEnd: () => { drag = null; stopDragScroll(); },
    onDragOver: (e) => { if (drag && owned) { e.preventDefault(); cell.classList.add('over'); } },
    onDragLeave: () => cell.classList.remove('over'),
    onDrop: (e) => {
      cell.classList.remove('over');
      if (!owned) return;
      e.preventDefault();
      stopDragScroll();
      dropOnSlot(sq, i);
    },
    onClick: () => onSlotClick(sq, i, merc, owned),
    onDblClick: () => { if (merc) openMercDetail(merc.uid); },
  });

  cell.append(
    el('span', { class: 'ix', text: String(i + 1) }),
    el('span', { class: 'zn', style: { color: ZONE_COLOR[zone] }, text: ZONE_SHORT[zone] }));
  if (!merc) {
    cell.appendChild(el('span', { class: 'tiny', text: ZONE_LABEL[zone] }));
    return cell;
  }
  cell.append(
    el('span', { class: 'lv', text: `L${merc.level || 1}` }),
    spriteCanvas(mercRecipe(merc, state), 1),
    el('span', { class: 'nm', style: { color: gradeColor(merc.grade) }, text: merc.name }));
  // 상세 보기 전용 버튼.
  //
  // 예전에는 더블클릭으로만 열 수 있었는데 실제로는 열리지 않았다 — 첫 클릭이 onSlotClick →
  // redraw() 로 화면 전체를 다시 그려서, 두 번째 클릭은 이미 교체된 새 DOM에 떨어진다.
  // 그래서 브라우저가 dblclick 을 아예 발생시키지 못한다. 더블클릭에 기대지 않고
  // 명시적인 버튼을 둔다. (더블클릭도 계속 동작하게 두되, 이제 이게 확실한 경로다)
  cell.appendChild(el('button', {
    class: 'co-info',
    title: `${merc.name} 상세 보기`,
    onClick: (e) => { e.stopPropagation(); openMercDetail(merc.uid); },
    onDblClick: (e) => e.stopPropagation(),
  }, 'ⓘ'));
  if (isWounded(merc, state.day)) cell.appendChild(el('span', { class: 'wd', text: '부상' }));
  return cell;
}

/* ── 클릭 배치 ── */

function onSlotClick(sq, i, merc, owned) {
  if (!owned) { toast('아직 보유하지 않은 진형입니다. 먼저 구매하세요.', 'bad'); return; }
  if (picked && picked.type === 'merc') { placeInto(sq, i); return; }
  // 같은 칸을 다시 누르면 해제
  if (picked && picked.type === 'slot' && picked.index === i) { picked = null; redraw(); return; }
  picked = merc ? { type: 'merc', uid: merc.uid, from: 'slot', index: i } : { type: 'slot', index: i };
  redraw();
  // 폰에서는 편성판이 sticky 가 아니다 — 빈 자리를 골랐으면 명부까지 데려다 준다
  if (picked && picked.type === 'slot') scrollToRoster();
}

/** 고른 용병을 index 칸에 넣는다 (사람이 있으면 자리 교환) */
function placeInto(sq, index) {
  const p = picked;
  picked = null;
  if (!p || p.type !== 'merc') { redraw(); return; }
  if (p.from === 'slot' && p.index === index) { redraw(); return; }   // 제자리 = 선택 해제
  const r = p.from === 'slot'
    ? swapSlots(state, sq.id, p.index, index)
    : addToSquad(state, sq.id, p.uid, index);
  toast(r.reason, r.ok ? 'good' : 'bad');
  if (r.ok) save();
  redraw();
}

/** 빈 자리 아무 곳에나 */
function placeToFirstEmpty(mercUid) {
  const sq = currentSquad();
  if (!sq) { toast('부대를 먼저 만드세요.', 'bad'); return; }
  const r = addToSquad(state, sq.id, mercUid, null);
  toast(r.reason, r.ok ? 'good' : 'bad');
  if (r.ok) save();
  picked = null;
  redraw();
}

/**
 * 빈 슬롯 자동 채우기.
 * 미배치 인원을 (건강한 사람 먼저) 전투력 순으로 뽑아,
 * 클래스의 `rank`(1=전열, 2=후열) 성향에 가장 가까운 x좌표의 빈 칸에 넣는다.
 */
function autoFill() {
  const sq = currentSquad();
  if (!sq) { toast('부대를 먼저 만드세요.', 'bad'); return; }
  const f = getFormation(sq.formationId) || getFormation('basic');
  const slots = squadSlots(state, sq.id);
  const empty = [];
  slots.forEach((m, i) => { if (!m) empty.push(i); });
  if (!empty.length) { toast('빈 자리가 없습니다.', 'bad'); return; }

  const day = state.day || 0;
  const cands = state.roster.filter((m) => !m.squadId).sort((a, b) =>
    (isWounded(a, day) ? 1 : 0) - (isWounded(b, day) ? 1 : 0) || mercPower(b, state) - mercPower(a, state));
  if (!cands.length) { toast('미배치 인원이 없습니다.', 'bad'); return; }

  const sx = (i) => {
    const s = f.slots[i];
    return s && s.x != null ? s.x : 0.5;
  };

  let placedCount = 0;
  for (const m of cands) {
    if (!empty.length) break;
    const c = getClass(m.classId) || {};
    const want = c.rank === 2 ? 1 : 0;             // 후열형은 x=1 쪽, 전열형은 x=0 쪽
    let best = 0;
    for (let k = 1; k < empty.length; k++) {
      if (Math.abs(sx(empty[k]) - want) < Math.abs(sx(empty[best]) - want)) best = k;
    }
    const idx = empty.splice(best, 1)[0];
    if (addToSquad(state, sq.id, m.uid, idx).ok) placedCount++;
  }

  picked = null;
  if (placedCount) { save(); toast(`${placedCount}명을 자동 배치했습니다.`, 'good'); }
  else toast('배치할 수 있는 인원이 없습니다.', 'bad');
  redraw();
}

function clearSquad() {
  const sq = currentSquad();
  if (!sq) return;
  const ms = squadMembers(state, sq.id);
  if (!ms.length) { toast('배치된 용병이 없습니다.', 'bad'); return; }
  confirmBox('전원 해제', `${sq.name}의 ${ms.length}명을 모두 미배치로 되돌립니다.`, () => {
    for (const m of ms) removeFromSquad(state, sq.id, m.uid);
    picked = null;
    save();
    toast(`${ms.length}명을 부대에서 뺐습니다.`, 'good');
    redraw();
  }, '전원 해제');
}

function dropOnSlot(sq, index) {
  if (!drag) return;
  const payload = drag;
  drag = null;
  let r;
  if (payload.kind === 'slot') r = swapSlots(state, sq.id, payload.index, index);
  else r = addToSquad(state, sq.id, payload.uid, index);
  toast(r.reason, r.ok ? 'good' : 'bad');
  if (r.ok) { save(); redraw(); }
}

/* ─────────────────────────── 부대 합계 ─────────────────────────── */

function squadTotals(sq) {
  const f = getFormation(sq.formationId) || getFormation('basic');
  const slots = squadSlots(state, sq.id);
  const raw = {}; const fin = {};
  for (const k of STAT_KEYS) { raw[k] = 0; fin[k] = 0; }
  let n = 0;
  slots.forEach((m, i) => {
    if (!m) return;
    n++;
    const c = getClass(m.classId) || {};
    const s = mercStats(m, state);
    const mods = f ? formationMods(f, i, { arch: c.arch, classId: m.classId }) : {};
    const t = scaleStats(s, mods);
    for (const k of STAT_KEYS) { raw[k] += s[k] || 0; fin[k] += t[k] || 0; }
  });
  return { raw, fin, n };
}

function totalsPanel() {
  const sq = currentSquad();
  const panel = el('div', { class: 'panel col co-totals' }, el('h3', { text: '부대 전력' }));
  if (!sq) { panel.appendChild(el('div', { class: 'muted tiny', text: '선택된 부대가 없습니다.' })); return panel; }

  const { raw, fin, n } = squadTotals(sq);
  const members = squadMembers(state, sq.id);
  const avgLv = n ? Math.round(members.reduce((a, m) => a + (m.level || 1), 0) / n) : 0;

  panel.appendChild(el('div', { class: 'row wrap', style: { gap: '18px' } },
    kv('총 전투력', num(squadPower(state, sq.id)), 'var(--gold)'),
    kv('인원', `${n} / ${SQUAD_SIZE}`),
    kv('평균 레벨', avgLv ? `Lv${avgLv}` : '—'),
    kv('하루 임금', `${num(squadUpkeep(state, sq.id))}G`)));

  if (!n) { panel.appendChild(el('div', { class: 'tiny faint', text: '배치된 용병이 없습니다.' })); return panel; }

  const table = el('table', { class: 'data tiny' },
    el('thead', {}, el('tr', {},
      el('th', { text: '스탯' }), el('th', { text: '진형 전' }),
      el('th', { text: '진형 보정' }), el('th', { text: '적용 후' }))));
  const tb = el('tbody', {});
  for (const k of STAT_KEYS) {
    const isAvg = AVG_KEYS.includes(k);
    const a = isAvg ? raw[k] / n : raw[k];
    const b = isAvg ? fin[k] / n : fin[k];
    tb.appendChild(el('tr', {},
      el('td', {}, STAT_LABEL[k], isAvg ? el('span', { class: 'faint tiny', text: ' (평균)' }) : null),
      el('td', { class: 'num muted', text: fmtStat(k, a) }),
      el('td', {}, statDelta(k, b - a)),
      el('td', { class: 'num', style: { fontWeight: '700' }, text: fmtStat(k, b) })));
  }
  table.appendChild(tb);
  panel.appendChild(xs(table));
  panel.appendChild(el('div', { class: 'tiny faint', text: `체력·공격·방어·저항은 합계, 속도·치명·치명피해·회피는 ${n}명 평균입니다.` }));
  return panel;
}

const kv = (k, v, color) => el('div', { class: 'col', style: { gap: '0' } },
  el('span', { class: 'tiny faint', text: k }),
  el('b', { class: 'num', style: color ? { color, fontSize: '17px' } : { fontSize: '17px' }, text: v }));

/* ─────────────────────────── 로스터 ─────────────────────────── */

function rosterPanel() {
  const panel = el('div', {
    class: 'panel col co-roster',
    onDragOver: (e) => { if (drag && drag.kind === 'slot') { e.preventDefault(); panel.classList.add('co-drop'); } },
    onDragLeave: () => panel.classList.remove('co-drop'),
    onDrop: (e) => {
      panel.classList.remove('co-drop');
      if (!drag || drag.kind !== 'slot') return;
      e.preventDefault();
      stopDragScroll();
      const r = removeFromSquad(state, selectedSquadId, drag.uid);
      drag = null;
      toast(r.reason, r.ok ? 'good' : 'bad');
      if (r.ok) { save(); redraw(); }
    },
  });

  const list = filteredRoster();
  const nf = activeFilterCount();
  panel.appendChild(el('div', { class: 'row spread center wrap', style: { gap: '10px' } },
    el('h3', { class: 'panel-title', text: `단원 명부 — ${list.length}명 표시`, style: { margin: '0' } }),
    // 폰에서는 필터가 7줄까지 넘쳐 명부를 밀어낸다 — 접이식으로 만든다 (PC 에서는 이 버튼이 안 보인다)
    el('button', {
      class: `btn sm co-ftoggle${nf ? ' primary' : ' ghost'}`,
      onClick: () => { filtersOpen = !filtersOpen; redraw(); },
    }, filtersOpen ? '필터 접기' : (nf ? `필터·정렬 (${nf})` : '필터·정렬')),
    filterBar()));

  // 정원 표시 + 확장 (요청 3)
  panel.appendChild(rosterCapRow());
  // 다중 선택 / 일괄 해고 (요청 4)
  if (state.roster.length) panel.appendChild(dismissBar(list));

  if (picked && picked.type === 'slot') {
    panel.appendChild(el('div', {
      class: 'tiny',
      style: { color: 'var(--gold)', fontWeight: '700' },
      text: `▲ ${picked.index + 1}번 자리에 넣을 용병을 아래에서 고르세요.`,
    }));
  } else if (picked && picked.type === 'merc') {
    panel.appendChild(el('div', {
      class: 'tiny',
      style: { color: 'var(--gold)', fontWeight: '700' },
      text: '▲ 위 편성판에서 자리를 고르세요. (Esc로 취소)',
    }));
  }

  if (!state.roster.length) {
    panel.appendChild(el('div', { class: 'muted', text: '단원이 없습니다. 주점에서 용병을 고용하세요.' }));
    return panel;
  }
  if (!list.length) {
    panel.appendChild(el('div', { class: 'muted', text: '조건에 맞는 단원이 없습니다.' }));
    return panel;
  }

  const cards = el('div', { class: 'cards' });
  for (const m of list) cards.appendChild(rosterCard(m));
  panel.appendChild(cards);
  panel.appendChild(el('div', {
    class: 'tiny faint',
    text: short(
      '카드를 누르면 선택되고 화면이 편성판으로 올라갑니다 — 거기서 칸을 누르면 배치됩니다. [배치]는 빈 자리에 바로 넣고, 왼쪽 체크박스는 일괄 해고용입니다.',
      '카드를 누르면 선택됩니다 — 그다음 편성판의 칸을 누르면 배치됩니다. [배치] 버튼은 빈 자리에 바로 넣습니다. 왼쪽 체크박스는 일괄 해고용 선택입니다. 끌어다 놓기도 됩니다(가장자리에서 화면이 자동으로 스크롤됩니다).'),
  }));
  return panel;
}

/* ── 정원 표시 + 확장 ── */

function rosterCapRow() {
  const cap = rosterCapOf();
  const n = state.roster.length;
  const full = n >= cap;
  const chk = expandRosterCheck();
  const atMax = cap >= ROSTER_CAP_MAX;
  const ratio = clamp(n / Math.max(1, cap), 0, 1);

  return el('div', { class: 'co-strip' },
    el('span', { class: 'tiny faint', style: { flex: '0 0 auto' }, text: '정원' }),
    el('b', {
      class: 'num',
      style: { flex: '0 0 auto', color: full ? 'var(--bad)' : 'var(--ink)' },
      text: `단원 ${num(n)} / ${num(cap)}`,
    }),
    el('div', { class: `co-cap${full ? ' full' : ''}`, title: `${n}명 / 정원 ${cap}명` },
      el('i', { style: { width: `${ratio * 100}%` } })),
    el('span', {
      class: 'tiny faint',
      style: { flex: '0 0 auto' },
      text: atMax ? `상한 ${ROSTER_CAP_MAX}명 도달` : `상한 ${ROSTER_CAP_MAX}명`,
    }),
    el('button', {
      class: `btn sm${chk.ok ? ' primary' : ''}`,
      style: { flex: '0 0 auto' },
      disabled: !chk.ok,
      title: atMax
        ? `정원 상한(${ROSTER_CAP_MAX}명)에 도달했다.`
        : (chk.ok ? `${num(chk.cost)}G를 내고 정원을 ${chk.nextCap}명으로 늘린다` : (chk.reason || '정원을 늘릴 수 없습니다.')),
      onClick: askExpandRoster,
    }, atMax
      ? `정원 상한 (${ROSTER_CAP_MAX}명)`
      : `정원 확장 +${ROSTER_CAP_STEP} (${Number.isFinite(chk.cost) ? `${num(chk.cost)}G` : '—'})`),
    full ? el('span', { class: 'tiny', style: { color: 'var(--bad)', fontWeight: '700', flexBasis: '100%' }, text: '정원이 가득 찼습니다. 정원을 넓히거나 단원을 해고해야 새로 고용할 수 있습니다.' }) : null);
}

function askExpandRoster() {
  const cap = rosterCapOf();
  if (cap >= ROSTER_CAP_MAX) { toast(`정원 상한(${ROSTER_CAP_MAX}명)에 도달했다.`, 'bad'); return; }
  const chk = expandRosterCheck();
  const gold = Math.round(state.gold || 0);
  const line = (k, v, color) => el('div', { class: 'row spread center tiny' },
    el('span', { class: 'faint', text: k }),
    el('b', { class: 'num', style: color ? { color } : {}, text: v }));

  modal({
    title: '단원 정원 확장',
    body: el('div', { class: 'col co-mbody' },
      el('div', { class: 'tiny muted', text: `숙소를 넓혀 단원을 ${ROSTER_CAP_STEP}명 더 받는다. 확장할수록 값이 가파르게 오른다.` }),
      el('div', { class: 'co-eq col', style: { gap: '4px' } },
        line('정원', `${cap}명 → ${chk.nextCap}명`, 'var(--gold)'),
        line('확장 비용', Number.isFinite(chk.cost) ? `${num(chk.cost)}G` : '—'),
        line('보유 골드', `${num(gold)}G`),
        line('확장 후 잔액', `${num(gold - (Number.isFinite(chk.cost) ? chk.cost : 0))}G`,
          gold < chk.cost ? 'var(--bad)' : ''),
        line('상한', `${ROSTER_CAP_MAX}명`)),
      chk.ok ? null : el('div', { class: 'tiny', style: { color: 'var(--bad)', fontWeight: '700' }, text: chk.reason })),
    actions: [
      { label: '취소', kind: 'ghost' },
      {
        label: Number.isFinite(chk.cost) ? `${num(chk.cost)}G 지불하고 확장` : '확장',
        kind: 'primary',
        act: () => {
          const now = expandRosterCheck();
          if (!now.ok) { toast(now.reason || '정원을 늘릴 수 없습니다.', 'bad'); return false; }
          const f = fnOf(StateAPI, 'expandRosterCap');
          let r;
          if (f) {
            r = f(state) || { ok: false, reason: '정원 확장에 실패했습니다.' };
          } else {
            // 폴백: state.js 에 확장 API가 없으면 여기서 직접 처리한다
            addGold(-now.cost);
            state.rosterCap = now.nextCap;
            addLog(`숙소를 넓혔다. 단원 정원이 ${now.nextCap}명이 되었다. (-${num(now.cost)}G)`);
            r = { ok: true, reason: `정원이 ${now.nextCap}명으로 늘었다.` };
          }
          if (!r.ok) { toast(r.reason, 'bad'); return false; }
          save();
          toast(r.reason, 'good');
          redraw();
          return true;
        },
      },
    ],
  });
}

/* ── 다중 선택 / 일괄 해고 ── */

/** 지금 명부에 보이는 목록 중 선택 가능한(= 배치 규칙을 통과한) 단원 */
function selectableIn(list) {
  return list.filter((m) => includeDeployed || !m.squadId);
}

function markedMercs() {
  pruneMarked();
  return [...marked].map(mercOf).filter(Boolean);
}

function dismissBar(list) {
  const sel = markedMercs();
  const upkeep = sel.reduce((a, m) => a + GameState.upkeepOfMerc(m, state), 0);
  const inSquad = sel.filter((m) => m.squadId).length;
  const pool = selectableIn(list);

  const setAll = (ms) => {
    if (!ms.length) { toast('조건에 맞는 단원이 없습니다.', 'bad'); return; }
    for (const m of ms) marked.add(m.uid);
    redraw();
  };

  return el('div', { class: 'co-strip' },
    el('b', {
      style: { flex: '0 0 auto', color: sel.length ? 'var(--bad)' : 'var(--ink-faint)' },
      text: `해고 선택 ${sel.length}명`,
    }),
    sel.length
      ? el('span', { class: 'tiny faint num', style: { flex: '0 0 auto' }, text: `임금 −${num(upkeep)}G/일` })
      : null,
    inSquad
      ? el('span', { class: 'tag', style: { color: 'var(--bad)', flex: '0 0 auto' }, text: `배치 인원 ${inSquad}명 포함` })
      : null,
    el('span', { style: { flex: '1 1 auto' } }),
    el('button', {
      class: 'btn sm ghost',
      title: '지금 명부에 보이는 F·E등급을 전부 고른다 (부대에 배치된 인원은 제외)',
      onClick: () => setAll(pool.filter((m) => m.grade === 'F' || m.grade === 'E')),
    }, 'F·E등급 전부 선택'),
    el('button', {
      class: 'btn sm ghost',
      title: '지금 명부에 보이는 미배치 인원을 전부 고른다',
      onClick: () => setAll(list.filter((m) => !m.squadId)),
    }, '미배치 전부 선택'),
    el('button', {
      class: 'btn sm ghost',
      disabled: !sel.length,
      onClick: () => { marked.clear(); redraw(); },
    }, '선택 해제'),
    el('label', {
      class: 'co-chk tiny',
      title: '실수로 주력을 잘라내지 않도록, 부대에 배치된 용병은 기본적으로 선택할 수 없다. 켜야만 체크할 수 있다.',
    },
      checkbox(includeDeployed, (v) => { includeDeployed = v; pruneMarked(); redraw(); }),
      '배치 인원도 선택'),
    el('button', {
      class: 'btn sm danger',
      disabled: !sel.length,
      title: sel.length ? `${sel.length}명을 해고한다` : '해고할 단원을 먼저 고르세요',
      onClick: () => askDismissMany(sel),
    }, `선택 해고 (${sel.length}명)`));
}

function filterBar() {
  const usedClasses = [...new Set(state.roster.map((m) => m.classId))]
    .map((id) => getClass(id)).filter(Boolean)
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, 'ko'));
  const usedGrades = GRADES.filter((g) => state.roster.some((m) => m.grade === g));
  const usedTiers = [1, 2, 3, 4].filter((t) => state.roster.some((m) => (getClass(m.classId)?.tier || 1) === t));
  // 고른 차수가 더 이상 명부에 없으면(전멸·해고·전직) 선택을 비워 목록이 통째로 사라지지 않게 한다.
  if (rosterFilter.tier && !usedTiers.includes(Number(rosterFilter.tier))) rosterFilter.tier = '';
  // 고른 부대가 해산됐으면 선택을 비운다 (안 그러면 명부가 통째로 빈 채로 남는다)
  if (rosterFilter.squadId && rosterFilter.squadId !== '__none'
    && !state.squads.some((s) => s.id === rosterFilter.squadId)) rosterFilter.squadId = '';

  const mk = (opts, value, onchange) => {
    const s = el('select', { class: 'co-in', onChange: (e) => { onchange(e.target.value); redraw(); } });
    for (const [v, label] of opts) s.appendChild(el('option', { value: v, selected: v === value, text: label }));
    return s;
  };

  return el('div', { class: `row wrap center co-filters${filtersOpen ? ' open' : ''}`, style: { gap: '6px' } },
    mk([['', '전체 클래스'], ...usedClasses.map((c) => [c.id, `${c.name} (${TIER_NAME[c.tier] || `${c.tier}차`})`])],
      rosterFilter.classId, (v) => { rosterFilter.classId = v; }),
    // 차수 필터 — 2개 이상 차수가 섞여 있을 때만 띄운다 (초반엔 전부 1차라 무의미).
    usedTiers.length > 1
      ? mk([['', '전체 차수'], ...usedTiers.map((t) => [String(t), TIER_NAME[t]])],
        rosterFilter.tier, (v) => { rosterFilter.tier = v; })
      : null,
    mk([['', '전체 등급'], ...usedGrades.map((g) => [g, `${g} 등급`])],
      rosterFilter.grade, (v) => { rosterFilter.grade = v; }),
    // 부대 필터 — 부대가 2개 이상일 때만. 40명 명부에서 "이 부대 사람만" 보려는 요구가 흔하다.
    state.squads.length > 1
      ? mk([['', '전체 부대'],
        ...state.squads.map((s) => [s.id, `${s.name} (${s.memberUids.filter(Boolean).length}명)`]),
        ['__none', '미배치']],
      rosterFilter.squadId, (v) => { rosterFilter.squadId = v; })
      : null,
    mk([['power', '전투력순'], ['level', '레벨순'], ['tier', '차수순'], ['grade', '등급순'], ['name', '이름순'], ['squad', '부대순'], ['promote', '전직 가능 우선']],
      rosterFilter.sort, (v) => { rosterFilter.sort = v; }),
    el('button', {
      class: `btn sm${rosterFilter.hideWounded ? ' primary' : ' ghost'}`,
      onClick: () => { rosterFilter.hideWounded = !rosterFilter.hideWounded; redraw(); },
    }, '부상 제외'),
    el('button', {
      class: `btn sm${rosterFilter.onlyFree ? ' primary' : ' ghost'}`,
      onClick: () => { rosterFilter.onlyFree = !rosterFilter.onlyFree; redraw(); },
    }, '미배치만'),
    // 전직 가능한 단원만 — 명부가 20~40명이 되면 ★ 표시를 눈으로 훑어 찾기가 힘들다.
    // 인원 수를 버튼에 박아 두어 목록을 열지 않고도 "지금 전직할 사람이 있나"를 알 수 있게 한다.
    (() => {
      const n = state.roster.filter(promotable).length;
      return el('button', {
        class: `btn sm${rosterFilter.onlyPromotable ? ' primary' : (n ? '' : ' ghost')}`,
        style: n && !rosterFilter.onlyPromotable ? { borderColor: 'var(--gold-dim)', color: 'var(--gold)' } : {},
        disabled: !n && !rosterFilter.onlyPromotable,
        title: n ? `전직 가능한 단원 ${n}명만 보기` : '지금 전직할 수 있는 단원이 없다',
        onClick: () => { rosterFilter.onlyPromotable = !rosterFilter.onlyPromotable; redraw(); },
      }, n ? `★ 전직 가능 ${n}` : '★ 전직 가능 0');
    })());
}

function filteredRoster() {
  const gi = (g) => GRADES.indexOf(g);
  const tierOf = (m) => getClass(m.classId)?.tier || 1;
  let list = state.roster.filter((m) => {
    if (rosterFilter.classId && m.classId !== rosterFilter.classId) return false;
    if (rosterFilter.tier && String(tierOf(m)) !== rosterFilter.tier) return false;
    if (rosterFilter.grade && m.grade !== rosterFilter.grade) return false;
    if (rosterFilter.hideWounded && isWounded(m, state.day)) return false;
    if (rosterFilter.onlyFree && m.squadId) return false;
    if (rosterFilter.onlyPromotable && !promotable(m)) return false;
    if (rosterFilter.squadId === '__none' && m.squadId) return false;
    if (rosterFilter.squadId && rosterFilter.squadId !== '__none' && m.squadId !== rosterFilter.squadId) return false;
    return true;
  });
  const by = {
    power: (a, b) => mercPower(b, state) - mercPower(a, state),
    level: (a, b) => (b.level || 1) - (a.level || 1) || gi(b.grade) - gi(a.grade),
    tier: (a, b) => tierOf(b) - tierOf(a) || (b.level || 1) - (a.level || 1) || mercPower(b, state) - mercPower(a, state),
    grade: (a, b) => gi(b.grade) - gi(a.grade) || (b.level || 1) - (a.level || 1),
    name: (a, b) => String(a.name).localeCompare(String(b.name), 'ko'),
    // 부대 순서 → 슬롯 번호. 부대별로 묶여 보이고, 미배치는 맨 뒤로 간다.
    squad: (a, b) => {
      const idx = (m) => (m.squadId ? state.squads.findIndex((s) => s.id === m.squadId) : 99);
      return idx(a) - idx(b) || (a.slotIndex ?? 9) - (b.slotIndex ?? 9)
        || mercPower(b, state) - mercPower(a, state);
    },
    // 전직 가능한 단원을 맨 위로. 필터로 걸러내지 않고 명부 전체를 보면서
    // 전직 대상만 먼저 처리하고 싶을 때 쓴다.
    promote: (a, b) => (promotable(b) ? 1 : 0) - (promotable(a) ? 1 : 0)
      || (b.level || 1) - (a.level || 1) || mercPower(b, state) - mercPower(a, state),
  };
  list = list.slice().sort(by[rosterFilter.sort] || by.power);
  return list;
}

/** 명부 카드 클릭 = 선택 (자리를 먼저 골라 뒀다면 곧바로 그 자리에 배치) */
function onRosterClick(m) {
  const sq = currentSquad();
  if (picked && picked.type === 'slot') {
    if (!sq) { picked = null; redraw(); return; }
    const idx = picked.index;
    picked = null;
    const r = addToSquad(state, sq.id, m.uid, idx);
    toast(r.reason, r.ok ? 'good' : 'bad');
    if (r.ok) save();
    redraw();
    return;
  }
  if (picked && picked.type === 'merc' && picked.uid === m.uid) { picked = null; redraw(); return; }
  const inCur = !!(sq && m.squadId === sq.id);
  picked = { type: 'merc', uid: m.uid, from: inCur ? 'slot' : 'roster', index: inCur ? m.slotIndex : -1 };
  redraw();
  // 폰에서는 명부가 편성판 아래에 있다 — 용병을 고르면 편성판까지 데려다 준다
  scrollToBoard();
}

function rosterCard(m) {
  const c = getClass(m.classId) || { name: m.classId, role: '', tier: 1 };
  const st = mercStats(m, state);
  const hpRatio = clamp((m.hp || st.hp) / Math.max(1, st.hp), 0, 1);
  const wounded = isWounded(m, state.day);
  const sq = m.squadId ? state.squads.find((s) => s.id === m.squadId) : null;
  const cur = currentSquad();
  const inCur = !!(cur && m.squadId === cur.id);
  const promo = canPromote(m);
  const isPicked = !!(picked && picked.type === 'merc' && picked.uid === m.uid);
  const slotWaiting = !!(picked && picked.type === 'slot');

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  // 주 버튼: 상황에 따라 배치 / 이 자리에 / 데려오기 / 제외
  let mainBtn = null;
  if (!cur) {
    mainBtn = el('button', { class: 'btn sm', disabled: true }, '부대 없음');
  } else if (slotWaiting) {
    mainBtn = el('button', {
      class: 'btn sm primary',
      onClick: stop(() => onRosterClick(m)),
    }, `${picked.index + 1}번 자리에`);
  } else if (inCur) {
    mainBtn = el('button', {
      class: 'btn sm ghost danger',
      onClick: stop(() => {
        const r = removeFromSquad(state, cur.id, m.uid);
        if (isPicked) picked = null;
        toast(r.reason, r.ok ? 'good' : 'bad');
        if (r.ok) save();
        redraw();
      }),
    }, '제외');
  } else {
    mainBtn = el('button', {
      class: 'btn sm primary',
      onClick: stop(() => placeToFirstEmpty(m.uid)),
    }, sq ? '데려오기' : '배치');
  }

  // 일괄 해고용 체크박스. 배치된 용병은 [배치 인원도 선택]을 켜야 열린다.
  const lockedForDismiss = !!m.squadId && !includeDeployed;
  const isMarked = marked.has(m.uid);
  const cb = checkbox(isMarked, (v) => {
    if (v) marked.add(m.uid); else marked.delete(m.uid);
    redraw();
  }, {
    disabled: lockedForDismiss,
    title: lockedForDismiss
      ? '부대에 배치된 용병입니다. 위의 [배치 인원도 선택]을 켜야 고를 수 있습니다.'
      : '해고 대상으로 고른다',
  });

  // 22px 체크박스는 손끝보다 작다 — 투명한 여백(label)을 둘러 실제 탭 영역만 40px로 넓힌다.
  // label 이라 여백을 눌러도 안쪽 체크박스가 토글되고, 카드 선택으로는 새지 않는다.
  const cbBox = el('label', { class: 'co-cbwrap', onClick: (e) => e.stopPropagation() }, cb);

  const card = el('div', {
    class: `card co-rcard${isPicked ? ' picked' : ''}${slotWaiting ? ' can' : ''}${isMarked ? ' marked' : ''}`,
    draggable: dragEnabled() ? 'true' : false,
    title: '클릭하면 선택 — 그다음 편성판의 칸을 누르세요',
    onDragStart: (e) => {
      if (!dragEnabled()) { e.preventDefault(); return; }
      drag = { kind: 'roster', uid: m.uid, index: -1 };
      card.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', m.uid); e.dataTransfer.effectAllowed = 'move'; } catch { /* noop */ }
    },
    onDragEnd: () => { card.classList.remove('dragging'); drag = null; stopDragScroll(); },
    onClick: () => onRosterClick(m),
  },
    el('div', { class: 'row center', style: { gap: '9px' } },
      cbBox,
      miniPortrait(m),
      el('div', { class: 'col', style: { gap: '1px', minWidth: '0', flex: '1' } },
        el('div', { class: 'row spread center', style: { gap: '6px' } },
          el('b', { style: { color: gradeColor(m.grade), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: m.name }),
          el('span', { class: 'tag', style: { color: gradeColor(m.grade) }, text: m.grade })),
        // 소속 부대 — 이름 바로 아래. 아래 태그 줄에 묻어 두면 40명 명부에서 안 읽힌다.
        el('div', { style: { marginTop: '3px' } }, squadBadge(m)),
        el('div', { class: 'tiny muted', style: { marginTop: '3px' }, text: `${c.name} · Lv${m.level || 1} · ${c.role || ''}` }),
        el('div', { class: 'bar hp', style: { marginTop: '3px' } }, el('i', { style: { width: `${hpRatio * 100}%` } })))),
    el('div', { class: 'row spread center tiny', style: { marginTop: '7px' } },
      el('span', { class: 'num muted', text: `전투력 ${num(mercPower(m, state))}` }),
      el('span', { class: 'num faint', text: `${GameState.upkeepOfMerc(m, state)}G/일` })),
    el('div', { class: 'row wrap', style: { gap: '4px', marginTop: '6px' } },
      el('span', { class: 'tag', style: { color: TIER_COLOR[c.tier] || 'var(--ink-faint)' }, text: TIER_NAME[c.tier] || `${c.tier}차` }),
      wounded ? el('span', { class: 'tag', style: { color: 'var(--bad)' }, text: `부상 ~${m.woundUntil}일` }) : null,
      el('span', { class: 'tag', style: { color: c.rank === 2 ? ZONE_COLOR.back : ZONE_COLOR.front }, text: c.rank === 2 ? '후열형' : '전열형' }),
      // 소속은 카드 상단 배지로 옮겼다 (여기 두면 태그 5개에 묻힌다)
      promo ? el('span', { class: 'tag', style: { color: 'var(--gold)' }, text: '전직 가능' }) : null),
    el('div', { class: 'row', style: { gap: '5px', marginTop: '8px' } },
      mainBtn,
      el('button', { class: 'btn sm ghost', onClick: stop(() => openMercDetail(m.uid)) }, '상세')));
  return card;
}

/* ─────────────────────────── 용병 상세 ─────────────────────────── */

/**
 * 다음 전직/만렙까지의 진행 상황 한 줄.
 * 레벨업이 3배 느려졌으므로 "얼마나 남았는가"를 숫자로 보여 진행감을 만든다.
 */
function promoteProgressLine(m) {
  const need = nextPromoteLevel(m);
  if (need == null) {
    return el('div', { class: 'tiny', style: { color: 'var(--gold)' }, text: `최종 차수 도달 · Lv${m.level || 1} / ${MAX_LEVEL}` });
  }
  if (canPromote(m)) {
    return el('div', { class: 'tiny', style: { color: 'var(--gold)', fontWeight: '700' }, text: `★ 지금 전직할 수 있다 (Lv${need} 도달)` });
  }
  const tier = getClass(m.classId)?.tier || 1;
  const curTotal = expTotalTo(m.level || 1) + (m.exp || 0);
  const remain = Math.max(0, Math.round(expTotalTo(need) - curTotal));
  return el('div', { class: 'tiny faint', text: `다음 전직 ${TIER_NAME[tier + 1] || ''} (Lv${need})까지 ${num(remain)} exp 남음` });
}

/**
 * 클래스 계보 (1차 → … → 현재 → 다음 후보).
 * 105종이 되면서 자기 용병이 어느 갈래인지 알기 어려워졌다 — 현재를 강조하고 다음 갈래를 흐리게 붙인다.
 */
function lineageBlock(m) {
  const cur = getClass(m.classId);
  const chain = classChain(m.classId) || [];
  const strip = el('div', { class: 'co-lineage' });
  chain.forEach((c, i) => {
    if (i > 0) strip.appendChild(el('span', { class: 'co-lin-arrow', text: '→' }));
    const isCur = c.id === m.classId;
    strip.appendChild(el('span', {
      class: `co-lin-node${isCur ? ' cur' : ''}`,
      title: `${TIER_NAME[c.tier] || `${c.tier}차`} · ${c.role || ''}`,
    },
      el('span', { class: 'co-lin-tier', style: { color: TIER_COLOR[c.tier] || 'var(--ink-faint)' }, text: TIER_NAME[c.tier] || `${c.tier}차` }),
      c.name));
  });
  // 아직 최종 차수가 아니면 다음 후보(갈래)를 흐리게 덧붙인다
  const nexts = (cur && Array.isArray(cur.next) ? cur.next : []).map(getClass).filter(Boolean);
  if (nexts.length) {
    strip.appendChild(el('span', { class: 'co-lin-arrow', text: '→' }));
    const branch = el('span', { class: 'co-lin-branch' });
    nexts.forEach((o, i) => {
      if (i > 0) branch.appendChild(el('span', { class: 'co-lin-or', text: '/' }));
      branch.appendChild(el('span', {
        class: 'co-lin-node future',
        title: `${TIER_NAME[o.tier] || `${o.tier}차`} 후보 · ${o.role || ''}`,
      },
        el('span', { class: 'co-lin-tier', text: TIER_NAME[o.tier] || `${o.tier}차` }),
        o.name));
    });
    strip.appendChild(branch);
  }
  const tail = nexts.length ? '흐린 칸은 다음 전직 후보다.' : '최종 차수까지 도달한 계보다.';
  return el('div', { class: 'col', style: { gap: '5px' } },
    el('div', { class: 'row spread center' },
      el('h3', { class: 'panel-title', text: '클래스 계보', style: { margin: '0' } }),
      el('span', { class: 'tiny faint', text: tail })),
    strip);
}

/**
 * 단원 상세 모달. **다른 화면에서도 부를 수 있게 export 한다** (장비 화면의 단원별 표 등).
 * 내부에서 쓰는 `redraw()` 는 app.js `refresh()`(= 지금 떠 있는 화면 다시 그리기)를 부를 뿐이라
 * 용병단 화면이 안 떠 있어도 안전하다.
 */
export function openMercDetail(mercUid) {
  const m = state.roster.find((x) => x.uid === mercUid);
  if (!m) { toast('용병을 찾을 수 없습니다.', 'bad'); return; }
  const c = getClass(m.classId) || {};
  const anim = animatedSprite(mercRecipe(m, state), 3);

  const base = baseStatsOf(m);
  const gear = mercStats(m, state);
  const mods = formationModsOf(m);
  const total = withMods(gear, mods);
  const exp = expProgress(m);
  const sq = m.squadId ? state.squads.find((s) => s.id === m.squadId) : null;

  /* 좌측 — 초상 / 신상 */
  const left = el('div', { class: 'col co-dl', style: { flex: '0 0 210px', alignItems: 'center', gap: '8px' } },
    el('div', { class: 'sprite-box', style: { width: '100%', height: '132px', padding: '6px' } }, anim.canvas),
    el('div', { class: 'col center', style: { gap: '2px', textAlign: 'center' } },
      el('b', { style: { color: gradeColor(m.grade), fontSize: '16px' }, text: m.name }),
      el('div', { class: 'tiny muted', text: `${c.name || m.classId} · ${c.tier || 1}차 · ${c.role || ''}` }),
      el('div', { class: 'row center', style: { gap: '6px', justifyContent: 'center' } },
        el('span', { class: 'tag', style: { color: gradeColor(m.grade) }, text: `${m.grade} 등급` }),
        el('span', { class: 'tag', style: { color: 'var(--ink-dim)' }, text: `Lv ${m.level || 1}` }))),
    el('div', { class: 'col', style: { width: '100%', gap: '3px' } },
      el('div', { class: 'row spread tiny faint' },
        el('span', { text: `경험치 · Lv${m.level || 1} / ${MAX_LEVEL}` }),
        el('span', { class: 'num', text: exp.max ? '최대 레벨' : `${num(exp.cur)} / ${num(exp.need)}` })),
      el('div', { class: 'bar exp' }, el('i', { style: { width: `${exp.ratio * 100}%` } })),
      promoteProgressLine(m)),
    el('div', { class: 'tiny faint col center', style: { gap: '1px', textAlign: 'center' } },
      el('div', { text: sq ? `${sq.name} ${m.slotIndex + 1}번 자리` : '미배치' }),
      el('div', { text: `일당 ${num(GameState.upkeepOfMerc(m, state))}G · 고용 ${num(m.hiredDay || 1)}일차` }),
      el('div', { text: `전투 ${num(m.battles || 0)}회 · 처치 ${num(m.kills || 0)}` }),
      isWounded(m, state.day) ? el('div', { style: { color: 'var(--bad)' }, text: `부상 — ${num(m.woundUntil)}일차 회복` }) : null),
    promoteBlock(m, () => { anim.stop(); }));

  /* 우측 — 계보 / 스탯 / 스킬 / 장비 */
  const right = el('div', { class: 'col co-dr', style: { flex: '1 1 380px', minWidth: '340px' } },
    lineageBlock(m),
    statTable(base, gear, total, mods),
    skillBlock(c),
    equipBlock(m, () => anim.stop()),
    setBlock(m));

  modal({
    /* 이름 옆에 바로 수정 아이콘을 단다.
     * 예전에는 하단 액션에 «이름 변경» 이 있었는데, 이름을 고치러 모달 끝까지 내려가야 했다. */
    title: el('span', { class: 'row center', style: { gap: '8px', flexWrap: 'wrap' } },
      el('span', { text: `${m.name} — ${c.name || m.classId}` }),
      el('button', {
        class: 'btn sm ghost co-rename',
        title: '이름 변경',
        'aria-label': '이름 변경',
        // 모달 안에서 모달을 바로 열면 바깥 모달이 닫히며 같이 사라진다 — 다음 틱으로 미룬다
        onClick: () => { anim.stop(); setTimeout(() => renameMerc(m), 0); },
      }, '✎')),
    wide: true,
    body: el('div', { class: 'row wrap co-mbody', style: { alignItems: 'flex-start', gap: '16px' } }, left, right),
    onClose: () => anim.stop(),
    actions: [
      { label: '해고', kind: 'ghost danger', act: () => { anim.stop(); setTimeout(() => askDismiss(m), 0); } },
      { label: '닫기', kind: '' },
    ],
  });
}

function statTable(base, gear, total, mods) {
  const table = el('table', { class: 'data tiny' },
    el('thead', {}, el('tr', {},
      el('th', { text: '스탯' }), el('th', { text: '소재' }),
      el('th', { text: '장비' }), el('th', { text: '진형' }), el('th', { text: '최종' }))));
  const tb = el('tbody', {});
  for (const k of STAT_KEYS) {
    tb.appendChild(el('tr', {},
      el('td', { text: STAT_LABEL[k] }),
      el('td', { class: 'num faint', text: fmtStat(k, base[k] || 0) }),
      el('td', {}, statDelta(k, (gear[k] || 0) - (base[k] || 0))),
      el('td', {}, statDelta(k, (total[k] || 0) - (gear[k] || 0))),
      el('td', { class: 'num', style: { fontWeight: '700' }, text: fmtStat(k, total[k] || 0) })));
  }
  table.appendChild(tb);
  const modKeys = Object.keys(mods || {});
  return el('div', { class: 'col', style: { gap: '5px' } },
    el('div', { class: 'row spread center' },
      el('h3', { class: 'panel-title', text: '최종 스탯', style: { margin: '0' } }),
      el('span', {
        class: 'tiny faint',
        text: modKeys.length ? `진형 보정: ${modKeys.map((k) => `${STAT_LABEL[k]} ${mods[k] > 0 ? '+' : ''}${Math.round(mods[k] * 100)}%`).join(', ')}` : '진형 보정 없음',
      })),
    xs(table));
}

function skillBlock(c) {
  const box = el('div', { class: 'col', style: { gap: '6px' } },
    el('h3', { class: 'panel-title', text: '보유 스킬', style: { margin: '0' } }));
  const basicName = { phys: '물리', magic: '마법', none: '무속성' }[c.dmgType] || '물리';
  box.appendChild(el('div', { class: 'co-eq col', style: { gap: '2px' } },
    el('div', { class: 'row spread center' },
      el('b', { text: '기본 공격' }),
      el('span', { class: 'tiny faint', text: `${c.range === 'ranged' ? '원거리' : '근접'} · ${basicName}` })),
    el('div', { class: 'tiny muted', text: '쿨다운이 남았을 때 자동으로 사용하는 평타. 배율 1.0배.' })));
  for (const sid of c.skills || []) {
    const s = getSkill(sid);
    if (!s) continue;
    box.appendChild(el('div', { class: 'co-eq col', style: { gap: '2px' } },
      el('div', { class: 'row spread center wrap', style: { gap: '6px' } },
        el('b', { style: { color: 'var(--gold)' }, text: s.name }),
        el('span', { class: 'tiny faint num', text: `쿨 ${s.cd}초 · 배율 x${s.power} · ${s.range === 'ranged' ? '원거리' : '근접'}` })),
      el('div', { class: 'tiny muted', text: s.desc || '' }),
      s.effects && s.effects.length
        ? el('div', { class: 'row wrap', style: { gap: '4px' } },
          s.effects.map((ef) => el('span', { class: 'tag', style: { color: 'var(--arcane)' }, text: effectLabel(ef) })))
        : null));
  }
  return box;
}

function effectLabel(ef) {
  const st = STAT_LABEL[ef.stat] || ef.stat || '';
  switch (ef.type) {
    case 'heal': return `회복 x${ef.power}`;
    case 'buff': return `${st} +${Math.round((ef.amount || 0) * 100)}% (${ef.dur}초)`;
    case 'debuff': return `${st} ${Math.round((ef.amount || 0) * 100)}% (${ef.dur}초)`;
    case 'dot': return `지속피해 x${ef.power} (${ef.dur}초)`;
    case 'shield': return `보호막 x${ef.power} (${ef.dur}초)`;
    case 'stun': return `기절 ${ef.dur}초 (${Math.round((ef.chance || 1) * 100)}%)`;
    case 'lifesteal': return `흡혈 ${Math.round((ef.ratio || 0) * 100)}%`;
    case 'execute': return `처형 (HP ${Math.round((ef.threshold || 0) * 100)}% 이하)`;
    case 'counter': return `반격 ${Math.round((ef.ratio || 0) * 100)}%`;
    default: return ef.type || '';
  }
}

/**
 * 10슬롯 장비창 (설계 A). 사람 실루엣처럼 배치한다 —
 * 머리 위 / 목·상의 가운데 / 양손 좌우 / 하의·신발 아래 / 반지 옆.
 * 양손 무기를 들면 왼손 칸은 잠긴 채 "양손무기 — 왼손 사용 불가" 로 표시된다.
 */
function equipBlock(m, stopAnim) {
  const worn = equippedItems(state, m);
  const locked = offhandLockedOf(m);
  const max = equippableSlotCountOf(m);
  const filled = SLOTS.filter((s) => worn[s]).length;

  const box = el('div', { class: 'col', style: { gap: '6px' } },
    el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
      el('h3', { class: 'panel-title', text: '장비', style: { margin: '0' } }),
      el('div', { class: 'row center wrap', style: { gap: '7px' } },
        el('span', {
          class: 'tiny num',
          style: { color: filled >= max ? 'var(--gold)' : 'var(--ink-faint)' },
          text: `${filled} / ${max}칸`,
        }),
        el('button', { class: 'btn sm ghost', onClick: () => { stopAnim(); closeModalLayer(); go('inventory'); } }, '장비 화면'),
        el('button', { class: 'btn sm ghost', onClick: () => { stopAnim(); closeModalLayer(); go('pets'); } }, '펫 관리'))));

  if (locked) {
    const w = worn.weapon;
    box.appendChild(el('div', { class: 'co-lock tiny' },
      el('b', { text: '양손무기 — 왼손 사용 불가' }),
      ` · ${w ? w.name : '양손 무기'}${josa(w ? w.name : '양손 무기', '을/를')} 들고 있어 왼손 칸이 잠겼습니다. 이 용병은 ${max}칸이 풀세트입니다.`));
  }

  const doll = el('div', { class: 'co-doll' });
  for (const slot of SLOTS) doll.appendChild(equipTile(m, slot, worn[slot], locked, stopAnim));
  box.appendChild(doll);
  box.appendChild(el('div', { class: 'tiny faint', text: '칸을 누르면 그 부위에 낄 수 있는 장비와 스탯 변화가 뜹니다. 오른쪽 위 ×는 해제입니다.' }));
  return box;
}

/** 장비창 칸 하나 */
function equipTile(m, slot, it, locked, stopAnim) {
  const off = slot === 'offhand' && locked;
  if (off) {
    // 잠긴 칸도 누를 수는 있다 — 왜 잠겼는지와 푸는 방법(오른손 교체)을 알려 준다
    return el('div', {
      class: 'co-eqs locked',
      style: { gridArea: slot },
      title: '양손 무기를 들고 있어 왼손을 쓸 수 없습니다. 누르면 오른손을 바꿀 수 있습니다.',
      onClick: () => { stopAnim(); openOffhandLocked(m); },
    },
      el('div', { class: 'sl', text: SLOT_NAME[slot] || slot }),
      el('div', { class: 'nm', style: { color: 'var(--ink-faint)' }, text: '양손무기' }),
      el('div', { class: 'sub', text: '왼손 사용 불가' }));
  }

  const myth = isMythic(it);
  const color = it ? rColor(it) : 'var(--line)';
  const setName = it && myth ? ((setDefOfItem(it) || {}).name || it.setName || '') : '';

  const tile = el('div', {
    class: `co-eqs${it ? '' : ' empty'}${myth ? ' myth' : ''}`,
    style: { gridArea: slot, borderLeftColor: color },
    title: it ? `${it.name}\n${statLine(itemStats(it))}` : `${SLOT_NAME[slot] || slot} — 비어 있음`,
    onClick: () => { stopAnim(); openEquipPicker(m, slot); },
  },
    el('div', { class: 'sl', text: SLOT_NAME[slot] || slot }),
    it
      ? el('div', { class: 'nm', style: { color }, text: it.name })
      : el('div', { class: 'nm', style: { color: 'var(--ink-faint)', fontWeight: '400' }, text: '비어 있음' }),
    it
      ? el('div', { class: 'sub', text: setName ? `${setName} · iLv${it.ilvl || 1}` : `${rName(it)} · iLv${it.ilvl || 1}${it.weaponType ? ` · ${weaponTypeName(it.weaponType)}` : ''}` })
      : el('div', { class: 'sub', text: '누르면 장착' }));

  if (it) {
    tile.appendChild(el('button', {
      class: 'co-off',
      title: '해제',
      onClick: (e) => {
        e.stopPropagation();
        const r = unequipSlot(state, m, slot);
        toast(r.reason, r.ok ? 'good' : 'bad');
        if (r.ok) { stopAnim(); save(); redraw(); openMercDetail(m.uid); }
      },
    }, '×'));
  }
  return tile;
}

/**
 * 세트 진행도 (설계 B). 착용 중인 세트와 단계를 보여준다.
 * 달성한 단계는 밝게, 미달 단계는 흐리게. 다음 단계까지 몇 개 남았는지도 적는다.
 */
function setBlock(m) {
  const { max, sets } = setProgressOf(m);
  const box = el('div', { class: 'col', style: { gap: '6px' } },
    el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
      el('h3', { class: 'panel-title', text: '세트 효과', style: { margin: '0' } }),
      el('span', { class: 'tiny faint', text: `풀세트 기준 ${max}칸${max < SLOTS.length ? ' (양손무기)' : ''}` })));

  if (!sets.length) {
    box.appendChild(el('div', { class: 'co-setnone tiny' },
      '착용 중인 세트가 없습니다. 던전 보스가 떨어뜨리는 ',
      el('b', { style: { color: MYTHIC_COLOR }, text: '신화(세트)' }),
      ` 장비를 3칸 이상 맞추면 단계 효과가 붙습니다. (3 / 5 / 7 / 풀세트 ${max}칸)`));
    return box;
  }

  for (const e of sets) {
    const d = e.def;
    const worn = new Set(e.slots);
    const next = d.steps.find((s) => e.count < stepNeed(s.key, max)) || null;
    // 아키타입 제한 — 이 용병이 그 세트의 대상이 아니면 조용히 알려 준다 (착용을 막지는 않는다)
    const mArch = (getClass(m.classId) || {}).arch;
    const archMiss = !!(mArch && Array.isArray(d.archs) && d.archs.length && d.archs.length < 7 && !d.archs.includes(mArch));

    const pips = el('div', { class: 'co-setpips' });
    for (const s of SLOTS) {
      const isLocked = s === 'offhand' && max < SLOTS.length;
      pips.appendChild(el('div', {
        class: `co-setpip${worn.has(s) ? ' on' : ''}${isLocked ? ' lock' : ''}`,
        title: isLocked ? `${SLOT_NAME[s]} — 양손무기로 잠김` : `${SLOT_NAME[s] || s}${worn.has(s) ? ' — 착용 중' : ' — 비어 있음'}`,
        text: SLOT_NAME[s] || s,
      }));
    }

    const card = el('div', { class: 'co-set', style: { borderLeftColor: d.color } },
      el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
        el('div', { class: 'row center wrap', style: { gap: '6px' } },
          el('b', { style: { color: d.color }, text: d.name }),
          el('span', { class: 'tag', style: { color: 'var(--ink-dim)' }, text: d.archs && d.archs.length && d.archs.length < 7 ? `${d.archs.map((a) => ARCH_NAME[a] || a).join('·')} 계열` : '전 계열' })),
        el('span', {
          class: 'num',
          style: { color: d.color, fontWeight: '700' },
          text: `${e.count} / ${max}`,
        })),
      pips,
      el('div', {
        class: 'tiny',
        style: { color: next ? 'var(--gold)' : MYTHIC_GLOW, fontWeight: '700' },
        text: next
          ? `다음 단계 ${stepLabel(next.key, max)}까지 ${stepNeed(next.key, max) - e.count}개 남음`
          : '모든 단계를 발동했다 — 풀세트 완성',
      }),
      archMiss
        ? el('div', { class: 'tiny', style: { color: 'var(--ink-faint)' }, text: `※ ${d.archs.map((a) => ARCH_NAME[a] || a).join('·')} 계열을 위해 만들어진 세트다 — 이 용병은 대상이 아니다.` })
        : null);

    for (const s of d.steps) {
      const need = stepNeed(s.key, max);
      const on = e.count >= need;
      card.appendChild(el('div', { class: `co-setstep ${on ? 'on' : 'off'}` },
        el('div', { class: 'row spread center wrap', style: { gap: '6px' } },
          el('b', { class: 'tiny', style: { color: on ? 'var(--gold)' : 'var(--ink-dim)' }, text: `${on ? '✔ ' : ''}${stepLabel(s.key, max)}` }),
          el('span', { class: 'tiny faint', text: on ? '발동 중' : `${need - e.count}개 부족` })),
        s.specialName ? el('div', { class: 'tiny', style: { color: d.color, fontWeight: '700' }, text: `★ ${s.specialName}` }) : null,
        s.desc ? el('div', { class: 'tiny muted', text: s.desc }) : null,
        Object.keys(s.stats || {}).length ? el('div', { class: 'tiny faint', text: statLine(s.stats) }) : null,
        modLine(s.mods) ? el('div', { class: 'tiny faint', text: modLine(s.mods) }) : null));
    }
    box.appendChild(card);
  }
  return box;
}

function statLine(stats) {
  const parts = [];
  for (const k of STAT_KEYS) {
    const v = stats[k];
    if (!v) continue;
    parts.push(`${STAT_LABEL[k]} ${v > 0 ? '+' : ''}${PCT_KEYS.has(k) ? v : num(v)}${PCT_KEYS.has(k) ? '%' : ''}`);
  }
  return parts.join(' ') || '보정 없음';
}

/** 비율 보정 한 줄 (`공격 +12% · 방어 +20%`) */
function modLine(mods) {
  const parts = [];
  for (const k of STAT_KEYS) if (mods && mods[k]) parts.push(`${STAT_LABEL[k]} ${mods[k] > 0 ? '+' : ''}${Math.round(mods[k] * 100)}%`);
  return parts.join(' · ');
}

/**
 * 장착 후보 목록 모달.
 * 후보는 `slotAccepts` 로 고른다 — 반지처럼 후보 칸이 둘인 장비도 정확히 잡힌다.
 * 스탯 변화는 `mercStats` 로 재기 때문에 세트 단계가 바뀌면 그 효과까지 델타에 실린다.
 */
function openEquipPicker(m, slot) {
  const locked = offhandLockedOf(m);
  if (slot === 'offhand' && locked) { openOffhandLocked(m); return; }

  const before = mercStats(m, state);
  const cur = itemByUid(m.equipment && m.equipment[slot]);
  const sid0 = cur ? setIdOfItem(cur) : null;
  const max = equippableSlotCountOf(m);

  const owners = new Map();
  for (const other of state.roster) {
    if (!other.equipment) continue;
    for (const s of slotKeysOf(other.equipment)) if (other.equipment[s]) owners.set(other.equipment[s], other);
  }

  const pool = inventory(state, { slot });
  const cand = pool.filter((it) => canEquip(m, it, slot)).sort((a, b) => itemPower(b) - itemPower(a));
  const blocked = pool.filter((it) => !canEquip(m, it, slot));
  // 다른 단원이 차고 있는 같은 부위 장비 (빼앗아 올 수 있다)
  const taken = (state.items || []).filter((it) => {
    if (!it || !slotTakes(slot, it)) return false;
    const o = owners.get(it.uid);
    return o && o.uid !== m.uid && canEquip(m, it, slot);
  }).sort((a, b) => itemPower(b) - itemPower(a));

  const body = el('div', { class: 'col co-mbody' });
  body.appendChild(el('div', { class: 'tiny muted', text: `${m.name} — ${SLOT_NAME[slot] || slot} 칸에 장착할 장비를 고르세요.` }));

  // 지금 낀 장비 — 해제 + 세트가 깨지는지 경고
  if (cur) {
    const after = mercStats({ ...m, equipment: { ...m.equipment, [slot]: null } }, state);
    const setNow = sid0 ? (setCountsOf(m.equipment).get(sid0) || 0) : 0;
    body.appendChild(el('div', { class: 'co-eq col', style: { gap: '3px' } },
      el('div', { class: 'row spread center wrap', style: { gap: '8px' } },
        el('div', { class: 'col', style: { gap: '1px', minWidth: '0', flex: '1' } },
          el('div', { class: 'tiny faint', text: '현재 착용' }),
          el('div', { style: { color: rColor(cur), fontWeight: '700' }, text: cur.name })),
        el('button', {
          class: 'btn sm ghost',
          onClick: () => {
            const r = unequipSlot(state, m, slot);
            toast(r.reason, r.ok ? 'good' : 'bad');
            if (r.ok) { save(); redraw(); }
            openMercDetail(m.uid);
          },
        }, '해제')),
      sid0
        ? el('div', { class: 'tiny', style: { color: 'var(--bad)' }, text: `⚠ 벗으면 세트가 ${setNow} → ${setNow - 1}칸으로 줄어든다.` })
        : null,
      deltaRow(before, after)));
    body.appendChild(el('div', { class: 'sep' }));
  }

  const pickRow = (it, ownerName) => {
    const ghostEq = { ...m.equipment, [slot]: it.uid };
    // 양손 무기를 오른손에 끼면 왼손은 자동으로 벗겨진다 — 미리보기에도 반영한다
    const kicksOffhand = slot === 'weapon' && isTwoHanded(it) && !!(m.equipment && m.equipment.offhand);
    if (kicksOffhand) ghostEq.offhand = null;
    const after = mercStats({ ...m, equipment: ghostEq }, state);

    const sid = setIdOfItem(it);
    const nowCounts = setCountsOf(m.equipment);
    const nextCounts = setCountsOf(ghostEq);
    const setLines = [];
    for (const key of new Set([...nowCounts.keys(), ...nextCounts.keys()])) {
      const a = nowCounts.get(key) || 0;
      const b = nextCounts.get(key) || 0;
      if (a === b) continue;
      const nm = (setDefFor(key) || {}).name || key;
      setLines.push({ down: b < a, text: `${b < a ? '⚠ ' : ''}${nm} 세트 ${a} → ${b}칸` });
    }
    const kicked = kicksOffhand ? itemByUid(m.equipment.offhand) : null;
    const archWarn = setArchWarn(m, it);

    return el('div', {
      class: 'co-pick',
      style: isMythic(it) ? { borderColor: MYTHIC_COLOR } : {},
      onClick: () => {
        const r = equipItem(state, m, it, slot);
        toast(r.reason, r.ok ? 'good' : 'bad');
        if (r.ok) { save(); redraw(); }
        openMercDetail(m.uid);
      },
    },
      el('div', { class: 'col', style: { flex: '1', gap: '2px', minWidth: '0' } },
        el('div', { class: 'row center wrap', style: { gap: '5px' } },
          el('span', { style: { color: rColor(it), fontWeight: '700' }, text: it.name }),
          isMythic(it) ? el('span', { class: 'co-myth-tag', text: (setDefOfItem(it) || {}).name || '세트' }) : null),
        el('div', { class: 'tiny faint', text: `${rName(it)} · iLv${it.ilvl} · 가치 ${num(it.value || 0)}G${ownerName ? ` · ${ownerName} 착용 중` : ''}` }),
        kicked ? el('div', { class: 'tiny', style: { color: 'var(--bad)' }, text: `⚠ 양손무기 — ${kicked.name}${josa(kicked.name, '이/가')} 벗겨진다` }) : null,
        archWarn ? el('div', { class: 'tiny', style: { color: 'var(--ink-faint)' }, text: `※ ${archWarn}` }) : null,
        setLines.map((l) => el('div', {
          class: 'tiny',
          style: { color: l.down ? 'var(--bad)' : MYTHIC_GLOW, fontWeight: l.down ? '700' : '400' },
          text: l.text,
        }))),
      el('div', { class: 'row wrap', style: { gap: '6px', flex: '0 0 auto', justifyContent: 'flex-end', maxWidth: '52%' } },
        deltaChips(before, after)));
  };

  if (!cand.length) {
    body.appendChild(el('div', { class: 'muted', text: '창고에 이 부위에 낄 수 있는 장비가 없습니다.' }));
  }
  for (const it of cand) body.appendChild(pickRow(it, null));

  if (taken.length) {
    body.appendChild(el('div', { class: 'sep' }));
    body.appendChild(el('div', { class: 'tiny faint', text: '다른 단원에게서 가져오기' }));
    for (const it of taken) body.appendChild(pickRow(it, owners.get(it.uid).name));
  }

  if (blocked.length) {
    body.appendChild(el('div', { class: 'sep' }));
    body.appendChild(el('div', { class: 'tiny faint', text: '장착 불가' }));
    for (const it of blocked.slice(0, 8)) {
      body.appendChild(el('div', { class: 'tiny muted' },
        el('span', { style: { color: rColor(it) }, text: it.name }),
        ` — ${equipIssue(m, it, slot) || '알 수 없음'}`));
    }
  }

  body.appendChild(el('div', { class: 'tiny faint', style: { marginTop: '4px' }, text: `풀세트 기준 ${max}칸 · 세트 단계 효과는 개별 스탯보다 클 수 있습니다.` }));

  modal({
    title: `${SLOT_NAME[slot] || slot} 장착`,
    wide: true,
    body,
    actions: [{ label: '뒤로', kind: 'ghost', act: () => { openMercDetail(m.uid); return false; } }],
  });
}

/** 왼손이 잠겼을 때 — 양손 무기를 벗을 길만 열어 준다 */
function openOffhandLocked(m) {
  const w = itemByUid(m.equipment && m.equipment.weapon);
  modal({
    title: `${SLOT_NAME.offhand || '왼손'} — 사용 불가`,
    body: el('div', { class: 'col co-mbody', style: { gap: '9px', minWidth: 'min(400px, 78vw)' } },
      el('div', { class: 'co-lock' },
        el('b', { text: '양손무기 — 왼손 사용 불가' })),
      el('div', { class: 'tiny muted', text: `${w ? w.name : '양손 무기'}${josa(w ? w.name : '양손 무기', '은/는')} 두 손으로 잡는 무기라 왼손 칸을 쓸 수 없습니다. 오른손을 한손 무기로 바꾸면 왼손이 다시 열립니다.` }),
      el('div', { class: 'tiny faint', text: `이 용병의 풀세트 기준은 ${equippableSlotCountOf(m)}칸입니다.` })),
    actions: [
      { label: '오른손 바꾸기', kind: 'primary', act: () => { setTimeout(() => openEquipPicker(m, 'weapon'), 0); } },
      { label: '뒤로', kind: 'ghost', act: () => { openMercDetail(m.uid); return false; } },
    ],
  });
}

/** 스탯 변화 칩들 (+ 녹색 / − 붉은색) */
function deltaChips(before, after) {
  const chips = STAT_KEYS
    .filter((k) => Math.abs((after[k] || 0) - (before[k] || 0)) > 0.0001)
    .map((k) => el('span', { class: 'tiny' }, `${STAT_LABEL[k]} `, statDelta(k, (after[k] || 0) - (before[k] || 0))));
  return chips.length ? chips : el('span', { class: 'tiny faint', text: '변화 없음' });
}

/** 스탯 변화 한 줄 */
function deltaRow(before, after) {
  return el('div', { class: 'row wrap', style: { gap: '6px' } }, deltaChips(before, after));
}

/* ─────────────────────────── 전직 ─────────────────────────── */

/** 4차 클래스의 갈래: 공격형 apex / 지속·제어형 abyss. 4차가 아니면 null. */
function t4Kind(id) {
  const s = String(id || '');
  if (s.endsWith('_apex')) return 'apex';
  if (s.endsWith('_abyss')) return 'abyss';
  return null;
}

/**
 * 전직 후보의 성향 배지(라벨·색).
 * 4차는 계보 규칙상 정점(apex)/심연(abyss)으로 성격이 명확히 갈린다. 하위 차수는 아키타입으로 추정한다.
 */
function dispositionOf(cls) {
  const kind = t4Kind(cls.id);
  if (kind === 'apex') return { label: '정점 · 공격형', color: 'var(--ember)' };
  if (kind === 'abyss') return { label: '심연 · 지속·제어형', color: 'var(--arcane)' };
  switch (cls.arch) {
    case 'tank': return { label: '방어형', color: 'var(--steel)' };
    case 'healer': return { label: '지원형', color: 'var(--leaf)' };
    case 'mage': return { label: '마법 화력형', color: 'var(--arcane)' };
    case 'archer': return { label: '원거리형', color: 'var(--steel)' };
    default: return { label: '공격형', color: 'var(--ember)' };
  }
}

function promoteBlock(m, stopAnim) {
  if (canPromote(m)) {
    return el('button', {
      class: 'btn primary',
      style: { width: '100%' },
      onClick: () => { stopAnim(); openPromote(m); },
    }, '★ 전직 가능 — 상위 클래스 선택');
  }
  const need = nextPromoteLevel(m);
  if (need == null) return el('div', { class: 'tiny faint', text: '최종 차수 — 더 전직할 수 없습니다.' });
  return el('div', { class: 'tiny faint', text: `Lv${need} 달성 시 전직할 수 있습니다. (현재 Lv${m.level || 1})` });
}

function openPromote(m) {
  let opts = promoteOptionsFor(m);
  if (!opts.length) { toast('전직 후보가 없습니다.', 'bad'); return; }
  const cur = getClass(m.classId) || {};
  const targetTier = clamp((cur.tier || 1) + 1, 1, 4);
  const awaken = targetTier === 4;
  // 4차 각성은 공격형(apex)을 왼쪽, 지속·제어형(abyss)을 오른쪽으로 고정해 두 성격이 한눈에 갈리게 한다.
  // (classes.js 의 next 배열은 순서가 제각각이라 여기서 정렬한다.)
  if (awaken) opts = opts.slice().sort((a, b) => (t4Kind(a.id) === 'apex' ? 0 : 1) - (t4Kind(b.id) === 'apex' ? 0 : 1));
  const before = mercStats(m, state);
  const curSkills = new Set(cur.skills || []);
  let picked2 = null;
  const cards = [];
  const anims = [];

  const body = el('div', { class: 'col co-mbody' });
  body.appendChild(el('div', {
    class: 'tiny',
    style: { color: 'var(--bad)', fontWeight: '700' },
    text: '⚠ 전직은 되돌릴 수 없습니다. 한 번 고르면 다른 갈래는 영원히 닫힙니다.',
  }));
  if (awaken) {
    // 4차는 "각성" 급으로 연출을 강화한다 — 테두리 광 + 차수 배율(2.10배) 강조.
    body.appendChild(el('div', { class: 'co-awaken' },
      el('b', { text: `★ 각성 — ${m.name}의 4차 전직` }),
      el('div', { class: 'tiny', style: { color: 'var(--ink)' }, text: `차수 배율이 3차 ×${(TIER_MULT[2] || 1.66).toFixed(2)} → 4차 ×${(TIER_MULT[3] || 2.10).toFixed(2)} 로 뛴다. 이 선택이 이 용병의 정점이자 마지막 전직이다.` }),
      el('div', { class: 'tiny faint', text: '왼쪽 정점(공격형)은 스탯을 몰아 방어를 버리고, 오른쪽 심연(지속·제어형)은 아키타입까지 바꿔 오래 버틴다.' })));
  } else {
    body.appendChild(el('div', { class: 'tiny muted', text: `${m.name} · 현재 ${cur.name || m.classId} (${TIER_NAME[cur.tier || 1]}) → ${TIER_NAME[targetTier]}` }));
  }

  const grid = el('div', { class: 'grid co-promogrid', style: { gridTemplateColumns: `repeat(${Math.min(opts.length, 2)}, minmax(240px, 1fr))` } });
  for (const opt of opts) {
    const fake = { ...m, classId: opt.id };
    const after = mercStats(fake, state);
    const anim = animatedSprite(mercRecipe(fake, state), 2);
    anims.push(anim);

    const deltas = el('table', { class: 'data tiny' });
    const tb = el('tbody', {});
    for (const k of STAT_KEYS) {
      const d = (after[k] || 0) - (before[k] || 0);
      if (!d) continue;
      tb.appendChild(el('tr', {},
        el('td', { text: STAT_LABEL[k] }),
        el('td', { class: 'num faint', text: fmtStat(k, before[k] || 0) }),
        el('td', { text: '→' }),
        el('td', { class: 'num', text: fmtStat(k, after[k] || 0) }),
        el('td', {}, statDelta(k, d))));
    }
    deltas.appendChild(tb);

    const newSkills = (opt.skills || []).filter((s) => !curSkills.has(s)).map(getSkill).filter(Boolean);
    const disp = dispositionOf(opt);
    const isT4 = (opt.tier || 1) === 4;
    const card = el('div', {
      class: `co-promo col${isT4 ? ' awaken' : ''}`,
      onClick: () => {
        picked2 = opt.id;
        for (const cd of cards) cd.classList.remove('sel');
        card.classList.add('sel');
      },
    },
      el('div', { class: 'row center', style: { gap: '10px' } },
        el('div', { class: 'sprite-box', style: { width: '72px', height: '88px', flex: '0 0 auto' } }, anim.canvas),
        el('div', { class: 'col', style: { gap: '3px', minWidth: '0' } },
          el('div', { class: 'row center wrap', style: { gap: '6px' } },
            el('b', { style: { color: isT4 ? 'var(--gold)' : 'var(--ink)', fontSize: '15px' }, text: opt.name }),
            el('span', { class: 'co-kind', style: { color: disp.color }, text: disp.label })),
          el('div', { class: 'tiny muted', text: `${TIER_NAME[opt.tier] || `${opt.tier}차`} · ${opt.role || ''}` }),
          el('div', { class: 'tiny faint', text: `기본공격 ${opt.range === 'ranged' ? '원거리' : '근접'} · ${opt.dmgType === 'magic' ? '마법' : '물리'}` }),
          el('div', { class: 'tiny faint', text: `장착 가능: ${(opt.equip || []).map(weaponTypeName).join(', ') || '없음'}` }))),
      el('div', { class: 'tiny muted', text: opt.desc || '' }),
      xs(deltas),
      newSkills.length
        ? el('div', { class: 'col', style: { gap: '3px' } },
          el('div', { class: 'tiny faint', text: '새로 익히는 스킬' }),
          newSkills.map((s) => el('div', { class: 'tiny' },
            el('b', { style: { color: 'var(--arcane)' }, text: s.name }),
            el('span', { class: 'muted', text: ` — ${s.desc || ''}` }))))
        : el('div', { class: 'tiny faint', text: '새 스킬 없음 (기존 스킬 유지)' }));
    cards.push(card);
    grid.appendChild(card);
  }
  body.appendChild(grid);

  const stopAll = () => { for (const a of anims) a.stop(); };
  modal({
    title: '전직',
    wide: true,
    body,
    onClose: stopAll,
    actions: [
      { label: '취소', kind: 'ghost', act: () => { stopAll(); openMercDetail(m.uid); return false; } },
      {
        label: '전직 실행',
        kind: 'primary',
        act: () => {
          if (!picked2) { toast('전직할 클래스를 먼저 고르세요.', 'bad'); return false; }
          const r = promote(m, picked2);
          toast(r.reason, r.ok ? 'good' : 'bad');
          if (!r.ok) return false;
          addLog(`${m.name}${josa(m.name, '이/가')} ${getClass(picked2)?.name || picked2}${josa(getClass(picked2)?.name || picked2, '으로/로')} 전직했다.`);
          stopAll();
          save();
          redraw();
          openMercDetail(m.uid);
          return false;
        },
      },
    ],
  });
}

/* ─────────────────────────── 해고 ─────────────────────────── */

/** 단원 1명 해고 — 확인 화면은 일괄 해고와 같은 것을 쓴다 */
function askDismiss(m) {
  askDismissMany([m]);
}

/** uid 로 창고 아이템 찾기 */
function itemByUid(uid) {
  if (!uid) return null;
  return (state.items || []).find((it) => it && it.uid === uid) || null;
}

/**
 * 일괄 해고 확인.
 * **되돌릴 수 없는 조작**이므로 인원 수·이름·환급·임금 절감액을 전부 펼쳐 보여주고,
 * 부대에 배치된 인원은 따로 경고한다.
 */
function askDismissMany(mercs) {
  const list = (mercs || [])
    .map((x) => (typeof x === 'string' ? mercOf(x) : x))
    .filter((m) => m && state.roster.some((r) => r.uid === m.uid));
  if (!list.length) { toast('해고할 단원을 먼저 고르세요.', 'bad'); return; }

  const upkeep = list.reduce((a, m) => a + GameState.upkeepOfMerc(m, state), 0);
  const deployed = list.filter((m) => m.squadId);
  // 해고 환급금은 이 게임에 없다. 대신 착용 장비가 창고로 돌아온다 — 그 가치를 대신 보여준다.
  const refund = 0;
  let gearCount = 0;
  let gearValue = 0;
  for (const m of list) {
    const seen = new Set();
    for (const s of slotKeysOf(m.equipment)) {
      const u = m.equipment && m.equipment[s];
      if (!u || seen.has(u)) continue;
      seen.add(u);
      const it = itemByUid(u);
      if (!it) continue;
      gearCount++;
      gearValue += Math.round(Number(it.value) || 0);
    }
  }

  const line = (k, v, color) => el('div', { class: 'row spread center tiny' },
    el('span', { class: 'faint', text: k }),
    el('b', { class: 'num', style: color ? { color } : {}, text: v }));

  const names = el('div', { class: 'co-names' });
  for (const m of list) {
    const c = getClass(m.classId) || {};
    const sq = m.squadId ? state.squads.find((s) => s.id === m.squadId) : null;
    names.appendChild(el('div', { class: 'row center tiny', style: { gap: '6px' } },
      el('span', { class: 'tag', style: { color: gradeColor(m.grade), flex: '0 0 auto' }, text: m.grade }),
      el('b', { style: { color: gradeColor(m.grade), flex: '0 0 auto' }, text: m.name }),
      el('span', { class: 'muted', style: { flex: '1 1 auto', minWidth: '0' }, text: `${c.name || m.classId} · Lv${m.level || 1}` }),
      sq
        ? el('span', { class: 'tag', style: { color: 'var(--bad)', flex: '0 0 auto' }, text: `${sq.name} ${m.slotIndex + 1}번` })
        : el('span', { class: 'tag', style: { color: 'var(--ink-faint)', flex: '0 0 auto' }, text: '미배치' }),
      el('span', { class: 'num faint', style: { flex: '0 0 auto' }, text: `${num(m.upkeep || 0)}G/일` })));
  }

  const body = el('div', { class: 'col co-mbody' },
    el('div', {
      class: 'tiny',
      style: { color: 'var(--bad)', fontWeight: '700' },
      text: '⚠ 해고는 되돌릴 수 없습니다. 해고한 단원은 다시 데려올 수 없고, 레벨과 성장도 전부 사라집니다.',
    }),
    el('div', { class: 'co-eq col', style: { gap: '4px' } },
      line('해고 인원', `${num(list.length)}명`, 'var(--bad)'),
      line('환급', refund > 0 ? `${num(refund)}G` : '없음 (해고 위로금·환급금 없음)'),
      line('일일 임금 절감', `−${num(upkeep)}G/일`, 'var(--ok)'),
      line('회수 장비', gearCount ? `${num(gearCount)}점 (가치 ${num(gearValue)}G) — 창고로 돌아옴` : '없음')),
    deployed.length
      ? el('div', {
        class: 'tiny',
        style: {
          color: 'var(--bad)', fontWeight: '700', padding: '7px 9px', borderRadius: '6px',
          border: '1px solid var(--bad)', background: 'rgba(168,58,74,.12)',
        },
        text: `⚠ 부대에 배치된 단원 ${deployed.length}명이 포함되어 있습니다: ${deployed.map((m) => m.name).join(', ')} — 해고하면 그 자리가 빈 칸이 됩니다.`,
      })
      : null,
    el('div', { class: 'tiny faint', text: '해고 대상' }),
    names);

  modal({
    title: list.length > 1 ? `단원 ${list.length}명 해고` : '용병 해고',
    body,
    actions: [
      { label: '취소', kind: 'ghost' },
      {
        label: list.length > 1 ? `${list.length}명 해고` : '해고',
        kind: 'primary danger',
        act: () => { doDismiss(list, upkeep); return true; },
      },
    ],
  });
}

function doDismiss(list, upkeep = 0) {
  let n = 0;
  const names = [];
  for (const m of list) {
    if (m.squadId) removeFromSquad(state, m.squadId, m.uid);
    // 옛 세이브의 3슬롯 키(armor/accessory)가 남아 있을 수 있어 실제 키를 전부 훑는다
    if (m.equipment) for (const s of slotKeysOf(m.equipment)) m.equipment[s] = null;
    const i = state.roster.findIndex((x) => x.uid === m.uid);
    if (i < 0) continue;
    state.roster.splice(i, 1);
    marked.delete(m.uid);
    if (picked && picked.type === 'merc' && picked.uid === m.uid) picked = null;
    names.push(m.name);
    n++;
  }
  if (!n) { toast('해고할 단원을 찾지 못했습니다.', 'bad'); redraw(); return; }

  if (n === 1) addLog(`${names[0]}${josa(names[0])} 해고했다.`);
  else addLog(`단원 ${n}명을 해고했다. (${names.slice(0, 4).join(', ')}${n > 4 ? ` 외 ${n - 4}명` : ''}) 일일 임금 -${num(upkeep)}G`);

  save();
  toast(n === 1 ? `${names[0]}${josa(names[0])} 해고했습니다.` : `${n}명을 해고했습니다. (임금 −${num(upkeep)}G/일)`, 'good');
  redraw();
}
