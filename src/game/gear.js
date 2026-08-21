// 장비 롤링 / 장착 / 매각. 순수 JS (DOM 참조 금지).
//
// 아이템 실물 형태 (SPEC §3.3):
//   { uid, baseId, name, slot, weaponType, rarity, ilvl, minLv,
//     stats, baseStats, affixes:[{id,name,stats,kind}], value, weight, desc }
//   ※ `stats` 는 베이스 + 접사를 모두 합친 "최종 합계"다. baseStats는 표기용 원본.
//
// 주의: state.js 와 순환 import 관계다. `globalState` 는 함수 안에서만 읽는다.
import { clamp } from '../core/util.js';
import { rng as defaultRng, uid } from '../core/rng.js';
import { ITEM_BASES, PREFIXES, SUFFIXES, WEAPON_TYPES, basesFor } from '../data/items.js';
// items.js 가 gear.js 용으로 제공하는 편의 함수들(scaleBaseStats / prefixesFor / uniquesFor …)은
// SPEC 계약에 없는 확장이라 네임스페이스로 받아 "있으면 쓰는" 방식으로만 사용한다.
import * as ITEMS from '../data/items.js';
// 던전 신화 세트(설계 B)의 **유일한 진실의 원천**. 40개 파츠 실물·세트 효과·아키타입 제한을 소유한다.
// items.js 의 ITEM_SETS(2피스 소형 세트 3종)와 공존하며, 같은 id 가 있으면 sets.js 가 이긴다.
import * as SETS_DATA from '../data/sets.js';
import { getClass } from '../data/classes.js';
import { state as globalState } from './state.js';

/* ─────────────────────────── 상수 ─────────────────────────── */

/* ── 설계 A: 장비 슬롯 3 → 10 ──────────────────────────────────────────────
 * 슬롯 정의(SLOTS / SLOT_NAME / SLOT_POWER)의 **주인은 `data/items.js`** 다.
 * gear.js 는 그걸 그대로 받아 재export 만 한다 (UI 들이 예전부터 gear 에서 import 하고 있다).
 * 아래 FALLBACK_* 는 items.js 가 아직 옛 3슬롯일 때도 모듈이 죽지 않게 두는 **비상 사본**이며,
 * items.js 가 값을 주면 언제나 그쪽이 이긴다. 여기서 슬롯을 새로 정의하지 마라.
 *
 * ★ 슬롯별 스탯 계수(SLOT_POWER)는 **items.js 가 베이스 스탯에 이미 반영한다.**
 *   gear.js 는 그 위에 어떤 배율도 얹지 않는다 — 슬롯이 10칸이 되면서 장비 총량이 폭증하는 것이
 *   이번 확장 최대의 밸런스 위험이고, 계수를 두 군데서 곱하면 랭크 승률 대역이 통째로 무너진다.
 */
const FALLBACK_SLOTS = ['weapon', 'offhand', 'head', 'body', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2'];
const FALLBACK_SLOT_NAME = {
  weapon: '오른손', offhand: '왼손', head: '머리', body: '상의', legs: '하의',
  hands: '장갑', feet: '신발', neck: '목걸이', ring1: '반지1', ring2: '반지2',
  // 옛 세이브 표기 (아이템에 남아 있는 옛 slot 값도 이름이 나와야 한다)
  armor: '방어구', accessory: '장신구', ring: '반지',
};
/** 참고용 사본. **여기서 곱하지 않는다** (위 주석 참조) */
const FALLBACK_SLOT_POWER = {
  weapon: 1.00, offhand: 0.50, head: 0.45, body: 0.60, legs: 0.45,
  hands: 0.35, feet: 0.35, neck: 0.40, ring1: 0.30, ring2: 0.30,
};

/** 장비 슬롯 10칸 (SPEC 설계 A). 정의는 data/items.js 소유. */
export const SLOTS = Array.isArray(ITEMS.SLOTS) && ITEMS.SLOTS.length ? ITEMS.SLOTS.slice() : FALLBACK_SLOTS.slice();
/** 슬롯 한국어 이름 */
export const SLOT_NAME = { ...FALLBACK_SLOT_NAME, ...(ITEMS.SLOT_NAME || {}) };
/** 슬롯별 스탯 계수 (items.js 가 적용한다 — 조회/표기용) */
export const SLOT_POWER = { ...FALLBACK_SLOT_POWER, ...(ITEMS.SLOT_POWER || {}) };

const has = (s) => SLOTS.includes(s);
/** 방어구 5칸 */
export const ARMOR_SLOTS = ['head', 'body', 'legs', 'hands', 'feet'].filter(has);
/** 장신구 3칸 */
export const ACCESSORY_SLOTS = ['neck', 'ring1', 'ring2'].filter(has);
/** 반지 2칸 (어느 쪽이든 같은 아이템을 받는다) */
export const RING_SLOTS = ['ring1', 'ring2'].filter(has);
/** 양손 2칸 */
export const HAND_SLOTS = ['weapon', 'offhand'].filter(has);

/**
 * 옛 세이브 슬롯 → 새 슬롯. 세이브 하위 호환의 핵심이다.
 *   weapon → weapon (그대로) / armor → body / accessory → neck
 */
export const LEGACY_SLOT_MAP = { armor: 'body', accessory: 'neck', trinket: 'neck', ring: 'ring1' };

/* ── 설계 B: 희귀도 5 = 신화(Mythic) ─────────────────────────────────────
 * 0 일반 / 1 고급 / 2 희귀 / 3 영웅 / 4 전설 / **5 신화(세트)**.
 * 신화는 던전 보스만 떨어뜨린다 — 일반 전리품 가중치는 0 이다.
 * 배율 2.7 = 전설(2.0) × 1.35 (같은 ilvl 전설의 1.35배라는 설계 B 요구).
 */
export const RARITY_MYTHIC = 5;
export const RARITY_MULT = (Array.isArray(ITEMS.RARITY_MULT) && ITEMS.RARITY_MULT.length > 5)
  ? ITEMS.RARITY_MULT.slice()
  : [1, 1.15, 1.35, 1.62, 2.0, 2.7];
/** 희귀도 상한 (= 신화) */
export const MAX_RARITY = RARITY_MULT.length - 1;
/**
 * 희귀도 기본 가중치 [일반, 고급, 희귀, 영웅, 전설, 신화].
 * 신화(5)는 0 — 일반 전리품에서는 절대 안 나온다(던전 세트 전용).
 *
 * ★ 예전 값 [55, 27, 13, 4.2, 0.8] 은 기울기가 너무 가팔라서, ilvl 보정(step)을 다 먹여도
 *   후반 드랍의 절반 이상이 일반·고급이었다(S랭크 ilvl80 실측 53.4%, 전설 5.1%).
 *   "후반에 쓸만한 게 없다"의 직접 원인이라 완만하게 눕혔다.
 *   실측 (S랭크 rarityBonus 0.5): ilvl80 일반+고급 53.4% → 40.0%, 전설 5.1% → 12.3%.
 *   초반(ilvl10, bonus 0)은 79.9% → 70.7% 로 거의 그대로다 — 초반 보호를 깨지 않는다.
 */
export const RARITY_WEIGHTS = [44, 28, 16, 7.5, 2.4, 0];
export const RARITY_VALUE = [1, 1.7, 2.8, 4.8, 9.5, 18];
/** 판매가 = 가치 * SELL_RATE */
export const SELL_RATE = 0.4;

const SCALING_KEYS = ['hp', 'atk', 'def', 'res', 'spd'];
const STAT_KEYS = ['hp', 'atk', 'def', 'res', 'spd', 'crit', 'critDmg', 'eva'];

/**
 * 전리품 슬롯 추첨 가중치. 실제 후보는 `data/items.js` 에 베이스가 존재하는 슬롯으로 한정된다
 * (items.js 가 아직 옛 3슬롯이어도 그대로 굴러가게 하기 위함).
 */
const SLOT_LOOT_WEIGHT = {
  weapon: 14, offhand: 10, head: 10, body: 12, legs: 10, hands: 9, feet: 9,
  neck: 9, ring: 16, ring1: 8, ring2: 8,
  armor: 34, accessory: 26, // 옛 3슬롯 데이터용
  ...(ITEMS.SLOT_DROP_WEIGHT || {}), // items.js 가 표를 주면 그쪽이 이긴다
};

/** 무기 타입 한국어 (data/items.js가 이름을 안 주면 이걸 쓴다) */
const WEAPON_TYPE_NAME = {
  sword: '검', greatsword: '대검', spear: '창', axe: '도끼', bow: '활', crossbow: '석궁',
  dagger: '단검', staff: '지팡이', wand: '완드', mace: '둔기', shield: '방패',
  tome: '마도서', claw: '발톱', scythe: '낫', katana: '카타나',
};

/** 양손 무기 — 들면 `offhand` 가 잠긴다. WEAPON_TYPES[t].twoHanded 가 있으면 그쪽이 우선. */
export const TWO_HANDED_TYPES = new Set(['greatsword', 'bow', 'crossbow', 'staff', 'scythe', 'spear']);

/**
 * 받침 유무에 맞는 조사를 고른다. 한글이 아니면 '을(를)' 형태로 안전하게 돌려준다.
 * @param {string} word 앞말
 * @param {string} pair '을/를' | '은/는' | '이/가' | '와/과' | '으로/로'
 */
export function josa(word, pair = '을/를') {
  const [withBatchim, without] = pair.split('/');
  const ch = String(word ?? '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return `${withBatchim}(${without})`;
  const jong = (code - 0xac00) % 28;
  // '으로/로' 는 ㄹ 받침(=8)도 받침 없음처럼 취급한다
  if (pair === '으로/로' && jong === 8) return without;
  return jong ? withBatchim : without;
}

/* ─────────────────────────── 내부 헬퍼 ─────────────────────────── */

/** 순환 import 대비 안전 접근 */
function gs() { try { return globalState; } catch { return null; } }
function useState(s) {
  if (s && (Array.isArray(s.items) || Array.isArray(s.roster) || Array.isArray(s.squads))) return s;
  return gs();
}
function isState(s) { return !!(s && (Array.isArray(s.items) || Array.isArray(s.roster) || Array.isArray(s.squads))); }
/** 첫 인자가 state가 아닌 "값"이면 state를 생략한 호출로 보고 인자를 한 칸 민다 */
function shifted(s) { return s != null && !isState(s); }

function asList(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === 'object') return Object.values(x);
  return [];
}

/** 베이스 목록 / 조회 */
export function itemBaseList() { return asList(ITEM_BASES).filter((b) => b && b.id); }
export function getBase(id) {
  if (!id) return null;
  if (typeof ITEMS.baseById === 'function') { const b = ITEMS.baseById(id); if (b) return b; }
  if (ITEM_BASES && !Array.isArray(ITEM_BASES) && ITEM_BASES[id]) return ITEM_BASES[id];
  return itemBaseList().find((b) => b.id === id) || null;
}

export function weaponTypeName(t) {
  if (!t) return '';
  const src = WEAPON_TYPES;
  if (src && !Array.isArray(src) && typeof src === 'object') {
    const v = src[t];
    if (typeof v === 'string') return v;
    if (v && typeof v.name === 'string') return v.name;
  }
  return WEAPON_TYPE_NAME[t] || t;
}

/* ── 아이템 조회 함수 (merc.js itemLookup 과 같은 입력들을 받는다) ── */

const _itemIndex = new WeakMap();
function indexItems(arr) {
  let e = _itemIndex.get(arr);
  if (!e || e.len !== arr.length) {
    e = { len: arr.length, map: new Map() };
    for (const it of arr) if (it && it.uid) e.map.set(it.uid, it);
    _itemIndex.set(arr, e);
  }
  return e;
}

/**
 * Item[] / state / {items:…} / Map / {uid:Item} / null(=전역 state) 을 모두 받아
 * `(uid) => item|null` 조회 함수를 만든다.
 */
export function itemFinder(src) {
  let s = src == null ? gs() : src;
  if (!s) return () => null;
  if (!Array.isArray(s) && typeof s.get !== 'function' && s.items) s = s.items;
  if (!s) return () => null;
  if (typeof s.get === 'function') return (u) => (u ? s.get(u) || null : null);
  if (Array.isArray(s)) {
    return (u) => {
      if (!u) return null;
      let e = indexItems(s);
      if (!e.map.has(u)) { _itemIndex.delete(s); e = indexItems(s); }
      return e.map.get(u) || null;
    };
  }
  return (u) => (u && typeof s === 'object' ? s[u] || null : null);
}

/* ─────────────────────────── 슬롯 규칙 (설계 A) ─────────────────────────── */

/** 이 무기 타입이 양손인가 */
export function isTwoHandedType(type) {
  if (!type) return false;
  const def = WEAPON_TYPES && !Array.isArray(WEAPON_TYPES) ? WEAPON_TYPES[type] : null;
  if (def && typeof def.twoHanded === 'boolean') return def.twoHanded;
  return TWO_HANDED_TYPES.has(type);
}

/** 이 아이템이 양손 무기인가 (아이템 → 베이스 → 무기타입 순으로 본다) */
export function isTwoHandedItem(item) {
  if (!item) return false;
  if (typeof item.twoHanded === 'boolean') return item.twoHanded;
  let wt = item.weaponType;
  if (wt === undefined) {
    const base = getBase(item.baseId);
    if (base && typeof base.twoHanded === 'boolean') return base.twoHanded;
    wt = base && base.weaponType;
  }
  // 방패는 절대 양손이 아니다 (왼손 전용)
  if (!wt || wt === 'shield') return false;
  return isTwoHandedType(wt);
}

/**
 * 이 아이템이 들어갈 수 있는 슬롯들 (선호 순). 없으면 빈 배열.
 * - 방패는 `slot` 값이 무엇이든 **왼손(offhand)** 으로 간다 (옛 세이브의 방패는 slot='weapon' 이다)
 * - 반지는 `ring1`/`ring2` 어느 쪽이든 가능
 * - 옛 슬롯(armor/accessory)은 `LEGACY_SLOT_MAP` 으로 옮긴다
 */
export function slotsForItem(item) {
  if (!item) return [];
  let s = item.slot;
  let wt = item.weaponType;
  // 실물 아이템은 slot/weaponType 을 항상 들고 있다 — 없을 때만 베이스를 뒤진다 (자동배분 핫패스)
  if (s == null || wt === undefined) {
    const base = getBase(item.baseId);
    if (base) {
      if (s == null) s = base.slot;
      if (wt === undefined) wt = base.weaponType;
    }
  }
  if (wt === 'shield' && has('offhand')) return ['offhand'];
  if (!s) return [];
  s = LEGACY_SLOT_MAP[s] && !has(s) ? LEGACY_SLOT_MAP[s] : s;
  if (s === 'ring' || RING_SLOTS.includes(s)) return RING_SLOTS.slice();
  return has(s) ? [s] : [];
}

/** 이 아이템의 대표 슬롯 (UI 표기·필터 기본값) */
export function primarySlot(item) {
  const list = slotsForItem(item);
  return list[0] || (item && item.slot) || null;
}

/** 그 슬롯이 이 아이템을 받는가 */
export function slotAccepts(slot, item) {
  if (!slot) return !!slotsForItem(item).length;
  const s = has(slot) ? slot : (LEGACY_SLOT_MAP[slot] || slot);
  return slotsForItem(item).includes(s);
}

/** 슬롯 이름 정규화 (옛 이름 허용). 알 수 없으면 null */
export function normalizeSlot(slot) {
  if (!slot) return null;
  if (has(slot)) return slot;
  const m = LEGACY_SLOT_MAP[slot];
  return m && has(m) ? m : null;
}

/**
 * 옛 세이브의 `equipment` 를 10슬롯 형태로 정규화한다 (새 객체를 만든다).
 * `{weapon, armor, accessory}` → `weapon / body / neck` 으로 옮기고 나머지는 빈 칸이다.
 */
export function normalizeEquipment(eq) {
  const out = {};
  for (const s of SLOTS) out[s] = null;
  if (eq && typeof eq === 'object') {
    for (const s of SLOTS) { const v = eq[s]; if (typeof v === 'string' && v) out[s] = v; }
    for (const [old, next] of Object.entries(LEGACY_SLOT_MAP)) {
      const v = eq[old];
      if (typeof v === 'string' && v && has(next) && !out[next]) out[next] = v;
    }
  }
  return out;
}

/** 용병의 equipment 를 제자리에서 정규화하고 돌려준다 */
export function ensureEquipment(merc) {
  if (!merc) return null;
  const eq = merc.equipment;
  const okShape = eq && typeof eq === 'object'
    && SLOTS.every((s) => s in eq)
    && !Object.keys(LEGACY_SLOT_MAP).some((k) => !has(k) && eq[k]);
  if (okShape) return eq;
  merc.equipment = normalizeEquipment(eq);
  return merc.equipment;
}

/** equipment 객체가 실제로 쓰는 키들 (옛 키가 남아 있어도 훑는다) */
function slotKeysOf(eq) {
  const keys = SLOTS.slice();
  if (eq && typeof eq === 'object') for (const k of Object.keys(eq)) if (!keys.includes(k)) keys.push(k);
  return keys;
}

/** 그 용병이 지금 왼손을 쓸 수 없는가 (= 양손 무기 착용 중) */
export function offhandLocked(merc, itemsById = null) {
  if (!merc || !has('offhand')) return false;
  const find = itemFinder(itemsById);
  const eq = merc.equipment || {};
  return isTwoHandedItem(find(eq.weapon));
}

/**
 * 그 용병이 낄 수 있는 칸 수. 양손 무기를 들면 왼손이 잠겨 **9칸**이다.
 * 세트 "풀세트" 판정 기준이 바로 이 값이다 (고정 10이 아니다).
 */
export function equippableSlotCount(merc, itemsById = null) {
  const n = SLOTS.length;
  return offhandLocked(merc, itemsById) ? Math.max(1, n - 1) : n;
}

/** 지금 잠겨 있는 슬롯 목록 */
export function lockedSlots(merc, itemsById = null) {
  return offhandLocked(merc, itemsById) ? ['offhand'] : [];
}

/** 용병이 착용 중인 아이템 배열 (슬롯 순서) */
export function wornItems(merc, itemsById = null) {
  if (!merc) return [];
  const find = itemFinder(itemsById);
  const eq = merc.equipment || {};
  const out = [];
  const seen = new Set();
  for (const s of slotKeysOf(eq)) {
    const u = eq[s];
    if (!u || typeof u !== 'string' || seen.has(u)) continue;
    const it = find(u);
    if (it) { seen.add(u); out.push(it); }
  }
  return out;
}

/* ─────────────────────────── 롤링 준비 ─────────────────────────── */

/** 요청 슬롯이 받아들일 수 있는 "베이스의 slot 값" 후보 (데이터 형태가 달라도 찾아내기 위함) */
function baseSlotAliases(slot) {
  if (!slot) return [];
  const out = [slot];
  if (RING_SLOTS.includes(slot)) out.push('ring', ...RING_SLOTS.filter((s) => s !== slot));
  if (slot === 'body') out.push('armor');
  if (slot === 'neck') out.push('accessory', 'trinket');
  if (slot === 'armor') out.push('body');
  if (slot === 'accessory') out.push('neck');
  return [...new Set(out)];
}

/** 후보 베이스 목록 (basesFor 우선, 실패 시 자체 필터). 고유 아이템은 제외한다. */
function candidateBases(slot, ilvl, weaponType) {
  const aliases = baseSlotAliases(slot);
  // 무기 타입이 자기 슬롯을 선언하고 있으면(방패 = offhand) 그 풀도 후보에 넣는다
  if (weaponType && WEAPON_TYPES && !Array.isArray(WEAPON_TYPES)) {
    const wdef = WEAPON_TYPES[weaponType];
    if (wdef && wdef.slot && !aliases.includes(wdef.slot)) aliases.push(wdef.slot);
  }
  const accept = (b) => {
    if (!b || b.unique) return false;
    // 세트(신화) 조각은 던전 보스 전용이다 — 일반 전리품 풀에 절대 섞이지 않는다
    if (b.setId || b.rarity === RARITY_MYTHIC) return false;
    if (weaponType && b.weaponType !== weaponType) return false;
    if (slot) {
      if (slot === 'offhand') {
        if (!(aliases.includes(b.slot) || b.weaponType === 'shield')) return false;
      } else if (!aliases.includes(b.slot)) return false;
      // 방패는 오른손(무기) 후보가 아니다 (타입을 콕 집어 요청한 경우는 예외)
      if (slot === 'weapon' && b.weaponType === 'shield' && weaponType !== 'shield') return false;
    }
    return true;
  };

  let list = [];
  if (typeof basesFor === 'function') {
    for (const s of aliases) {
      let got = [];
      try { got = asList(basesFor(s, ilvl, weaponType ? { weaponTypes: [weaponType] } : {})); } catch { got = []; }
      list = list.concat(got.map((b) => (typeof b === 'string' ? getBase(b) : b)).filter(Boolean));
    }
  }
  list = list.filter(accept);
  if (!list.length) list = itemBaseList().filter((b) => accept(b) && (b.minLv || 1) <= ilvl + 2);
  if (!list.length) list = itemBaseList().filter(accept);
  // uid 중복 제거 (여러 alias 에서 같은 베이스가 들어올 수 있다)
  const seen = new Set();
  return list.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
}

/** 합성 베이스 — items.js에 맞는 베이스가 아예 없을 때의 최후 수단 */
function fallbackBase(slot, weaponType) {
  const s = slot || 'weapon';
  const table = {
    weapon: { name: '낡은 무기', stats: { atk: 6 } },
    offhand: { name: '낡은 방패', stats: { def: 3, hp: 12 } },
    head: { name: '낡은 투구', stats: { def: 2, hp: 10 } },
    body: { name: '낡은 갑옷', stats: { def: 4, hp: 16 } },
    legs: { name: '낡은 각반', stats: { def: 2, hp: 10 } },
    hands: { name: '낡은 장갑', stats: { def: 2, atk: 1 } },
    feet: { name: '낡은 신발', stats: { def: 2, spd: 1 } },
    neck: { name: '낡은 목걸이', stats: { res: 3, hp: 8 } },
    ring1: { name: '낡은 반지', stats: { atk: 2, crit: 1 } },
    ring2: { name: '낡은 반지', stats: { atk: 2, crit: 1 } },
    armor: { name: '낡은 갑옷', stats: { def: 5, hp: 20 } },
    accessory: { name: '낡은 장신구', stats: { res: 3, spd: 2 } },
  };
  const t = table[s] || table.weapon;
  return {
    id: `plain_${s}`, name: t.name,
    slot: s, weaponType: s === 'weapon' ? weaponType || 'sword' : null,
    minLv: 1, stats: t.stats, weight: 5, desc: '어디서나 굴러다니는 물건.',
  };
}

/** 실제로 베이스가 존재하는 슬롯만 담은 전리품 추첨표 */
let _lootSlots = null;
function lootSlotEntries() {
  if (_lootSlots) return _lootSlots;
  const present = new Set();
  for (const b of itemBaseList()) if (!b.unique && b.slot) present.add(b.slot);
  const entries = [...present].map((s) => ({ slot: s, w: SLOT_LOOT_WEIGHT[s] ?? 10 })).filter((e) => e.w > 0);
  _lootSlots = entries.length ? entries : [{ slot: SLOTS[0] || 'weapon', w: 1 }];
  return _lootSlots;
}

/** 접사 후보 필터 */
function affixCandidates(pool, { slot, ilvl, weaponType }) {
  return asList(pool).filter((a) => {
    if (!a || !(a.stats || a.mods)) return false;
    const min = a.minIlvl ?? a.minLv ?? a.ilvl ?? 0;
    if (ilvl < min) return false;
    const slots = a.slots || (a.slot ? [a.slot] : null);
    if (slots && slots.length && !slots.includes(slot) && !slots.includes('all')) {
      // 새 슬롯 이름과 옛 이름이 섞여 있어도 통과시킨다
      const alt = baseSlotAliases(slot);
      if (!alt.some((x) => slots.includes(x))) return false;
    }
    const wt = a.weaponTypes || null;
    if (wt && wt.length && weaponType && !wt.includes(weaponType)) return false;
    return true;
  });
}

/**
 * 접사 스탯 확정 (범위 [min,max] 표기도 지원).
 * ★ **슬롯을 반드시 넘긴다.** items.js 의 `scaleAffixStats(stats, ilvl, slot)` 가 슬롯 계수를
 *   여기서 곱한다 — 슬롯이 10칸이 되면서 접사 총량도 같이 불어나기 때문이다.
 *   슬롯을 빼먹으면 장갑·신발까지 무기와 같은 접사를 달고 장비 총량이 폭증한다.
 */
function resolveAffixStats(a, ilvl, rng, slot = null) {
  const src = a.stats || a.mods || {};
  const rolled = {};
  for (const k of Object.keys(src)) {
    const raw = src[k];
    const v = Array.isArray(raw) ? rng.float(raw[0], raw[1]) : raw;
    if (v) rolled[k] = v;
  }
  if (typeof ITEMS.scaleAffixStats === 'function') return ITEMS.scaleAffixStats(rolled, ilvl, slot);
  const p = (slot && SLOT_POWER[slot]) || 1;
  const out = {};
  for (const k of Object.keys(rolled)) {
    const v = rolled[k] * p;
    if (SCALING_KEYS.includes(k)) {
      const n = v * (1 + 0.13 * (ilvl - 1));
      out[k] = v > 0 ? Math.max(1, Math.round(n)) : Math.min(-1, Math.round(n));
    } else {
      out[k] = Math.round(v * (1 + 0.012 * (ilvl - 1)) * 10) / 10;
    }
  }
  return out;
}

/**
 * 베이스 스탯 스케일 (SPEC §3.3). items.js의 scaleBaseStats가 있으면 그걸 쓴다.
 * ★ 슬롯 계수(SLOT_POWER)는 **items.js 안에서** 곱해진다. 여기서 또 곱하지 마라.
 */
function scaleBase(base, ilvl, rarity, slot = null) {
  if (typeof ITEMS.scaleBaseStats === 'function') return ITEMS.scaleBaseStats(base, ilvl, rarity, { slot: slot || base.slot });
  const mult = RARITY_MULT[clamp(rarity, 0, MAX_RARITY)];
  const scale = 1 + 0.13 * (ilvl - 1);
  const p = SLOT_POWER[slot || base.slot] || 1;
  const out = {};
  for (const k of Object.keys(base.stats || {})) {
    const v = (base.stats[k] || 0) * p;
    if (!v) continue;
    if (SCALING_KEYS.includes(k)) out[k] = v > 0 ? Math.max(1, Math.round(v * scale * mult)) : Math.min(-1, Math.round(v * scale * mult));
    else out[k] = Math.round(v * (1 + 0.012 * (ilvl - 1)) * (1 + (mult - 1) * 0.5) * 10) / 10;
  }
  return out;
}

/** 가중 비복원 추출 */
function pickWeighted(list, n, rng, weightOf = () => 1) {
  const pool = list.slice();
  const out = [];
  while (out.length < n && pool.length) {
    const entries = pool.map((x, i) => ({ x, i, w: Math.max(0.01, weightOf(x)) }));
    const e = rng.weighted(entries);
    out.push(e.x);
    pool.splice(e.i, 1);
  }
  return out;
}

/**
 * "접두사 + ' ' + 베이스명 + 접미사" 조립 (data/items.js 계약).
 * 접미사 이름은 '의 맹수'처럼 조사를 이미 품고 있어 공백 없이 붙인다.
 *   예) '날카로운' + '롱소드' + '의 맹수' -> '날카로운 롱소드의 맹수'
 */
function joinName(prefix, base, suffix) {
  let s = prefix ? `${prefix} ${base}` : base;
  if (suffix) s += /^[가-힣]/.test(suffix) && !suffix.startsWith(' ') ? suffix : ` ${suffix}`;
  return s;
}

/* ─────────────────────────── 롤링 ─────────────────────────── */

/** ilvl / 보너스를 반영한 희귀도 가중치 (신화는 항상 0 — 던전 보스 전용) */
export function rarityWeights(ilvl = 1, rarityBonus = 0) {
  const b = Math.max(0, rarityBonus || 0);
  /* ★ 분모가 60 이면 t 가 **ilvl 61 에서 1.0 으로 포화**한다.
   * 그 결과 ilvl 61 과 80 의 등급 분포가 소수점까지 같아져, 게임 후반 20레벨 동안
   * 장비 진행이 통째로 멈춘다(실측: ilvl 60/61/70/80 전부 전설 4~5.6%).
   * 아이템 레벨 상한이 80 이므로 79 로 나눠 곡선이 마지막 레벨까지 이어지게 한다. */
  const t = clamp((ilvl - 1) / 79, 0, 1);
  const step = 1 + 0.55 * b + 0.5 * t;
  const w = RARITY_WEIGHTS.map((v, i) => v * Math.pow(step, i));
  w[0] = w[0] / (1 + 0.35 * b + 0.4 * t);
  return w;
}

/** 희귀도 추첨 */
export function rollRarity(ilvl = 1, rarityBonus = 0, rng = defaultRng) {
  const w = rarityWeights(ilvl, rarityBonus);
  const entries = w.map((v, i) => ({ r: i, w: v })).filter((e) => e.w > 0);
  if (!entries.length) return 0;
  const e = rng.weighted(entries);
  return e ? e.r : 0;
}

/** 고유(unique) 아이템이 나올 기본 확률 */
export const UNIQUE_CHANCE = 0.02;

/** ilvl에 등장 가능한 고유 베이스 하나 (없으면 null) */
function rollUniqueBase(slot, ilvl, weaponType, rng, rarityBonus) {
  if (typeof ITEMS.uniquesFor !== 'function') return null;
  if (!rng.chance(Math.min(0.25, UNIQUE_CHANCE * (1 + 0.6 * Math.max(0, rarityBonus))))) return null;
  let pool = [];
  for (const s of baseSlotAliases(slot)) {
    try { pool = pool.concat(ITEMS.uniquesFor(ilvl, s) || []); } catch { /* noop */ }
  }
  // 신화(세트) 조각은 던전 보스만 준다. 옛 2피스 고유 세트(unique:true)는 그대로 둔다.
  pool = pool.filter((b) => b && b.rarity !== RARITY_MYTHIC && (b.unique || !b.setId));
  if (weaponType) pool = pool.filter((b) => b.weaponType === weaponType);
  return pool.length ? rng.pick(pool) : null;
}

/**
 * 아이템 하나를 굴린다.
 * 고유(unique) 베이스는 접사를 굴리지 않고 `fixedAffixes` 를 그대로 쓴다.
 * 베이스에 `rarity` 가 박혀 있으면(세트 조각 = 신화 5) 그 값이 우선한다.
 * @param {{ilvl?:number, rarity?:number, slot?:string, weaponType?:string, baseId?:string, rarityBonus?:number, rng?:object}} opt
 * @returns {object} Item
 */
export function rollItem({ ilvl = 1, rarity, slot, weaponType, baseId, rarityBonus = 0, rng = defaultRng } = {}) {
  const lv = Math.max(1, Math.round(ilvl));
  let base = baseId ? getBase(baseId) : null;
  let useSlot = slot || (base && base.slot) || (rng.weighted(lootSlotEntries()) || lootSlotEntries()[0]).slot;

  if (!base) base = rollUniqueBase(useSlot, lv, weaponType, rng, rarityBonus);
  if (!base) {
    const cands = candidateBases(useSlot, lv, weaponType);
    base = cands.length
      ? pickWeighted(cands, 1, rng, (b) => 1 / (1 + Math.max(0, lv - (b.minLv || 1)) * 0.12))[0]
      : fallbackBase(useSlot, weaponType);
  }
  useSlot = base.slot || useSlot;

  const forced = Number.isFinite(base.rarity) ? clamp(Math.round(base.rarity), 0, MAX_RARITY) : null;
  const r = forced != null ? forced
    : base.unique ? 4
      : rarity == null ? rollRarity(lv, rarityBonus, rng)
        : clamp(Math.round(rarity), 0, MAX_RARITY);
  // 슬롯 계수는 items.js 안에서 곱해진다 (baseStats·접사 둘 다 슬롯을 넘겨야 한다)
  const baseStats = scaleBase(base, lv, r, useSlot);

  // 접사 — 개수는 희귀도와 같다. 접두/접미를 번갈아 뽑고, 이름에는 첫 접두 + 첫 접미만 쓴다.
  const affixes = [];
  const fixed = base.fixedAffixes || (base.unique ? [] : null);
  if (fixed && fixed.length) {
    for (const a of fixed) {
      affixes.push({ id: a.id, name: a.name, stats: resolveAffixStats(a, lv, rng, useSlot), kind: base.unique ? 'unique' : 'set' });
    }
  } else if (!base.unique) {
    const nAffix = (ITEMS.RARITY_AFFIX_COUNT && ITEMS.RARITY_AFFIX_COUNT[r] != null) ? ITEMS.RARITY_AFFIX_COUNT[r] : r;
    const ctx = { slot: useSlot, ilvl: lv, weaponType: base.weaponType || null };
    const preSrc = typeof ITEMS.prefixesFor === 'function' ? ITEMS.prefixesFor(lv) : PREFIXES;
    const sufSrc = typeof ITEMS.suffixesFor === 'function' ? ITEMS.suffixesFor(lv) : SUFFIXES;
    const preCands = affixCandidates(preSrc, ctx);
    const sufCands = affixCandidates(sufSrc, ctx);
    const nPre = Math.ceil(nAffix / 2);
    const weightOf = (a) => a.w ?? a.weight ?? 1;
    const chosen = [
      ...pickWeighted(preCands, nPre, rng, weightOf).map((a) => ({ a, kind: 'prefix' })),
      ...pickWeighted(sufCands, nAffix - nPre, rng, weightOf).map((a) => ({ a, kind: 'suffix' })),
    ];
    for (const { a, kind } of chosen) {
      const st = resolveAffixStats(a, lv, rng, useSlot);
      if (Object.keys(st).length) affixes.push({ id: a.id || a.name, name: a.name || a.id || '', stats: st, kind });
    }
  }

  const stats = { ...baseStats };
  for (const af of affixes) {
    for (const k of Object.keys(af.stats)) stats[k] = Math.round(((stats[k] || 0) + af.stats[k]) * 10) / 10;
  }
  for (const k of SCALING_KEYS) if (stats[k] != null) stats[k] = Math.round(stats[k]);

  const pre = affixes.find((x) => x.kind === 'prefix');
  const suf = affixes.find((x) => x.kind === 'suffix');
  const keepName = base.unique || base.setId;

  const item = {
    uid: uid('it'),
    baseId: base.id,
    name: keepName ? (base.name || base.id) : joinName(pre && pre.name, base.name || base.id, suf && suf.name),
    slot: useSlot,
    weaponType: base.weaponType || null,
    rarity: r,
    ilvl: lv,
    minLv: base.minLv || 1,
    stats,
    baseStats,
    affixes,
    value: 0,
    weight: base.weight || 0,
    desc: base.desc || '',
  };
  if (base.unique) item.unique = true;
  if (base.armorType) item.armorType = base.armorType;
  if (base.accType) item.accType = base.accType;
  // setId 는 **항상** 기록한다 (없으면 null) — setIdOf 가 이 키로 베이스 조회를 건너뛴다
  item.setId = base.setId || baseSetIndex().get(base.id) || null;
  if (typeof base.twoHanded === 'boolean') item.twoHanded = base.twoHanded;
  item.value = itemValue(item);
  return item;
}

/**
 * 전리품 여러 개.
 * @param {{ilvl?:number, count?:number, rarityBonus?:number, rng?:object, slot?:string}} opt
 * @returns {object[]}
 */
export function rollLoot({ ilvl = 1, count = 1, rarityBonus = 0, rng = defaultRng, slot } = {}) {
  const out = [];
  const n = Math.max(0, Math.round(count));
  for (let i = 0; i < n; i++) {
    const jitter = rng.int(-2, 2);
    out.push(rollItem({ ilvl: Math.max(1, ilvl + jitter), rarityBonus, rng, slot }));
  }
  return out;
}

/**
 * 세트(신화) 조각 하나를 굴린다 — 던전 보스 드랍용.
 * 해당 세트에서 그 슬롯을 담당하는 베이스를 찾아 희귀도 5로 만든다.
 * @param {{setId:string, slot?:string, ilvl?:number, rng?:object}} opt
 * @returns {object|null} 그 세트/슬롯 베이스가 없으면 null
 */
export function rollSetItem({ setId, slot = null, ilvl = 1, rng = defaultRng, weaponType = null } = {}) {
  if (!setId) return null;

  // 1) 던전 신화 세트 — data/sets.js 가 완성품을 준다 (이미 ilvl·희귀도·슬롯계수 반영됨).
  if (SETS_DATA.getSet(setId)) {
    const slots = Array.isArray(SETS_DATA.SET_SLOTS) ? SETS_DATA.SET_SLOTS : SLOTS;
    let want = slot ? (normalizeSlot(slot) || slot) : null;
    if (!want || !slots.includes(want)) want = rng.pick(slots.slice());
    return SETS_DATA.setPieceItem(setId, want, ilvl, { weaponType: weaponType || null });
  }

  // 2) items.js 에 베이스로 정의된 옛 세트
  let pool = itemBaseList().filter((b) => b.setId === setId);
  if (!pool.length) return null;
  if (slot) {
    const want = normalizeSlot(slot) || slot;
    const hit = pool.filter((b) => slotsForItem(b).includes(want) || b.slot === want || b.slot === slot);
    if (hit.length) pool = hit;
  }
  const base = rng.pick(pool);
  return rollItem({ baseId: base.id, ilvl, rarity: RARITY_MYTHIC, rng });
}

/* ─────────────────────────── 아이템 조회 ─────────────────────────── */

/** 아이템의 최종 스탯 (합계). 항상 새 객체 */
export function itemStats(item) {
  if (!item) return {};
  if (item.stats && Object.keys(item.stats).length) return { ...item.stats };
  const out = { ...(item.baseStats || {}) };
  for (const a of item.affixes || []) for (const k of Object.keys(a.stats || {})) out[k] = (out[k] || 0) + a.stats[k];
  return out;
}

/** 스탯 총합 지표 (비교/가치 산정용) */
export function itemPower(item) {
  const s = itemStats(item);
  return (s.hp || 0) * 0.12 + (s.atk || 0) * 1.0 + (s.def || 0) * 0.85 + (s.res || 0) * 0.75
    + (s.spd || 0) * 0.9 + (s.crit || 0) * 1.2 + (s.critDmg || 0) * 0.35 + (s.eva || 0) * 1.1;
}

/** 상점/판매 기준 가치 (골드). items.js가 기준가를 제공하면 그 값을 따른다. */
export function itemValue(item) {
  if (!item) return 0;
  const r = clamp(item.rarity || 0, 0, MAX_RARITY);
  const base = getBase(item.baseId);
  if (base && typeof ITEMS.itemValue === 'function') {
    const v = ITEMS.itemValue(base, item.ilvl || 1, r);
    if (v > 0) return v;
  }
  const rv = RARITY_VALUE[r] ?? RARITY_VALUE[RARITY_VALUE.length - 1];
  const v = (25 + (item.ilvl || 1) * 11) * rv * (1 + itemPower(item) / 90);
  return Math.max(5, Math.round(v / 5) * 5);
}

/* ─────────────────────────── 세트 (설계 B) ─────────────────────────── */

/**
 * 세트 단계. 착용 개수가 이 값에 닿을 때마다 효과가 하나씩 더 붙는다 (누적).
 * `'full'` 은 고정 10 이 아니라 **그 용병이 낄 수 있는 최대 칸 수**다 —
 * 양손 무기 사용자는 9칸이 풀세트다 (`equippableSlotCount`).
 */
export const SET_TIERS = [3, 5, 7, 'full'];

/**
 * 세트 효과 전체 강도 노브. **밸런스 검증 담당이 여기만 만지면 세트 전체가 같이 움직인다.**
 * (던전 웨이브 곡선을 맞출 때 세트 쪽 조정은 개별 수치가 아니라 이 값부터 건드려라.)
 */
export const SET_POWER = 1.0;

/**
 * 세트 성격별 단계 효과 — **증분**이다 (5단계를 받으면 3단계도 그대로 유지된다).
 *   stats : 최종 스탯에 **절대값 가산** (평탄 스탯 위주)
 *   mods  : 최종 스탯에 **비율 곱연산** (`atk:0.1` = +10%)
 *
 * ★ **고유 효과(special)는 여기에 적지 않는다.** 유일한 정의처는 `data/sets.js` 다
 *   (`special` / `specialLabel` / `specialParams` / `desc`).
 *   8차까지 이 표에도 `steel_rampart`(받는 피해 20% 경감) 같은 정의가 **따로** 박혀 있어
 *   sets.js 와 이름도 수치도 어긋났고, 어느 쪽이 진짜인지 정해져 있지 않았다 → 9차에 제거했다.
 *   고유 효과를 읽으려면 `setSpecialsFor(merc)` / `SETS_DATA.getSetSpecial(id)` 를 써라.
 *
 * 이 표가 실제로 쓰이는 곳은 **items.js 의 옛 2피스 세트(dawn/nightveil/dragon)** 뿐이다.
 * 던전 신화 세트 4종은 sets.js 가 `bonuses` 를 직접 주므로 이 표를 타지 않는다.
 */
export const SET_PROFILES = {
  // 방어·전열형 (tank / lancer)
  guard: {
    3: { mods: { hp: 0.06, def: 0.10, res: 0.08 } },
    5: { mods: { hp: 0.06, def: 0.09, res: 0.07, atk: 0.06 } },
    7: { mods: { hp: 0.09, def: 0.11, res: 0.09, atk: 0.08, spd: 0.05 }, stats: { eva: 2 } },
    full: { mods: { hp: 0.14, def: 0.15, res: 0.13, atk: 0.12, spd: 0.08 }, stats: { eva: 3, crit: 2 } },
  },
  // 근접 딜러형 (fighter / rogue)
  blood: {
    3: { mods: { atk: 0.09, spd: 0.05 }, stats: { crit: 3 } },
    5: { mods: { atk: 0.09, spd: 0.05, hp: 0.05 }, stats: { crit: 3, critDmg: 8 } },
    7: { mods: { atk: 0.11, spd: 0.07, hp: 0.06 }, stats: { crit: 4, critDmg: 10, eva: 2 } },
    full: { mods: { atk: 0.15, spd: 0.10, hp: 0.08, def: 0.08 }, stats: { crit: 5, critDmg: 15 } },
  },
  // 원거리·마법형 (archer / mage)
  star: {
    3: { mods: { atk: 0.09, spd: 0.06 }, stats: { crit: 2 } },
    5: { mods: { atk: 0.09, spd: 0.06, res: 0.08 }, stats: { crit: 2, critDmg: 8 } },
    7: { mods: { atk: 0.12, spd: 0.08, res: 0.08, hp: 0.06 }, stats: { crit: 3, critDmg: 10, eva: 2 } },
    full: { mods: { atk: 0.16, spd: 0.11, res: 0.10, hp: 0.08 }, stats: { crit: 4, critDmg: 15, eva: 3 } },
  },
  // 범용·생존/유틸형 (전 아키타입)
  grace: {
    3: { mods: { hp: 0.07, def: 0.06, res: 0.06, spd: 0.04 } },
    5: { mods: { hp: 0.07, def: 0.06, res: 0.06, spd: 0.04, atk: 0.06 }, stats: { eva: 2 } },
    7: { mods: { hp: 0.09, def: 0.08, res: 0.08, spd: 0.06, atk: 0.08 }, stats: { eva: 2, crit: 2 } },
    full: { mods: { hp: 0.13, def: 0.11, res: 0.11, spd: 0.09, atk: 0.11 }, stats: { eva: 3, crit: 3, critDmg: 10 } },
  },
};

/** items.js 의 세트 정의 원본 (여러 export 형태를 다 받아준다) */
function rawSetDef(setId) {
  if (!setId) return null;
  // 던전 신화 세트가 먼저다 — sets.js 가 archs/bonuses 의 주인이다.
  const dsel = SETS_DATA.getSet(setId);
  if (dsel) return dsel;
  for (const key of ['ITEM_SETS', 'SETS', 'SET_DEFS', 'DUNGEON_SETS']) {
    const src = ITEMS[key];
    if (!src) continue;
    const d = Array.isArray(src) ? src.find((s) => s && s.id === setId) : src[setId];
    if (d) return d;
  }
  for (const fn of ['setById', 'getSet', 'setDef']) {
    if (typeof ITEMS[fn] === 'function') { try { const d = ITEMS[fn](setId); if (d) return d; } catch { /* noop */ } }
  }
  if (typeof ITEMS.setOf === 'function') {
    const b = itemBaseList().find((x) => x.setId === setId);
    if (b) { try { const d = ITEMS.setOf(b.id); if (d) return d; } catch { /* noop */ } }
  }
  return null;
}

/** 이 세트를 쓸 수 있는 아키타입 목록 (제한 없으면 null) */
export function setArchs(setId) {
  const d = rawSetDef(setId);
  const a = d && (d.archs || d.archetypes || d.allowArchs || d.arch);
  if (Array.isArray(a) && a.length) return a.slice();
  if (typeof a === 'string' && a) return [a];
  return null;
}

/** 세트 id/이름으로 성격을 추정한다 (items.js 가 archs 를 안 줬을 때의 마지막 보루) */
const SET_NAME_HINTS = [
  [/steel|wall|bulwark|rampart|성벽|강철/i, 'guard'],
  [/blood|oath|crimson|피의|서약|혈/i, 'blood'],
  [/star|arrow|astral|shot|별|사수|성흔/i, 'star'],
  [/grace|constell|bless|성좌|은총/i, 'grace'],
];

/** 세트가 쓰는 효과 프로파일 키 */
function profileKeyOf(setId) {
  const d = rawSetDef(setId);
  if (d && d.profile && SET_PROFILES[d.profile]) return d.profile;
  const archs = setArchs(setId);
  if (archs && archs.length && archs.length < 6) {
    if (archs.includes('tank') || archs.includes('lancer')) return 'guard';
    if (archs.includes('rogue') || archs.includes('fighter')) return 'blood';
    if (archs.includes('archer') || archs.includes('mage')) return 'star';
  }
  const tag = `${setId} ${(d && d.name) || ''}`;
  for (const [re, key] of SET_NAME_HINTS) if (re.test(tag)) return key;
  return 'grace';
}

/**
 * 고유 효과 하나를 **`data/sets.js` 와 같은 형태**로 정규화한다.
 * 최종 형태: `{id, name, label, params, desc, setId, step, tier}` (`sets.js makeSpecial` 과 동일)
 *
 * `sets.js` 는 단계 객체에 `special`(id 문자열) / `specialLabel` / `specialParams` / `desc` 를
 * 형제 필드로 두므로, 문자열이 들어오면 그 형제 값(또는 `SET_SPECIALS` 색인)으로 채워 준다.
 * @param {string|object} sp
 * @param {{setId?:string, step?:number|'full', desc?:string, label?:string, params?:object}} ctx
 */
function normSpecial(sp, ctx = {}) {
  if (!sp) return null;
  const { setId = null, step = null, desc = '', label = null, params = null } = ctx;
  if (typeof sp === 'string') {
    let known = null;
    try { known = typeof SETS_DATA.getSetSpecial === 'function' ? SETS_DATA.getSetSpecial(sp) : null; } catch { known = null; }
    const name = label || (known && known.name) || sp;
    return {
      id: sp, name, label: name,
      params: params ? { ...params } : (known ? { ...known.params } : {}),
      desc: desc || (known && known.desc) || '',
      setId: setId || (known && known.setId) || null,
      step, tier: step,
    };
  }
  if (typeof sp !== 'object') return null;
  const name = sp.name || sp.label || sp.id || '';
  const st = sp.step != null ? sp.step : (sp.tier != null ? sp.tier : step);
  return {
    ...sp,
    id: sp.id || name,
    name, label: name,
    params: sp.params ? { ...sp.params } : {},
    desc: sp.desc || desc || '',
    setId: sp.setId || setId || null,
    step: st, tier: st,
  };
}

/**
 * 단계 정의 한 칸을 `{stats, mods, specials}` 로 정규화.
 * @param {object} raw  단계 정의 (sets.js `bonuses[step]` 또는 items.js 의 옛 형태)
 * @param {number|'full'|null} [step] 이 단계의 키 (specials 에 실어 준다)
 * @param {string|null} [setId]
 */
function normTierBonus(raw, step = null, setId = null) {
  const out = { stats: {}, mods: {}, specials: [] };
  if (!raw || typeof raw !== 'object') return out;
  const structured = raw.stats || raw.mods || raw.specials || raw.special;
  if (structured) {
    for (const k of STAT_KEYS) if (raw.stats && raw.stats[k]) out.stats[k] = raw.stats[k];
    for (const k of STAT_KEYS) if (raw.mods && raw.mods[k]) out.mods[k] = raw.mods[k];
    const sp = raw.specials || raw.special;
    const list = Array.isArray(sp) ? sp : (sp ? [sp] : []);
    for (const s of list) {
      const n = normSpecial(s, {
        setId, step, desc: raw.specialDesc || raw.desc || '',
        label: raw.specialLabel || null, params: raw.specialParams || null,
      });
      if (n) out.specials.push(n);
    }
    return out;
  }
  // 옛 형태: 평탄 스탯 객체 그대로 (dawn/nightveil/dragon 2피스 세트)
  for (const k of STAT_KEYS) if (raw[k]) out.stats[k] = raw[k];
  out.legacyFlat = true;
  return out;
}

/**
 * 세트 정의 (UI/툴 표기용).
 * @returns {{id, name, desc, archs, tiers:Array<number|'full'>, bonus:object}|null}
 */
export function setDefOf(setId) {
  if (!setId) return null;
  const raw = rawSetDef(setId) || {};
  const src = raw.tiers || raw.bonus || raw.bonuses || null;
  const prof = SET_PROFILES[profileKeyOf(setId)] || SET_PROFILES.grace;
  const table = {};
  let tiers = [];
  if (src && typeof src === 'object' && Object.keys(src).length) {
    for (const k of Object.keys(src)) {
      const key = k === 'full' || k === 'max' ? 'full' : Number(k);
      if (key !== 'full' && !Number.isFinite(key)) continue;
      const nb = normTierBonus(src[k], key, setId);
      // items.js 가 **평탄 스탯만** 준 단계에는 프로파일의 비율(mods)만 얹어 준다.
      // (스탯은 얹지 않는다 — 이중 계산이 된다. 고유 효과는 sets.js 만 소유하므로 얹을 게 없다.)
      const p = prof[key];
      if (nb.legacyFlat && p) {
        for (const sk of STAT_KEYS) if (p.mods && p.mods[sk]) nb.mods[sk] = (nb.mods[sk] || 0) + p.mods[sk];
      }
      table[key] = nb;
      tiers.push(key);
    }
    tiers.sort((a, b) => (a === 'full' ? 1 : b === 'full' ? -1 : a - b));
  } else {
    tiers = SET_TIERS.slice();
    for (const t of tiers) table[t] = normTierBonus(prof[t], t, setId);
  }
  return {
    id: setId,
    name: raw.name || setId,
    desc: raw.desc || '',
    archs: setArchs(setId),
    /* ★★ 이 반환값은 **아는 필드만 남기는 화이트리스트**다. sets.js 에 필드를 더해도
     *   여기에 안 적으면 조용히 사라진다 — `prefer` 를 넣고 «아무것도 안 바뀐다» 로 한 번 당했다.
     *   (엣지 함수의 sanitizeSquadsFull 이 부대 전력 `p` 를 버렸던 것과 같은 병이다.) */
    prefer: Array.isArray(raw.prefer) ? raw.prefer.slice() : null,
    profile: profileKeyOf(setId),
    tiers,
    bonus: table,
  };
}

/** baseId → setId 색인 (한 번만 만든다 — 자동 배분이 아이템마다 부른다) */
let _baseSetIndex = null;
function baseSetIndex() {
  if (_baseSetIndex) return _baseSetIndex;
  _baseSetIndex = new Map();
  for (const b of itemBaseList()) {
    let sid = b.setId || null;
    if (!sid && typeof ITEMS.setOf === 'function') {
      try { const s = ITEMS.setOf(b.id); if (s && s.id) sid = s.id; } catch { /* noop */ }
    }
    if (sid) _baseSetIndex.set(b.id, sid);
  }
  return _baseSetIndex;
}

/** 아이템이 속한 세트 id (베이스까지 뒤진다) */
export function setIdOf(item) {
  if (!item) return null;
  if (item.setId) return item.setId;
  if ('setId' in item) return null; // 롤링된 실물은 항상 이 키를 갖는다 → 베이스 조회 생략
  return baseSetIndex().get(item.baseId) || null;
}

/** 용병의 아키타입 (알 수 없으면 null) */
function archOf(merc) {
  if (!merc) return null;
  let c = null;
  try { c = getClass(typeof merc === 'string' ? merc : merc.classId); } catch { c = null; }
  return (c && c.arch) || null;
}

/** 이 용병이 그 세트 아이템을 쓸 수 있는가 (아키타입 제한) */
export function setArchAllows(setId, merc) {
  const archs = setArchs(setId);
  if (!archs || !archs.length) return true;
  const a = archOf(merc);
  if (!a) return true;
  return archs.includes(a);
}

/** 착용 개수로 발동한 단계들 */
function activeTiersOf(def, count, max) {
  const out = [];
  if (!def) return out;
  for (const t of def.tiers) {
    const need = t === 'full' ? max : t;
    if (count >= need) out.push(t);
  }
  return out;
}

/**
 * 세트 진행도. UI(부대/창고 화면)가 그대로 그린다.
 * @param {object} merc
 * @param {Array|object|Map|null} itemsById
 * @returns {Array<{setId, name, count, max, tiers, active, next, need, archs}>}
 */
export function setProgress(merc, itemsById = null) {
  const worn = Array.isArray(merc) ? merc.filter(Boolean) : wornItems(merc, itemsById);
  const max = Array.isArray(merc) ? SLOTS.length : equippableSlotCount(merc, itemsById);
  const count = new Map();
  for (const it of worn) {
    const sid = setIdOf(it);
    if (sid) count.set(sid, (count.get(sid) || 0) + 1);
  }
  const out = [];
  for (const [setId, n] of count) {
    const def = setDefOf(setId);
    const active = activeTiersOf(def, n, max);
    const next = def.tiers.find((t) => !active.includes(t)) ?? null;
    out.push({
      setId,
      name: def.name,
      count: n,
      max,
      tiers: def.tiers.slice(),
      active,
      next,
      need: next == null ? 0 : Math.max(0, (next === 'full' ? max : next) - n),
      archs: def.archs,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/**
 * 착용 중인 세트 효과 합계.
 *   stats    최종 스탯에 **절대값 가산**
 *   mods     최종 스탯에 **비율 곱연산** (merc.js 가 가산 뒤에 적용한다)
 *   specials 고유 효과 목록 — `data/sets.js` 의 `special`/`specialLabel`/`specialParams` 를
 *            그대로 실은 `{id, name, params, desc, setId, tier}` 배열.
 *            **고유 효과만 필요하면 `setSpecialsFor(merc)` 를 써라** (전투/UI 공용 진입점).
 *
 * 호출 형태 두 가지를 모두 받는다:
 *   setBonusStats(merc, itemsById)   ← 설계 B (권장)
 *   setBonusStats(items[])           ← 옛 호출 (풀세트 기준 = 10칸)
 * @returns {{stats:object, mods:object, specials:Array, sets:Array}}
 */
export function setBonusStats(merc, itemsById = null) {
  if (Array.isArray(merc)) return setBonusFromWorn(merc.filter(Boolean), SLOTS.length);
  return setBonusFromWorn(wornItems(merc, itemsById), equippableSlotCount(merc, itemsById));
}

/**
 * 이미 뽑아 둔 착용 아이템 배열로 세트 효과를 계산한다 (merc.js 가 이 경로로 부른다 — 재조회 없음).
 * @param {object[]} worn 착용 중인 아이템
 * @param {number} maxSlots 풀세트 기준 칸 수 (양손무기면 9)
 */
export function setBonusFromWorn(worn = [], maxSlots = SLOTS.length) {
  const stats = {}, mods = {}, specials = [], sets = [];
  const list = (worn || []).filter(Boolean);
  if (!list.length) return { stats, mods, specials, sets };

  const count = new Map();
  const ilvlSum = new Map();
  for (const it of list) {
    const sid = setIdOf(it);
    if (!sid) continue;
    count.set(sid, (count.get(sid) || 0) + 1);
    ilvlSum.set(sid, (ilvlSum.get(sid) || 0) + (it.ilvl || 1));
  }
  if (!count.size) return { stats, mods, specials, sets };

  const max = Math.max(1, Math.round(maxSlots || SLOTS.length));
  for (const [setId, n] of count) {
    // 던전 신화 세트는 sets.js 가 직접 계산한다 (stats/mods/specials 형태가 그쪽 계약이다).
    if (SETS_DATA.getSet(setId)) {
      const ilvl = Math.max(1, Math.round(ilvlSum.get(setId) / n));
      const b = SETS_DATA.setBonusAt(setId, n, max, ilvl);
      for (const k of STAT_KEYS) if (b.stats && b.stats[k]) stats[k] = (stats[k] || 0) + b.stats[k] * SET_POWER;
      for (const k of STAT_KEYS) if (b.mods && b.mods[k]) mods[k] = (mods[k] || 0) + b.mods[k] * SET_POWER;
      // 고유 효과는 **sets.js 값을 그대로** 싣는다 (id/이름/파라미터를 여기서 만들지 않는다).
      // 단계도 sets.js 가 알려 준 값을 쓴다 — 'full' 로 못 박으면 3/5/7 에 효과가 붙는 날 어긋난다.
      for (const sp of b.specials || []) {
        const norm = normSpecial(sp, { setId, step: sp && (sp.step ?? sp.tier) });
        if (norm) specials.push(norm);
      }
      sets.push({ setId, name: SETS_DATA.getSet(setId).name, count: n, max, active: b.steps.slice() });
      continue;
    }
    const def = setDefOf(setId);
    if (!def) continue;
    const active = activeTiersOf(def, n, max);
    if (!active.length) { sets.push({ setId, name: def.name, count: n, max, active }); continue; }
    const ilvl = Math.max(1, Math.round(ilvlSum.get(setId) / n));
    for (const t of active) {
      const b = def.bonus[t];
      if (!b) continue;
      let add = b.stats;
      // 옛 형태(평탄 스탯 객체)는 예전처럼 ilvl 로 스케일한다
      if (b.legacyFlat && typeof ITEMS.scaleAffixStats === 'function') {
        try { add = ITEMS.scaleAffixStats(b.stats, ilvl); } catch { add = b.stats; }
      }
      for (const k of STAT_KEYS) if (add && add[k]) stats[k] = (stats[k] || 0) + add[k] * SET_POWER;
      for (const k of STAT_KEYS) if (b.mods && b.mods[k]) mods[k] = (mods[k] || 0) + b.mods[k] * SET_POWER;
      for (const sp of b.specials || []) {
        const norm = normSpecial(sp, { setId, step: t });
        if (norm) specials.push(norm);
      }
    }
    sets.push({ setId, name: def.name, count: n, max, active });
  }
  return { stats, mods, specials, sets };
}

/**
 * ★ **그 용병이 지금 받고 있는 세트 고유 효과 목록** — 전투/UI 의 단일 진입점이다.
 *
 * `squad.js` / `quest.js` 가 UnitDef 를 만들 때 이걸 불러 `unit.specials` 로 싣고,
 * `battle/engine.js` 가 그 배열을 소비한다. UI(용병 상세·던전 화면)도 같은 배열을 그린다.
 * **고유 효과의 정의는 `data/sets.js` 뿐이다** — 소비자는 여기서 받은 것만 믿으면 된다.
 *
 * 반환 원소 (`data/sets.js makeSpecial` 과 같은 형태):
 * ```js
 * { id:'rampart_aegis', name:'불락(不落)의 가호', params:{...},
 *   desc:'…', setId:'ironrampart', setName:'강철 성벽', step:'full', tier:'full' }
 * ```
 * `params` 는 항상 사본이라 소비자가 만져도 원본 데이터가 오염되지 않는다.
 * 어떤 이유로든 실패하면 **빈 배열**을 돌려준다 (전투 경로가 절대 죽지 않게).
 *
 * @param {object|object[]} merc 용병 객체 — 또는 이미 뽑아 둔 **착용 아이템 배열**
 * @param {Array|object|Map|null} [itemsById] 아이템 조회원 (생략하면 전역 state)
 * @returns {Array<{id:string, name:string, params:object, desc:string, setId:string, tier:number|'full'}>}
 */
export function setSpecialsFor(merc, itemsById = null) {
  try {
    const b = Array.isArray(merc)
      ? setBonusFromWorn(merc.filter(Boolean), SLOTS.length)
      : setBonusStats(merc, itemsById);
    return (b && b.specials) || [];
  } catch { return []; }
}

/** 발동한 세트 정의 목록 (UI 표기용 — 옛 시그니처 유지) */
export function activeSets(items = []) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const out = [];
  const count = new Map();
  for (const it of list) {
    const sid = setIdOf(it);
    if (sid) count.set(sid, (count.get(sid) || 0) + 1);
  }
  for (const [id, n] of count) {
    const def = setDefOf(id);
    if (!def) continue;
    out.push({ set: def, count: n, active: activeTiersOf(def, n, SLOTS.length).length > 0 });
  }
  return out;
}

/** 판매가 */
export function sellPrice(item) { return Math.max(1, Math.floor((item?.value ?? itemValue(item)) * SELL_RATE)); }

/**
 * 두 아이템 비교 (인벤토리 툴팁용).
 * @returns {{diff:object, powerA:number, powerB:number, delta:number, verdict:'상승'|'하락'|'동일'}}
 */
export function compareItems(a, b) {
  const sa = itemStats(a), sb = itemStats(b);
  const diff = {};
  for (const k of STAT_KEYS) {
    const d = Math.round(((sa[k] || 0) - (sb[k] || 0)) * 10) / 10;
    if (d) diff[k] = d;
  }
  const powerA = Math.round(itemPower(a) * 10) / 10;
  const powerB = Math.round(itemPower(b) * 10) / 10;
  const delta = Math.round((powerA - powerB) * 10) / 10;
  return { diff, powerA, powerB, delta, verdict: delta > 0 ? '상승' : delta < 0 ? '하락' : '동일' };
}

/* ─────────────────────────── 장착 ─────────────────────────── */

/**
 * 장착 불가 사유 (가능하면 null).
 * @param {object} merc
 * @param {object} item
 * @param {string|null} [slot] 특정 슬롯에 넣을 때만. 생략하면 "어디든 낄 수 있는가"를 본다
 * @param {Array|object|Map|null} [itemsById] 왼손 잠금 판정용 (생략하면 전역 state)
 */
export function equipIssue(merc, item, slot = null, itemsById = null) {
  if (!merc) return '용병이 없습니다.';
  if (!item) return '장비가 없습니다.';
  const cands = slotsForItem(item);
  if (!cands.length) return '장착할 수 없는 부위입니다.';

  let target = null;
  if (slot) {
    target = normalizeSlot(slot);
    if (!target) return '알 수 없는 부위입니다.';
    if (!cands.includes(target)) return `${SLOT_NAME[target] || target} 부위에 장착할 수 없습니다.`;
  }

  const need = item.minLv ?? getBase(item.baseId)?.minLv ?? 1;
  if ((merc.level || 1) < need) return `레벨 ${need} 이상이어야 착용할 수 있습니다.`;

  // 무기 타입 제한 (오른손·왼손 공용)
  const wt = item.weaponType || getBase(item.baseId)?.weaponType || null;
  const handSlot = target ? HAND_SLOTS.includes(target) : cands.some((s) => HAND_SLOTS.includes(s));
  if (wt && handSlot) {
    const c = getClass(merc.classId);
    const allow = c && c.equip;
    if (allow && allow.length && !allow.includes(wt)) {
      return `${c.name}${josa(c.name, '은/는')} ${weaponTypeName(wt)}${josa(weaponTypeName(wt))} 다룰 수 없습니다.`;
    }
  }

  // 세트(신화) 아키타입 제한
  const sid = setIdOf(item);
  if (sid && !setArchAllows(sid, merc)) {
    const def = setDefOf(sid);
    return `${def && def.name ? def.name : '이 세트'}${josa(def && def.name ? def.name : '이 세트', '은/는')} 이 용병의 계열이 다룰 수 없습니다.`;
  }

  // 왼손 잠금 — 양손 무기를 들고 있으면 offhand 자체가 없다
  const offOnly = target ? target === 'offhand' : cands.every((s) => s === 'offhand');
  if (offOnly && offhandLocked(merc, itemsById)) return '양손 무기를 들고 있어 왼손이 비어 있지 않습니다.';

  return null;
}

/** 장착 가능 여부 (사유는 equipIssue) */
export function canEquip(merc, item, slot = null, itemsById = null) {
  return equipIssue(merc, item, slot, itemsById) == null;
}

/** state에서 용병 찾기 (객체/uid 모두 허용) */
function findMerc(st, m) {
  if (!m) return null;
  if (typeof m === 'object') return m;
  return (st && st.roster || []).find((x) => x && x.uid === m) || null;
}
/** state에서 아이템 찾기 (객체/uid 모두 허용) */
function findItem(st, it) {
  if (!it) return null;
  if (typeof it === 'object') return it;
  return (st && st.items || []).find((x) => x && x.uid === it) || null;
}

/** 이 아이템을 장착 중인 용병 (없으면 null) */
export function ownerOf(state, itemUid) {
  const st = useState(state);
  const u = typeof itemUid === 'object' ? itemUid?.uid : itemUid;
  if (!st || !u) return null;
  for (const m of st.roster || []) {
    if (!m || !m.equipment) continue;
    for (const slot of slotKeysOf(m.equipment)) if (m.equipment[slot] === u) return m;
  }
  return null;
}

/** 누군가 장착 중인가 */
export function isEquipped(state, itemUid) { return !!ownerOf(state, itemUid); }

/** 창고(=아무도 장착하지 않은) 아이템 목록 */
export function inventory(state, { slot = null, weaponType = null, rarity = null } = {}) {
  const st = useState(state);
  if (!st) return [];
  const equipped = new Set();
  for (const m of st.roster || []) {
    if (!m || !m.equipment) continue;
    for (const s of slotKeysOf(m.equipment)) if (m.equipment[s]) equipped.add(m.equipment[s]);
  }
  return (st.items || []).filter((it) => it && !equipped.has(it.uid)
    && (!slot || slotAccepts(slot, it))
    && (!weaponType || it.weaponType === weaponType)
    && (rarity == null || it.rarity === rarity));
}

/** 용병이 장착 중인 아이템 객체들 (키 = 10슬롯) */
export function equippedItems(state, merc) {
  const st = useState(state);
  const m = findMerc(st, merc);
  const out = {};
  for (const s of SLOTS) out[s] = null;
  if (!m) return out;
  const eq = ensureEquipment(m);
  for (const s of SLOTS) out[s] = findItem(st, eq && eq[s]);
  return out;
}

/** 반지처럼 후보가 여럿일 때 어느 칸에 넣을지 고른다 (빈 칸 → 더 나쁜 장비가 낀 칸) */
function pickSlotFor(st, m, it) {
  const cands = slotsForItem(it).filter((s) => !equipIssue(m, it, s, st));
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  const eq = ensureEquipment(m);
  const empty = cands.find((s) => !eq[s]);
  if (empty) return empty;
  const ctx = { weights: archWeightsFor(m) };
  let worst = cands[0], worstScore = Infinity;
  for (const s of cands) {
    const cur = findItem(st, eq[s]);
    const sc = cur ? scoreItemFor(m, cur, { ...ctx, checkEquip: false }) : 0;
    if (sc < worstScore) { worstScore = sc; worst = s; }
  }
  return worst;
}

/**
 * 장착. 이미 다른 용병이 들고 있으면 빼앗아 온다.
 * 양손 무기를 끼면 **왼손 장비가 자동으로 벗겨진다** (`removed` 에 실린다).
 * @param {object} state
 * @param {object|string} merc
 * @param {object|string} item
 * @param {string|null} [slot] 반지처럼 후보가 여럿일 때 지정. 생략하면 자동
 * @returns {{ok:boolean, reason:string, replaced:object|null, slot:string|null, removed:object[]}}
 */
export function equipItem(state, merc, item, slot = null) {
  if (shifted(state)) { [state, merc, item, slot] = [gs(), state, merc, item]; }
  const st = useState(state);
  if (!st) return { ok: false, reason: '게임 상태가 없습니다.', replaced: null, slot: null, removed: [] };
  const m = findMerc(st, merc);
  const it = findItem(st, item);
  if (!m) return { ok: false, reason: '용병을 찾을 수 없습니다.', replaced: null, slot: null, removed: [] };
  if (!it) return { ok: false, reason: '보유하지 않은 장비입니다.', replaced: null, slot: null, removed: [] };

  ensureEquipment(m);
  const target = slot ? normalizeSlot(slot) : pickSlotFor(st, m, it);
  const reason = equipIssue(m, it, target || slot || null, st);
  if (reason) return { ok: false, reason, replaced: null, slot: null, removed: [] };
  if (!target) return { ok: false, reason: '장착할 수 없는 부위입니다.', replaced: null, slot: null, removed: [] };

  if (!Array.isArray(st.items)) st.items = [];
  if (!st.items.some((x) => x && x.uid === it.uid)) st.items.push(it);

  // 다른 용병(또는 자기 다른 칸)이 쓰고 있으면 해제
  const prevOwner = ownerOf(st, it.uid);
  if (prevOwner) {
    for (const s of slotKeysOf(prevOwner.equipment)) if (prevOwner.equipment[s] === it.uid) prevOwner.equipment[s] = null;
  }

  const replacedUid = m.equipment[target] || null;
  const replaced = replacedUid && replacedUid !== it.uid ? findItem(st, replacedUid) : null;
  m.equipment[target] = it.uid;

  // 양손 무기를 들면 왼손은 비운다
  const removed = [];
  if (target === 'weapon' && has('offhand') && isTwoHandedItem(it) && m.equipment.offhand) {
    const off = findItem(st, m.equipment.offhand);
    m.equipment.offhand = null;
    if (off) removed.push(off);
  }

  let msg = `${it.name}${josa(it.name)} 장착했습니다.`;
  if (removed.length) msg += ` (양손 무기라 ${removed[0].name}${josa(removed[0].name, '이/가')} 벗겨졌습니다)`;
  return { ok: true, reason: msg, replaced, slot: target, removed };
}

/**
 * 해제.
 * @returns {{ok:boolean, reason:string, item:object|null}}
 */
export function unequipSlot(state, merc, slot) {
  if (shifted(state)) { [state, merc, slot] = [gs(), state, merc]; }
  const st = useState(state);
  const m = findMerc(st, merc);
  if (!m) return { ok: false, reason: '용병을 찾을 수 없습니다.', item: null };
  const target = normalizeSlot(slot);
  if (!target) return { ok: false, reason: '알 수 없는 부위입니다.', item: null };
  ensureEquipment(m);
  const cur = m.equipment && m.equipment[target];
  if (!cur) return { ok: false, reason: '해당 부위에 장비가 없습니다.', item: null };
  const it = findItem(st, cur);
  m.equipment[target] = null;
  const nm = it ? it.name : '장비';
  return { ok: true, reason: `${nm}${josa(nm)} 해제했습니다.`, item: it };
}

/**
 * 매각. 장착 중이면 자동 해제한 뒤 목록에서 제거하고 골드를 준다.
 * @returns {{ok:boolean, reason:string, gold:number, item:object|null}}
 */
/**
 * 팔 수 있는 장비인가.
 *
 * ★ 이 규칙의 **유일한 출처**다. 예전에는 `ui/inventory.js` 안에만 있어서
 *   판매 경로가 늘어날 때마다(자동 판매 등) 규칙이 갈릴 위험이 있었다 —
 *   이 프로젝트는 같은 종류의 사고(아군 UnitDef 두 경로)를 이미 두 번 겪었다.
 *   `sellItem` 자체는 아무것도 안 막으므로 **부르는 쪽이 반드시 이걸 통과시켜야 한다.**
 *
 * 못 파는 것: 명시적 noSell / 신화(던전 세트) / 착용 중인 장비.
 * @param {object} item
 * @param {object} [st] 넘기면 착용 여부까지 본다
 */
/**
 * 잠긴 장비인가.
 *
 * ★ 잠금은 «자동으로 움직이지 마라» 는 뜻이다. 세 가지를 동시에 막는다:
 *   자동 착용이 **뺏어가지 못하고**, 착용자에게서 **벗기지도 못하고**, **팔리지도** 않는다.
 *   되돌릴 수 없는 조작(자동 착용·자동 판매)에 대한 플레이어의 유일한 안전장치다.
 *
 * ★ 옛 세이브에는 이 필드가 없다 — 없으면 false 라 그대로 «안 잠김» 이다. 마이그레이션이 필요 없다.
 */
export function isLocked(item) {
  return !!(item && item.locked);
}

export function isSellable(item, st = null) {
  if (!item) return false;
  if (item.noSell === true) return false;
  if (isLocked(item)) return false;          // 잠긴 건 안 판다
  // 신화 = 던전 세트 조각. rarity 로도, setId 로도 판정한다 (둘 중 하나만 있는 데이터가 있다)
  const mythicR = Number.isFinite(SETS_DATA.MYTHIC_RARITY) ? SETS_DATA.MYTHIC_RARITY : 5;
  if ((item.rarity || 0) >= mythicR) return false;
  if (item.mythic) return false;
  if (item.setId) return false;
  if (st && ownerOf(st, item.uid)) return false;
  return true;
}

export function sellItem(state, itemUid) {
  if (shifted(state)) { [state, itemUid] = [gs(), state]; }
  const st = useState(state);
  if (!st) return { ok: false, reason: '게임 상태가 없습니다.', gold: 0, item: null };
  const it = findItem(st, itemUid);
  if (!it) return { ok: false, reason: '보유하지 않은 장비입니다.', gold: 0, item: null };

  const owner = ownerOf(st, it.uid);
  if (owner) for (const s of slotKeysOf(owner.equipment)) if (owner.equipment[s] === it.uid) owner.equipment[s] = null;

  const idx = (st.items || []).findIndex((x) => x && x.uid === it.uid);
  if (idx >= 0) st.items.splice(idx, 1);

  const gold = sellPrice(it);
  st.gold = (st.gold || 0) + gold;
  return { ok: true, reason: `${it.name}${josa(it.name)} ${gold}G에 팔았습니다.`, gold, item: it };
}

/* ─────────────────────────── 자동 착용 ─────────────────────────── */

/**
 * 아키타입별 스탯 가중치 — "이 용병에게 이 장비가 얼마나 좋은가"의 기준.
 * 값은 스탯 1포인트의 상대 가치다 (hp는 수치 자체가 크므로 계수가 작다).
 * 탱커는 hp/def/res, 딜러는 atk/crit/critDmg, 도적은 spd/crit, 힐러는 res/hp를 우선한다.
 */
export const ARCH_WEIGHTS = {
  tank: { hp: 0.20, atk: 0.60, def: 2.40, res: 2.00, spd: 0.70, crit: 0.30, critDmg: 0.10, eva: 0.90 },
  fighter: { hp: 0.11, atk: 2.40, def: 1.05, res: 0.65, spd: 1.20, crit: 1.50, critDmg: 0.55, eva: 0.80 },
  lancer: { hp: 0.12, atk: 2.25, def: 1.25, res: 0.70, spd: 1.20, crit: 1.25, critDmg: 0.45, eva: 0.75 },
  archer: { hp: 0.07, atk: 2.50, def: 0.50, res: 0.50, spd: 1.55, crit: 1.85, critDmg: 0.70, eva: 1.00 },
  rogue: { hp: 0.07, atk: 2.20, def: 0.45, res: 0.45, spd: 2.00, crit: 2.20, critDmg: 0.90, eva: 1.45 },
  mage: { hp: 0.08, atk: 2.60, def: 0.40, res: 1.05, spd: 1.30, crit: 1.15, critDmg: 0.50, eva: 0.60 },
  healer: { hp: 0.15, atk: 0.85, def: 0.90, res: 1.95, spd: 1.60, crit: 0.45, critDmg: 0.15, eva: 0.85 },
};

/** 아키타입을 알 수 없을 때의 무난한 가중치 */
export const DEFAULT_ARCH_WEIGHT = { hp: 0.11, atk: 2.00, def: 1.10, res: 1.00, spd: 1.20, crit: 1.20, critDmg: 0.45, eva: 0.90 };

/** 용병(또는 classId)의 스탯 가중치 */
export function archWeightsFor(merc) {
  const id = typeof merc === 'string' ? merc : merc && merc.classId;
  let c = null;
  try { c = getClass(id); } catch { c = null; }
  return (c && ARCH_WEIGHTS[c.arch]) || DEFAULT_ARCH_WEIGHT;
}

/** 세트 조각을 모을 때 붙는 점수 가산 — 다음 단계에 닿으면 크게 쳐준다 */
const SET_SCORE_STEP = 0.05;
const SET_SCORE_TIER = 0.18;

/* ── 세트가 «임자» 를 고르는 배율 (`sets.js` 의 `prefer` 를 선언한 세트에만 걸린다) ──
 *
 * ★★ 왜 필요한가: 배분은 **전투력 순**이라 사제가 맨 뒤에 고르고, healer 가중치는
 *   atk 0.85(다른 아키타입은 2.2~2.6)라 같은 조각도 점수가 낮게 나온다.
 *   그래서 사제를 노린 세트가 앞사람들에게 흩어졌다 (실측: tools/setalloc.mjs).
 *
 * ★ 임자를 올리는 것만으로는 부족하다 — 앞사람이 **먼저** 고르기 때문이다.
 *   그래서 임자가 아닌 사람의 점수를 **내리는** 쪽이 실제로 작동한다.
 *   두 값 다 실측으로 골랐다: 임자만 올리면(1.35/1.00) 사제 0칸 그대로,
 *   임자 아닌 쪽을 0.62 로 내려야 사제가 세트를 쥔다.
 *
 * ★ 0.62 보다 더 내리면 «아무도 안 낀 채 창고에 남는» 구간이 생긴다 —
 *   임자가 그 부대에 없을 수도 있기 때문이다. 그 경계도 도구로 확인했다. */
const SET_PREFER_MULT = 1.35;
const SET_OFF_PREFER_MULT = 0.30;

/**
 * 이 세트가 이 용병을 «임자» 로 보는가. prefer 를 선언 안 한 세트면 null(=중립).
 *
 * ★★ `active` 가 핵심이다. 페널티를 **무조건** 걸면 임자가 그 부대에 없을 때
 *   아무도 안 끼고 세트가 창고에서 썩는다 (실측: 사제 없는 부대에서 최대 2칸, 세트 효과 0).
 *   그래서 «지금 배분 대상 중에 임자가 있는가» 를 보고, 있을 때만 남들을 물러나게 한다.
 *   `active` 가 없으면(단독 호출) 예전처럼 중립적으로 임자만 살짝 올린다.
 */
function preferBiasFor(setId, merc, active = null) {
  const def = setDefOf(setId);
  const pref = def && Array.isArray(def.prefer) ? def.prefer : null;
  if (!pref || !pref.length) return null;
  const mine = pref.includes(archOf(merc));
  if (mine) return SET_PREFER_MULT;
  // 임자가 이번 배분에 없으면 남을 물러나게 할 이유가 없다 — 그러면 세트가 버려진다
  if (active && !active.has(setId)) return null;
  return SET_OFF_PREFER_MULT;
}

/**
 * 이 용병에게 이 아이템이 얼마나 좋은지 점수화한다. 장착 불가면 -Infinity.
 * @param {object} merc 용병
 * @param {object} item 아이템
 * @param {{weights?:object, worn?:object[], checkEquip?:boolean, slot?:string, items?:any}} ctx
 *   weights    직접 넘긴 가중치 (없으면 클래스 아키타입에서 뽑는다)
 *   worn       다른 슬롯에 착용 중인 아이템들 (세트 시너지 판정용)
 *   checkEquip false면 장착 가능 검사를 건너뛴다 (이미 착용 중인 장비 평가용)
 *   slot       이 슬롯에 넣는다고 가정하고 검사한다
 * @returns {number}
 */
export function scoreItemFor(merc, item, ctx = {}) {
  if (!merc || !item) return -Infinity;
  if (ctx.checkEquip !== false && equipIssue(merc, item, ctx.slot || null, ctx.items ?? null)) return -Infinity;
  const w = ctx.weights || archWeightsFor(merc);
  const s = itemStats(item);
  let v = 0;
  for (const k of STAT_KEYS) { const val = s[k]; if (val) v += val * (w[k] || 0); }
  // 같은 세트를 이미 걸치고 있으면 더 쳐준다 (다음 단계에 닿으면 크게)
  const sid = setIdOf(item);
  if (sid && Array.isArray(ctx.worn)) {
    const n = ctx.worn.filter((x) => x && x.uid !== item.uid && setIdOf(x) === sid).length;
    if (n > 0) {
      const def = setDefOf(sid);
      const max = ctx.max || SLOTS.length;
      const hitsTier = !!def && def.tiers.some((t) => (t === 'full' ? max : t) === n + 1);
      v *= 1 + SET_SCORE_STEP * n + (hitsTier ? SET_SCORE_TIER : 0);
    }
  }
  /* ★ 임자 배율은 조각을 **하나도 안 걸쳤을 때부터** 걸려야 한다.
   *   위 시너지 블록은 `n > 0` 일 때만 도는데, 첫 조각을 누가 집느냐가 곧 결과라
   *   거기 얹으면 아무것도 안 바뀐다 (그렇게 만들었다가 실측으로 확인했다). */
  if (sid) {
    const bias = preferBiasFor(sid, merc, ctx.preferActive || null);
    if (bias != null) v *= bias;
  }
  return Math.round(v * 100) / 100;
}

/** 자동 착용이 장비를 갈아 끼우는 최소 개선폭 — 도토리 키재기로 장비가 계속 도는 걸 막는다 */
export const SWAP_MARGIN = 0.02;

/**
 * 지금 낀 것(curScore)을 새 것(newScore)으로 바꿀 만한가.
 * @param {number} curScore 현재 장비 점수 (빈 슬롯이면 0)
 * @param {number} newScore 후보 점수
 */
export function isUpgrade(curScore, newScore) {
  if (!isFinite(newScore)) return false;
  if (!curScore) return newScore > 0;
  return newScore > curScore + Math.max(0.5, Math.abs(curScore) * SWAP_MARGIN);
}

const GRADE_ORDER = { F: 0, E: 1, D: 2, C: 3, B: 4, A: 5, S: 6 };
const STRENGTH_TIER = [1.00, 1.30, 1.66, 2.10];

/**
 * 전투력 근사치 (자동 배분 우선순위용).
 * merc.js 의 `mercPower` 와 목적은 같지만 gear.js ↔ merc.js 순환 import 를 피하려고 따로 센다.
 * 정확한 값이 필요하면 `autoEquipAll(state, { powerOf })` 로 mercPower 를 넘겨라.
 */
export function mercStrength(state, merc) {
  const st = useState(state);
  const m = findMerc(st, merc);
  if (!m) return 0;
  let c = null;
  try { c = getClass(m.classId); } catch { c = null; }
  const tier = clamp(((c && c.tier) || 1) - 1, 0, STRENGTH_TIER.length - 1);
  const base = 100 * (1 + 0.085 * ((m.level || 1) - 1)) * STRENGTH_TIER[tier] * (1 + 0.11 * (GRADE_ORDER[m.grade] ?? 0));
  let gear = 0;
  for (const s of slotKeysOf(m.equipment)) {
    const it = findItem(st, m.equipment && m.equipment[s]);
    if (it) gear += itemPower(it);
  }
  return Math.round(base + gear);
}

/** uid/아이템 섞인 목록을 uid Set 으로 (null이면 제한 없음) */
function toUidSet(pool) {
  if (!pool) return null;
  const arr = pool instanceof Set ? [...pool] : Array.isArray(pool) ? pool : [pool];
  const set = new Set();
  for (const x of arr) { const u = typeof x === 'string' ? x : x && x.uid; if (u) set.add(u); }
  return set;
}

/** 다른 슬롯에 착용 중인 아이템들 (세트 판정용) */
function wornExcept(st, equipment, slot) {
  const out = [];
  const seen = new Set();
  for (const s of slotKeysOf(equipment)) {
    if (s === slot) continue;
    const u = equipment && equipment[s];
    if (!u || seen.has(u)) continue;
    const it = findItem(st, u);
    if (it) { seen.add(u); out.push(it); }
  }
  return out;
}

/**
 * 용병에게 지금 끼울 수 있는 그 슬롯 최고 점수 아이템.
 * 이미 누군가 장착 중인 장비는 후보에서 빠진다 (`inventory`가 걸러 준다).
 * @param {object} state
 * @param {object|string} merc
 * @param {string} slot 10슬롯 중 하나
 * @param {{pool?:Array|Set, exclude?:Set}} opt  pool=후보 제한, exclude=이번 배분에서 이미 찜한 uid
 * @returns {object|null}
 */
export function bestItemFor(state, merc, slot, opt = {}) {
  const st = useState(state);
  const m = findMerc(st, merc);
  if (!m) return null;
  const target = normalizeSlot(slot);
  if (!target) return null;
  const pool = toUidSet(opt.pool);
  const exclude = opt.exclude instanceof Set ? opt.exclude : null;
  const ctx = {
    weights: archWeightsFor(m), worn: wornExcept(st, m.equipment, target),
    slot: target, items: st, max: equippableSlotCount(m, st),
  };
  let best = null, bestScore = -Infinity;
  for (const it of inventory(st, { slot: target })) {
    if (exclude && exclude.has(it.uid)) continue;
    if (pool && !pool.has(it.uid)) continue;
    const sc = scoreItemFor(m, it, ctx);
    if (sc > bestScore) { bestScore = sc; best = it; }
  }
  return best;
}

/**
 * 배분 계획을 세운다 (state를 건드리지 않는다).
 * 가상 소유 맵을 굴리므로 앞 용병이 벗은 장비가 뒤 용병 후보로 다시 들어간다.
 * 슬롯은 `SLOTS` 순서대로 본다 — 오른손이 먼저라 양손 무기를 고르면 그 자리에서 왼손이 잠긴다.
 * @returns {{uid:string, name:string, merc:object, changed:Array}[]}
 */
/**
 * 이 교체가 **활성 세트 단계를 떨어뜨리는가**.
 * 예: 3칸(3단계 보너스 활성)에서 한 칸을 다른 세트/일반템으로 바꾸면 2칸이 되어 단계가 사라진다.
 *
 * @param {object} st
 * @param {object} eq   가상 장비 맵 (buildPlan 진행 중 상태)
 * @param {string} slot 바꾸려는 슬롯
 * @param {object} curItem 지금 낀 것
 * @param {object} next 새로 낄 것
 * @returns {boolean} true 면 그 교체를 하면 안 된다
 */
function breaksSetTier(st, eq, slot, curItem, next) {
  const sid = setIdOf(curItem);
  if (!sid) return false;                 // 세트 조각이 아니면 지킬 단계가 없다
  if (setIdOf(next) === sid) return false; // 같은 세트끼리 교체 — 개수가 안 변한다

  let now = 0;
  for (const s of slotKeysOf(eq)) {
    const it = findItem(st, eq[s]);
    if (it && setIdOf(it) === sid) now++;
  }
  const after = Math.max(0, now - 1);
  return tierOf(sid, now) > tierOf(sid, after);
}

/** 조각 n 개일 때 활성인 세트 단계 (없으면 0) */
function tierOf(sid, n) {
  const def = setDefOf(sid);
  const steps = (def && Array.isArray(def.tiers) && def.tiers.length)
    ? def.tiers.map((t) => (t === 'full' ? SLOTS.length : t))
    : [3, 5, 7, SLOTS.length];
  let best = 0;
  for (const t of steps) if (n >= t && t > best) best = t;
  return best;
}

function buildPlan(st, targets, opt = {}) {
  const pool = toUidSet(opt.pool);
  const owner = new Map(); // itemUid -> mercUid (가상 소유)

  /* ★★ **가상 장비를 전원분 들고 간다** (예전에는 대상 한 명분만 만들었다).
   *
   *   자동 착용이 «남이 끼고 있는 장비» 를 가져올 수 있게 되면서 필요해졌다:
   *   A 가 B 의 장비를 가져가면 B 의 상태도 그 자리에서 비어야 한다.
   *   안 그러면 뒤에 B 차례가 왔을 때 **이미 뺏긴 물건을 아직 낀 것으로** 보고
   *   «지금 것보다 나은 게 없다» 며 빈손으로 끝난다. */
  const vEq = new Map();
  for (const m of st.roster || []) {
    if (!m) continue;
    const e = { ...normalizeEquipment(m.equipment) };
    vEq.set(m.uid, e);
    for (const s of slotKeysOf(e)) { const u = e[s]; if (u) owner.set(u, m.uid); }
  }
  /* 처리 순서 = 전투력 순. 자기보다 **먼저 고른 사람** 것은 못 가져온다 —
   * 가져가면 그 사람 계획을 되돌려야 해서 결과가 요동친다. */
  const rank = new Map();
  targets.forEach((m, i) => { if (m) rank.set(m.uid, i); });
  const byUid = new Map((st.roster || []).filter(Boolean).map((m) => [m.uid, m]));

  const items = (st.items || []).filter(Boolean);

  /* ★ «이번 배분 대상 중에 임자가 있는 세트» 만 남을 물러나게 한다.
   *   사제가 없는 부대에서까지 페널티를 걸면 세트가 통째로 창고에 남는다. */
  const targetArchs = new Set(targets.map((m) => archOf(m)).filter(Boolean));
  const preferActive = new Set();
  for (const it of items) {
    const sid = setIdOf(it);
    if (!sid || preferActive.has(sid)) continue;
    const def = setDefOf(sid);
    const pref = def && Array.isArray(def.prefer) ? def.prefer : null;
    if (pref && pref.some((a) => targetArchs.has(a))) preferActive.add(sid);
  }

  const out = [];

  for (const m of targets) {
    const myRank = rank.has(m.uid) ? rank.get(m.uid) : Infinity;
    /** 이 아이템을 지금 사람이 가져갈 수 있나 (없으면 자유, 있으면 «아직 안 고른 사람» 것만) */
    const canTake = (it) => {
      const holder = owner.get(it.uid);
      if (!holder) return true;                 // 창고에 있다
      if (holder === m.uid) return false;       // 자기가 이미 다른 칸에 끼고 있다
      if (isLocked(it)) return false;           // ★ 잠긴 건 못 뺏는다
      const hr = rank.has(holder) ? rank.get(holder) : Infinity;
      return hr > myRank;                       // 나보다 뒤에 고르는 사람(또는 대상 밖) 것만
    };
    const eq = vEq.get(m.uid) || { ...normalizeEquipment(m.equipment) };
    const weights = archWeightsFor(m);
    const changed = [];
    const virt = { ...m, equipment: eq };
    for (const slot of SLOTS) {
      // 양손 무기를 들었으면 왼손은 건너뛰고, 남아 있던 왼손 장비는 벗긴다
      if (slot === 'offhand' && isTwoHandedItem(findItem(st, eq.weapon))) {
        if (eq.offhand) { owner.delete(eq.offhand); eq.offhand = null; }
        continue;
      }
      const ctx = {
        weights, worn: wornExcept(st, eq, slot), slot, items: st,
        max: SLOTS.length - (isTwoHandedItem(findItem(st, eq.weapon)) ? 1 : 0),
        preferActive,
      };
      const curItem = findItem(st, eq[slot]);
      const curScore = curItem ? scoreItemFor(virt, curItem, { ...ctx, checkEquip: false }) : 0;
      /* ★ 잠긴 장비를 끼고 있으면 그 칸은 **손대지 않는다.**
       *   «못 뺏는다» 만으로는 부족하다 — 착용자 본인의 자동 착용이 벗겨 버리면 잠금이 무의미하다. */
      if (curItem && isLocked(curItem)) continue;
      let best = null, bestScore = -Infinity;
      for (const it of items) {
        if (!slotAccepts(slot, it)) continue;
        if (!canTake(it)) continue;
        if (pool && !pool.has(it.uid)) continue;
        const sc = scoreItemFor(virt, it, ctx);
        if (sc > bestScore) { bestScore = sc; best = it; }
      }
      // 지금 낀 것보다 뚜렷하게 낫지 않으면 그대로 둔다
      if (!best || !isUpgrade(curScore, bestScore)) continue;

      /* ★ 세트 단계 보호.
       * `scoreItemFor` 는 세트 보너스를 ×(1 + 0.05n + 0.18) 배율로 **근사**할 뿐,
       * 실제 보너스 스탯·고유효과를 점수에 넣지 않는다. 그래서 전설 후보가 많아지면
       * (희귀도 곡선을 고친 뒤 실제로 그렇게 됐다) 배율을 넘겨 세트를 하나씩 벗겨 낸다 —
       * 실측: 3칸 보유 부대가 자동 착용 후 평균 1.0칸, 30회 중 27회 3칸 보너스가 날아갔다.
       * 활성 단계(3/5/7/풀)를 **내리는 교체는 하지 않는다.** 같은 세트로 갈아타는 건 허용한다. */
      if (curItem && breaksSetTier(st, eq, slot, curItem, best)) continue;
      /* 남에게서 가져오는 것이면 **그 사람의 가상 장비도 그 자리에서 비운다.**
       * (실제 state 는 applyPlan 의 equipItem 이 벗긴다 — gear.js equipItem 1350행 부근) */
      const holder = owner.get(best.uid);
      let tookFrom = null;
      if (holder && holder !== m.uid) {
        const hm = byUid.get(holder);
        const he = vEq.get(holder);
        if (he) for (const s of slotKeysOf(he)) if (he[s] === best.uid) he[s] = null;
        tookFrom = { uid: holder, name: (hm && hm.name) || '다른 단원' };
      }
      changed.push({
        slot, from: curItem || null, to: best,
        delta: Math.round((bestScore - curScore) * 100) / 100,
        // ★ 미리보기·결과에 «누구에게서» 를 보여 준다. 안 보이면 조용히 뺏긴 것처럼 느껴진다.
        tookFrom,
      });
      if (curItem) owner.delete(curItem.uid); // 벗은 장비는 창고로 돌아간다
      owner.set(best.uid, m.uid);
      eq[slot] = best.uid;
    }
    out.push({ uid: m.uid, name: m.name, merc: m, changed });
  }
  return out;
}

/** 계획을 실제 state에 반영. 실패한 항목은 changed 에서 빼서 결과가 현실과 어긋나지 않게 한다. */
function applyPlan(st, plan) {
  let n = 0;
  for (const row of plan) {
    const done = [];
    for (const ch of row.changed) {
      const r = equipItem(st, row.merc || row.uid, ch.to, ch.slot);
      if (r && r.ok) { done.push(ch); n++; }
      else console.warn('[gear] 자동 착용 실패:', (r && r.reason) || '알 수 없음');
    }
    row.changed = done;
  }
  return n;
}

/** 자동 착용 대상 추리기 (mercs > squadId > 전체 순으로 우선) */
function resolveTargets(st, { squadId = null, mercs = null } = {}) {
  if (mercs) {
    const arr = Array.isArray(mercs) ? mercs : [mercs];
    return arr.map((m) => findMerc(st, m)).filter(Boolean);
  }
  const roster = (st.roster || []).filter(Boolean);
  if (!squadId) return roster;
  const squad = (st.squads || []).find((s) => s && s.id === squadId);
  const set = new Set(((squad && squad.memberUids) || []).filter(Boolean));
  return roster.filter((m) => set.has(m.uid));
}

/**
 * 용병 하나의 10슬롯을 각각 더 좋은 것으로 교체한다.
 * 현재 장비보다 점수가 낮거나 같으면 바꾸지 않는다.
 * @param {object} state
 * @param {object|string} merc
 * @param {{pool?:Array|Set, dryRun?:boolean}} opt  pool=후보 제한(예: 이번 전투 전리품), dryRun=미리보기
 * @returns {{changed:Array<{slot:string, from:object|null, to:object, delta:number}>, uid:string|null, name:string}}
 */
export function autoEquipMerc(state, merc, opt = {}) {
  const st = useState(state);
  const m = findMerc(st, merc);
  if (!st || !m) return { changed: [], uid: null, name: '' };
  const plan = buildPlan(st, [m], opt);
  if (!opt.dryRun) applyPlan(st, plan);
  const row = plan[0] || { changed: [] };
  return { changed: row.changed, uid: m.uid, name: m.name };
}

/**
 * 여러 용병에게 일괄 배분한다. **전투력이 높은 용병부터** 고르므로 좋은 장비가 주력에게 간다.
 * @param {object} state
 * @param {{squadId?:string, mercs?:Array, pool?:Array|Set, dryRun?:boolean, powerOf?:Function}} opt
 * @returns {{perMerc:Array<{uid:string, name:string, merc:object, changed:Array}>, total:number}}
 */
/**
 * 부대에 배치되지 않은 단원의 장비를 전부 벗긴다.
 *
 * 부대 상한이 5 x 7 = 35 명인데 정원은 70 이라, 대기 인원이 장비를 쥔 채 놀고 있으면
 * 정작 출전하는 단원이 낄 물건이 창고에 없다. 자동 착용 전에 이걸 돌리면
 * 대기 인원의 장비가 전부 후보 풀로 돌아온다.
 *
 * @param {object} state
 * @returns {{unequipped:number, mercs:number}}
 */
export function unequipBenched(state) {
  const st = useState(state);
  if (!st) return { unequipped: 0, mercs: 0 };
  const assigned = new Set();
  for (const sq of st.squads || []) {
    for (const u of sq.memberUids || []) if (u) assigned.add(u);
  }
  let n = 0, who = 0;
  for (const m of st.roster || []) {
    if (!m || assigned.has(m.uid)) continue;
    let any = false;
    for (const s of slotKeysOf(m.equipment)) {
      if (m.equipment[s]) { m.equipment[s] = null; n++; any = true; }
    }
    if (any) who++;
  }
  return { unequipped: n, mercs: who };
}

export function autoEquipAll(state, {
  squadId = null, mercs = null, pool = null, dryRun = false, powerOf = null,
  freeBenched = true,
} = {}) {
  const st = useState(state);
  if (!st) return { perMerc: [], total: 0 };
  let targets = resolveTargets(st, { squadId, mercs });

  /* ★ 대기 인원은 **대상에서 뺀다** (단, 사용자가 `mercs` 로 그 사람을 콕 집었을 때는 존중).
   * `resolveTargets` 는 squadId 가 없으면 로스터 전원을 돌려준다. 그대로 두면
   * "전체 단원" 자동 착용이 대기 인원에게도 장비를 물려, 정작 출전 단원이 낄 게 없어진다
   * (실제로 대기 14명이 장비를 낀 채 남았다).
   * 장비는 싸우는 사람이 낀다 — 대기 인원은 벗기고 끝이다. */
  if (freeBenched && !mercs) {
    const assigned = new Set();
    for (const sq of st.squads || []) for (const u of sq.memberUids || []) if (u) assigned.add(u);
    targets = targets.filter((m) => m && assigned.has(m.uid));
  }

  /* ★ 대기 인원(부대 미배치) 장비를 먼저 회수한다.
   * 부대 상한 5 x 7 = 35 명인데 정원은 70 이라, 대기 인원이 장비를 쥐고 있으면
   * 정작 출전하는 단원이 낄 물건이 창고에 없다.
   *
   * dryRun 일 때도 **똑같이** 해야 한다 — 미리보기와 실제 결과가 갈리면 안 된다.
   * 그래서 dryRun 이면 원래 장비를 기억했다가 계획을 만든 뒤 되돌린다.
   *
   * 자동 착용 대상 자신이 대기 인원이면 건드리지 않는다(그 사람 걸 뺏어 그 사람에게
   * 다시 주는 꼴이라 의미가 없고, 계획이 요란해진다). */
  const restore = [];
  if (freeBenched) {
    const targetUids = new Set(targets.map((m) => m && m.uid).filter(Boolean));
    const assigned = new Set();
    for (const sq of st.squads || []) for (const u of sq.memberUids || []) if (u) assigned.add(u);
    for (const m of st.roster || []) {
      if (!m || assigned.has(m.uid) || targetUids.has(m.uid)) continue;
      for (const s of slotKeysOf(m.equipment)) {
        if (!m.equipment[s]) continue;
        restore.push({ m, s, uid: m.equipment[s] });
        m.equipment[s] = null;
      }
    }
  }
  const strength = typeof powerOf === 'function'
    ? (m) => { try { return powerOf(m) || 0; } catch { return 0; } }
    : (m) => mercStrength(st, m);
  const ordered = targets
    .map((m, i) => ({ m, i, p: strength(m) }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.m);

  const perMerc = buildPlan(st, ordered, { pool });
  if (!dryRun) applyPlan(st, perMerc);
  else for (const r of restore) r.m.equipment[r.s] = r.uid;   // 미리보기는 상태를 안 바꾼다

  return {
    perMerc,
    total: perMerc.reduce((a, r) => a + r.changed.length, 0),
    freed: restore.length,
  };
}

/**
 * 이 아이템이 가장 잘 어울리는 용병 순위 (장착 불가한 용병은 빠진다).
 * @param {object} state
 * @param {object|string} item
 * @param {{limit?:number}} opt limit<=0 이면 전원
 * @returns {Array<{merc:object, uid:string, name:string, score:number, cur:object|null, curScore:number, delta:number, owner:boolean, slot:string|null}>}
 */
export function recommendMercsFor(state, item, { limit = 3 } = {}) {
  const st = useState(state);
  const it = findItem(st, item);
  if (!st || !it) return [];
  const holder = ownerOf(st, it.uid);
  const out = [];
  for (const m of st.roster || []) {
    if (!m) continue;
    const slot = pickSlotFor(st, m, it);
    if (!slot) continue;
    const ctx = {
      weights: archWeightsFor(m), worn: wornExcept(st, m.equipment, slot),
      slot, items: st, max: equippableSlotCount(m, st),
    };
    const score = scoreItemFor(m, it, ctx);
    if (!isFinite(score)) continue;
    const eq = m.equipment || {};
    const curUid = eq[slot];
    const cur = curUid && curUid !== it.uid ? findItem(st, curUid) : null;
    const curScore = cur ? scoreItemFor(m, cur, { ...ctx, checkEquip: false }) : 0;
    out.push({
      merc: m, uid: m.uid, name: m.name, score, cur, curScore, slot,
      delta: Math.round((score - curScore) * 100) / 100,
      owner: !!holder && holder.uid === m.uid,
    });
  }
  out.sort((a, b) => b.delta - a.delta || b.score - a.score);
  return limit > 0 ? out.slice(0, limit) : out;
}
