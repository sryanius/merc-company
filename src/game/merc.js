// 용병(Mercenary) 런타임 모델 — 생성 / 스탯 / 성장 / 전직 / 외형 레시피.
// 순수 JS: 모듈 최상위에서 document·window·canvas를 만지지 않는다 (node import 가능).
import { MAX_LEVEL as LIMIT_MAX_LEVEL } from '../data/limits.js';
//
// 주의: state.js 와는 순환 import 관계다. `globalState` 는 반드시 함수 "안"에서만 읽는다.
import { clamp, clone, lerp } from '../core/util.js';
import { rng as defaultRng, uid } from '../core/rng.js';
import { ARCHETYPES, CLASSES, getClass, promoteOptions } from '../data/classes.js';
import * as NAMES from '../data/names.js';
// 슬롯 정의(SLOTS)·세트 규칙의 주인은 gear.js 다. 여기서 다시 정의하지 않는다.
import {
  SLOTS, setBonusStats, setBonusFromWorn, setProgress, normalizeEquipment,
  isTwoHandedType, isTwoHandedItem, equippableSlotCount, josa,
} from './gear.js';
import { state as globalState } from './state.js';

/* ─────────────────────────── 상수 (SPEC §2.1 / §2.4) ─────────────────────────── */

export const GRADES = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
export const GRADE_MULT = { F: 0.78, E: 0.88, D: 0.97, C: 1.06, B: 1.18, A: 1.34, S: 1.55 };
export const GRADE_IDX = { F: 0, E: 1, D: 2, C: 3, B: 4, A: 5, S: 6 };
/**
 * 전직 차수 배율 (인덱스 = tier-1). 1차 / 2차 / 3차 / **4차**.
 *
 * 4차(2.10)는 3차 대비 1.265배로, 앞선 두 계단(1.30배 / 1.277배)과 같은 보폭이다.
 * 이 값을 바꾸면 `quest.js` 의 적 레벨 차수 보정(PROMO_STEP)도 같이 바꿔야 한다 —
 * 적에게는 차수 배율이 없어서 용병 쪽 계단만 올리면 그 랭크가 통째로 헐거워진다.
 */
export const TIER_MULT = [1.00, 1.30, 1.66, 2.10];
export const GROWTH_RATE = 0.085;
/** 클래스 최고 차수 (= TIER_MULT 길이). 차수를 더 늘리면 여기만 따라온다. */
export const MAX_TIER = TIER_MULT.length;
/* ★ 정의는 `data/limits.js` 에 있다 (의존성 0 모듈).
 *   랭킹 검증이 서버(Deno)에서도 돌아야 하는데, 상수 하나 읽자고 merc.js 를 통째로
 *   끌고 가면 게임 전체가 딸려 간다. 여기서는 **다시 내보내기만** 한다 —
 *   기존 `import { MAX_LEVEL } from './merc.js'` 는 전부 그대로 동작한다. */
export const MAX_LEVEL = LIMIT_MAX_LEVEL;
/** 각 차수로 전직하는 데 필요한 레벨. 키 = 목표 차수 */
export const PROMOTE_LEVEL = { 2: 15, 3: 35, 4: 55 };

export const STAT_KEYS = ['hp', 'atk', 'def', 'res', 'spd', 'crit', 'critDmg', 'eva'];
export const SCALING_KEYS = ['hp', 'atk', 'def', 'res', 'spd'];
export const FLAT_KEYS = ['crit', 'critDmg', 'eva'];

/** 등급별 고용가 기준값 (1레벨 1차 클래스) */
export const GRADE_HIRE_COST = { F: 60, E: 110, D: 200, C: 380, B: 760, A: 1600, S: 4000 };
/**
 * 등급별 일당 기준값. **표 자체는 건드리지 않았다** — 주점 UI가 이 숫자를 그대로 보여주고,
 * 초반 경제(임금 = 총수입의 36~39%)가 이 값에 맞춰져 있다.
 * 만렙 압박은 아래 `upkeepLevelTerm` 의 2차항으로만 준다.
 */
export const GRADE_UPKEEP = { F: 2, E: 3, D: 4, C: 6, B: 9, A: 14, S: 22 };
/** 차수 보정 (고용가 / 일당). 인덱스 = tier-1, 4차까지. */
const TIER_COST = [1, 2.2, 4.6, 9.8];
const TIER_UPKEEP = [1, 1.3, 1.7, 2.2];

/* ── 임금 레벨 항 (설계 A: 만렙 부대의 임금이 수입을 압박해야 한다) ──
 * 예전 항은 `1 + 0.05*(lv-1)` 하나뿐이었다. 그런데 의뢰 보상은 `(60 + level*13) * RANK_MULT`
 * 로 레벨과 랭크 배율(F 1 → S 18)이 함께 올라 **초선형**으로 늘어난다. 선형 임금은 Lv80 에서도
 * 4.95배뿐이라 수입 대비 비중이 후반으로 갈수록 계속 얇아지고, 만렙에 닿으면 임금이
 * 브레이크 역할을 완전히 잃는다. 임금은 이 게임의 **유일한** 경제 브레이크다.
 *
 * 그래서 2차항을 얹어 레벨이 높을수록 임금이 더 빠르게 붙게 했다.
 * 계수 0.0005 는 "Lv80 4차 7인 부대의 일당이 S랭크 **일반** 의뢰 수입의 60~100% 를 먹고,
 * 정예 의뢰(보상 ×2.2)를 타면 30~50% 로 내려간다" 를 목표로 역산한 값이다 —
 * 즉 만렙 부대는 정예를 돌아야 흑자가 된다.
 *
 *   레벨 항 값   Lv1 1.00 / Lv15 1.80 / Lv35 3.28 / Lv55 5.16 / Lv60 5.69 / Lv80 8.07
 *   (예전 선형)  Lv1 1.00 / Lv15 1.70 / Lv35 2.70 / Lv55 3.70 / Lv60 3.95 / Lv80 4.95
 *
 * Lv15 이하에서는 차이가 6% 미만이라 **초반 경제는 사실상 그대로다**(경험치 곡선이 3배
 * 느려졌으므로 초반 40일의 실제 레벨은 오히려 예전보다 낮다). 초반을 조이려면 여기가 아니라
 * GRADE_UPKEEP 를 만져야 한다.
 */
const UPKEEP_LV1 = 0.05;
const UPKEEP_LV2 = 0.0005;

/** 임금의 레벨 비례항 (1차 + 2차) */
export function upkeepLevelTerm(level = 1) {
  const d = clamp(Math.round(level || 1), 1, MAX_LEVEL) - 1;
  return 1 + UPKEEP_LV1 * d + UPKEEP_LV2 * d * d;
}

/**
 * 도시 tier 별 등급 가중치 (각 행의 합 = 100).
 *
 * 1~5 는 도시 데이터의 실제 tier 다. **6 은 도시에 존재하지 않는다** —
 * 평판·특화 보정으로만 도달하는 "실효 티어" 상한이며, tier 5 의 추세를 한 단계 더 민 값이다.
 */
/**
 * **S 등급은 이 표에 없다(전부 0).** 특화 도시에서만 나온다.
 *
 * 예전에는 티어가 오르면 S가 조금씩 섞여 나왔다(5티어 3%). 그러면 대도시 하나만 붙잡고
 * 있어도 S가 나오므로 특화 도시를 돌 이유가 약해진다. S를 특화 전용으로 못 박아서
 * "이 클래스의 S를 원하면 그 클래스의 고장으로 가라"가 규칙이 되게 했다.
 * 원래 S 자리의 가중치는 A로 넘겨 대도시가 여전히 고등급에 유리하도록 유지한다.
 */
export const GRADE_WEIGHTS = {
  1: { F: 40, E: 30, D: 18, C: 9, B: 2.5, A: 0.5, S: 0 },
  2: { F: 28, E: 30, D: 22, C: 13, B: 5.5, A: 1.5, S: 0 },
  3: { F: 18, E: 26, D: 26, C: 18, B: 8.5, A: 3.5, S: 0 },
  4: { F: 10, E: 20, D: 26, C: 23, B: 13, A: 8, S: 0 },
  5: { F: 5, E: 13, D: 24, C: 26, B: 19, A: 13, S: 0 },
  6: { F: 2, E: 7, D: 21, C: 28, B: 25, A: 17, S: 0 },
  /* ★ 7·8 은 **평판으로만** 닿는다 (도시 등급은 5 가 최고). 평판 상한을 300 으로 늘리면서
   *   같이 얹었다 — 안 얹으면 5등급 명물 도시는 평판 10 에서 이미 상한(5+1.0=6)이라
   *   평판을 아무리 올려도 확률이 1도 안 변한다. 실제로 그랬다. */
  7: { F: 1, E: 4, D: 16, C: 27, B: 29, A: 23, S: 0 },
  8: { F: 0.5, E: 2, D: 11, C: 24, B: 32, A: 30.5, S: 0 },
};

/* ── 평판 / 특화 보정 노브 ────────────────────────────────────────────────
 * 도시 평판(0~300)과 "클래스 특화 도시" 를 실효 티어 하나로 합쳐 등급 확률에 반영한다.
 * 노림수: 부대가 커져도 5티어 도시에만 눌러앉지 않고, 원하는 클래스의 특화 도시를 순회하게 만든다. */

/** 실효 티어 상한 (GRADE_WEIGHTS 의 마지막 행) */
export const MAX_CITY_TIER = 8;
/** 평판 기준선. 이 값이면 보정 0 (state.js 의 START_REP 과 같은 값) */
export const REP_BASELINE = 10;
/**
 * 평판 몇 점이 실효 티어 +1 인가.
 *
 * ★ 예전에는 60 이었다 (평판 100 = +1.5티어). 그런데 **평판 100 을 너무 금방 찍어서**
 *   중반이면 더 올릴 이유가 사라졌다 (제작자 지적).
 *   상한을 300 으로 늘리면서 이 값도 같이 늘려 **효과가 퍼지게** 했다:
 *
 *     평판 100 → +0.60티어   (예전 +1.5)
 *     평판 200 → +1.27티어
 *     평판 300 → +1.93티어   (예전 상한보다 조금 더 높다)
 *
 *   즉 «금방 얻는 큰 보상» 을 «오래 걸리는 더 큰 보상» 으로 바꾼 것이다.
 */
export const REP_PER_TIER = 150;
/** 특화 도시가 주는 실효 티어 보너스 */
export const SPECIALTY_TIER_BONUS = 1.0;
/**
 * 특화 도시에서 배수를 받는 등급.
 * S는 여기 없다 — S는 배수가 아니라 아래 `SPEC_S_MAX` 로 직접 배정한다.
 */
export const SPECIALTY_TOP_GRADES = ['B', 'A'];
/**
 * 특화 도시의 고등급(B·A) 가중치 배수.
 *
 * 처음엔 S·A 에 ×4 를 걸었는데 실제 화면에서 **A 48% / S 20%** 가 나왔다.
 * 특화 도시 한 곳만 가면 A 이상이 68% — 등급 뽑기라는 게임의 축이 무의미해질 수준이었다.
 * ×1.5 로 낮춰 "특화 도시가 유리하지만 여전히 뽑기"인 상태로 되돌린다.
 */
export const SPECIALTY_TOP_MULT = 1.5;
/**
 * 특화 도시의 S 확률 상한 (5%).
 * 실효 티어에 비례해 이 값까지 올라간다. **비특화 도시는 언제나 0%다.**
 */
export const SPEC_S_MAX = 0.05;
/** 실효 티어가 가장 낮아도 상한 대비 이 비율만큼은 S가 나온다 (5% × 0.16 = 0.8%) */
export const SPEC_S_MIN_FRAC = 0.16;

/** 기본 아키타입 (클래스 데이터가 깨져도 스탯 0이 되지 않게) */
const FALLBACK_ARCH = { hp: 220, atk: 30, def: 15, res: 12, spd: 46, crit: 6, critDmg: 50, eva: 5 };

/** 클래스에 sprite가 없을 때 쓰는 최소 레시피 (§4.4 어휘) */
const DEFAULT_SPRITE = {
  body: 'body_normal', head: 'head_human', hair: 'hair_short',
  helm: 'helm_none', armor: 'armor_leather', cape: 'cape_none',
  weapon: 'wpn_sword', offhand: 'shd_none',
  palette: { skin: 'pale', hair: 'brown', metal: 'iron', cloth: 'ash', leather: 'brown', accent: 'gold', glow: 'none' },
};

/* ─────────────────────────── 무기 타입 → 파츠 매핑 (§4.4 어휘 고정) ─────────────────────────── */

/** 무기 타입 → wpn_* 파츠. (shield는 손이 아니라 offhand로 간다) */
export const WEAPON_PART = {
  sword: 'wpn_sword', greatsword: 'wpn_greatsword', katana: 'wpn_katana',
  dagger: 'wpn_dagger', spear: 'wpn_spear', axe: 'wpn_axe', mace: 'wpn_mace',
  bow: 'wpn_bow', crossbow: 'wpn_crossbow', staff: 'wpn_staff', wand: 'wpn_wand',
  tome: 'wpn_tome', claw: 'wpn_claw', scythe: 'wpn_scythe', shield: 'wpn_none',
};

/** 베이스 id에 이 조각이 들어가면 더 구체적인 파츠를 쓴다 (긴 것부터 검사) */
export const WEAPON_PART_HINTS = [
  ['twindagger', 'wpn_twindagger'], ['twin', 'wpn_twindagger'],
  ['greataxe', 'wpn_greataxe'], ['battleaxe', 'wpn_greataxe'], ['warhammer', 'wpn_hammer'],
  ['halberd', 'wpn_halberd'], ['longbow', 'wpn_longbow'], ['crossbow', 'wpn_crossbow'],
  ['greatsword', 'wpn_greatsword'], ['rapier', 'wpn_rapier'], ['hammer', 'wpn_hammer'],
  ['maul', 'wpn_hammer'], ['pike', 'wpn_pike'], ['lance', 'wpn_pike'],
  ['scythe', 'wpn_scythe'], ['katana', 'wpn_katana'], ['orb', 'wpn_orb'],
];

/** 방패 베이스 id → shd_* 파츠 */
export const SHIELD_PART_HINTS = [
  ['buckler', 'shd_buckler'], ['tower', 'shd_tower'], ['kite', 'shd_kite'],
  ['round', 'shd_round'], ['torch', 'shd_torch'], ['orb', 'shd_orb'], ['dagger', 'shd_dagger'],
];

/**
 * 왼손(offhand) 베이스 id → shd_* 파츠.
 * 왼손에는 방패뿐 아니라 보조무기(단검·마도서·횃불…)도 들어간다 — §4.4 shd_* 어휘 안에서만 고른다.
 */
export const OFFHAND_PART_HINTS = [
  ['buckler', 'shd_buckler'], ['tower', 'shd_tower'], ['kite', 'shd_kite'], ['round', 'shd_round'],
  ['torch', 'shd_torch'], ['lantern', 'shd_torch'], ['orb', 'shd_orb'], ['crystal', 'shd_orb'],
  ['tome', 'shd_orb'], ['grimoire', 'shd_orb'], ['dagger', 'shd_dagger'], ['parry', 'shd_dagger'],
  ['shield', 'shd_round'],
];

/** 왼손 무기 타입 → shd_* 파츠 (id 힌트가 안 걸릴 때) */
export const OFFHAND_TYPE_PART = {
  shield: 'shd_round', dagger: 'shd_dagger', claw: 'shd_dagger', katana: 'shd_dagger',
  sword: 'shd_dagger', axe: 'shd_dagger', mace: 'shd_dagger',
  tome: 'shd_orb', wand: 'shd_orb', orb: 'shd_orb',
};

/** 투구 베이스 id → helm_* 파츠 (구체적인 것부터 검사) */
export const HELM_PART_HINTS = [
  ['greathelm', 'helm_great'], ['great', 'helm_great'], ['horned', 'helm_horned'],
  ['circlet', 'helm_circlet'], ['tiara', 'helm_circlet'], ['crown', 'helm_crown'],
  ['hood', 'helm_hood'], ['cowl', 'helm_hood'], ['wizard', 'helm_wizard'], ['hat', 'helm_wizard'],
  ['mask', 'helm_mask'], ['visor', 'helm_mask'], ['plume', 'helm_plume'], ['barbute', 'helm_plume'],
  ['helmet', 'helm_iron'], ['helm', 'helm_iron'], ['coif', 'helm_iron'], ['cap', 'helm_iron'],
];

/** 방어구 타입(base.armorType) → helm_* 파츠 */
export const HELM_TYPE_PART = {
  cloth: 'helm_hood', robe: 'helm_wizard', leather: 'helm_iron',
  mail: 'helm_iron', plate: 'helm_great', heavy: 'helm_great', bone: 'helm_mask',
};

/** 하의 베이스 id → leg_* 파츠 */
export const LEG_PART_HINTS = [
  ['greave', 'leg_plate'], ['plate', 'leg_plate'], ['heavy', 'leg_plate'],
  ['mail', 'leg_mail'], ['chain', 'leg_mail'], ['scale', 'leg_mail'],
  ['leather', 'leg_leather'], ['hide', 'leg_leather'], ['trouser', 'leg_leather'],
  ['cloth', 'leg_cloth'], ['robe', 'leg_cloth'], ['skirt', 'leg_cloth'],
];

/** 방어구 타입(base.armorType) → leg_* 파츠 */
export const LEG_TYPE_PART = {
  cloth: 'leg_cloth', robe: 'leg_cloth', leather: 'leg_leather',
  mail: 'leg_mail', plate: 'leg_plate', heavy: 'leg_plate', bone: 'leg_bare',
};

/** 방어구 베이스 id → armor_* 파츠 */
export const ARMOR_PART_HINTS = [
  ['plate', 'armor_plate'], ['heavy', 'armor_heavy'], ['brigandine', 'armor_heavy'],
  ['mail', 'armor_mail'], ['chain', 'armor_mail'], ['scale', 'armor_mail'],
  ['leather', 'armor_leather'], ['hide', 'armor_leather'], ['robe', 'armor_robe'],
  ['vestment', 'armor_robe'], ['cloth', 'armor_cloth'], ['tunic', 'armor_cloth'], ['bone', 'armor_bone'],
];

/** 방어구 타입(base.armorType) → armor_* 파츠 */
export const ARMOR_TYPE_PART = {
  cloth: 'armor_cloth', robe: 'armor_robe', leather: 'armor_leather',
  mail: 'armor_mail', plate: 'armor_plate', heavy: 'armor_heavy', bone: 'armor_bone',
};

/**
 * 양손 무기 — 들면 왼손(offhand)이 잠긴다.
 * 판정 자체는 gear.js 가 소유한다(장착 규칙과 한 곳에서 관리해야 어긋나지 않는다).
 */
function isTwoHanded(type) { return isTwoHandedType(type); }

/** 금속 색 서열 (희귀도 승급 시 "내려가지 않게" 비교용) */
const METAL_RANK = { bone: 0, dark: 0, iron: 1, bronze: 2, blood: 2, steel: 3, silver: 4, gold: 5 };
/** 희귀도 → 승급할 금속/강조색 (인덱스 5 = 신화) */
const RARITY_METAL = [null, 'bronze', 'steel', 'silver', 'gold', 'gold'];
const RARITY_ACCENT = [null, null, 'bronze', 'silver', 'gold', 'gold'];

/* ─────────────────────────── 내부 헬퍼 ─────────────────────────── */

/** id → 클래스. getClass가 실패해도 CLASSES 맵으로 한 번 더 시도 */
function klass(id) {
  if (!id) return null;
  if (typeof id === 'object') return id;
  try { const c = getClass(id); if (c) return c; } catch { /* noop */ }
  return (CLASSES && CLASSES[id]) || null;
}

/** 순환 import 중이면 state가 아직 초기화 전일 수 있다 (TDZ) — 안전하게 읽는다 */
function gs() { try { return globalState; } catch { return null; } }

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
 * 아이템 조회 함수를 만든다. 다음을 전부 받아준다:
 * Item[] / state / {items: Item[]|Map|{uid:Item}} / Map / {uid:Item} / null(=전역 state)
 * @returns {(uid:string)=>object|null}
 */
export function itemLookup(src) {
  let s = src == null ? gs() : src;
  if (!s) return () => null;
  // {items: ...} 래퍼(state 또는 state.itemsById 결과를 감싼 것)면 안쪽을 본다
  if (!Array.isArray(s) && typeof s.get !== 'function' && s.items) s = s.items;
  if (!s) return () => null;
  if (typeof s.get === 'function') return (u) => (u ? s.get(u) || null : null);
  const arr = Array.isArray(s) ? s : null;
  if (arr) {
    return (u) => {
      if (!u) return null;
      let e = indexItems(arr);
      if (!e.map.has(u)) { _itemIndex.delete(arr); e = indexItems(arr); } // 길이가 같게 교체된 경우 재색인
      return e.map.get(u) || null;
    };
  }
  return (u) => (u && typeof s === 'object' ? s[u] || null : null);
}

/** 문자열에서 힌트 테이블을 찾는다 */
function hintPart(str, table) {
  const s = String(str || '').toLowerCase();
  for (const [frag, part] of table) if (s.includes(frag)) return part;
  return null;
}

/** 더 좋은 금속만 채택 */
function upMetal(cur, want) {
  if (!want) return cur;
  return (METAL_RANK[want] ?? 0) > (METAL_RANK[cur] ?? 0) ? want : cur;
}

/* ─────────────────────────── 이름 ─────────────────────────── */

const FALLBACK_GIVEN = [
  '가레스', '로한', '에이든', '미르', '케인', '토르반', '유리아', '셀레나', '리안', '다르윈',
  '브란', '엘라', '시온', '카일', '노아', '베릴', '드미트리', '아샤', '제로드', '휘온',
  '타릭', '레미', '오딜', '파벨', '린데', '쿠엔', '발라', '모건', '아이린', '세르반',
  '유안', '키라', '테오', '하란', '메이븐', '로르카', '실비아', '군터', '엔릴', '보리스',
];
const FALLBACK_EPITHET = [
  '잿빛', '폭풍', '강철', '붉은', '고요한', '외눈', '북방', '달빛', '불꽃', '서리',
  '천둥', '방랑', '철벽', '그림자', '황금', '묵묵한', '한쪽귀', '검은', '늑대', '해묵은',
];

/** data/names.js 의 어떤 export든 활용하고, 없으면 자체 생성기로 대체 */
export function rollName(rng = defaultRng, opts = {}) {
  for (const fn of ['randomName', 'genName', 'rollName', 'mercName', 'makeName', 'pickName', 'generateName', 'nameFor']) {
    if (typeof NAMES[fn] === 'function') {
      try {
        const n = NAMES[fn](rng, opts);
        if (typeof n === 'string' && n.trim()) return n.trim();
      } catch { /* 다음 후보 */ }
    }
  }
  for (const key of ['NAMES', 'FIRST_NAMES', 'GIVEN_NAMES', 'MERC_NAMES', 'NAME_LIST']) {
    const arr = NAMES[key];
    if (Array.isArray(arr) && arr.length && typeof arr[0] === 'string') return rng.pick(arr);
  }
  const given = rng.pick(FALLBACK_GIVEN);
  return rng.chance(0.35) ? `${rng.pick(FALLBACK_EPITHET)} ${given}` : given;
}

/* ─────────────────────────── 레벨 / 경험치 ─────────────────────────── */

/* ── 경험치 곡선 (설계 B) ──────────────────────────────────────────────
 * 플레이어 피드백: "레벨업도 금방 되고, 몇 번 하다 보면 5등급 도시에서 대충 의뢰해도 다 깨진다."
 * 성장이 너무 일찍 끝나서 S 등급 뽑기 말고 할 게 없어진 상태였다.
 *
 *   예전: round(55 * lv^1.55)   →  지금: round(60 * lv^1.55)
 *
 * ※ 7차 세션(검증): 설계 B 안(60·lv^1.72 / EXP_SCALE 1.8)은 **도시 이동을 넣은** 실측
 * 성장 시뮬(earlygame.mjs ★E2)에서 목표보다 약 2배 느렸고, 특히 지수 1.72 가 후반(Lv35·55)을
 * 과도하게 늘렸다. 지수를 1.55 로 낮추고 EXP_SCALE 을 2.45 로 올려 목표 대역에 맞췄다.
 * (성장 노브는 전투 밸런스와 독립이다 — 전투는 레벨 대 레벨로 맞춰져 있어 승률이 안 변한다.)
 *
 * ── 누적 경험치 표 (Lv1 → 목표 레벨. sum of expToNext(1..lv-1)) ──
 * 다음 사람이 곡선을 조정할 때 **여기부터 보면 된다.**
 *
 * | 목표 | 차수 | 지금 누적 (60·1.55) | 예전 누적 (55·1.55) |
 * |---|---|---|---|
 * | Lv15 (2차 전직) | 2차 |      21,513 |      19,721 |
 * | Lv35 (3차 전직) | 3차 |     196,328 |     179,968 |
 * | Lv55 (4차 전직) | 4차 |     630,078 |     577,575 |
 * | **Lv80 (만렙)**  | 4차 | **1,650,192** |  (도달 불가) |
 *
 * 실측 도달 일수(earlygame.mjs ★E2, 도시 이동 포함, EXP_SCALE 2.45):
 *   Lv15 ~31일 / Lv35 ~112일 / Lv55 ~210일 / Lv80 ~333일. 전부 설계 B 목표 대역:
 *   Lv15 30~45 / Lv35 80~120 / Lv55 160~220 / Lv80 300일+.
 */
const EXP_BASE = 60;
const EXP_POW = 1.55;

/** 다음 레벨까지 필요한 경험치 (SPEC §2.4). 만렙이면 Infinity. */
export function expToNext(level) {
  const lv = clamp(Math.floor(level || 1), 1, MAX_LEVEL);
  if (lv >= MAX_LEVEL) return Infinity;
  return Math.round(EXP_BASE * Math.pow(lv, EXP_POW));
}

/**
 * Lv1 부터 `level` 까지의 누적 필요 경험치. (밸런스 도구·UI 표기용 — 위 표를 코드로 뽑을 때 쓴다)
 * @param {number} level 목표 레벨 (1 이면 0)
 */
export function expTotalTo(level) {
  const target = clamp(Math.floor(level || 1), 1, MAX_LEVEL);
  let acc = 0;
  // 반올림된 단계값을 더한다 — gainExp 가 실제로 소비하는 양과 정확히 같아야 한다.
  for (let lv = 1; lv < target; lv++) acc += expToNext(lv);
  return acc;
}

/** UI용 진행도 */
export function expProgress(merc) {
  const need = expToNext(merc?.level || 1);
  const cur = merc?.exp || 0;
  if (!isFinite(need)) return { cur: 0, need: 0, ratio: 1, max: true };
  return { cur, need, ratio: clamp(cur / need, 0, 1), max: false };
}

/**
 * 경험치 획득. 레벨업 처리까지 한다.
 * @returns {{levels:number, promoteReady:boolean, gained:number, level:number}}
 */
export function gainExp(merc, amount) {
  const gained = Math.max(0, Math.round(amount || 0));
  if (!merc || !gained) return { levels: 0, promoteReady: canPromote(merc), gained: 0, level: merc?.level || 1 };
  merc.exp = (merc.exp || 0) + gained;
  let levels = 0;
  while (merc.level < MAX_LEVEL) {
    const need = expToNext(merc.level);
    if (merc.exp < need) break;
    merc.exp -= need;
    merc.level += 1;
    levels += 1;
  }
  if (merc.level >= MAX_LEVEL) { merc.level = MAX_LEVEL; merc.exp = 0; }
  if (levels) merc.upkeep = upkeepOf(merc);
  return { levels, promoteReady: canPromote(merc), gained, level: merc.level };
}

/* ─────────────────────────── 생성 ─────────────────────────── */

/**
 * 용병 하나를 만든다 (SPEC §3.7).
 * @param {{classId:string, grade?:string, level?:number, rng?:object, name?:string, day?:number}} opt
 */
export function createMerc({ classId, grade, level = 1, rng = defaultRng, name, day = 1 } = {}) {
  const c = klass(classId) || klass(Object.keys(CLASSES || {})[0]);
  const cid = c ? c.id : classId;
  const g = GRADE_MULT[grade] ? grade : gradeRoll(1, rng);
  const lv = clamp(Math.round(level || 1), 1, MAX_LEVEL);

  const merc = {
    uid: uid('mc'),
    name: name || rollName(rng, { classId: cid, grade: g }),
    grade: g,
    classId: cid,
    level: lv,
    exp: 0,
    hp: 1,
    status: 'ready',
    woundUntil: 0,
    // 10슬롯 (설계 A). 슬롯 목록은 gear.js(=data/items.js) 가 소유한다.
    equipment: normalizeEquipment(null),
    squadId: null,
    slotIndex: -1,
    upkeep: 0,
    hiredDay: day,
    kills: 0,
    battles: 0,
    // 외형 개성 (같은 클래스라도 다르게 보이도록). mercRecipe가 적용한다.
    look: rollLook(rng),
  };
  merc.upkeep = upkeepOf(merc);
  merc.hp = mercStats(merc, null).hp;
  return merc;
}

/** 개인 외형 편차 */
export function rollLook(rng = defaultRng) {
  return {
    skin: rng.pick(['pale', 'pale', 'tan', 'tan', 'dark']),
    hair: rng.pick(['black', 'brown', 'brown', 'blond', 'white', 'red']),
    hairPart: rng.pick(['hair_short', 'hair_short', 'hair_long', 'hair_pony', 'hair_mohawk', 'hair_beard']),
  };
}

/* ─────────────────────────── 스탯 ─────────────────────────── */

function roundStats(s) {
  return {
    hp: Math.max(1, Math.round(s.hp)),
    atk: Math.max(1, Math.round(s.atk)),
    def: Math.max(0, Math.round(s.def)),
    res: Math.max(0, Math.round(s.res)),
    spd: Math.max(1, Math.round(s.spd)),
    crit: Math.round(clamp(s.crit, 0, 100) * 10) / 10,
    critDmg: Math.round(clamp(s.critDmg, 0, 400) * 10) / 10,
    eva: Math.round(clamp(s.eva, 0, 60) * 10) / 10,
  };
}

/**
 * 용병이 지금 착용 중인 아이템 배열. 10슬롯을 훑고, 옛 세이브에 남아 있는
 * `armor`/`accessory` 키도 함께 본다 (정규화 전에 스탯을 물어봐도 결과가 같아야 한다).
 */
function wornOf(merc, find) {
  const eq = merc && merc.equipment;
  if (!eq) return [];
  const keys = SLOTS.slice();
  for (const k of Object.keys(eq)) if (!keys.includes(k)) keys.push(k);
  const out = [];
  const seen = new Set();
  for (const k of keys) {
    const u = eq[k];
    if (!u || typeof u !== 'string' || seen.has(u)) continue;
    const it = find(u);
    if (it) { seen.add(u); out.push(it); }
  }
  return out;
}

/**
 * 최종 스탯 (SPEC §2.1).
 *
 * 계산 순서 (설계 A/B — 이 순서를 바꾸면 세트 % 가 장비를 못 먹어 밸런스가 통째로 달라진다):
 *   아키타입 × 클래스보정 × 성장 × 차수 × 등급
 *     → **10슬롯 장비 절대값 가산**
 *     → **세트 stats 절대값 가산**
 *     → **세트 mods 비율 곱연산**
 *
 * @param {object} merc
 * @param {Array|object|Map|null} itemsById  Item[] / state / Map / {uid:Item} / null(전역 state)
 */
export function mercStats(merc, itemsById) {
  if (!merc) return roundStats({ ...FALLBACK_ARCH });
  const c = klass(merc.classId);
  const arch = (c && ARCHETYPES && ARCHETYPES[c.arch]) || FALLBACK_ARCH;
  const mods = (c && c.mods) || {};
  const lv = clamp(merc.level || 1, 1, MAX_LEVEL);
  const gi = GRADE_IDX[merc.grade] ?? 0;

  const lvMul = 1 + GROWTH_RATE * (lv - 1);
  const tierMul = TIER_MULT[clamp(((c && c.tier) || 1) - 1, 0, TIER_MULT.length - 1)];
  const gMul = GRADE_MULT[merc.grade] ?? 1;

  const out = {};
  for (const k of SCALING_KEYS) out[k] = (arch[k] || 0) * (mods[k] ?? 1) * lvMul * tierMul * gMul;
  for (const k of FLAT_KEYS) out[k] = (arch[k] || 0) * (mods[k] ?? 1);
  out.crit += gi * 0.8;
  out.eva += gi * 0.5;

  // 1) 장비 절대값 가산 (10슬롯)
  const find = itemLookup(itemsById);
  const worn = wornOf(merc, find);
  for (const it of worn) {
    if (!it.stats) continue;
    for (const k of STAT_KEYS) if (it.stats[k]) out[k] = (out[k] || 0) + it.stats[k];
  }

  // 2) 세트 효과. 풀세트 기준은 고정 10이 아니라 **그 용병이 낄 수 있는 칸 수**다
  //    (양손 무기를 들면 왼손이 잠겨 9칸이 풀세트).
  if (worn.length) {
    const maxSlots = SLOTS.length - (isTwoHandedItem(find(merc.equipment && merc.equipment.weapon)) ? 1 : 0);
    const setb = setBonusFrom(worn, maxSlots);
    for (const k of STAT_KEYS) if (setb.stats[k]) out[k] = (out[k] || 0) + setb.stats[k];
    for (const k of STAT_KEYS) if (setb.mods[k]) out[k] = (out[k] || 0) * (1 + setb.mods[k]);
  }

  return roundStats(out);
}

/** 세트 효과 계산 (실패해도 스탯 계산이 멈추지 않게 감싼다) */
function setBonusFrom(worn, maxSlots) {
  try {
    const b = setBonusFromWorn(worn || [], maxSlots) || {};
    return { stats: b.stats || {}, mods: b.mods || {}, specials: b.specials || [], sets: b.sets || [] };
  } catch { return { stats: {}, mods: {}, specials: [], sets: [] }; }
}

/**
 * 착용 중인 아이템 배열로 세트 보너스의 **절대값 스탯**만 구한다 (옛 시그니처 유지).
 * 비율(mods)·고유 효과(specials)까지 필요하면 `mercSetBonus` 를 써라.
 */
export function setBonusOf(items) {
  return setBonusFrom(items || [], SLOTS.length).stats;
}

/**
 * 이 용병에게 지금 걸린 세트 효과 전체.
 * @returns {{stats:object, mods:object, specials:Array, sets:Array}}
 */
export function mercSetBonus(merc, itemsById) {
  if (!merc) return { stats: {}, mods: {}, specials: [], sets: [] };
  try {
    const b = setBonusStats(merc, itemsById) || {};
    return { stats: b.stats || {}, mods: b.mods || {}, specials: b.specials || [], sets: b.sets || [] };
  } catch { return { stats: {}, mods: {}, specials: [], sets: [] }; }
}

/** 이 용병의 세트 수집 진행도 (UI 표기용 — gear.setProgress 를 그대로 넘긴다) */
export function mercSetProgress(merc, itemsById) {
  try { return setProgress(merc, itemsById) || []; } catch { return []; }
}

/** 그 용병이 낄 수 있는 칸 수 (양손 무기면 9) */
export function mercSlotCount(merc, itemsById) {
  try { return equippableSlotCount(merc, itemsById); } catch { return SLOTS.length; }
}

/** 장비 없이(소재만) 본 스탯 — 비교 UI용 */
export function baseStatsOf(merc) {
  return mercStats({ ...merc, equipment: {} }, null);
}

/** 전력 수치 (부대 정렬/난이도 표시용) */
export function mercPower(merc, itemsById) {
  const s = mercStats(merc, itemsById);
  const v = s.hp * 0.14 + s.atk * 2.6 + s.def * 1.5 + s.res * 1.3 + s.spd * 1.6
    + s.crit * 2.2 + s.critDmg * 0.5 + s.eva * 1.8;
  return Math.round(v);
}

/* ─────────────────────────── 전직 ─────────────────────────── */

/** 용병의 현재 전직 차수 (클래스 데이터가 깨졌으면 1) */
export function mercTier(merc) {
  const c = klass(merc?.classId);
  return clamp(Math.round((c && c.tier) || 1), 1, MAX_TIER);
}

/**
 * 다음 차수 전직에 필요한 레벨 (더 전직할 게 없으면 null).
 * 조건은 "목표 차수의 레벨 도달 + 현재 차수가 목표보다 낮음" 이다. 4차(Lv55)까지 동작한다.
 */
export function nextPromoteLevel(merc) {
  const c = klass(merc?.classId);
  if (!c) return null;
  const t = clamp(Math.round(c.tier || 1), 1, MAX_TIER);
  if (t >= MAX_TIER) return null;
  return PROMOTE_LEVEL[t + 1] ?? null;
}

/** 지금 전직 가능한가 */
export function canPromote(merc) {
  const need = nextPromoteLevel(merc);
  if (need == null) return false;
  if ((merc.level || 1) < need) return false;
  return promoteOptionsFor(merc).length > 0;
}

/** 전직 후보 클래스 객체 배열 */
export function promoteOptionsFor(merc) {
  const c = klass(merc?.classId);
  if (!c) return [];
  let list = [];
  try { list = promoteOptions(c.id) || []; } catch { list = []; }
  if (!list.length) list = c.next || [];
  return list.map((x) => (typeof x === 'string' ? klass(x) : x)).filter(Boolean);
}

/**
 * 전직 실행.
 * @returns {{ok:boolean, reason:string, from:string, to:string}}
 */
export function promote(merc, toClassId) {
  const target = typeof toClassId === 'object' ? toClassId?.id : toClassId;
  const from = merc?.classId;
  if (!merc) return { ok: false, reason: '용병이 없습니다.', from, to: target };
  const need = nextPromoteLevel(merc);
  if (need == null) return { ok: false, reason: '더 이상 전직할 수 없습니다.', from, to: target };
  if ((merc.level || 1) < need) return { ok: false, reason: `레벨 ${need} 이상이어야 전직할 수 있습니다.`, from, to: target };
  const opts = promoteOptionsFor(merc);
  const pick = opts.find((o) => o.id === target);
  if (!pick) return { ok: false, reason: '전직할 수 없는 클래스입니다.', from, to: target };
  // 현재 차수보다 높은 차수로만 간다 (클래스 데이터가 옆이나 아래를 가리켜도 막는다)
  const curTier = mercTier(merc);
  if (clamp(Math.round(pick.tier || 1), 1, MAX_TIER) <= curTier) {
    return { ok: false, reason: '이미 그 차수 이상입니다.', from, to: target };
  }

  const prevFull = mercStats(merc, null).hp;
  merc.classId = pick.id;
  merc.upkeep = upkeepOf(merc);
  // 차수가 오르면 최대 체력이 크게 뛴다. 현재 체력도 **실제 차수 배율 비율만큼** 올려준다.
  // (예전에는 1.3 고정이었다. 4차는 3차 대비 1.265배라 고정값이 더는 맞지 않는다.)
  const full = mercStats(merc, null).hp;
  const ratio = prevFull > 0 ? clamp(full / prevFull, 1, 4) : 1;
  merc.hp = Math.max(1, Math.min(full, Math.round(merc.hp > 0 ? merc.hp * ratio : full)));
  return { ok: true, reason: `${pick.name}${josa(pick.name, '으로/로')} 전직했습니다.`, from, to: pick.id };
}

/* ─────────────────────────── 고용 / 유지비 ─────────────────────────── */

/** 도시 tier 기준 등급 가중치 (정수 티어 표를 그대로 본다) */
export function gradeWeights(cityTier = 1) {
  return GRADE_WEIGHTS[clamp(Math.round(cityTier || 1), 1, MAX_CITY_TIER)];
}

/**
 * 도시 tier + 평판 + 특화를 하나의 실효 티어(1~6)로 합친다.
 *
 *   effTier = clamp(cityTier + (rep - 10)/60 + (특화 ? 1.0 : 0), 1, 6)
 *
 * `opts` 를 생략하면 rep = 기준선(10) · 특화 없음이므로 **결과는 cityTier 그대로**다.
 * @param {number} cityTier
 * @param {{rep?:number, specialty?:boolean}} [opts]
 */
export function effectiveTier(cityTier = 1, opts = {}) {
  const t = Number(cityTier) || 1;
  const raw = Number(opts && opts.rep);
  const rep = Number.isFinite(raw) ? raw : REP_BASELINE;
  const spec = !!(opts && opts.specialty);
  return clamp(t + (rep - REP_BASELINE) / REP_PER_TIER + (spec ? SPECIALTY_TIER_BONUS : 0), 1, MAX_CITY_TIER);
}

/** 실효 티어의 가중치 표. 정수 티어 사이는 선형 보간한다. */
export function gradeWeightsAt(effTier = 1) {
  const t = clamp(Number(effTier) || 1, 1, MAX_CITY_TIER);
  const lo = Math.floor(t);
  const hi = Math.min(MAX_CITY_TIER, lo + 1);
  const f = t - lo;
  const a = GRADE_WEIGHTS[lo] || GRADE_WEIGHTS[1];
  const b = GRADE_WEIGHTS[hi] || a;
  const out = {};
  for (const g of GRADES) out[g] = lerp(a[g] || 0, b[g] || 0, f);
  return out;
}

/**
 * 특화 도시 S 확률 (합계 대비 비율). 실효 티어에 비례하고 `SPEC_S_MAX` 가 상한이다.
 * 실효 티어에 비례한다. 상한이 8 로 올라가면서 «최대치» 는 그만큼 멀어졌다 —
 * S 는 초반엔 더 어렵고, 평판을 오래 쌓은 뒤라야 예전 수준에 닿는다 (제작자 의도).
 */
export function specialtySChance(effTier = 1) {
  const f = clamp((clamp(Number(effTier) || 1, 1, MAX_CITY_TIER) - 1) / (MAX_CITY_TIER - 1), SPEC_S_MIN_FRAC, 1);
  return SPEC_S_MAX * f;
}

/**
 * 특화 보정. 두 단계다.
 *   1) B·A 가중치에 `SPECIALTY_TOP_MULT`(1.5배)를 곱하고 나머지를 비례 축소해 합계를 유지한다.
 *   2) S 를 실효 티어에 비례한 비율(최대 5%)로 **직접 배정**한다.
 *      기본 표의 S 는 전부 0이므로, S 는 오직 여기를 통해서만 생긴다.
 */
function applySpecialty(w, effTier = 1) {
  const total = GRADES.reduce((a, g) => a + (w[g] || 0), 0);
  if (!(total > 0)) return { ...w };
  const isTop = (g) => SPECIALTY_TOP_GRADES.includes(g);
  const top = GRADES.reduce((a, g) => a + (isTop(g) ? (w[g] || 0) : 0), 0);
  const rest = total - top;
  const boosted = top * SPECIALTY_TOP_MULT;
  const k = rest > 0 ? Math.max(0, (total - boosted) / rest) : 0;
  const out = {};
  for (const g of GRADES) out[g] = isTop(g) ? (w[g] || 0) * SPECIALTY_TOP_MULT : (w[g] || 0) * k;

  // S 배정: 나머지를 (1 - s) 로 눌러 자리를 만들고 그 자리에 S 를 넣는다. 합계는 유지된다.
  const s = specialtySChance(effTier);
  const sum = GRADES.reduce((a, g) => a + out[g], 0);
  if (sum > 0 && s > 0) {
    for (const g of GRADES) out[g] *= (1 - s);
    out.S = sum * s;
  }
  return out;
}

/**
 * 평판·특화까지 반영한 실효 가중치 표.
 * @param {number} cityTier
 * @param {{rep?:number, specialty?:boolean}} [opts]
 */
export function gradeWeightsFor(cityTier = 1, opts = {}) {
  const eff = effectiveTier(cityTier, opts);
  const w = gradeWeightsAt(eff);
  return (opts && opts.specialty) ? applySpecialty(w, eff) : w;
}

/**
 * 등급 확률 표 — 합이 **1** 이 되는 비율로 돌려준다. UI 확률표가 이걸 그대로 그린다.
 * @param {number} cityTier
 * @param {{rep?:number, specialty?:boolean}} [opts]
 * @returns {{F:number,E:number,D:number,C:number,B:number,A:number,S:number}}
 */
export function gradeOdds(cityTier = 1, opts = {}) {
  const w = gradeWeightsFor(cityTier, opts);
  const total = GRADES.reduce((a, g) => a + Math.max(0, w[g] || 0), 0);
  const out = {};
  if (!(total > 0)) {
    for (const g of GRADES) out[g] = 0;
    out.F = 1;
    return out;
  }
  let sum = 0, top = GRADES[0];
  for (const g of GRADES) {
    out[g] = Math.round((Math.max(0, w[g] || 0) / total) * 1e6) / 1e6;
    sum += out[g];
    if (out[g] > out[top]) top = g;
  }
  // 반올림 잔차는 가장 큰 항목이 흡수한다 (합 === 1 보장)
  out[top] = Math.round((out[top] + (1 - sum)) * 1e6) / 1e6;
  return out;
}

/** 등급 확률(%) 표 — 주점 화면에서 그대로 보여준다 */
export function gradeChances(cityTier = 1, opts = {}) {
  const odds = gradeOdds(cityTier, opts);
  const out = {};
  for (const g of GRADES) out[g] = Math.round(odds[g] * 1000) / 10;
  return out;
}

/**
 * 등급 추첨.
 * @param {number} cityTier 도시 tier (1~5)
 * @param {object} [rng] RNG
 * @param {{rep?:number, specialty?:boolean}} [opts]
 *   `rep` 그 도시의 평판(0~100, 기본 10=기준선), `specialty` 그 도시의 특화 클래스인가.
 *   **생략하면 기존 2인자 호출과 결과가 완전히 같다** (실효 티어 = cityTier).
 */
export function gradeRoll(cityTier = 1, rng = defaultRng, opts = {}) {
  const r = rng || defaultRng;
  const w = gradeWeightsFor(cityTier, opts);
  const entries = GRADES.map((g) => ({ g, w: w[g] || 0 })).filter((e) => e.w > 0);
  if (!entries.length) return GRADES[0];
  return (r.weighted(entries) || entries[0]).g;
}

/** 고용 비용 (골드) */
export function hireCost(classId, grade, level = 1) {
  const c = klass(classId);
  const tier = clamp(((c && c.tier) || 1) - 1, 0, TIER_COST.length - 1);
  const base = GRADE_HIRE_COST[grade] ?? GRADE_HIRE_COST.F;
  const lv = clamp(Math.round(level || 1), 1, MAX_LEVEL);
  const cost = base * TIER_COST[tier] * (1 + 0.075 * (lv - 1));
  return Math.max(10, Math.round(cost / 10) * 10);
}

/**
 * 하루 임금 = 등급기준값 × 차수보정 × 레벨항(1차+2차).
 *
 * 실측 참고값. 수입 기준은 quest.js 의 `(60 + level*13) * RANK_MULT` 를 랭크 소요일수로
 * 나눈 하루 환산치다 (D 358G/일 · B 928G/일 · S 2,578G/일).
 *
 *   | 용병 | 1인 일당 | 7인 부대 | 대응 랭크 수입 대비 |
 *   |---|---|---|---|
 *   | Lv1  1차 F |    2G |    14G | — |
 *   | Lv15 2차 D |    9G |    63G | D 18% |
 *   | Lv35 3차 C |   33G |   231G | B 25% |
 *   | Lv55 4차 B |  102G |   714G | S 28% |
 *   | Lv80 4차 A |  249G | 1,743G | S 일반 **68%** / 정예 31% |  ← 만렙 압박 지점
 *   | Lv80 4차 S |  391G | 2,737G | S 일반 **106%**(적자) / 정예 48% |
 *
 * 만렙 전원 S 부대는 일반 의뢰만으로는 임금을 못 낸다 — 의도한 것이다. 여기에 정원 40 중
 * 출전 못 하는 예비 인원의 일당까지 순손실로 얹힌다. 이 압박이 과하다고 판단되면
 * `UPKEEP_LV2` 를 내려라 (0 으로 두면 예전 선형 항과 같아진다).
 */
export function upkeepOf(merc) {
  if (!merc) return 1;
  const c = klass(merc.classId);
  const tier = clamp(((c && c.tier) || 1) - 1, 0, TIER_UPKEEP.length - 1);
  const base = GRADE_UPKEEP[merc.grade] ?? GRADE_UPKEEP.F;
  return Math.max(1, Math.round(base * TIER_UPKEEP[tier] * upkeepLevelTerm(merc.level || 1)));
}

/**
 * 용병의 `upkeep` 캐시를 지금 공식으로 다시 계산해 넣는다.
 *
 * `upkeep` 은 세이브에 값으로 박혀 있고 레벨업·전직 때만 갱신된다. 임금 공식이 바뀐 뒤
 * 로드된 옛 세이브는 값이 낡은 상태로 남으므로, 세이브 정규화 경로에서 단원마다 한 번
 * 불러 주면 된다 (state.js 담당용 훅).
 * @returns {number} 새 일당
 */
export function refreshUpkeep(merc) {
  if (!merc) return 1;
  merc.upkeep = upkeepOf(merc);
  return merc.upkeep;
}

/* ─────────────────────────── 외형 레시피 ─────────────────────────── */

/** 무기 아이템 → wpn_* 파츠 */
export function weaponPartOf(item) {
  if (!item) return null;
  if (item.weaponType === 'shield') return null;
  const hint = hintPart(item.baseId, WEAPON_PART_HINTS);
  if (hint) return hint;
  return WEAPON_PART[item.weaponType] || null;
}

/** 방패 아이템 → shd_* 파츠 */
export function shieldPartOf(item) {
  if (!item || item.weaponType !== 'shield') return null;
  return hintPart(item.baseId, SHIELD_PART_HINTS) || 'shd_round';
}

/** 왼손 아이템 → shd_* 파츠 (방패 + 보조무기. 판별 불가면 null) */
export function offhandPartOf(item) {
  if (!item) return null;
  const hint = hintPart(item.baseId, OFFHAND_PART_HINTS);
  if (hint) return hint;
  if (item.weaponType) return OFFHAND_TYPE_PART[item.weaponType] || 'shd_buckler';
  return 'shd_buckler';
}

/** 머리 아이템 → helm_* 파츠 (판별 불가면 null = 클래스 기본 유지) */
export function helmPartOf(item) {
  if (!item) return null;
  const hint = hintPart(item.baseId, HELM_PART_HINTS);
  if (hint) return hint;
  const t = item.armorType || null;
  if (t && HELM_TYPE_PART[t]) return HELM_TYPE_PART[t];
  return 'helm_iron';
}

/** 하의 아이템 → leg_* 파츠 (판별 불가면 null = 갑옷에서 자동 결정) */
export function legPartOf(item) {
  if (!item) return null;
  const hint = hintPart(item.baseId, LEG_PART_HINTS);
  if (hint) return hint;
  const t = item.armorType || null;
  if (t && LEG_TYPE_PART[t]) return LEG_TYPE_PART[t];
  return null;
}

/** 방어구(상의) 아이템 → armor_* 파츠 (판별 불가면 null = 클래스 기본 유지) */
export function armorPartOf(item) {
  if (!item) return null;
  // 새 슬롯은 'body', 옛 세이브는 'armor' 다
  if (item.slot && item.slot !== 'body' && item.slot !== 'armor') return null;
  const t = item.armorType || null;
  if (t && ARMOR_TYPE_PART[t]) return ARMOR_TYPE_PART[t];
  return hintPart(item.baseId, ARMOR_PART_HINTS);
}

/**
 * 용병의 스프라이트 레시피 (SPEC §3.2 sprite 형태).
 * 클래스 레시피를 바탕으로 개인 외형 + 장비를 반영한다. 클래스 데이터는 건드리지 않는다.
 * @param {object} merc
 * @param {Array|object|Map|null} itemsById
 */
export function mercRecipe(merc, itemsById) {
  const c = klass(merc?.classId);
  const rec = clone((c && c.sprite) || DEFAULT_SPRITE);
  rec.palette = { ...(DEFAULT_SPRITE.palette), ...((c && c.sprite && c.sprite.palette) || {}) };

  // 1) 개인 외형 편차 — 머리 파츠가 '평범한 머리'일 때만 바꾼다 (후드/대머리 컨셉 보존)
  const look = merc?.look;
  if (look) {
    if (look.skin) rec.palette.skin = look.skin;
    if (look.hair) rec.palette.hair = look.hair;
    const swappable = ['hair_short', 'hair_long', 'hair_pony', 'hair_mohawk'];
    if (look.hairPart && swappable.includes(rec.hair)) rec.hair = look.hairPart;
  }

  // 2) 장비 반영 (10슬롯). 옛 세이브의 armor/accessory 키도 그대로 읽는다.
  const find = itemLookup(itemsById);
  const eq = merc?.equipment || {};
  const weapon = find(eq.weapon);
  const offhand = find(eq.offhand);
  const head = find(eq.head);
  const body = find(eq.body) || find(eq.armor);
  const legs = find(eq.legs);

  if (weapon) {
    if (weapon.weaponType === 'shield') {
      // 옛 세이브: 방패가 무기 슬롯에 들어 있다
      rec.offhand = shieldPartOf(weapon) || rec.offhand;
    } else {
      const wp = weaponPartOf(weapon);
      if (wp) rec.weapon = wp;
      if (isTwoHanded(weapon.weaponType)) rec.offhand = 'shd_none';
    }
  }
  // 왼손: 양손 무기를 들고 있으면 아무것도 걸리지 않는다
  if (offhand && !(weapon && weapon.weaponType !== 'shield' && isTwoHanded(weapon.weaponType))) {
    const op = offhandPartOf(offhand);
    if (op) rec.offhand = op;
  }
  if (head) {
    const hp = helmPartOf(head);
    if (hp) rec.helm = hp;
  }
  if (body) {
    const ap = armorPartOf(body);
    if (ap) rec.armor = ap;
  }
  if (legs) {
    const lp = legPartOf(legs);
    if (lp) rec.leg = lp; // spritegen 은 recipe.leg 를 쓰고, 없으면 armor 로 자동 결정한다
  }

  // 3) 희귀도 → 팔레트 승급 (착용 중인 10칸 전부를 본다)
  let maxR = -1;
  for (const slot of SLOTS) {
    const it = find(eq[slot]);
    if (it && typeof it.rarity === 'number') maxR = Math.max(maxR, it.rarity);
  }
  for (const legacy of ['armor', 'accessory']) {
    const it = find(eq[legacy]);
    if (it && typeof it.rarity === 'number') maxR = Math.max(maxR, it.rarity);
  }
  if (maxR >= 1) {
    rec.palette.metal = upMetal(rec.palette.metal, RARITY_METAL[Math.min(maxR, RARITY_METAL.length - 1)]);
    const acc = RARITY_ACCENT[Math.min(maxR, RARITY_ACCENT.length - 1)];
    if (acc) rec.palette.accent = upMetal(rec.palette.accent, acc);
  }
  // 전설은 성스러운 광채, 신화(세트)는 붉은 금빛으로 구분한다
  if (maxR >= 5) rec.palette.glow = 'blood';
  else if (maxR >= 4 && (!rec.palette.glow || rec.palette.glow === 'none')) rec.palette.glow = 'holy';

  return rec;
}

/** SPEC §3.7 표기 호환 별칭 */
export const mercSprite = mercRecipe;

/* ─────────────────────────── 잡다한 조회 ─────────────────────────── */

/** 부상 중인가 (day 기준) */
export function isWounded(merc, day = 0) {
  if (!merc) return false;
  return merc.status === 'wounded' && (merc.woundUntil || 0) > day;
}

/** UI 한 줄 요약: "검사 Lv12 · B등급" */
export function mercLabel(merc) {
  const c = klass(merc?.classId);
  return `${c ? c.name : merc?.classId || '?'} Lv${merc?.level || 1} · ${merc?.grade || 'F'}등급`;
}
