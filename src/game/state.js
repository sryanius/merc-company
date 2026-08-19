// 전역 게임 상태 + 세이브/로드 + 날짜 진행 + 도시 목록(주점/상점/의뢰) 갱신.
// 순수 JS: 모듈 최상위에서 document/window/canvas를 만지지 않는다.
// localStorage는 존재할 때만 사용한다 (node에서 import 가능해야 한다).
import { emitter, clamp, num } from '../core/util.js';
import { RNG, rng, uid } from '../core/rng.js';
import { START_CITY, getCity, CITIES } from '../data/world.js';
import { BASE_CLASSES, getClass } from '../data/classes.js';
import { getFormation } from '../data/formations.js';
// SLOTS(장비 10슬롯)는 data/items.js 가 소유한다. 여기서 하드코딩하지 않는다.
import { basesFor, PREFIXES, SUFFIXES, SLOTS } from '../data/items.js';
import { companyName as genCompanyName } from '../data/names.js';
import { PETS_PER_SQUAD } from '../data/pets.js';
import { TOWER_FLOORS } from '../data/tower.js';
import { DEPTH_CAP } from '../data/abyss.js';
// 순환 참조(state <-> quest, state <-> gear/merc/squad)를 안전하게 다루려고 네임스페이스로 받는다.
// 최상위에서는 절대 호출하지 않는다.
import * as Merc from './merc.js';
import * as Gear from './gear.js';
import * as Quest from './quest.js';
import * as Squad from './squad.js';

export const SAVE_KEY = 'merc_company_save_v1';
export const SAVE_VERSION = 1;
/**
 * 데이터 수치 버전. **밸런스 수치를 바꿀 때마다 1 올려라.**
 *
 * `SAVE_VERSION` 과 목적이 다르다. 저쪽은 세이브 구조가 바뀌어 **못 읽을 때** 올리는 값이고,
 * 이쪽은 구조는 그대로인데 **숫자만 바뀌었을 때** 올린다. 올리면 다음 로드에서
 * 의뢰·주점·상점 목록만 비워 새 수치로 다시 만든다(진행 상황은 유지). `migrateDataVersion` 참고.
 *
 *   2 — 특화 도시 등급 확률 하향(S는 특화 전용·최대 5%), 정원 확장 비용 인상
 *   3 — Lv80 상한 + 4차 전직 56종, 경험치 곡선 상향(60·lv^1.55 / EXP_SCALE 2.45 —
 *       설계 원안 lv^1.72 / 1.8 은 도시 이동을 포함한 실측에서 목표보다 2배 느려 조정했다),
 *       서브랭크(-/기본/+)·정예 의뢰 도입, 랭크별 권장 레벨·난이도 대역 전면 개편.
 *       옛 세이브의 의뢰·주점·상점 목록이 새 수치로 다시 채워져야 한다.
 *   4 — 장비 슬롯 3 → 10 (weapon/offhand/head/body/legs/hands/feet/neck/ring1/ring2,
 *       슬롯별 스탯 계수로 총량 관리), 신화(희귀도 5) 세트 아이템 4세트 × 10슬롯,
 *       던전 4개(각 10웨이브·주차 제한)와 던전 진행 상태(state.dungeons),
 *       년/월/주 달력(day 파생 — calendar/openDungeonWeek/calendarLabel) 도입.
 *       옛 세이브의 장비는 weapon→weapon / armor→body / accessory→neck 으로 옮겨지고,
 *       의뢰·주점·상점 목록은 새 슬롯·수치로 다시 채워져야 한다.
 */
export const DATA_VERSION = 4;
/** 도시 목록(주점/상점/의뢰) 리롤 주기 */
export const REFRESH_DAYS = 3;

/* 회복 관련 노브 — UI가 안내 문구에 그대로 쓸 수 있도록 export 한다.
 * 회복이 느리면 "부상 → 출전 불가 → 수입 0 → 임금만 지출" 의 하강 나선이 생긴다.
 * 하루 단위로 눈에 띄게 회복되어야 플레이어가 다음 의뢰를 계획할 수 있다. */
/** 건강한 단원의 하루 자연 회복량 (maxHp 비율) */
export const RECOVER_READY = 0.30;
/** 부상 중인 단원의 하루 자연 회복량 (maxHp 비율) */
export const RECOVER_WOUNDED = 0.20;
/** 여관 휴식이 하루당 추가로 회복시키는 양 (maxHp 비율) */
export const REST_HEAL = 0.45;
/** 여관 휴식이 하루당 추가로 단축하는 부상 잔여 일수 */
export const REST_WOUND_SPEEDUP = 1;

/* ─────────────────────────── 도시 평판 노브 ───────────────────────────
 * 도시마다 0~100 의 평판을 갖는다. 처음 온 도시는 0 이고, **시작 도시만** START_REP 로 출발한다.
 * - 평판 REP_TAVERN_MIN 미만이면 그 도시 주점에서 고용할 수 없다
 *   → 낯선 도시에서는 의뢰부터 하나 받아야 한다.
 * - 평판이 높을수록 주점 등급 롤이 좋아진다 (실효 티어 보정은 merc.js gradeRoll 담당).
 */
/** 평판 하한/상한 */
export const REP_MIN = 0;
export const REP_MAX = 100;
/** 시작 도시의 초기 평판 */
export const START_REP = 10;
/** 주점 고용이 열리는 최소 평판 */
export const REP_TAVERN_MIN = 10;
/** 의뢰 성공 시 랭크별 평판 상승량. 실패는 이 값의 절반(최소 1)만큼 하락한다. */
export const REP_QUEST_GAIN = { F: 2, E: 3, D: 4, C: 5, B: 6, A: 8, S: 10 };

/* ─────────────────────────── 단원 정원 노브 ───────────────────────────
 * 정원은 골드로 산다. 체증 비용이라 무한 확장은 못 하고, 확장할 때마다 의뢰를 더 돌아야 한다. */
/** 시작 정원 */
export const ROSTER_CAP_START = 20;
/** 정원 상한. 부대 5개 x 7명 = 35 명이 출전 정원이라 40 은 예비가 5명뿐이었다.
 *  70 이면 부대를 갈아 끼우고 클래스 조합을 실험할 여유가 생긴다. */
export const ROSTER_CAP_MAX = 70;
/** 한 번 확장할 때 늘어나는 인원 */
export const ROSTER_CAP_STEP = 5;
/**
 * 목표 정원 -> 확장 비용(골드).
 *
 * 처음엔 25명 1,200G 였는데 용병 한 명 고용비가 380~645G 다. 즉 정원 +5 가 고용 2회 값이라
 * 정원이 제약으로 느껴지지 않았다("너무 싸다"). 부대 구매(1,500 / 4,000 / 9,000 / 18,000G)와
 * 견줄 만한 수준으로 올려서, 정원 확장이 한동안 모아야 하는 목표가 되게 한다.
 */
export const ROSTER_CAP_COST = {
  25: 3500, 30: 9000, 35: 20000, 40: 40000,
  // 40 이후 구간. 앞 구간의 2배 곡선을 그대로 이으면 70명까지 152만 G 라 새 벽이 된다 —
  // 정원을 늘려 달라는 요청의 취지(부대 5개 x 7명 = 35명이라 예비가 없다)와 어긋난다.
  // 1.35 배로 완만하게 이어 20→70 총 **86만 G** 로 맞췄다. 참고로 이 구간에서는
  // 정원보다 **하루 임금**이 더 큰 제약이다 (단원이 늘면 임금도 같이 는다).
  45: 55000, 50: 74000, 55: 100000, 60: 135000, 65: 182000, 70: 246000,
};

const LOG_MAX = 200;
const RARITY_MULT = [1, 1.15, 1.35, 1.62, 2.0];
const FLAT_KEYS = new Set(['crit', 'critDmg', 'eva']);
/** 진형을 못 읽었을 때 쓰는 최소 슬롯 (7칸) */
const FALLBACK_SLOTS = [
  { x: 0.10, y: 0.28 }, { x: 0.10, y: 0.72 }, { x: 0.38, y: 0.14 },
  { x: 0.38, y: 0.50 }, { x: 0.38, y: 0.86 }, { x: 0.74, y: 0.30 }, { x: 0.74, y: 0.70 },
];

/* ------------------------------------------------------------------ 상태 */

/** 초기 평판 맵: 모든 도시 0, 시작 도시만 START_REP */
function defaultReputation() {
  const rep = {};
  for (const c of CITIES) rep[c.id] = 0;
  rep[START_CITY] = START_REP;
  return rep;
}

function defaultState() {
  return {
    version: SAVE_VERSION,
    /** 데이터 수치 버전. 옛 세이브를 새 수치로 끌어올리는 데 쓴다 (migrateDataVersion) */
    dataVersion: DATA_VERSION,
    seed: 0,
    /** 용병단 이름. newGame 2번째 인자로 받고, 없으면 자동 생성한다. */
    companyName: '',
    day: 1,
    gold: 800,
    renown: 0,
    cityId: START_CITY,
    roster: [],
    items: [],
    squads: [],
    formations: ['basic'],
    /** 도시별 평판 0~100. 세이브 직렬화 대상 */
    reputation: defaultReputation(),
    /** 단원 정원. 골드로 확장한다 (ROSTER_CAP_COST) */
    rosterCap: ROSTER_CAP_START,
    /** 던전 진행: { [dungeonId]: {bestWave, clearedAt} }. 세이브 직렬화 대상 */
    dungeons: {},
    /**
     * 의뢰 결과에서 이 등급 **이하** 장비를 자동으로 판다. -1 = 끔.
     * 0 일반 / 1 고급 / 2 희귀 / 3 영웅 / 4 전설. 신화(세트)는 어떤 값이어도 안 판다.
     */
    autoSellRarity: -1,
    /** 보유 펫 [{uid, sid, grade, hp}]. 배치는 squad.petUids 에 있다 */
    pets: [],
    /** 펫 uid 채번기. Math.random 대신 이걸 쓴다 (전투 결과 키의 결정론) */
    petSeq: 0,
    /**
     * 무한의 탑 진행. `{ best, lastRunDay, lastRunFloor }`
     * ★ dungeons 에 얹으면 안 된다 — normalizeDungeons 가 항목을 {bestWave, clearedAt}
     *   두 키로 재구성해 나머지 필드를 조용히 버린다.
     */
    tower: { best: 0, lastRunDay: 0, lastRunFloor: 0 },
    /** 황금 나락 진행. `{ best, lastRunDay, lastRunDepth, lastGold }` — 주당 1회 판정에 lastRunDay 를 쓴다 */
    abyss: { best: 0, lastRunDay: 0, lastRunDepth: 0, lastGold: 0 },
    quests: {},
    tavern: {},
    shop: {},
    log: [],
    stats: { battlesWon: 0, battlesLost: 0, questsDone: 0 },
  };
}

/** 살아있는 단일 상태 객체. 재할당 금지 — 내용만 갈아끼운다. */
export const state = defaultState();

/** 상태 변경 알림 버스. 'change' 이벤트만 쓴다. */
export const bus = emitter();

const touch = () => bus.emit('change');

/* ─────────────────────────── 년 / 월 / 주 달력 ───────────────────────────
 * `state.day` 하나가 여전히 **진실의 원천**이다. 여기 있는 건 전부 day 에서 계산해 내는
 * 파생값이라 세이브에 따로 저장하지 않는다 (저장하면 두 값이 어긋날 수 있다).
 *
 *   1주 = 7일 · 1개월 = 4주 = 28일 · 1년 = 12개월 = 336일
 *   year        = floor((day-1)/336) + 1
 *   dayOfYear   = (day-1) % 336
 *   month       = floor(dayOfYear/28) + 1
 *   weekOfMonth = floor((dayOfYear%28)/7) + 1     ← 던전 개방 주차
 *   dayOfWeek   = (dayOfYear%7) + 1
 *
 * 336 은 7 의 배수라 해가 바뀌어도 요일이 끊기지 않는다.
 * UI 표기는 `calendarLabel()` 의 `3년 7월 2주차 (245일차)` 형태로 통일한다. */

/** 1주의 일수 */
export const DAYS_PER_WEEK = 7;
/** 1개월의 주 수 */
export const WEEKS_PER_MONTH = 4;
/** 1년의 개월 수 */
export const MONTHS_PER_YEAR = 12;
/** 1개월의 일수 (28) */
export const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH;
/** 1년의 일수 (336) */
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

/** day 를 1 이상의 정수로 정규화한다 (NaN·0·음수·소수 방어) */
function normDay(day) {
  const d = Math.floor(Number(day));
  return Number.isFinite(d) && d >= 1 ? d : 1;
}

/**
 * 날짜(day)를 년/월/주/요일로 쪼갠다.
 * @param {number} [day] 생략하면 현재 state.day
 * @returns {{year:number, month:number, week:number, dayOfWeek:number, day:number}}
 *  - `week` 은 **그 달의 주차(1~4)** 다. 던전 개방 판정에 그대로 쓴다.
 */
export function calendar(day = state.day) {
  const d = normDay(day);
  const dayOfYear = (d - 1) % DAYS_PER_YEAR;
  return {
    year: Math.floor((d - 1) / DAYS_PER_YEAR) + 1,
    month: Math.floor(dayOfYear / DAYS_PER_MONTH) + 1,
    week: Math.floor((dayOfYear % DAYS_PER_MONTH) / DAYS_PER_WEEK) + 1,
    dayOfWeek: (dayOfYear % DAYS_PER_WEEK) + 1,
    day: d,
  };
}

/**
 * 이번 주에 들어갈 수 있는 던전 번호(= 그 달의 주차, 1~4).
 * N주차에는 N번 던전만 개방된다.
 * @param {number} [day] 생략하면 현재 state.day
 * @returns {number} 1~4
 */
export function openDungeonWeek(day = state.day) {
  return calendar(day).week;
}

/**
 * UI 공용 날짜 표기. `3년 7월 2주차 (245일차)`
 * @param {number} [day] 생략하면 현재 state.day
 * @returns {string}
 */
export function calendarLabel(day = state.day) {
  const c = calendar(day);
  return `${c.year}년 ${c.month}월 ${c.week}주차 (${c.day}일차)`;
}

/* ─────────────────────────── 장비 슬롯 (10칸) ───────────────────────────
 * 슬롯 목록의 소유자는 `data/items.js` 의 SLOTS 다. 여기서는 정규화만 담당한다.
 *
 * 옛 세이브는 슬롯이 3칸(weapon/armor/accessory)이었다. 다음 규칙으로 옮긴다:
 *   weapon → weapon · armor → body · accessory → neck   (나머지 7칸은 빈 채로 시작)
 * 아이템 자체의 `slot` 필드도 같은 규칙으로 갈아 준다 — 안 그러면 옛 방어구가
 * 'armor' 라는 존재하지 않는 슬롯을 가리켜 영영 장착할 수 없게 된다. */

/** 옛 슬롯 이름 → 새 슬롯 이름 */
export const LEGACY_SLOT_MAP = { weapon: 'weapon', armor: 'body', accessory: 'neck' };

/** 전 슬롯이 null 인 빈 장비 객체 */
export function emptyEquipment() {
  const eq = {};
  for (const s of SLOTS) eq[s] = null;
  return eq;
}

/**
 * 임의의 장비 객체를 10슬롯 형태로 정규화한다.
 * 새 슬롯 이름이 이미 있으면 그대로 두고, 옛 이름(armor/accessory)은
 * 대응 슬롯이 비어 있을 때만 옮긴다. 알 수 없는 키는 버린다.
 * @param {object} [src]
 * @returns {object} SLOTS 전 칸을 가진 새 객체
 */
export function normalizeEquipment(src) {
  const eq = emptyEquipment();
  if (!src || typeof src !== 'object') return eq;
  for (const s of SLOTS) {
    const v = src[s];
    if (typeof v === 'string' && v) eq[s] = v;
  }
  for (const [oldSlot, newSlot] of Object.entries(LEGACY_SLOT_MAP)) {
    if (oldSlot === newSlot) continue;
    const v = src[oldSlot];
    if (typeof v === 'string' && v && !eq[newSlot]) eq[newSlot] = v;
  }
  return eq;
}

/**
 * 아이템이 들어갈 슬롯 이름. 옛 세이브의 'armor'/'accessory' 를 새 이름으로 바꿔 준다.
 * @returns {string|null} SLOTS 안의 이름, 판정 불가면 null
 */
export function slotForItem(item) {
  const s = item && item.slot;
  if (typeof s !== 'string' || !s) return null;
  if (SLOTS.includes(s)) return s;
  const mapped = LEGACY_SLOT_MAP[s];
  return mapped && SLOTS.includes(mapped) ? mapped : null;
}

/** 아이템 목록의 slot 필드를 새 어휘로 옮긴다 (옛 세이브 정규화) */
function normalizeItemSlots(list) {
  for (const it of list || []) {
    if (!it || typeof it !== 'object') continue;
    const s = slotForItem(it);
    if (s && it.slot !== s) it.slot = s;
  }
  return list;
}

/** state의 내용을 통째로 교체한다 (참조는 유지). */
function replaceState(src) {
  const base = defaultState();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, base, src || {});
  state.stats = { ...base.stats, ...(src?.stats || {}) };
  state.roster = Array.isArray(state.roster) ? state.roster : [];
  state.items = Array.isArray(state.items) ? state.items : [];
  state.squads = Array.isArray(state.squads) ? state.squads : [];
  state.log = Array.isArray(state.log) ? state.log : [];
  state.formations = Array.isArray(state.formations) && state.formations.length ? state.formations : ['basic'];
  for (const key of ['quests', 'tavern', 'shop']) {
    if (!state[key] || typeof state[key] !== 'object') state[key] = {};
  }
  // 장비 10슬롯 정규화 — 옛 세이브의 {weapon, armor, accessory} 를 옮긴다.
  normalizeItemSlots(state.items);
  for (const m of state.roster) {
    if (m) m.equipment = normalizeEquipment(m.equipment);
  }
  for (const s of state.squads) {
    if (!Array.isArray(s.memberUids)) s.memberUids = new Array(7).fill(null);
    while (s.memberUids.length < 7) s.memberUids.push(null);
    s.memberUids.length = 7;
    // 펫 자리 — 옛 세이브에는 없다. 길이를 고정해 둬야 UI 가 빈 칸을 그릴 수 있다.
    if (!Array.isArray(s.petUids)) s.petUids = new Array(PETS_PER_SQUAD).fill(null);
    while (s.petUids.length < PETS_PER_SQUAD) s.petUids.push(null);
    s.petUids.length = PETS_PER_SQUAD;
    // 파견 필드 하위 호환 — 예전 세이브에는 status/returnDay 가 없다. 없으면 idle 로 본다.
    normalizeSquadDispatch(s, state.day);
  }
  if (typeof state.companyName !== 'string') state.companyName = '';
  normalizeReputation(state);
  normalizeRosterCap(state);
  normalizeDungeons(state);
  // 자동 판매 설정 — 범위를 벗어난 값이 세이브에 있으면 끔으로 되돌린다
  {
    const v = Math.round(Number(state.autoSellRarity));
    state.autoSellRarity = Number.isFinite(v) && v >= 0 && v <= 4 ? v : -1;
  }
  normalizePets(state);
  normalizeTower(state);
  normalizeAbyss(state);
  migrateDataVersion(state);
}

/**
 * 펫 보유 목록 정규화.
 * ★ `Object.assign(state, base, src)` 는 **세이브 값이 무조건 이긴다.** 손상된 세이브에
 *   `pets: null` 이 들어 있으면 그대로 null 이 박혀 `state.pets.length` 가 터진다.
 *   defaultState 에 필드를 추가하는 것만으로는 안전하지 않다 — 여기서 반드시 정규화한다.
 */
function normalizePets(st) {
  if (!Array.isArray(st.pets)) st.pets = [];
  const seen = new Set();
  st.pets = st.pets.filter((p) => {
    if (!p || typeof p !== 'object') return false;
    if (typeof p.uid !== 'string' || typeof p.sid !== 'string') return false;
    if (seen.has(p.uid)) return false;          // uid 중복은 전투 결과 키를 덮어쓴다
    seen.add(p.uid);
    if (typeof p.grade !== 'string') p.grade = 'F';
    if (typeof p.hp !== 'number' || !(p.hp > 0)) delete p.hp;   // 없으면 만피로 본다
    return true;
  });

  // 채번기가 기존 uid 보다 뒤처져 있으면 새 펫이 uid 를 덮어쓴다 — 최대치로 끌어올린다
  let max = 0;
  for (const p of st.pets) {
    const n = parseInt(String(p.uid).replace(/^pet_/, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  if (typeof st.petSeq !== 'number' || st.petSeq < max) st.petSeq = max;

  // 배치 목록에서 이미 없는 펫(놓아준 뒤 세이브가 어긋난 경우)을 걷어낸다
  const alive = new Set(st.pets.map((p) => p.uid));
  for (const s of st.squads || []) {
    if (!Array.isArray(s.petUids)) continue;
    for (let i = 0; i < s.petUids.length; i++) if (s.petUids[i] && !alive.has(s.petUids[i])) s.petUids[i] = null;
  }
}

/** 황금 나락 진행도 정규화 */
function normalizeAbyss(st) {
  const a = st.abyss && typeof st.abyss === 'object' ? st.abyss : {};
  st.abyss = {
    best: clampInt(a.best, 0, DEPTH_CAP),
    lastRunDay: clampInt(a.lastRunDay, 0, 1e9),
    lastRunDepth: clampInt(a.lastRunDepth, 0, DEPTH_CAP),
    lastGold: clampInt(a.lastGold, 0, 1e12),
  };
}

/** 무한의 탑 진행도 정규화 */
function normalizeTower(st) {
  const t = st.tower && typeof st.tower === 'object' ? st.tower : {};
  st.tower = {
    best: clampInt(t.best, 0, TOWER_FLOORS),
    lastRunDay: clampInt(t.lastRunDay, 0, 1e9),
    lastRunFloor: clampInt(t.lastRunFloor, 0, TOWER_FLOORS),
  };
}

const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
};

/**
 * 데이터 수치가 바뀌었을 때 옛 세이브를 새 수치로 끌어올린다.
 *
 * 등급 확률·비용·전투 공식 같은 건 **매번 코드에서 계산**하므로 세이브를 불러오는 즉시 반영된다.
 * 문제는 생성 시점에 값이 굳는 목록들이다 — 이미 떠 있는 의뢰(보상·적 구성·소요 일수),
 * 주점 명단·고용 비용, 상점 재고는 세이브에 박제되어 있어서 밸런스를 고쳐도 그대로 남는다.
 * 그래서 지금까지는 "수치를 바꿨으면 새 게임을 시작하라"고 안내해야 했다.
 *
 * `DATA_VERSION` 을 올리면 여기서 그 목록만 비운다. 다음 화면 진입 때 `refreshCity` 가
 * 새 수치로 다시 만들어 준다. **진행 상황(골드·단원·레벨·장비·날짜·평판)은 건드리지 않는다.**
 *
 * → 데이터 수치를 바꿀 때마다 `DATA_VERSION` 을 1 올려라.
 */
function migrateDataVersion(st) {
  const cur = Number(st.dataVersion) || 0;
  if (cur === DATA_VERSION) return;
  // 갓 만든 상태(newGame)에는 목록이 아직 없으므로 비울 것도 없다.
  const had = ['quests', 'tavern', 'shop'].some((k) => Object.keys(st[k] || {}).length);
  st.quests = {};
  st.tavern = {};
  st.shop = {};
  // 최대 HP는 장비·레벨에서 다시 계산되므로 다음 advanceDays 가 알아서 맞춘다.
  // 다만 현재 HP가 새 최대치를 넘는 일은 막아 둔다.
  for (const m of st.roster || []) {
    if (m && Number.isFinite(m.maxHp) && Number.isFinite(m.hp)) m.hp = Math.min(m.hp, m.maxHp);
  }
  st.dataVersion = DATA_VERSION;
  if (had && Array.isArray(st.log)) {
    st.log.push({ day: st.day, text: '세상이 달라졌다. 의뢰·주점·상점 목록이 새로 채워진다.' });
    if (st.log.length > LOG_MAX) st.log.splice(0, st.log.length - LOG_MAX);
  }
}

/**
 * 평판 맵 정규화.
 * 필드가 아예 없거나(옛 세이브) 빈 객체면 `defaultReputation()` 으로 되돌린다
 * — newGame 은 항상 14개 도시를 전부 채우므로, 비어 있다는 건 평판 이전 세이브라는 뜻이다.
 * 값이 있으면 0~100 정수로 자르고, 빠진 도시는 0 으로 채운다.
 */
function normalizeReputation(st) {
  const src = st.reputation;
  if (!src || typeof src !== 'object' || Array.isArray(src) || !Object.keys(src).length) {
    st.reputation = defaultReputation();
    return st.reputation;
  }
  const rep = {};
  for (const c of CITIES) {
    const v = Math.round(Number(src[c.id]));
    rep[c.id] = Number.isFinite(v) ? clamp(v, REP_MIN, REP_MAX) : 0;
  }
  st.reputation = rep;
  return rep;
}

/** 단원 정원 정규화. 없으면 20, 범위 밖이면 잘라낸다. */
function normalizeRosterCap(st) {
  const v = Math.round(Number(st.rosterCap));
  st.rosterCap = Number.isFinite(v) && v > 0
    ? clamp(v, ROSTER_CAP_START, ROSTER_CAP_MAX)
    : ROSTER_CAP_START;
  return st.rosterCap;
}

/**
 * 던전 진행 정규화. 필드가 없는 옛 세이브는 빈 객체가 된다.
 * 항목 형태는 `{bestWave:0.., clearedAt:day|null}` 로 강제한다.
 */
function normalizeDungeons(st) {
  const src = st.dungeons;
  const out = {};
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const [id, entry] of Object.entries(src)) {
      if (!id || !entry || typeof entry !== 'object') continue;
      const best = Math.floor(Number(entry.bestWave));
      const cleared = Math.floor(Number(entry.clearedAt));
      out[id] = {
        bestWave: Number.isFinite(best) && best > 0 ? best : 0,
        clearedAt: Number.isFinite(cleared) && cleared > 0 ? cleared : null,
      };
    }
  }
  st.dungeons = out;
  return out;
}

/**
 * 부대의 파견 필드를 정규화한다. squad.js 의 normalizeDispatch 를 쓰되,
 * 순환 import 로 아직 준비되지 않았을 경우를 대비해 같은 규칙을 인라인으로도 갖고 있다.
 */
function normalizeSquadDispatch(sq, day = 0) {
  if (!sq) return sq;
  if (typeof Squad.normalizeDispatch === 'function') {
    try { return Squad.normalizeDispatch(sq, day); } catch { /* 아래 폴백 */ }
  }
  if (sq.status !== 'away') sq.status = 'idle';
  const rd = Math.round(Number(sq.returnDay) || 0);
  sq.returnDay = rd > 0 ? rd : 0;
  if (sq.status === 'away' && (!sq.returnDay || (day > 0 && day >= sq.returnDay))) {
    sq.status = 'idle';
    sq.returnDay = 0;
  }
  return sq;
}

/* ------------------------------------------------------------------ 새 게임 */

/**
 * 시작 상태를 구성한다. 골드 800 / 1일차 / 시작 도시 /
 * 1차 클래스 용병 4명(D~C) 무료 지급 / 기본 장비 / 기본 부대 1개.
 *
 * @param {number} seed 시드
 * @param {string} [companyName] 용병단 이름. 비우면 `data/names.js` 로 자동 생성한다.
 */
export function newGame(seed = Date.now() >>> 0, companyName = '') {
  const s = (seed >>> 0) || 1;
  rng.s = s;
  const r = new RNG(s);

  replaceState(defaultState());
  state.seed = s;

  // 용병단 이름: 플레이어가 지어 준 이름 > 자동 생성.
  const given = typeof companyName === 'string' ? companyName.trim() : '';
  if (given) {
    state.companyName = given.slice(0, 24);
  } else {
    let auto = '';
    try { auto = genCompanyName(r) || ''; } catch (e) { console.warn('[state] 용병단 이름 생성 실패', e); }
    state.companyName = auto || '이름 없는 용병단';
  }

  // 1차 클래스 4명 — 전열 2, 힐러 1, 나머지 1로 균형을 맞춘다.
  // 오토배틀러에서 인원수는 곧 화력이다(집중공격이 유닛을 하나씩 지우므로 수적 우위가 복리로 작용).
  // 3명으로는 개별 스탯이 우세해도 최저 랭크 의뢰조차 수적 열세를 넘지 못한다.
  const all = (BASE_CLASSES || []).map((id) => getClass(id)).filter(Boolean);
  const picks = [];
  const take = (pool) => {
    const cand = pool.filter((c) => !picks.includes(c));
    if (cand.length) picks.push(r.pick(cand));
  };
  take(all.filter((c) => c.rank === 1));
  take(all.filter((c) => c.rank === 1));
  take(all.filter((c) => c.arch === 'healer'));
  while (picks.length < 4 && picks.length < all.length) take(all);

  const grades = r.shuffle(['C', 'C', 'D', 'D']);
  const squad = {
    id: 'squad_1', name: '제1부대', memberUids: new Array(7).fill(null), formationId: 'basic',
    status: 'idle', returnDay: 0,
    // ★ squad.js createSquad 에도 같은 필드가 있다. 이 리터럴은 newGame 전용 사본이라
    //   한쪽만 고치면 새 게임에만 펫 칸이 없는 재현 어려운 버그가 된다.
    petUids: new Array(PETS_PER_SQUAD).fill(null),
  };
  state.squads.push(squad);

  const slotOrder = formationSlotOrder('basic');
  let frontCursor = 0;
  let backCursor = slotOrder.length - 1;

  picks.forEach((cls, i) => {
    const m = Merc.createMerc({ classId: cls.id, grade: grades[i] || 'D', level: 1 });
    m.equipment = normalizeEquipment(m.equipment);
    m.hiredDay = 1;
    state.roster.push(m);

    const slotIndex = cls.rank === 2 ? slotOrder[backCursor--] : slotOrder[frontCursor++];
    squad.memberUids[slotIndex] = m.uid;
    m.squadId = squad.id;
    m.slotIndex = slotIndex;

    // 기본 무기 + 상의 지급 후 장착. 나머지 8칸은 비운 채로 시작한다 (파밍으로 채운다).
    const wtype = Array.isArray(cls.equip) ? cls.equip.find((t) => t !== 'shield') || cls.equip[0] : null;
    giveStarterGear(m, rollLoot({ ilvl: 1, rarityBonus: 0, slot: 'weapon', weaponType: wtype, rng: r }));
    // 방어구는 새 어휘의 'body'(상의)로 뽑는다. 옛 'armor' 베이스만 있는 경우를 위해 폴백을 둔다.
    giveStarterGear(m, rollLoot({ ilvl: 1, rarityBonus: 0, slot: 'body', rng: r })
      || rollLoot({ ilvl: 1, rarityBonus: 0, slot: 'armor', rng: r }));
  });

  // 예비 장비 몇 개
  for (let i = 0; i < 3; i++) {
    const it = rollLoot({ ilvl: 1 + i, rarityBonus: i === 2 ? 0.25 : 0, rng: r });
    if (it) state.items.push(it);
  }

  addLog(`용병단 「${state.companyName}」을(를) 결성했다. 첫 의뢰를 찾아보자.`);
  addLog(`단원 ${state.roster.length}명과 함께 ${getCity(state.cityId)?.name || '알 수 없는 도시'}에서 출발한다.`);

  refreshCity(state.cityId, true);
  touch();
  return state;
}

/** 시작 지급 장비를 인벤토리에 넣고 해당 슬롯에 채운다. */
function giveStarterGear(m, it) {
  if (!it) return null;
  const slot = slotForItem(it);
  state.items.push(it);
  if (slot) {
    it.slot = slot;
    m.equipment[slot] = it.uid;
  }
  return it;
}

/** 진형 슬롯을 전열(x 작은 순)부터 정렬한 인덱스 배열 */
function formationSlotOrder(formationId) {
  const f = getFormation(formationId);
  const slots = (f && Array.isArray(f.slots) && f.slots.length === 7) ? f.slots : FALLBACK_SLOTS;
  return slots.map((s, i) => ({ i, x: s.x })).sort((a, b) => a.x - b.x).map((o) => o.i);
}

/* ------------------------------------------------------------------ 세이브 */

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/**
 * 게임이 실제로 시작됐는가. `defaultState()` 의 seed 는 0이고 `newGame` 은 항상 1 이상을 넣는다.
 * 그래서 seed 하나로 "아직 시작 안 한 빈 상태"를 정확히 구분할 수 있다.
 */
function started(s = state) {
  return !!(s && (s.seed >>> 0));
}

export function hasSave() {
  const ls = storage();
  if (!ls) return false;
  try {
    const raw = ls.getItem(SAVE_KEY);
    if (!raw) return false;
    // 빈 상태(시작 전)가 저장돼 있으면 세이브가 없는 것으로 본다 — 아래 save() 주석 참고.
    const data = JSON.parse(raw);
    return !!(data && typeof data === 'object' && started(data));
  } catch { return false; }
}

/**
 * 현재 상태를 저장한다.
 *
 * ※ **시작 전 빈 상태는 절대 쓰지 않는다.**
 *   ui/app.js 는 부팅 시 `beforeunload` 에 save() 를 걸어 두고, 세이브가 없으면
 *   용병단 이름 모달을 띄운다. 이름을 정하기 전에 새로고침하면 beforeunload 가 먼저 터져서
 *   **단원 0명 / 부대 0개 / 이름 없음** 인 기본 상태가 저장됐다. 다음 부팅에서는 그게
 *   정상 세이브로 로드되어 아무것도 없는 용병단으로 시작하게 된다(실제로 재현됨).
 *   seed 로 걸러 내면 어느 경로에서 save() 가 불려도 같은 사고가 나지 않는다.
 */
/* ─────────────────── 업데이트 이전 세이브 관문 ───────────────────
 * 봉인 이전 빌드의 브라우저 세이브는 개발자도구로 값만 바꿔 놓은 것일 수 있다.
 * 그래서 **딱 한 번** 암호를 묻고, 통과하면 표식을 찍어 그 뒤로는 다시 안 묻는다.
 *
 * ★ 매번 검사하지 않는다. 표식이 있는지만 본다 —
 *   즉 이건 "구버전 세이브 걸러내기"이지 상시 치트 방지가 아니다.
 *   상시 검사는 플레이할 때마다 발목을 잡고, 어차피 이 코드를 읽으면 뚫린다.
 *   내보낸 **파일** 쪽은 계속 체크섬을 본다(ui/savefile.js) — 거긴 주고받는 물건이라 다르다.
 */

/** 이 버전부터 찍는 표식. 값이 있으면 관문을 이미 지난 세이브다. */
export const SEAL_MARK = 1;

/** 관문을 지나야 하는 세이브인가 (= 표식이 없다) */
export function needsUnlock(data) {
  return !!data && typeof data === 'object' && !data.sealMark;
}

/**
 * 마지막 load() 가 관문에 걸렸을 때 그 세이브를 보관해 둔다.
 * 부팅 화면(app.js)이 가져가 암호를 묻는다 — **세이브를 지우지 않는 게 핵심**이다.
 */
let pendingLocked = null;
export function takeLockedSave() {
  const v = pendingLocked;
  pendingLocked = null;
  return v;
}

/** 암호를 맞춘 뒤 그 세이브를 적용한다 (표식이 찍혀 다음부터는 안 묻는다) */
export function acceptLockedSave(data) {
  if (!data || typeof data !== 'object') return false;
  if (tripsResetRule(data)) { newGame(); return false; }   // 암호와 무관한 별개 관문
  replaceState(data);
  if (state.seed) rng.s = (state.seed >>> 0) || 1;
  save();          // save() 가 표식을 찍는다
  touch();
  return true;
}

/* ─────────────────── 임시 관문: 1부대 전원 S ───────────────────
 * ★ **임시 조치다.** 세이브 봉인은 파일에만 걸려 있고 브라우저 저장소(localStorage)는
 *   개발자도구로 그냥 고칠 수 있다. 고친 티가 가장 확실하게 나는 지점이
 *   "1부대가 꽉 찬 채 전원 S등급" 이라, 그걸 만나면 새 게임으로 돌린다.
 *
 * ★ 이건 **언젠가 반드시 정상 플레이어에게도 걸린다.** S등급은 특화 도시에서 정상적으로
 *   나오고, 이 게임은 애초에 "S를 모으는 것"이 목표다. 지금 넣는 근거는 오직
 *   "아직 거기까지 간 사람이 없다"는 것뿐이므로, **누군가 정상적으로 도달하기 전에 빼야 한다.**
 *
 * ★ 판정을 "꽉 찬 부대"로 잡은 이유: 슬롯이 2개만 찬 부대가 우연히 둘 다 S인 건
 *   중반에도 충분히 일어난다. 그걸로 세이브를 날리면 그게 더 큰 사고다.
 */
export function squadAllS(sq, roster) {
  if (!sq || !Array.isArray(sq.memberUids)) return false;
  const uids = sq.memberUids.filter(Boolean);
  if (uids.length < sq.memberUids.length || !uids.length) return false;   // 빈 슬롯이 있으면 아니다
  const byUid = new Map((roster || []).filter(Boolean).map((m) => [m.uid, m]));
  for (const uid of uids) {
    const m = byUid.get(uid);
    if (!m || m.grade !== 'S') return false;
  }
  return true;
}

/** 이 세이브가 임시 관문에 걸리는가 (= 1부대가 꽉 찬 채 전원 S) */
export function tripsResetRule(data) {
  if (!data || typeof data !== 'object') return false;
  const sq = (data.squads || [])[0];
  return squadAllS(sq, data.roster);
}

export function save() {
  const ls = storage();
  if (!ls) return false;
  if (!started()) return false;
  try {
    state.sealMark = SEAL_MARK;                 // 관문을 지난 세이브라는 표식
    ls.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('[state] 저장 실패', e);
    return false;
  }
}

/** 세이브를 불러온다. 실패하거나 버전이 다르면 새 게임을 시작하고 false를 반환. */
export function load() {
  const ls = storage();
  const raw = ls ? safeGet(ls) : null;
  if (!raw) { newGame(); return false; }
  let data = null;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!data || typeof data !== 'object' || data.version !== SAVE_VERSION) {
    console.warn('[state] 세이브 버전 불일치 — 새 게임으로 시작합니다.');
    newGame();
    return false;
  }
  // 예전 빌드가 남긴 "시작 전 빈 세이브"를 걸러 낸다 (save() 주석 참고).
  // 이걸 통과시키면 단원 0명·부대 0개인 용병단으로 부팅되어 진행이 막힌다.
  if (!started(data)) {
    console.warn('[state] 빈 세이브 — 새 게임으로 시작합니다.');
    newGame();
    return false;
  }
  /* ★ 임시 관문 — 1부대 전원 S 는 새 게임으로 돌린다 (위 squadAllS 주석 참고).
   *   암호 관문보다 **앞**에 둔다: 어차피 못 쓸 세이브를 두고 암호를 묻는 건 의미가 없다. */
  if (tripsResetRule(data)) {
    console.warn('[state] 1부대 전원 S — 새 게임으로 시작합니다.');
    newGame();
    return false;
  }

  /* ★ 업데이트 이전 세이브면 딱 한 번 암호를 묻는다 (표식이 없는 세이브).
   * 세이브를 **지우지는 않는다** — 원본을 들고 있다가 암호를 맞추면 그대로 살린다. */
  if (needsUnlock(data)) {
    console.warn('[state] 업데이트 이전 세이브 — 암호 확인이 필요합니다.');
    pendingLocked = data;
    newGame();
    return false;
  }

  replaceState(data);
  if (state.seed) rng.s = (state.seed >>> 0) || 1;
  touch();
  return true;
}

/**
 * 이미 파싱된 세이브 객체를 그대로 현재 상태로 올린다 (localStorage 를 거치지 않는다).
 *
 * `load()` 는 브라우저 저장소가 있어야 돌아가서 node 검증 스크립트가 쓸 수 없다.
 * 새 필드(`reputation`/`rosterCap`/`dungeons`/10슬롯 `equipment`)의 **옛 세이브 정규화**를 스모크가 직접 검사하려면
 * "임의의 객체를 replaceState 에 태우는" 경로가 필요해서 열어 둔다.
 * @param {object} data 세이브 객체 (JSON.parse 결과)
 * @returns {boolean} 성공 여부
 */
export function importState(data) {
  if (!data || typeof data !== 'object') return false;
  replaceState(data);
  if (state.seed) rng.s = (state.seed >>> 0) || 1;
  touch();
  return true;
}

function safeGet(ls) { try { return ls.getItem(SAVE_KEY); } catch { return null; } }

export function clearSave() {
  const ls = storage();
  if (!ls) return false;
  try { ls.removeItem(SAVE_KEY); return true; } catch { return false; }
}

/* ------------------------------------------------------------------ 기본 조작 */

/** 로그 추가. 최신이 앞(index 0)에 오고 최대 200개를 유지한다. */
export function addLog(text) {
  if (!text) return null;
  const entry = { day: state.day, text: String(text) };
  state.log.unshift(entry);
  if (state.log.length > LOG_MAX) state.log.length = LOG_MAX;
  bus.emit('log', entry);
  touch();
  return entry;
}

export function addGold(n) {
  state.gold = Math.max(0, Math.round(state.gold + (n || 0)));
  touch();
  return state.gold;
}

export function addItem(item) {
  if (!item) return null;
  if (!item.uid) item.uid = uid('it');
  state.items.push(item);
  touch();
  return item;
}

/** 인벤토리에서 제거. 장착 중이면 해제한다. */
export function removeItem(uidToRemove) {
  const i = state.items.findIndex((x) => x.uid === uidToRemove);
  if (i < 0) return null;
  const [item] = state.items.splice(i, 1);
  for (const m of state.roster) {
    const eq = m.equipment;
    if (!eq) continue;
    for (const slot of SLOTS) {
      if (eq[slot] === uidToRemove) eq[slot] = null;
    }
  }
  touch();
  return item;
}

/**
 * uid -> 아이템 인덱스.
 * `idx[uid]` / `idx.get(uid)` / `idx.find(fn)` / `for..of` 전부 동작하도록 만든다
 * (다른 모듈이 어떤 방식으로 조회하든 안전하게).
 */
export function itemsById(list = state.items) {
  const idx = {};
  for (const it of list || []) if (it && it.uid) idx[it.uid] = it;
  const vals = () => Object.values(idx);
  const def = (name, value) => Object.defineProperty(idx, name, { value, enumerable: false });
  def('get', (u) => idx[u] || null);
  def('has', (u) => !!idx[u]);
  def('find', (fn) => vals().find(fn) || null);
  def('filter', (fn) => vals().filter(fn));
  def('map', (fn) => vals().map(fn));
  def('forEach', (fn) => vals().forEach(fn));
  def('values', () => vals());
  def(Symbol.iterator, function* () { yield* vals(); });
  Object.defineProperty(idx, 'size', { get: () => vals().length, enumerable: false });
  return idx;
}

export function getMerc(uidToFind) {
  return state.roster.find((m) => m.uid === uidToFind) || null;
}

export function getSquad(id) {
  if (!id) return state.squads[0] || null;
  return state.squads.find((s) => s.id === id) || null;
}

export function addMerc(merc) {
  if (!merc) return null;
  merc.equipment = normalizeEquipment(merc.equipment);
  if (merc.hiredDay == null) merc.hiredDay = state.day;
  state.roster.push(merc);
  touch();
  return merc;
}

/** addLog 는 전역 state 전용이다. 테스트/시뮬이 별도 상태 객체를 넘겼을 때는 로그를 건너뛴다. */
function logFor(st, text) {
  if (st === state) addLog(text);
}

/* ------------------------------------------------------------------ 도시 평판 */

/* 평판은 "그 도시가 우리 용병단을 얼마나 신뢰하는가"다.
 * - 의뢰 성공/실패로만 움직인다 (랭크별 증감표는 REP_QUEST_GAIN).
 * - REP_TAVERN_MIN 미만이면 주점이 닫혀 있다 → 처음 온 도시에서는 의뢰부터 받아야 한다.
 * - 높을수록 그 도시 주점의 등급 롤이 좋아진다 (보정은 merc.gradeRoll 의 opts.rep 담당). */

/** 도시 평판 조회. 기록이 없으면 0 */
export function getRep(cityId, st = state) {
  if (!cityId) return 0;
  const rep = (st && st.reputation) || {};
  const v = Math.round(Number(rep[cityId]));
  return Number.isFinite(v) ? clamp(v, REP_MIN, REP_MAX) : 0;
}

/**
 * 도시 평판 증감. 0~100 으로 잘라 저장하고 실제 변화가 있으면 로그를 남긴다.
 * @returns {number} 변경 후 평판
 */
export function addRep(cityId, delta, st = state) {
  if (!cityId) return 0;
  if (!st.reputation || typeof st.reputation !== 'object') st.reputation = defaultReputation();
  const before = getRep(cityId, st);
  const d = Math.round(Number(delta) || 0);
  const after = clamp(before + d, REP_MIN, REP_MAX);
  st.reputation[cityId] = after;
  if (after !== before) {
    const name = getCity(cityId)?.name || cityId;
    const diff = after - before;
    logFor(st, diff > 0
      ? `${name}에서의 평판이 올랐다. (${before} → ${after})`
      : `${name}에서의 평판이 떨어졌다. (${before} → ${after})`);
  }
  touch();
  return after;
}

/**
 * 의뢰 결과를 평판에 반영한다. 성공은 REP_QUEST_GAIN, 실패는 그 절반(최소 1) 하락.
 * quest.js 가 결과 정산에서 한 번만 부르면 된다.
 * @param {string} cityId
 * @param {string} rank 'F'~'S'
 * @param {boolean} success
 * @returns {{delta:number, rep:number}}
 */
export function addQuestRep(cityId, rank, success, st = state) {
  const base = REP_QUEST_GAIN[rank] ?? REP_QUEST_GAIN.F;
  const delta = success ? base : -Math.max(1, Math.floor(base / 2));
  return { delta, rep: addRep(cityId, delta, st) };
}

/**
 * 이 도시 주점을 쓸 수 있는가. 평판이 REP_TAVERN_MIN 미만이면 잠긴다.
 * @returns {{ok:boolean, reason:string, rep:number, need:number}}
 */
export function canUseTavern(cityId = state.cityId, st = state) {
  const rep = getRep(cityId, st);
  if (rep < REP_TAVERN_MIN) {
    const name = getCity(cityId)?.name || cityId;
    return {
      ok: false,
      reason: `${name}의 주점은 아직 우리를 믿지 않는다. 평판 ${REP_TAVERN_MIN} 이상이 필요하다. (현재 ${rep}) 의뢰를 먼저 완수해라.`,
      rep,
      need: REP_TAVERN_MIN,
    };
  }
  return { ok: true, reason: '', rep, need: REP_TAVERN_MIN };
}

/* ------------------------------------------------------------------ 단원 정원 */

/**
 * 목표 정원까지 확장하는 데 드는 골드. 표에 없는 값이면 Infinity
 * (시작 정원 이하는 이미 가진 것이므로 0).
 */
export function rosterCapCost(nextCap) {
  const n = Math.round(Number(nextCap) || 0);
  if (n <= ROSTER_CAP_START) return 0;
  const cost = ROSTER_CAP_COST[n];
  return Number.isFinite(cost) ? cost : Infinity;
}

/**
 * 정원을 한 단계(+ROSTER_CAP_STEP) 늘릴 수 있는가.
 * @returns {{ok:boolean, reason:string, cost:number, nextCap:number}}
 */
export function canExpandRoster(st = state) {
  const cur = normalizeRosterCap(st);
  const nextCap = cur + ROSTER_CAP_STEP;
  if (cur >= ROSTER_CAP_MAX) {
    return { ok: false, reason: `이미 최대 정원(${ROSTER_CAP_MAX}명)이다.`, cost: 0, nextCap: cur };
  }
  const cost = rosterCapCost(nextCap);
  if (!Number.isFinite(cost)) {
    return { ok: false, reason: '더 이상 정원을 늘릴 수 없다.', cost: 0, nextCap: cur };
  }
  if ((st.gold || 0) < cost) {
    return { ok: false, reason: `골드가 부족하다. ${num(cost)}G 필요.`, cost, nextCap };
  }
  return { ok: true, reason: '', cost, nextCap };
}

/**
 * 정원을 한 단계 확장하고 비용을 차감한다.
 * @returns {{ok:boolean, reason:string, cost?:number, cap?:number}}
 */
export function expandRosterCap(st = state) {
  const chk = canExpandRoster(st);
  if (!chk.ok) return { ok: false, reason: chk.reason };
  st.gold = Math.max(0, Math.round((st.gold || 0) - chk.cost));
  st.rosterCap = chk.nextCap;
  logFor(st, `숙소를 넓혔다. 단원 정원이 ${chk.nextCap}명이 되었다. (-${num(chk.cost)}G)`);
  touch();
  return { ok: true, reason: `정원이 ${chk.nextCap}명으로 늘었다.`, cost: chk.cost, cap: chk.nextCap };
}

/**
 * 단원을 한 명 더 받을 수 있는가 (정원 검사). 주점/보상 고용 경로가 쓴다.
 * @returns {{ok:boolean, reason:string, count:number, cap:number}}
 */
export function canHireMore(st = state) {
  const cap = normalizeRosterCap(st);
  const count = (st.roster || []).length;
  if (count >= cap) {
    return {
      ok: false,
      reason: `단원 정원이 가득 찼다. (${count}/${cap}) 숙소를 넓히거나 단원을 내보내라.`,
      count,
      cap,
    };
  }
  return { ok: true, reason: '', count, cap };
}

/* ------------------------------------------------------------------ 던전 진행 */

/* 던전은 도시가 아니라 월드맵의 별도 노드다. 던전 하나당 10웨이브이고 웨이브마다 보스가 나온다.
 * 여기서는 "어디까지 갔는가"만 들고 있는다 — 던전 정의(웨이브 수·세트·주차)는 data 쪽 소유다.
 *   bestWave  : 지금까지 돌파한 최고 웨이브 (0 = 한 번도 못 깼다). 단조 증가한다.
 *   clearedAt : 마지막 웨이브까지 클리어한 날(day). 아직이면 null. */

/**
 * 던전 진행 조회. 기록이 없으면 초기값을 돌려준다(상태에 쓰지는 않는다).
 * @returns {{bestWave:number, clearedAt:number|null}}
 */
export function getDungeonProgress(dungeonId, st = state) {
  const e = dungeonId && st && st.dungeons ? st.dungeons[dungeonId] : null;
  if (!e || typeof e !== 'object') return { bestWave: 0, clearedAt: null };
  const best = Math.floor(Number(e.bestWave));
  const cleared = Math.floor(Number(e.clearedAt));
  return {
    bestWave: Number.isFinite(best) && best > 0 ? best : 0,
    clearedAt: Number.isFinite(cleared) && cleared > 0 ? cleared : null,
  };
}

/**
 * 웨이브 돌파를 기록한다. `bestWave` 는 뒤로 가지 않는다(단조 증가).
 * 마지막 웨이브를 깼으면 `clearedAt` 에 그날을 박는다 — 최초 1회만 기록한다.
 * @param {string} dungeonId
 * @param {number} wave 방금 돌파한 웨이브 번호 (1부터)
 * @param {object} [opts] `{total}` 총 웨이브 수. 주면 클리어 판정까지 한다.
 * @returns {{bestWave:number, clearedAt:number|null}} 갱신 후 진행도
 */
export function recordDungeonWave(dungeonId, wave, opts = {}, st = state) {
  if (!dungeonId) return { bestWave: 0, clearedAt: null };
  if (!st.dungeons || typeof st.dungeons !== 'object' || Array.isArray(st.dungeons)) st.dungeons = {};
  const cur = getDungeonProgress(dungeonId, st);
  const w = Math.floor(Number(wave));
  const next = {
    bestWave: Math.max(cur.bestWave, Number.isFinite(w) && w > 0 ? w : 0),
    clearedAt: cur.clearedAt,
  };
  const total = Math.floor(Number(opts && opts.total));
  if (next.clearedAt == null && Number.isFinite(total) && total > 0 && next.bestWave >= total) {
    next.clearedAt = st.day;
  }
  st.dungeons[dungeonId] = next;
  touch();
  return next;
}

/* ------------------------------------------------------------------ 아이템 롤 */

function pickFn(ns, names) {
  for (const n of names) if (typeof ns?.[n] === 'function') return ns[n];
  return null;
}
const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

/**
 * 전리품/상점 아이템 1개를 굴린다.
 * gear.js에 롤러가 있으면 그것을 쓰고, 없으면 SPEC §3.3 공식으로 직접 만든다.
 */
export function rollLoot(opts = {}) {
  const r = opts.rng || rng;
  const ilvl = clamp(Math.round(opts.ilvl ?? 1), 1, 80);
  const args = { ...opts, ilvl, rng: r };
  const fn = pickFn(Gear, ['rollItem', 'rollGear', 'createItem', 'generateItem', 'makeItem']);
  if (fn) {
    try {
      const it = fn(args);
      if (it && it.uid) return it;
    } catch (e) {
      console.warn('[state] gear 롤러 실패 — 내장 롤러로 대체합니다.', e);
    }
  }
  return builtinRoll(args);
}

function rollRarity(r, bonus = 0) {
  const b = clamp(bonus || 0, 0, 1.5);
  const w = [56, 26, 12, 5, 1.4].map((v, i) => v * (1 + b * i * 1.6));
  const total = w.reduce((a, x) => a + x, 0);
  let t = r.next() * total;
  for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0) return i; }
  return 0;
}

/**
 * 슬롯을 지정하지 않았을 때 뽑을 슬롯. gear.js 롤러가 실패했을 때만 타는 폴백 경로다.
 * SLOTS 의 첫 칸(무기)을 조금 더 자주 뽑고 나머지는 균등하게 굴린다.
 */
function pickAnySlot(r) {
  const pool = (SLOTS || []).filter(Boolean);
  if (!pool.length) return 'weapon';
  return r.next() < 0.30 ? pool[0] : r.pick(pool);
}

function builtinRoll({ ilvl, rarityBonus = 0, slot, weaponType, rng: r }) {
  // 지정 슬롯은 옛 이름만 새 이름으로 바꾸고 그대로 존중한다
  // (모르는 슬롯이면 pool 이 비어 null 을 돌려줘야 호출부가 폴백을 탈 수 있다).
  const s = slot ? (slotForItem({ slot }) || slot) : pickAnySlot(r);
  let pool = [];
  try { pool = basesFor(s, ilvl) || []; } catch { pool = []; }
  if (weaponType) {
    const f = pool.filter((b) => b.weaponType === weaponType);
    if (f.length) pool = f;
  }
  if (!pool.length) return null;

  const base = r.pick(pool);
  const rarity = rollRarity(r, rarityBonus);
  const mul = (1 + 0.13 * (ilvl - 1)) * RARITY_MULT[rarity];
  const stats = {};
  for (const [k, v] of Object.entries(base.stats || {})) {
    stats[k] = FLAT_KEYS.has(k) ? Math.round(v * (1 + rarity * 0.18)) : Math.max(1, Math.round(v * mul));
  }

  const okAffix = (a) => a && (!a.minLv || a.minLv <= ilvl) && (!a.slot || a.slot === s);
  const pre = asArray(PREFIXES).filter(okAffix);
  const suf = asArray(SUFFIXES).filter(okAffix);
  const nPre = Math.min(Math.ceil(rarity / 2), pre.length);
  const nSuf = Math.min(rarity - nPre, suf.length);
  const chosen = [...r.pickMany(pre, nPre), ...r.pickMany(suf, nSuf)];
  const affixes = [];
  const affMul = 1 + 0.09 * (ilvl - 1);
  for (const a of chosen) {
    const st = {};
    for (const [k, v] of Object.entries(a.stats || {})) {
      st[k] = FLAT_KEYS.has(k) ? Math.round(v) : Math.max(1, Math.round(v * affMul));
      stats[k] = (stats[k] || 0) + st[k];
    }
    affixes.push({ id: a.id, name: a.name, stats: st });
  }

  const preName = nPre ? `${chosen[0].name} ` : '';
  const sufName = nSuf ? ` ${chosen[nPre].name}` : '';
  const value = Math.round((14 + ilvl * 7) * (1 + rarity * 0.65) * (s === 'weapon' ? 1.1 : 1));

  return {
    uid: uid('it'),
    baseId: base.id,
    name: `${preName}${base.name}${sufName}`,
    slot: s,
    weaponType: base.weaponType || null,
    rarity,
    ilvl,
    stats,
    affixes,
    value,
  };
}

/* ------------------------------------------------------------------ 날짜 진행 */

function maxHpOf(merc, idx) {
  try {
    const st = Merc.mercStats(merc, { items: idx });
    if (st && st.hp > 0) return Math.round(st.hp);
  } catch (e) {
    console.warn('[state] mercStats 실패', e);
  }
  return Math.max(1, Math.round(merc.maxHp || merc.hp || 1));
}

/**
 * 부대에 배치되지 않은 단원(대기 인원)의 임금 배율.
 *
 * ★ 왜 필요한가: 부대 상한이 5 x 7 = 35 명인데 정원은 70 까지 늘릴 수 있다.
 *   36번째 단원부터는 **수입 기여가 0인데 임금은 100% 낸다** — 정원을 늘리는 것이
 *   순수한 손실이 되어, 실측 일수지가 정원 35 +810G / 50 -1,590G / 70 -4,790G 였다.
 *   대기 인원을 싸게 두면 "예비를 두는 여유"라는 원래 의도가 살아난다.
 *
 * 0.25 는 실측으로 고른 값이다 (탑 비용 1/2 · 의뢰 보상 +20% 와 함께):
 *   정원 35 +2,092G/일 · 50 +1,372G/일 · 70 +692G/일 — 전 구간 흑자.
 */
export const BENCH_UPKEEP_MULT = 0.25;

/**
 * 하루 총임금. **이 함수가 유일한 출처다** — 실제 차감(advanceDays)과 화면 표시가
 * 서로 다른 식을 쓰면 "표시는 1만인데 2만이 빠지는" 버그가 된다.
 * 합산 지점이 6곳이나 흩어져 있었으므로 전부 여기를 부르게 했다.
 */
export function dailyUpkeep(st = state) {
  const assigned = new Set();
  for (const sq of st.squads || []) {
    for (const u of sq.memberUids || []) if (u) assigned.add(u);
  }
  let total = 0;
  for (const m of st.roster || []) {
    if (!m) continue;
    const base = m.upkeep || 0;
    total += assigned.has(m.uid) ? base : base * BENCH_UPKEEP_MULT;
  }
  return Math.round(total);
}

/** 한 단원이 실제로 내는 하루 임금 (대기면 할인 적용). 개별 표시용. */
export function upkeepOfMerc(m, st = state) {
  if (!m) return 0;
  const base = m.upkeep || 0;
  for (const sq of st.squads || []) {
    if ((sq.memberUids || []).includes(m.uid)) return base;
  }
  return Math.round(base * BENCH_UPKEEP_MULT);
}

/**
 * n일 진행. 매일 임금 지출 / 부상 회복 / **원정 부대 복귀** / 도시 목록 만료를 처리한다.
 *
 * ※ 의뢰를 끝냈다고 여기가 자동으로 불리지는 않는다. 날짜는 플레이어가 직접 넘긴다
 *   (도시 화면의 "하루 넘기기" 등). 의뢰는 부대를 `away` 로 잠글 뿐이다.
 *
 * @returns {{days:number, upkeep:number, unpaid:number, recovered:string[], returned:string[]}}
 *  - `returned` 이번 진행에서 원정을 마치고 복귀한 부대 이름들
 */
export function advanceDays(n = 1) {
  const days = Math.max(1, Math.round(n || 1));
  const out = { days: 0, upkeep: 0, unpaid: 0, recovered: [], returned: [] };

  for (let d = 0; d < days; d++) {
    state.day++;
    out.days++;

    // 원정 복귀 — 임금/회복보다 먼저 처리해 복귀 당일부터 다시 출정할 수 있게 한다.
    for (const sq of state.squads) {
      if (!sq || sq.status !== 'away') continue;
      if (state.day < (sq.returnDay || 0)) continue;
      sq.status = 'idle';
      sq.returnDay = 0;
      out.returned.push(sq.name);
      addLog(`${sq.name}이(가) 원정에서 복귀했다.`);
    }

    // 임금
    const due = dailyUpkeep(state);
    if (due > 0) {
      if (state.gold >= due) {
        state.gold -= due;
        out.upkeep += due;
      } else {
        const short = due - state.gold;
        out.upkeep += state.gold;
        out.unpaid += short;
        state.gold = 0;
        const loss = Math.max(1, Math.ceil(short / 60));
        state.renown = Math.max(0, state.renown - loss);
        addLog(`임금 ${num(short)}G가 밀렸다. 단원들의 불만이 커진다. (명성 -${loss})`);
      }
    }

    // 부상 회복 / 자연 회복
    const idx = itemsById();
    for (const m of state.roster) {
      const maxHp = maxHpOf(m, idx);
      m.maxHp = maxHp;
      if (m.status === 'wounded') {
        if (state.day >= (m.woundUntil || 0)) {
          m.status = 'ready';
          m.woundUntil = 0;
          m.hp = maxHp;
          out.recovered.push(m.name);
          addLog(`${m.name}이(가) 부상에서 회복했다.`);
        } else {
          m.hp = clamp(Math.round((m.hp || 1) + maxHp * RECOVER_WOUNDED), 1, maxHp);
        }
      } else {
        m.hp = clamp(Math.round((m.hp || maxHp) + maxHp * RECOVER_READY), 1, maxHp);
      }
    }

    expireCityLists();
  }

  if (out.upkeep > 0) addLog(`${out.days}일이 지났다. 임금으로 ${num(out.upkeep)}G를 지출했다.`);
  touch();
  return out;
}

/* ------------------------------------------------------------------ 원정 조회 */

/* 도시 이동과 원정의 관계:
 * 부대는 도시를 따로 갖지 않는다(`state.cityId` 하나뿐). 그래서 원정 중인 부대가 있는 상태로
 * 도시를 옮기면 그 부대도 **함께 이동한 것**이 된다. 복귀일(`returnDay`)은 그대로 유지되고
 * 별도 페널티는 없다 — 이동에 든 일수만큼 복귀도 자연히 가까워진다.
 * 다만 플레이어 입장에서는 "원정 보낸 부대를 두고 떠나는" 것처럼 보이므로,
 * 월드맵 UI 는 `anySquadAway()` 로 확인해 이동 전에 경고를 띄운다. */

/** 원정(`status:'away'`) 중인 부대 목록. 필드가 없는 예전 세이브는 idle 로 본다. */
export function awaySquads(st = state) {
  const day = (st && st.day) || 0;
  return (st.squads || []).filter((sq) => sq && sq.status === 'away' && (sq.returnDay || 0) > day);
}

/** 원정 나간 부대가 하나라도 있는가 (월드맵 이동 경고용) */
export function anySquadAway(st = state) {
  return awaySquads(st).length > 0;
}

/**
 * 가장 빨리 복귀하는 부대까지 남은 일수. 원정 중인 부대가 없으면 null.
 * 도시 화면의 "부대 복귀까지 넘기기" 버튼이 이 값을 그대로 advanceDays 에 넘기면 된다.
 * @returns {number|null}
 */
export function daysUntilNextReturn(st = state) {
  const day = (st && st.day) || 0;
  let best = null;
  for (const sq of awaySquads(st)) {
    const left = Math.max(1, Math.round((sq.returnDay || 0) - day));
    if (best == null || left < best) best = left;
  }
  return best;
}

/**
 * 여관 휴식. 날짜만 넘기는 게 아니라 실제로 치료한다.
 * - 하루당 부상 잔여 기간을 REST_WOUND_SPEEDUP 일 추가로 단축한다
 *   (자연 경과 1일 + 단축 1일 = 하루 묵으면 부상이 2일치 줄어든다).
 * - 하루당 maxHp의 REST_HEAL 만큼 추가 회복한다 (자연 회복과 별도).
 *
 * 숙박비 계산/차감은 UI(ui/city.js) 담당이다. 여기서는 골드를 건드리지 않는다.
 *
 * @param {number} days 묵을 일수
 * @returns {{days:number, healed:{name:string, from:number, to:number}[], recovered:string[]}}
 */
export function restAtInn(days = 1) {
  const n = Math.max(1, Math.round(days || 1));

  // 휴식 전 체력을 기록해 둔다 (요약 표기용).
  const before = new Map();
  for (const m of state.roster) before.set(m.uid, Math.max(0, Math.round(m.hp || 0)));

  // 날짜가 흐르기 전에 부상 잔여 기간을 먼저 깎는다.
  // 이래야 이번 advanceDays 안에서 회복 판정(state.day >= woundUntil)이 실제로 걸린다.
  const cut = n * REST_WOUND_SPEEDUP;
  for (const m of state.roster) {
    if (m.status === 'wounded') m.woundUntil = Math.max(state.day, (m.woundUntil || 0) - cut);
  }

  const adv = advanceDays(n);

  // 자연 회복 위에 휴식분을 얹는다.
  const idx = itemsById();
  for (const m of state.roster) {
    const maxHp = maxHpOf(m, idx);
    m.maxHp = maxHp;
    const cur = clamp(Math.round(m.hp ?? maxHp), 1, maxHp);
    m.hp = clamp(Math.round(cur + maxHp * REST_HEAL * n), 1, maxHp);
  }

  const healed = [];
  for (const m of state.roster) {
    const from = before.has(m.uid) ? before.get(m.uid) : Math.round(m.hp || 0);
    const to = Math.round(m.hp || 0);
    if (to > from) healed.push({ name: m.name, from, to });
  }

  touch();
  return { days: adv.days, healed, recovered: adv.recovered.slice() };
}

/** 오래된 도시 목록을 버리고, 기한이 지난 의뢰를 제거한다. */
function expireCityLists() {
  for (const key of ['quests', 'tavern', 'shop']) {
    const book = state[key];
    for (const cityId of Object.keys(book)) {
      const entry = book[cityId];
      if (!entry || !Array.isArray(entry.list) || state.day - (entry.day || 0) >= REFRESH_DAYS) {
        delete book[cityId];
      }
    }
  }
  for (const cityId of Object.keys(state.quests)) {
    const entry = state.quests[cityId];
    entry.list = entry.list.filter((q) => (q.expiresDay ?? Infinity) >= state.day);
    if (!entry.list.length) delete state.quests[cityId];
  }
}

/* ------------------------------------------------------------------ 도시 목록 */

/** 주점 제안 생성. 등급은 여기서 정하지 않는다 (고용 순간에 롤). */
function genTavern(city, r) {
  const tier = clamp(city.tier || 1, 1, 5);
  const count = clamp(3 + r.int(0, 2) + (tier >= 4 ? 1 : 0), 3, 6);

  /* ★ 그 도시의 특화 클래스는 **항상** 목록에 넣는다.
   * 예전에는 전체 1차 클래스에서 무작위로만 뽑아서, S 등급이 특화 도시에서만 나오는데
   * 정작 그 도시에 특화 클래스가 안 뜨는 날이 많았다. 특화 도시를 찾아간 이유가 사라진다.
   * 나머지 자리는 예전대로 무작위로 채운다. */
  const base = Array.isArray(BASE_CLASSES) ? BASE_CLASSES : [];
  const spec = (Array.isArray(city.specialty) ? city.specialty : []).filter((c) => base.includes(c));
  const rest = r.pickMany(base.filter((c) => !spec.includes(c)), Math.max(0, count - spec.length));
  const classes = [...spec, ...rest];

  return classes.map((classId) => {
    let base = 0;
    try { base = Merc.hireCost(classId, 'C', 1) || 0; } catch { base = 0; }
    if (!base) base = 260;
    const cost = Math.round(base * (1 + 0.2 * (tier - 1)) * r.float(0.88, 1.18) / 5) * 5;
    return { classId, cost };
  });
}

/** 상점 재고 생성. 도시 tier와 단원 평균 레벨로 아이템 레벨을 정한다. */
function genShop(city, r) {
  const tier = clamp(city.tier || 1, 1, 5);
  const avgLv = state.roster.length
    ? state.roster.reduce((a, m) => a + (m.level || 1), 0) / state.roster.length
    : 1;
  const ilvlBase = clamp(Math.round(avgLv * 0.9 + tier * 2.2), 1, 60);
  const count = 5 + r.int(0, 4);
  const list = [];
  for (let i = 0; i < count; i++) {
    const ilvl = clamp(ilvlBase + r.int(-2, 4), 1, 60);
    const it = rollLoot({ ilvl, rarityBonus: 0.04 * tier, rng: r });
    if (it) {
      it.price = Math.round(it.value * r.float(1.35, 1.7));
      list.push(it);
    }
  }
  return list;
}

/**
 * 도시의 주점/상점/의뢰 목록을 필요할 때(3일 주기) 재생성한다.
 * @param {string} cityId
 * @param {boolean} force 강제 리롤
 */
export function refreshCity(cityId = state.cityId, force = false) {
  const city = getCity(cityId);
  if (!city) return null;
  const r = rng;
  const stale = (e) => force || !e || !Array.isArray(e.list) || state.day - (e.day || 0) >= REFRESH_DAYS;
  let changed = false;

  if (stale(state.quests[cityId])) {
    state.quests[cityId] = { day: state.day, list: Quest.genQuests(cityId, state.day, r) };
    changed = true;
  } else {
    const before = state.quests[cityId].list.length;
    state.quests[cityId].list = state.quests[cityId].list.filter((q) => (q.expiresDay ?? Infinity) >= state.day);
    changed = changed || state.quests[cityId].list.length !== before;
  }
  if (stale(state.tavern[cityId])) {
    state.tavern[cityId] = { day: state.day, list: genTavern(city, r) };
    changed = true;
  }
  if (stale(state.shop[cityId])) {
    state.shop[cityId] = { day: state.day, list: genShop(city, r) };
    changed = true;
  }

  if (changed) touch();
  return {
    quests: state.quests[cityId].list,
    tavern: state.tavern[cityId].list,
    shop: state.shop[cityId].list,
  };
}
