// 장비 데이터 — 슬롯 정의 / 베이스 / 접두사 / 접미사 / 고유·세트 아이템.
// 순수 JS. DOM 참조 금지 (node에서 import 가능해야 한다).
//
// [계약 요약 — game/gear.js 가 지켜야 할 것]
//  - 장비 슬롯은 **10칸**이다 (SLOTS). 양손무기를 들면 offhand 가 잠겨 실질 9칸이 된다.
//    옛 3슬롯(weapon/armor/accessory) 은 LEGACY_SLOT_MAP 으로 옮긴다.
//  - ITEM_BASES 는 "배열"이다. 단건 조회는 baseById(id).
//  - 베이스/접사의 stats 는 모두 **절대값**이며 "무기(계수 1.0) 기준 ilvl 1" 의 원본 수치다.
//    실제 수치는 gear.js 가 SPEC §3.3 공식 + ★슬롯 계수로 스케일한다:
//      baseStat = base.stats[k] * SLOT_POWER[slot] * (1 + 0.13*(ilvl-1)) * RARITY_MULT[rarity]
//    ★ SLOT_POWER 하나만 만지면 장비 총량이 조절된다 (검증 담당 전용 노브).
//  - 단, crit/critDmg/eva 는 SPEC §2.1 의 FLAT_KEYS 다. 위 공식을 그대로 먹이면
//    ilvl 50 에서 crit 이 수십 %가 되어 망가진다. FLAT_STAT_KEYS 를 import 해서
//    별도 처리하거나, 여기서 제공하는 scaleBaseStats()/scaleAffixStats() 를 쓸 것.
//  - 최종 이름 = 접두사 + ' ' + 베이스명 + 접미사.
//    접미사 name 은 '의 맹수' 처럼 이미 '의' 를 포함하므로 **공백 없이** 붙인다.
//      예) '날카로운' + ' ' + '롱소드' + '의 맹수' -> '날카로운 롱소드의 맹수'
//  - unique:true 베이스는 접사를 굴리지 않는다. base.fixedAffixes 를 그대로 복사하고
//    이름은 베이스명을 그대로 쓴다. basesFor() 는 기본적으로 고유를 제외하므로
//    고유 드랍은 uniquesFor(ilvl) 에서 낮은 확률로 따로 뽑는다.
//  - tierMin / minLv 는 ILVL_TIERS = [1, 8, 16, 26, 38, 50] 의 인덱스(0~5)와 대응한다.
//  - 희귀도 5 = 신화(Mythic). **세트 아이템 전용**이며 일반 드랍 테이블에 넣지 마라
//    (gear.js RARITY_WEIGHTS 는 0~4 만 굴린다).

import { clamp } from '../core/util.js';

/** 아이템 레벨 구간 경계. tierOf() 가 이 배열의 인덱스를 돌려준다. */
export const ILVL_TIERS = [1, 8, 16, 26, 38, 50];

/** 희귀도 배율 (일반/고급/희귀/영웅/전설/신화) — 신화는 전설의 1.35배 */
export const RARITY_MULT = [1, 1.15, 1.35, 1.62, 2.0, 2.7];
/** 희귀도별 접사 개수 (신화는 세트 고정효과를 쓰므로 전설과 같다) */
export const RARITY_AFFIX_COUNT = [0, 1, 2, 3, 4, 4];
/** 희귀도 이름 (0~5) */
export const RARITY_NAME = ['일반', '고급', '희귀', '영웅', '전설', '신화'];
/** 희귀도 색 (0~5). 신화는 전설(주황)과 구분되는 붉은 금빛 */
export const RARITY_COLOR = ['#9a9aa6', '#6fae7a', '#5b95d6', '#a86fd6', '#e8a13a', '#f4503c'];
/** 신화 등급 인덱스 (세트 아이템 전용) */
export const MYTHIC_RARITY = 5;
/** 레벨 스케일을 곱하면 안 되는 평탄 스탯 (SPEC §2.1 FLAT_KEYS) */
export const FLAT_STAT_KEYS = ['crit', 'critDmg', 'eva'];

/** ilvl -> 티어 인덱스(0~5) */
export function tierOf(ilvl) {
  let t = 0;
  for (let i = 0; i < ILVL_TIERS.length; i++) if (ilvl >= ILVL_TIERS[i]) t = i;
  return t;
}

// ─────────────────────────────────────────────────────────────
// 슬롯 (설계 A)
// ─────────────────────────────────────────────────────────────

/** 장비 슬롯 10칸. 표시 순서도 이 순서를 따른다. */
export const SLOTS = ['weapon', 'offhand', 'head', 'body', 'legs', 'hands', 'feet', 'neck', 'ring1', 'ring2'];

/** 슬롯 한국어 표기. 옛 슬롯 이름도 함께 담아 둔다(정규화 전 세이브 표시용). */
export const SLOT_NAME = {
  weapon: '오른손', offhand: '왼손',
  head: '머리', body: '상의', legs: '하의', hands: '장갑', feet: '신발',
  neck: '목걸이', ring1: '반지 1', ring2: '반지 2',
  // 베이스 풀 이름 / 옛 슬롯 (SLOTS 에는 없다)
  ring: '반지', armor: '방어구', accessory: '장신구',
};

/** 옛 세이브의 3슬롯 -> 새 슬롯 */
export const LEGACY_SLOT_MAP = { weapon: 'weapon', armor: 'body', accessory: 'neck' };

/** 무기/왼손 (던전 9~10웨이브 드랍) */
export const WEAPON_SLOTS = ['weapon', 'offhand'];
/** 방어구 5칸 (던전 1~5웨이브 드랍) */
export const ARMOR_SLOTS = ['head', 'body', 'legs', 'hands', 'feet'];
/** 장신구 3칸 (던전 6~8웨이브 드랍) */
export const ACC_SLOTS = ['neck', 'ring1', 'ring2'];
/** 같은 베이스 풀을 공유하는 반지 슬롯 */
export const RING_SLOTS = ['ring1', 'ring2'];

/**
 * ★ 슬롯별 스탯 계수 (설계 A). 무기를 1.00 으로 본 상대 가치.
 * 합계 ≈ 4.7 (옛 3슬롯 합계 ≈ 2.4 대비 약 2배 — 10칸을 다 채우는 건 후반이므로 성장 여지).
 *
 * ★★ 밸런스 담당은 **이 표 하나만** 만져 장비 총량을 조절한다.
 *     베이스의 stats 는 전부 "계수 1.0 기준"으로 적혀 있고 scaleBaseStats() 가 여기를 곱한다.
 */
export const SLOT_POWER = {
  weapon: 1.00,
  offhand: 0.50,
  head: 0.45,
  body: 0.60,
  legs: 0.45,
  hands: 0.35,
  feet: 0.35,
  neck: 0.40,
  ring1: 0.30,
  ring2: 0.30,
  // 베이스 풀 이름(반지 공용) / 옛 슬롯 별칭
  ring: 0.30,
  armor: 0.60,
  accessory: 0.40,
};

/** 슬롯 계수 조회 (모르는 슬롯은 1.0) */
export function slotPowerOf(slot) {
  const v = SLOT_POWER[slot];
  return typeof v === 'number' && v > 0 ? v : 1;
}

/** 전리품 슬롯 추첨 가중치 (10칸 균형용). gear.js 가 참고한다. */
export const SLOT_DROP_WEIGHT = {
  weapon: 16, offhand: 10, head: 10, body: 12, legs: 10,
  hands: 9, feet: 9, neck: 8, ring1: 8, ring2: 8,
};

/** 빈 10슬롯 장비 객체 */
export function emptyEquipment() {
  const out = {};
  for (const s of SLOTS) out[s] = null;
  return out;
}

/**
 * 어떤 형태의 equipment 든 10슬롯으로 정규화한다.
 * 옛 세이브(weapon/armor/accessory) 는 LEGACY_SLOT_MAP 으로 옮기고 나머지는 빈 칸으로 둔다.
 * 필드가 아예 없어도 안전하다.
 */
export function normalizeEquipment(eq) {
  const out = emptyEquipment();
  if (!eq || typeof eq !== 'object') return out;
  for (const s of SLOTS) if (eq[s]) out[s] = eq[s];
  for (const k of Object.keys(LEGACY_SLOT_MAP)) {
    const to = LEGACY_SLOT_MAP[k];
    if (eq[k] && !out[to] && eq[k] !== out.weapon) out[to] = eq[k];
  }
  if (eq.ring && !out.ring1) out.ring1 = eq.ring;
  return out;
}

/**
 * 슬롯 이름 -> 베이스 풀 이름 배열.
 * ring1/ring2 는 같은 'ring' 풀을 쓴다.
 *
 * 옛 슬롯 이름은 **LEGACY_SLOT_MAP 그대로** 좁게 번역한다 (armor→body, accessory→neck).
 * accessory 를 neck+ring 으로 넓히면 'neck' 을 요청한 호출이 별칭('accessory')을 거쳐
 * 반지를 되받는 누수가 생긴다 (gear.js baseSlotAliases 가 neck→accessory 를 함께 조회한다).
 * 반지는 'ring' / 'ring1' / 'ring2' 로만 닿는다.
 */
export function basePoolsFor(slot) {
  if (!slot) return [];
  if (slot === 'ring' || slot === 'ring1' || slot === 'ring2') return ['ring'];
  const legacy = LEGACY_SLOT_MAP[slot];
  if (legacy && legacy !== slot) return [legacy];
  return [slot];
}

// ─────────────────────────────────────────────────────────────
// 무기 / 왼손 타입
// ─────────────────────────────────────────────────────────────

/**
 * 무기 타입 정의. archs = 이 무기를 선호하는 아키타입(ARCHETYPES 키) 목록.
 * ★ shield 만 slot 이 'offhand' 다 (설계 A: 방패는 왼손으로 이사했다).
 *   클래스의 equip 목록에 'shield' 가 있으면 "왼손에 방패를 들 수 있다"는 뜻이 된다.
 */
export const WEAPON_TYPES = {
  sword:      { id: 'sword',      name: '검',     slot: 'weapon', twoHanded: false, range: 'melee',  archs: ['fighter', 'tank', 'lancer'], desc: '균형 잡힌 한손검.' },
  greatsword: { id: 'greatsword', name: '대검',   slot: 'weapon', twoHanded: true,  range: 'melee',  archs: ['fighter'],                   desc: '무겁지만 일격이 강한 양손검.' },
  katana:     { id: 'katana',     name: '도',     slot: 'weapon', twoHanded: false, range: 'melee',  archs: ['fighter', 'rogue'],          desc: '치명타에 특화된 곡도.' },
  spear:      { id: 'spear',      name: '창',     slot: 'weapon', twoHanded: true,  range: 'melee',  archs: ['lancer', 'fighter'],         desc: '간격을 벌리고 찌르는 장병기.' },
  axe:        { id: 'axe',        name: '도끼',   slot: 'weapon', twoHanded: false, range: 'melee',  archs: ['fighter', 'tank'],           desc: '공격력이 높고 거친 도끼.' },
  mace:       { id: 'mace',       name: '둔기',   slot: 'weapon', twoHanded: false, range: 'melee',  archs: ['healer', 'tank', 'fighter'], desc: '단단한 타격 무기.' },
  scythe:     { id: 'scythe',     name: '낫',     slot: 'weapon', twoHanded: true,  range: 'melee',  archs: ['fighter', 'mage'],           desc: '치명타 피해가 극단적인 사신의 낫.' },
  dagger:     { id: 'dagger',     name: '단검',   slot: 'weapon', twoHanded: false, range: 'melee',  archs: ['rogue', 'archer'],           desc: '빠르고 치명적인 단검.' },
  claw:       { id: 'claw',       name: '수갑',   slot: 'weapon', twoHanded: false, range: 'melee',  archs: ['rogue', 'fighter'],          desc: '양손에 차는 발톱형 무기.' },
  bow:        { id: 'bow',        name: '활',     slot: 'weapon', twoHanded: true,  range: 'ranged', archs: ['archer'],                    desc: '연사가 빠른 원거리 무기.' },
  crossbow:   { id: 'crossbow',   name: '석궁',   slot: 'weapon', twoHanded: true,  range: 'ranged', archs: ['archer'],                    desc: '느리지만 관통력이 큰 석궁.' },
  staff:      { id: 'staff',      name: '지팡이', slot: 'weapon', twoHanded: true,  range: 'ranged', archs: ['mage', 'healer'],            desc: '마력을 증폭하는 긴 지팡이.' },
  wand:       { id: 'wand',       name: '완드',   slot: 'weapon', twoHanded: false, range: 'ranged', archs: ['mage', 'healer'],            desc: '시전이 빠른 단봉.' },
  tome:       { id: 'tome',       name: '마도서', slot: 'weapon', twoHanded: false, range: 'ranged', archs: ['healer', 'mage'],            desc: '저항과 생명력을 보태는 서적.' },
  shield:     { id: 'shield',     name: '방패',   slot: 'offhand', twoHanded: false, range: 'melee', archs: ['tank'],                      desc: '공격력을 포기하고 방어를 얻는다.' },
};

/**
 * 왼손(보조) 장비 계통. part 는 SPEC §4.4 의 shd_* 어휘만 쓴다.
 * archs = 이 계통을 선호하는 아키타입.
 */
export const OFFHAND_TYPES = {
  shield: { id: 'shield', name: '방패',   part: 'shd_round',   archs: ['tank', 'lancer', 'fighter'], desc: '몸을 가려 피해를 줄인다.' },
  orb:    { id: 'orb',    name: '보주',   part: 'shd_orb',     archs: ['mage', 'healer'],            desc: '마력을 머금은 구슬.' },
  torch:  { id: 'torch',  name: '횃불',   part: 'shd_torch',   archs: ['mage', 'rogue', 'archer'],   desc: '불빛으로 적을 태운다.' },
  crest:  { id: 'crest',  name: '문장',   part: 'shd_buckler', archs: ['tank', 'healer', 'lancer'],  desc: '가문·기사단의 표식.' },
  dagger: { id: 'dagger', name: '보조검', part: 'shd_dagger',  archs: ['rogue', 'fighter', 'archer'], desc: '왼손에 쥐는 짧은 칼.' },
};

/** 특정 아키타입이 선호하는 무기 타입 id 배열 */
export function weaponTypesFor(arch) {
  return Object.values(WEAPON_TYPES).filter((w) => w.archs.includes(arch)).map((w) => w.id);
}

/** 특정 아키타입이 선호하는 왼손 계통 id 배열 */
export function offhandTypesFor(arch) {
  return Object.values(OFFHAND_TYPES).filter((o) => o.archs.includes(arch)).map((o) => o.id);
}

/** 양손무기인가 (모르는 타입은 false) */
export function isTwoHanded(weaponType) {
  const w = weaponType && WEAPON_TYPES[weaponType];
  return !!(w && w.twoHanded);
}

/**
 * 이 무기를 들었을 때 실제로 쓸 수 있는 슬롯 목록.
 * 양손무기면 offhand 가 빠져 9칸이 된다 (세트 "풀세트" 판정 기준).
 * @param {string|{weaponType?:string}} weapon 무기 타입 id 또는 weaponType 을 가진 객체
 */
export function equippableSlots(weapon) {
  const t = typeof weapon === 'string' ? weapon : weapon && weapon.weaponType;
  return isTwoHanded(t) ? SLOTS.filter((s) => s !== 'offhand') : SLOTS.slice();
}

/** 위 목록의 개수 (10 또는 9) */
export function equippableSlotCount(weapon) {
  return equippableSlots(weapon).length;
}

// ─────────────────────────────────────────────────────────────
// 베이스 아이템
// ─────────────────────────────────────────────────────────────

const mk = (o) => ({
  weaponType: null, armorType: null, accType: null, offhandType: null,
  setId: null, weight: 8, unique: false, ...o,
});

/** 무기(오른손) */
const W = (id, name, weaponType, minLv, stats, weight, desc) =>
  mk({ id, name, slot: 'weapon', weaponType, minLv, stats, weight, desc });
/** 왼손 — offhandType 은 OFFHAND_TYPES 키. 방패/보조검은 weaponType 도 함께 갖는다. */
const O = (id, name, offhandType, weaponType, minLv, stats, weight, desc) =>
  mk({ id, name, slot: 'offhand', offhandType, weaponType, part: OFFHAND_TYPES[offhandType].part, minLv, stats, weight, desc });
/** 상의(몸통) */
const A = (id, name, armorType, minLv, stats, weight, desc) =>
  mk({ id, name, slot: 'body', armorType, minLv, stats, weight, desc });
/** 목걸이 */
const N = (id, name, accType, minLv, stats, weight, desc) =>
  mk({ id, name, slot: 'neck', accType, minLv, stats, weight, desc });
/** 반지 (ring1 / ring2 공용 풀) */
const R = (id, name, accType, minLv, stats, weight, desc) =>
  mk({ id, name, slot: 'ring', accType, minLv, stats, weight, desc });
/** 고유 아이템 */
const U = (o) => mk({ weight: 2, unique: true, fixedAffixes: [], ...o });

/* ── 무기 42종 (기존 유지) ───────────────────────────────────── */
const WEAPON_BASES = [
  // 검 (t0/t2/t4)
  W('longsword',    '롱소드',           'sword', 1,  { atk: 12 },                    12, '용병단 지급품인 평범한 한손검.'),
  W('broadsword',   '브로드소드',       'sword', 16, { atk: 17, crit: 1 },           10, '날 폭이 넓어 베는 맛이 좋다.'),
  W('runeblade',    '룬블레이드',       'sword', 38, { atk: 23, crit: 2 },            8, '날에 새긴 룬이 옅게 빛난다.'),
  // 대검 (t1/t3/t5)
  W('greatsword',   '그레이트소드',     'greatsword', 8,  { atk: 19, spd: -2 },      10, '두 손으로 휘두르는 거대한 검.'),
  W('zweihander',   '츠바이핸더',       'greatsword', 26, { atk: 27, spd: -2 },       8, '보병 대열을 쓸어버리는 장검.'),
  W('titanblade',   '거인의 검',        'greatsword', 50, { atk: 36, spd: -3, critDmg: 8 }, 5, '거인족이 쓰던 것을 개조했다.'),
  // 도 (t1/t3/t5)
  W('uchigatana',   '우치가타나',       'katana', 8,  { atk: 16, crit: 3 },          10, '동방에서 건너온 얇은 곡도.'),
  W('nodachi',      '노다치',           'katana', 26, { atk: 23, crit: 4, spd: 2 },   8, '길이가 사람 키에 육박한다.'),
  W('masterblade',  '명인의 도',        'katana', 50, { atk: 31, crit: 6, spd: 3 },   5, '한 자루에 평생을 바친 장인의 작품.'),
  // 창 (t0/t2/t4)
  W('shortspear',   '단창',             'spear', 1,  { atk: 11, spd: 1 },            12, '민병대가 쓰는 짧은 창.'),
  W('warlance',     '전투창',           'spear', 16, { atk: 16, spd: 1 },            10, '기병 돌격을 견디도록 만든 창.'),
  W('dragonpike',   '용창',             'spear', 38, { atk: 22, spd: 2, crit: 2 },    8, '용을 잡기 위해 벼려낸 장창.'),
  // 도끼 (t1/t3/t5)
  W('handaxe',      '손도끼',           'axe', 8,  { atk: 15, crit: 1 },             12, '나무도 사람도 팬다.'),
  W('battleaxe',    '전투도끼',         'axe', 26, { atk: 23, crit: 2 },              9, '북방 부족의 주력 무기.'),
  W('executioner',  '처형자의 도끼',    'axe', 50, { atk: 32, critDmg: 10 },          5, '한 번에 끝내기 위한 형구.'),
  // 둔기 (t0/t2/t4)
  W('club',         '곤봉',             'mace', 1,  { atk: 11, def: 1 },             12, '가장 값싼 무기.'),
  W('warmace',      '전투 철퇴',        'mace', 16, { atk: 16, def: 2 },             10, '판금 갑옷을 찌그러뜨린다.'),
  W('holymace',     '성스러운 철퇴',    'mace', 38, { atk: 22, def: 3, res: 2 },      8, '사제단이 축복을 내린 철퇴.'),
  // 낫 (t1/t3/t5)
  W('reapscythe',   '수확용 낫',        'scythe', 8,  { atk: 17, critDmg: 8 },       10, '농기구를 급히 개조했다.'),
  W('warscythe',    '전투낫',           'scythe', 26, { atk: 25, critDmg: 10, crit: 2 }, 8, '날을 세워 세로로 고정한 낫.'),
  W('soulreaper',   '영혼 수확자',      'scythe', 50, { atk: 34, critDmg: 12, crit: 3 }, 5, '베인 자리에 냉기가 남는다.'),
  // 단검 (t0/t2/t4)
  W('dirk',         '단도',             'dagger', 1,  { atk: 9, crit: 3, spd: 2 },   12, '품에 숨기기 좋은 칼.'),
  W('stiletto',     '스틸레토',         'dagger', 16, { atk: 13, crit: 4, spd: 3 },  10, '갑옷 틈을 노리는 송곳칼.'),
  W('fangdagger',   '독니 단검',        'dagger', 38, { atk: 18, crit: 5, spd: 4 },   8, '뱀 이빨 모양의 칼날.'),
  // 수갑 (t0/t2/t4)
  W('ironclaw',     '쇠발톱',           'claw', 1,  { atk: 10, crit: 2, spd: 2 },    11, '주먹에 덧대는 쇠갈퀴.'),
  W('tigerclaw',    '범발톱',           'claw', 16, { atk: 15, crit: 3, spd: 3 },     9, '연격에 최적화된 수갑.'),
  W('windclaw',     '질풍 발톱',        'claw', 38, { atk: 20, crit: 4, spd: 4 },     7, '휘두르면 바람 소리가 난다.'),
  // 활 (t0/t2/t4)
  W('shortbow',     '단궁',             'bow', 1,  { atk: 12, crit: 1 },             12, '사냥꾼이 쓰던 작은 활.'),
  W('huntingbow',   '사냥활',           'bow', 16, { atk: 17, crit: 2 },             10, '장력이 강해 관통력이 좋다.'),
  W('windbow',      '질풍궁',           'bow', 38, { atk: 23, crit: 3, spd: 2 },      8, '시위를 놓으면 바람이 인다.'),
  // 석궁 (t1/t3/t5)
  W('lightcrossbow','경노',             'crossbow', 8,  { atk: 18, spd: -2 },        10, '훈련 없이도 쏠 수 있다.'),
  W('heavycrossbow','중노',             'crossbow', 26, { atk: 26, spd: -3 },         8, '장전이 느린 대신 위력이 크다.'),
  W('siegearbalest','공성 석궁',        'crossbow', 50, { atk: 35, spd: -4, critDmg: 8 }, 5, '성문도 뚫는 공성용 대형 석궁.'),
  // 지팡이 (t0/t2/t4)
  W('oakstaff',     '참나무 지팡이',    'staff', 1,  { atk: 13, res: 2 },            12, '견습 마법사의 첫 지팡이.'),
  W('runestaff',    '룬 지팡이',        'staff', 16, { atk: 18, res: 3 },            10, '룬을 새겨 마력을 모은다.'),
  W('archstaff',    '대마도사의 지팡이','staff', 38, { atk: 25, res: 5 },             8, '끝에 박힌 보주가 스스로 빛난다.'),
  // 완드 (t1/t3/t5)
  W('applewand',    '사과나무 완드',    'wand', 8,  { atk: 15, spd: 2 },             11, '가볍고 시전이 빠르다.'),
  W('crystalwand',  '수정 완드',        'wand', 26, { atk: 21, spd: 3, res: 2 },      9, '수정이 주문을 증폭한다.'),
  W('starwand',     '별빛 완드',        'wand', 50, { atk: 29, spd: 4, res: 3 },      5, '밤하늘의 조각을 박아 넣었다.'),
  // 마도서 (t1/t3/t5)
  W('prayerbook',   '기도서',           'tome', 8,  { atk: 13, res: 4, hp: 16 },     11, '성구가 빼곡히 적혀 있다.'),
  W('grimoire',     '마도서',           'tome', 26, { atk: 19, res: 6, hp: 24 },      9, '금지된 주문이 절반쯤 실려 있다.'),
  W('codex',        '봉인된 금서',      'tome', 50, { atk: 26, res: 8, hp: 34 },      5, '사슬로 묶어 두어야 하는 책.'),
];

/* ── 왼손 13종 — 방패 + 보주/횃불/문장/보조검 (def·res 중심) ── */
const OFFHAND_BASES = [
  O('buckler',       '버클러',         'shield', 'shield', 1,  { atk: 3, def: 5, hp: 20 },          12, '작고 가벼운 소형 방패.'),
  O('oiltorch',      '기름 횃불',      'torch',  null,     1,  { atk: 4, crit: 1, res: 2 },         12, '불을 붙인 채로 휘두른다.'),
  O('roundshield',   '라운드 실드',    'shield', 'shield', 8,  { atk: 3, def: 7, hp: 28 },          11, '보병이 대열을 짜고 드는 원형 방패.'),
  O('parryingdagger','방어용 단검',    'dagger', 'dagger', 8,  { atk: 5, crit: 2, eva: 2 },         11, '적의 칼끝을 흘려보내는 짧은 칼.'),
  O('kiteshield',    '카이트 실드',    'shield', 'shield', 16, { atk: 4, def: 8, hp: 34 },          10, '기병용 연 모양 방패.'),
  O('crystalorb',    '수정 보주',      'orb',    null,     16, { atk: 6, res: 5, hp: 16 },          10, '손 위에 떠 있는 맑은 구슬.'),
  O('spikedshield',  '가시 방패',      'shield', 'shield', 26, { atk: 8, def: 7, hp: 26 },           9, '막으면서 동시에 찌른다.'),
  O('knightcrest',   '기사단 문장',    'crest',  null,     26, { def: 5, res: 6, hp: 28 },           9, '들고 있는 것만으로 대열이 굳는다.'),
  O('towershield',   '타워 실드',      'shield', 'shield', 38, { atk: 5, def: 12, hp: 52, spd: -2 }, 8, '몸 전체를 가리는 대형 방패.'),
  O('everlamp',      '영원의 등불',    'torch',  null,     38, { atk: 7, res: 7, crit: 2 },          7, '기름을 넣지 않아도 꺼지지 않는다.'),
  O('pavise',        '파비스',         'shield', 'shield', 50, { atk: 6, def: 16, hp: 64, spd: -3 }, 5, '세워 두면 그 자체로 벽이 된다.'),
  O('soulorb',       '영혼의 보주',    'orb',    null,     50, { atk: 10, res: 9, hp: 30 },          5, '안에서 무언가가 천천히 돌고 있다.'),
  O('saintreliquary','성인의 성물함',  'crest',  null,     50, { def: 10, res: 11, hp: 46 },         5, '순교자의 뼈 한 조각이 들었다.'),
];

/* ── 상의(몸통) 20종 (기존 방어구 이관) ─────────────────────── */
const BODY_BASES = [
  // 천 (마법 저항 중심)
  A('clothrobe',    '천 로브',          'cloth', 1,  { hp: 44, def: 2, res: 5 },              12, '가장 값싼 마법사용 의복.'),
  A('paddedvest',   '누비옷',           'cloth', 8,  { hp: 56, def: 3, res: 6 },              11, '솜을 누벼 충격을 덜어 준다.'),
  A('silkrobe',     '비단 로브',        'cloth', 16, { hp: 68, def: 3, res: 9 },              10, '가볍고 마력이 잘 통한다.'),
  A('magerobe',     '마도사 로브',      'cloth', 26, { hp: 84, def: 4, res: 12 },              9, '주문 문양이 은실로 박혀 있다.'),
  A('archrobe',     '대마도사의 예복',  'cloth', 50, { hp: 120, def: 6, res: 18, spd: 2 },     5, '탑의 상위 서열만 걸친다.'),
  // 가죽 (균형 + 회피)
  A('leatherjerkin','가죽 조끼',        'leather', 1,  { hp: 54, def: 4, res: 2, eva: 2 },    12, '움직임을 방해하지 않는다.'),
  A('studdedleather','징박은 가죽갑옷', 'leather', 8,  { hp: 68, def: 6, res: 2, eva: 2 },    11, '쇠징을 박아 방어를 보강했다.'),
  A('rangergarb',   '순찰자 복장',      'leather', 16, { hp: 84, def: 8, res: 3, eva: 3 },    10, '숲을 오래 걷기 위한 옷.'),
  A('shadowleather','그림자 가죽갑옷',  'leather', 38, { hp: 124, def: 12, res: 5, eva: 4 },   7, '발소리를 죽이도록 무두질했다.'),
  A('dragonhide',   '용가죽 갑옷',      'leather', 50, { hp: 150, def: 15, res: 7, eva: 4 },   5, '비룡의 배가죽으로 만들었다.'),
  // 사슬 (방어 중심)
  A('ringmail',     '사슬 조끼',        'mail', 1,  { hp: 60, def: 6, res: 1 },               12, '고리를 이어 붙인 짧은 갑옷.'),
  A('chainmail',    '사슬 갑옷',        'mail', 8,  { hp: 76, def: 8, res: 2 },               11, '용병단의 표준 장비.'),
  A('scalemail',    '비늘 갑옷',        'mail', 26, { hp: 106, def: 13, res: 4 },              9, '쇠비늘을 겹쳐 꿰맸다.'),
  A('mithrilmail',  '미스릴 사슬',      'mail', 38, { hp: 128, def: 16, res: 6, spd: 1 },      6, '깃털처럼 가벼운 은빛 사슬.'),
  A('runemail',     '룬 사슬갑옷',      'mail', 50, { hp: 154, def: 19, res: 8 },              5, '고리마다 보호 룬이 새겨졌다.'),
  // 판금 (최고 방어, 속도 감소)
  A('halfplate',    '하프 플레이트',    'plate', 8,  { hp: 82, def: 11, res: 2, spd: -2 },    11, '상반신만 판금으로 덮는다.'),
  A('fullplate',    '풀 플레이트',      'plate', 16, { hp: 100, def: 14, res: 3, spd: -2 },   10, '전신을 감싸는 정식 판금.'),
  A('knightplate',  '기사 판금갑옷',    'plate', 26, { hp: 120, def: 17, res: 4, spd: -2 },    8, '문장을 새긴 기사단 제식품.'),
  A('crusaderplate','성전사 판금갑옷',  'plate', 38, { hp: 144, def: 21, res: 7, spd: -3 },    6, '성수로 축성한 판금.'),
  A('titanplate',   '거인 판금갑옷',    'plate', 50, { hp: 174, def: 26, res: 9, spd: -4 },    5, '입은 자를 성벽으로 만든다.'),
];

/* ── 머리 / 하의 / 장갑 / 신발 — 재질 4 × 레벨대 5 = 슬롯당 20종 ──
   스탯 성격(설계 A-4):
     머리·하의  hp·def·res    장갑  crit·atk    신발  spd·eva
   수치는 전부 "계수 1.0(무기) 기준"이다. 실제로는 SLOT_POWER 가 곱해져
   머리 0.45 / 하의 0.45 / 장갑 0.35 / 신발 0.35 로 줄어든다.            */

const GEN_SLOTS = ['head', 'legs', 'hands', 'feet'];
const ARMOR_MATERIALS = ['cloth', 'leather', 'mail', 'plate'];
/** 재질별 등장 레벨 5구간 (ILVL_TIERS 경계 위에 얹는다) */
const ARMOR_LVS = {
  cloth: [1, 8, 16, 26, 38],
  leather: [1, 8, 26, 38, 50],
  mail: [1, 16, 26, 38, 50],
  plate: [8, 16, 26, 38, 50],
};
/** 재질별 등급 수식어 (레벨대 5구간) */
const ARMOR_ADJ = {
  cloth: ['무명', '누비', '비단', '마법사', '대마도사의'],
  leather: ['가죽', '징박은 가죽', '순찰자의', '그림자', '용가죽'],
  mail: ['사슬', '고리사슬', '비늘', '미스릴', '룬사슬'],
  plate: ['강철', '기사', '흑철', '성전사', '거인의'],
};
/** 슬롯 × 재질 명사 */
const ARMOR_NOUN = {
  head: { cloth: '두건', leather: '투구', mail: '두건', plate: '투구' },
  legs: { cloth: '바지', leather: '각반', mail: '각반', plate: '다리보호대' },
  hands: { cloth: '장갑', leather: '손보호대', mail: '장갑', plate: '건틀릿' },
  feet: { cloth: '신', leather: '장화', mail: '신발', plate: '부츠' },
};
/** 슬롯 × 재질 설명 */
const ARMOR_DESC = {
  head: {
    cloth: '머리를 가볍게 감싸는 천 두건.', leather: '가죽을 여러 겹 덧댄 머리 보호구.',
    mail: '사슬을 엮어 목덜미까지 덮는다.', plate: '얼굴까지 가리는 금속 투구.',
  },
  legs: {
    cloth: '통이 넓어 움직임이 자유롭다.', leather: '무릎까지 덮는 가죽 각반.',
    mail: '허벅지를 감싸는 사슬 각반.', plate: '다리를 통째로 덮는 판금.',
  },
  hands: {
    cloth: '손끝의 감각을 죽이지 않는다.', leather: '손아귀 힘을 보태 준다.',
    mail: '손등에 사슬을 덧댔다.', plate: '주먹 자체가 무기가 된다.',
  },
  feet: {
    cloth: '발소리가 거의 나지 않는다.', leather: '오래 걸어도 발이 편하다.',
    mail: '발등을 사슬로 보호한다.', plate: '한 발짝마다 땅이 울린다.',
  },
};
/** 레벨대별 품질 계수 (곱연산 스탯 / 평탄 스탯) */
const ARMOR_QUALITY = [1.00, 1.27, 1.55, 1.92, 2.45];
const ARMOR_FLAT_QUALITY = [1.0, 1.0, 1.5, 1.5, 2.0];
const ARMOR_WEIGHT = [12, 11, 10, 8, 5];
/** 슬롯 × 재질 기본 스탯 (계수 1.0 기준, 최저 레벨대) */
const ARMOR_PROFILE = {
  head: {
    cloth: { hp: 30, def: 2, res: 5 },
    leather: { hp: 36, def: 4, res: 2, eva: 2 },
    mail: { hp: 42, def: 6, res: 1 },
    plate: { hp: 48, def: 9, res: 2, spd: -1 },
  },
  legs: {
    cloth: { hp: 32, def: 2, res: 4 },
    leather: { hp: 38, def: 5, res: 2, eva: 2 },
    mail: { hp: 44, def: 7, res: 1 },
    plate: { hp: 52, def: 10, res: 2, spd: -1 },
  },
  hands: {
    cloth: { atk: 5, res: 3, crit: 1 },
    leather: { atk: 4, crit: 3, eva: 1 },
    mail: { atk: 4, def: 3, hp: 10, crit: 2 },
    plate: { atk: 3, def: 6, hp: 16 },
  },
  feet: {
    cloth: { spd: 4, res: 2, eva: 2 },
    leather: { spd: 3, hp: 12, eva: 4 },
    mail: { spd: 2, def: 4, hp: 16, eva: 1 },
    plate: { def: 6, hp: 24, spd: -2 },
  },
};

/** 프로필 × 레벨대 -> 실제 stats */
function armorStatsAt(profile, i) {
  const out = {};
  for (const k of Object.keys(profile)) {
    const flat = FLAT_STAT_KEYS.includes(k);
    const n = profile[k] * (flat ? ARMOR_FLAT_QUALITY[i] : ARMOR_QUALITY[i]);
    if (flat) out[k] = Math.round(n * 10) / 10;
    else out[k] = n < 0 ? Math.min(-1, Math.round(n)) : Math.max(1, Math.round(n));
  }
  return out;
}

/** 머리/하의/장갑/신발 베이스 80종 생성 */
function buildArmorPieces() {
  const out = [];
  for (const slot of GEN_SLOTS) {
    for (const mat of ARMOR_MATERIALS) {
      const lvs = ARMOR_LVS[mat];
      for (let i = 0; i < lvs.length; i++) {
        out.push(mk({
          id: `${mat}_${slot}_${i + 1}`,
          name: `${ARMOR_ADJ[mat][i]} ${ARMOR_NOUN[slot][mat]}`,
          slot,
          armorType: mat,
          minLv: lvs[i],
          stats: armorStatsAt(ARMOR_PROFILE[slot][mat], i),
          weight: ARMOR_WEIGHT[i],
          desc: ARMOR_DESC[slot][mat],
        }));
      }
    }
  }
  return out;
}

/* ── 목걸이 12종 (res·critDmg 중심) ─────────────────────────── */
const NECK_BASES = [
  N('boneamulet',      '뼈 목걸이',      'amulet', 1,  { hp: 20, res: 3 },                  12, '부족 주술사가 만든 부장품.'),
  N('luckcharm',       '행운의 부적',    'charm',  1,  { eva: 3, crit: 1, res: 1 },         12, '어머니가 쥐여 준 부적.'),
  N('wardpendant',     '수호의 펜던트',  'amulet', 8,  { hp: 26, res: 5 },                  11, '기도문을 접어 넣은 은 펜던트.'),
  N('vowchoker',       '맹세의 목띠',    'charm',  8,  { hp: 24, res: 3, critDmg: 6 },      11, '풀지 않겠다고 맹세하고 매는 띠.'),
  N('jadeamulet',      '옥 목걸이',      'amulet', 16, { hp: 32, res: 6, spd: 1 },          10, '차가운 옥이 마음을 가라앉힌다.'),
  N('windcharm',       '바람의 부적',    'charm',  16, { eva: 4, spd: 3, res: 2 },          10, '흔들면 바람 소리가 난다.'),
  N('sunamulet',       '태양 목걸이',    'amulet', 26, { hp: 40, res: 8, atk: 3 },           8, '햇빛을 모아 두었다고 전해진다.'),
  N('silencetalisman', '침묵의 성표',    'charm',  26, { res: 9, critDmg: 8, hp: 24 },       8, '주문 소리를 삼켜 버린다.'),
  N('wraithcharm',     '망령의 부적',    'charm',  38, { eva: 6, spd: 4, crit: 2 },          7, '쥐고 있으면 형체가 흐려진다.'),
  N('starnecklace',    '별자리 목걸이',  'amulet', 38, { hp: 44, res: 10, critDmg: 12 },     7, '알 수 없는 별자리가 새겨져 있다.'),
  N('phantomcharm',    '환영의 부적',    'charm',  50, { eva: 8, spd: 5, crit: 3, res: 4 },  5, '착용자의 잔상이 남는다.'),
  N('dragonamulet',    '용의 목걸이',    'amulet', 50, { hp: 60, res: 13, critDmg: 14 },     5, '용의 송곳니를 깎아 걸었다.'),
];

/* ── 반지 13종 (crit·spd·atk 중심, ring1/ring2 공용 풀) ──────── */
const RING_BASES = [
  R('copperring',   '구리 반지',      'ring',   1,  { crit: 2, atk: 2 },                12, '싸구려지만 없는 것보단 낫다.'),
  R('ironband',     '무쇠 고리',      'ring',   1,  { atk: 3, def: 2 },                 12, '대장간 구석에 굴러다니던 것.'),
  R('silverring',   '은 반지',        'ring',   8,  { crit: 3, spd: 2 },                11, '손끝이 가벼워진다.'),
  R('garnet',       '석류석 반지',    'gem',    8,  { atk: 4, critDmg: 8 },             11, '붉은 기운이 손끝에 맺힌다.'),
  R('signetring',   '인장 반지',      'signet', 16, { atk: 4, crit: 2, spd: 1 },        10, '누군가의 이름이 새겨져 있다.'),
  R('sapphire',     '청옥 반지',      'gem',    16, { res: 5, atk: 3, spd: 1 },         10, '주문을 밀어내는 푸른 돌.'),
  R('goldring',     '황금 반지',      'ring',   26, { crit: 4, atk: 4, spd: 2 },         8, '값나가는 순금 반지.'),
  R('swiftring',    '질주의 반지',    'ring',   26, { spd: 5, crit: 3 },                 8, '끼는 순간 발끝이 근질거린다.'),
  R('ruby',         '홍옥 반지',      'gem',    38, { atk: 7, critDmg: 12 },             7, '피처럼 짙게 빛난다.'),
  R('bloodsignet',  '피의 인장',      'signet', 38, { atk: 6, crit: 3, critDmg: 6 },     7, '닦아도 붉은 자국이 남는다.'),
  R('archonring',   '아르콘의 반지',  'ring',   50, { crit: 6, atk: 6, critDmg: 10 },    5, '옛 집정관의 인장 반지.'),
  R('diamond',      '금강석 반지',    'gem',    50, { atk: 8, critDmg: 16, crit: 3 },    5, '무엇으로도 흠집이 나지 않는다.'),
  R('eternalband',  '영원의 고리',    'ring',   50, { atk: 7, spd: 5, crit: 4 },         5, '시작도 끝도 보이지 않는 고리.'),
];

/* ── 고유(전설) 아이템: 접사를 굴리지 않고 fixedAffixes 를 그대로 쓴다 ── */
const UNIQUE_BASES = [
  U({
    id: 'sunforged_blade', name: '여명의 검', slot: 'weapon', weaponType: 'sword', minLv: 26,
    stats: { atk: 26, crit: 3 }, setId: 'dawn', desc: '해가 뜨는 순간에만 벼릴 수 있었다는 검.',
    fixedAffixes: [
      { id: 'u_dawnblessing', name: '여명의 축복', stats: { atk: 5, res: 4, hp: 24 } },
      { id: 'u_sunfire', name: '태양의 불꽃', stats: { critDmg: 14 } },
    ],
  }),
  U({
    id: 'worldcleaver', name: '세계를 가르는 대검', slot: 'weapon', weaponType: 'greatsword', minLv: 38,
    stats: { atk: 34, spd: -3 }, desc: '한 번 휘두르면 지평선이 흔들린다고 한다.',
    fixedAffixes: [
      { id: 'u_severance', name: '단절의 일격', stats: { atk: 9, critDmg: 16 } },
      { id: 'u_giantgrip', name: '거인의 악력', stats: { hp: 40, def: 5 } },
    ],
  }),
  U({
    id: 'windpiercer', name: '바람뚫이', slot: 'weapon', weaponType: 'spear', minLv: 16,
    stats: { atk: 18, spd: 3 }, desc: '던지면 바람보다 먼저 도착한다.',
    fixedAffixes: [
      { id: 'u_galethrust', name: '질풍 관통', stats: { atk: 5, spd: 4 } },
      { id: 'u_piercepoint', name: '꿰뚫기', stats: { crit: 4 } },
    ],
  }),
  U({
    id: 'moonfang', name: '월아', slot: 'weapon', weaponType: 'katana', minLv: 38,
    stats: { atk: 28, crit: 6 }, desc: '초승달을 그대로 벼려 낸 듯한 곡도.',
    fixedAffixes: [
      { id: 'u_moonlight', name: '월광 잔상', stats: { eva: 5, spd: 3 } },
      { id: 'u_crescent', name: '초승달 베기', stats: { crit: 5, critDmg: 14 } },
    ],
  }),
  U({
    id: 'stormcaller', name: '폭풍을 부르는 지팡이', slot: 'weapon', weaponType: 'staff', minLv: 26,
    stats: { atk: 23, res: 5 }, desc: '끝을 들면 먹구름이 몰려온다.',
    fixedAffixes: [
      { id: 'u_thundercall', name: '천둥 소환', stats: { atk: 7, crit: 3 } },
      { id: 'u_squall', name: '돌풍', stats: { spd: 4, res: 4 } },
    ],
  }),
  U({
    id: 'nightwhisper', name: '밤의 속삭임', slot: 'weapon', weaponType: 'dagger', minLv: 16,
    stats: { atk: 13, crit: 6, spd: 4 }, setId: 'nightveil', desc: '뽑는 소리조차 나지 않는 단검.',
    fixedAffixes: [
      { id: 'u_silentedge', name: '소리 없는 칼날', stats: { crit: 5, eva: 4 } },
      { id: 'u_venomkiss', name: '독의 입맞춤', stats: { atk: 4, critDmg: 12 } },
    ],
  }),
  U({
    id: 'sunbow', name: '태양궁', slot: 'weapon', weaponType: 'bow', minLv: 38,
    stats: { atk: 26, crit: 4 }, desc: '시위를 당기면 화살이 저절로 맺힌다.',
    fixedAffixes: [
      { id: 'u_sunray', name: '햇살 화살', stats: { atk: 7, crit: 3 } },
      { id: 'u_farsight', name: '천리안', stats: { spd: 3, critDmg: 12 } },
    ],
  }),
  U({
    id: 'aegis', name: '불멸의 방패', slot: 'offhand', offhandType: 'shield', weaponType: 'shield',
    part: 'shd_tower', minLv: 26,
    stats: { atk: 5, def: 14, hp: 60 }, setId: 'dawn', desc: '단 한 번도 부서진 적이 없다.',
    fixedAffixes: [
      { id: 'u_immortalward', name: '불멸의 가호', stats: { hp: 44, res: 6 } },
      { id: 'u_reflectwall', name: '반사 방벽', stats: { def: 7 } },
    ],
  }),
  U({
    id: 'shadowcloak', name: '그림자 장막', slot: 'body', armorType: 'leather', minLv: 26,
    stats: { hp: 96, def: 9, res: 5, eva: 5 }, setId: 'nightveil', desc: '입은 자가 어둠에 반쯤 녹아든다.',
    fixedAffixes: [
      { id: 'u_veilofnight', name: '밤의 장막', stats: { eva: 6, spd: 3 } },
      { id: 'u_fadeaway', name: '소멸', stats: { hp: 28, res: 4 } },
    ],
  }),
  U({
    id: 'dragonplate', name: '용린 판금갑옷', slot: 'body', armorType: 'plate', minLv: 50,
    stats: { hp: 180, def: 27, res: 11, spd: -3 }, setId: 'dragon', desc: '고룡의 비늘을 통째로 이어 붙였다.',
    fixedAffixes: [
      { id: 'u_dragonscale', name: '용비늘', stats: { def: 8, res: 6 } },
      { id: 'u_dragonheart', name: '용의 심장', stats: { hp: 60, atk: 5 } },
    ],
  }),
  U({
    id: 'grasphelm', name: '통찰의 투구', slot: 'head', armorType: 'mail', minLv: 26,
    stats: { hp: 70, def: 8, res: 9 }, desc: '쓰면 적의 다음 수가 반 박자 먼저 보인다.',
    fixedAffixes: [
      { id: 'u_foresight', name: '예지', stats: { eva: 4, spd: 2 } },
      { id: 'u_clearmind', name: '맑은 정신', stats: { res: 6 } },
    ],
  }),
  U({
    id: 'strider_boots', name: '천리행 장화', slot: 'feet', armorType: 'leather', minLv: 26,
    stats: { spd: 8, eva: 5, hp: 30 }, desc: '신은 자가 하루에 천 리를 걸었다고 한다.',
    fixedAffixes: [
      { id: 'u_thousandsteps', name: '천 걸음', stats: { spd: 5, eva: 3 } },
    ],
  }),
  U({
    id: 'wanderer_ring', name: '방랑자의 반지', slot: 'ring', accType: 'ring', minLv: 8,
    stats: { crit: 3, spd: 3, eva: 2 }, weight: 3, desc: '이름 없는 여행자가 남기고 간 반지.',
    fixedAffixes: [
      { id: 'u_wanderstep', name: '방랑자의 발걸음', stats: { spd: 3, eva: 3 } },
    ],
  }),
  U({
    id: 'dragonscale_ring', name: '용린 반지', slot: 'ring', accType: 'ring', minLv: 50,
    stats: { atk: 6, def: 6, res: 6, hp: 30 }, setId: 'dragon', desc: '용의 눈알만 한 비늘 하나를 물렸다.',
    fixedAffixes: [
      { id: 'u_scaleguard', name: '비늘 수호', stats: { def: 6, res: 6 } },
    ],
  }),
  U({
    id: 'deepheart', name: '심연의 심장', slot: 'neck', accType: 'amulet', minLv: 50,
    stats: { hp: 56, atk: 7, res: 9 }, desc: '아직도 규칙적으로 뛰고 있다.',
    fixedAffixes: [
      { id: 'u_abyssalpulse', name: '심연의 고동', stats: { atk: 7, hp: 36 } },
      { id: 'u_devour', name: '포식', stats: { critDmg: 18, crit: 3 } },
    ],
  }),
];

/**
 * 전체 베이스 목록(배열). 고유 아이템도 이 배열에 포함된다(unique:true).
 * 슬롯별 개수: weapon 42 / offhand 13 / body 20 / head·legs·hands·feet 각 20 / neck 12 / ring 13 (+고유 15)
 */
export const ITEM_BASES = [
  ...WEAPON_BASES,
  ...OFFHAND_BASES,
  ...BODY_BASES,
  ...buildArmorPieces(),
  ...NECK_BASES,
  ...RING_BASES,
  ...UNIQUE_BASES,
];

// ─────────────────────────────────────────────────────────────
// 접사 — stats 는 ilvl 1 기준 절대값. 접사 1개 ≈ 무기 기본 atk 의 15~35%.
// tierMin = 이 접사가 등장하기 시작하는 티어 인덱스(0~5).
// ─────────────────────────────────────────────────────────────

export const PREFIXES = [
  { id: 'sharp',     name: '날카로운',   stats: { atk: 3 },                     tierMin: 0 },
  { id: 'sturdy',    name: '견고한',     stats: { def: 2, hp: 12 },             tierMin: 0 },
  { id: 'swift',     name: '질풍의',     stats: { spd: 2 },                     tierMin: 0 },
  { id: 'precise',   name: '정교한',     stats: { crit: 3 },                    tierMin: 0 },
  { id: 'tough',     name: '튼튼한',     stats: { hp: 28 },                     tierMin: 0 },
  { id: 'cruel',     name: '잔혹한',     stats: { atk: 2, critDmg: 6 },         tierMin: 1 },
  { id: 'heavy',     name: '육중한',     stats: { atk: 4, spd: -1 },            tierMin: 1 },
  { id: 'burning',   name: '불타는',     stats: { atk: 3, crit: 1 },            tierMin: 1 },
  { id: 'frozen',    name: '서릿발의',   stats: { atk: 2, res: 2 },             tierMin: 1 },
  { id: 'holy',      name: '신성한',     stats: { res: 3, hp: 10 },             tierMin: 1 },
  { id: 'steel',     name: '강철의',     stats: { def: 4 },                     tierMin: 1 },
  { id: 'hunters',   name: '사냥꾼의',   stats: { atk: 2, crit: 2 },            tierMin: 1 },
  { id: 'nimble',    name: '민첩한',     stats: { spd: 2, eva: 2 },             tierMin: 1 },
  { id: 'shadowy',   name: '어둠의',     stats: { atk: 3, eva: 2 },             tierMin: 2 },
  { id: 'venomous',  name: '맹독의',     stats: { atk: 4, crit: 1 },            tierMin: 2 },
  { id: 'guardians', name: '수호자의',   stats: { def: 3, res: 3 },             tierMin: 2 },
  { id: 'sages',     name: '현자의',     stats: { res: 4, hp: 12 },             tierMin: 2 },
  { id: 'blessed',   name: '축복받은',   stats: { hp: 20, res: 2 },             tierMin: 2 },
  { id: 'cursed',    name: '저주받은',   stats: { atk: 5, hp: -15 },            tierMin: 2 },
  { id: 'brave',     name: '용맹한',     stats: { atk: 3, def: 2 },             tierMin: 2 },
  { id: 'cunning',   name: '교활한',     stats: { crit: 3, eva: 2 },            tierMin: 2 },
  { id: 'ruthless',  name: '냉혹한',     stats: { critDmg: 12 },                tierMin: 2 },
  { id: 'berserk',   name: '광전사의',   stats: { atk: 6, def: -2 },            tierMin: 3 },
  { id: 'stormy',    name: '폭풍의',     stats: { spd: 3, crit: 2 },            tierMin: 3 },
  { id: 'earthen',   name: '대지의',     stats: { hp: 30, def: 3 },             tierMin: 3 },
  { id: 'radiant',   name: '찬란한',     stats: { atk: 4, res: 3 },             tierMin: 3 },
  { id: 'ancient',   name: '고대의',     stats: { atk: 4, hp: 20 },             tierMin: 3 },
  { id: 'stealthy',  name: '은밀한',     stats: { eva: 4, spd: 2 },             tierMin: 3 },
  { id: 'savage',    name: '야만적인',   stats: { atk: 5, critDmg: 8 },         tierMin: 4 },
  { id: 'glorious',  name: '영광의',     stats: { atk: 5, def: 4, hp: 25 },     tierMin: 4 },
];

export const SUFFIXES = [
  { id: 'beast',      name: '의 맹수',    stats: { atk: 3 },                    tierMin: 0 },
  { id: 'ward',       name: '의 수호',    stats: { def: 3 },                    tierMin: 0 },
  { id: 'gale',       name: '의 질풍',    stats: { spd: 2 },                    tierMin: 0 },
  { id: 'edge',       name: '의 예리함',  stats: { crit: 3 },                   tierMin: 0 },
  { id: 'bulwark',    name: '의 반석',    stats: { hp: 26, def: 2 },            tierMin: 1 },
  { id: 'hunt',       name: '의 사냥',    stats: { atk: 2, spd: 1 },            tierMin: 1 },
  { id: 'shade',      name: '의 그림자',  stats: { eva: 3 },                    tierMin: 1 },
  { id: 'flame',      name: '의 불꽃',    stats: { atk: 4 },                    tierMin: 1 },
  { id: 'frost',      name: '의 서리',    stats: { res: 3, atk: 1 },            tierMin: 1 },
  { id: 'soil',       name: '의 대지',    stats: { hp: 24, res: 2 },            tierMin: 1 },
  { id: 'valor',      name: '의 용기',    stats: { atk: 3, hp: 16 },            tierMin: 1 },
  { id: 'wisdom',     name: '의 지혜',    stats: { res: 4 },                    tierMin: 1 },
  { id: 'slaughter',  name: '의 학살',    stats: { atk: 4, critDmg: 8 },        tierMin: 2 },
  { id: 'tempest',    name: '의 폭풍',    stats: { spd: 2, crit: 2 },           tierMin: 2 },
  { id: 'dawn',       name: '의 여명',    stats: { hp: 22, res: 3 },            tierMin: 2 },
  { id: 'life',       name: '의 생명',    stats: { hp: 36 },                    tierMin: 2 },
  { id: 'precision',  name: '의 정밀',    stats: { crit: 4, atk: 1 },           tierMin: 2 },
  { id: 'evasion',    name: '의 회피',    stats: { eva: 4 },                    tierMin: 2 },
  { id: 'abyss',      name: '의 심연',    stats: { atk: 5, eva: 2 },            tierMin: 3 },
  { id: 'dusk',       name: '의 황혼',    stats: { crit: 3, critDmg: 8 },       tierMin: 3 },
  { id: 'resolve',    name: '의 결의',    stats: { def: 3, res: 3, hp: 14 },    tierMin: 3 },
  { id: 'execution',  name: '의 처형',    stats: { critDmg: 16 },               tierMin: 3 },
  { id: 'silence',    name: '의 침묵',    stats: { res: 5, spd: 1 },            tierMin: 3 },
  { id: 'onslaught',  name: '의 맹공',    stats: { atk: 4, spd: 2 },            tierMin: 3 },
  { id: 'tailwind',   name: '의 순풍',    stats: { spd: 4 },                    tierMin: 3 },
  { id: 'madness',    name: '의 광기',    stats: { atk: 6, def: -2, spd: 2 },   tierMin: 4 },
  { id: 'ruin',       name: '의 파멸',    stats: { atk: 6, critDmg: 10 },       tierMin: 4 },
  { id: 'ironwall',   name: '의 철벽',    stats: { def: 6, hp: 20 },            tierMin: 4 },
  { id: 'beastking',  name: '의 야수왕',  stats: { atk: 5, hp: 30, crit: 2 },   tierMin: 4 },
  { id: 'starlight',  name: '의 별빛',    stats: { res: 4, crit: 2, spd: 1 },   tierMin: 4 },
];

// ─────────────────────────────────────────────────────────────
// 세트
//  - 여기 정의된 3종은 고유 아이템 2개짜리 소형 세트다(기존 유지).
//  - 던전 신화 세트(설계 B, 4세트 × 10슬롯)는 별도 모듈이 소유하고
//    registerItemBases()/registerItemSets() 로 이 레지스트리에 끼워 넣는다.
//  - bonus 의 키는 필요한 착용 개수, 값은 접사와 동일한 절대값 스탯.
//    풀세트 단계는 착용자가 낄 수 있는 최대 칸 수(equippableSlotCount)로 판정하므로
//    9 와 10 을 모두 정의하거나 'full' 키를 쓰는 쪽이 안전하다.
// ─────────────────────────────────────────────────────────────

export const ITEM_SETS = {
  dawn: {
    id: 'dawn', name: '여명 세트', pieces: ['sunforged_blade', 'aegis'],
    bonus: { 2: { atk: 6, def: 6, hp: 36 } }, desc: '해를 등지고 싸우는 자를 위한 한 벌.',
  },
  nightveil: {
    id: 'nightveil', name: '밤장막 세트', pieces: ['nightwhisper', 'shadowcloak'],
    bonus: { 2: { crit: 5, eva: 5, spd: 3 } }, desc: '어둠에 녹아들기 위한 한 벌.',
  },
  dragon: {
    id: 'dragon', name: '용린 세트', pieces: ['dragonplate', 'dragonscale_ring'],
    bonus: { 2: { hp: 50, atk: 6, res: 6 } }, desc: '고룡의 잔해로 만든 한 벌.',
  },
};

// ─────────────────────────────────────────────────────────────
// 조회 헬퍼
// ─────────────────────────────────────────────────────────────

const BASE_MAP = new Map();
const AFFIX_MAP = new Map();

function indexBase(b) {
  if (!b || !b.id) return;
  BASE_MAP.set(b.id, b);
  if (b.fixedAffixes) for (const a of b.fixedAffixes) AFFIX_MAP.set(a.id, a);
}
for (const b of ITEM_BASES) indexBase(b);
for (const a of PREFIXES) AFFIX_MAP.set(a.id, a);
for (const a of SUFFIXES) AFFIX_MAP.set(a.id, a);

/**
 * 외부 모듈(던전 세트 등)이 만든 베이스를 등록한다.
 * 이미 있는 id 는 덮어쓰지 않는다.
 * @param {object[]} bases
 * @returns {number} 실제로 추가된 개수
 */
export function registerItemBases(bases = []) {
  let n = 0;
  for (const b of bases) {
    if (!b || !b.id || BASE_MAP.has(b.id)) continue;
    const norm = mk(b);
    ITEM_BASES.push(norm);
    indexBase(norm);
    n++;
  }
  return n;
}

/**
 * 외부 모듈이 만든 세트 정의를 등록한다. 이미 있는 id 는 덮어쓰지 않는다.
 * @param {Record<string,object>|object[]} sets
 * @returns {number} 실제로 추가된 개수
 */
export function registerItemSets(sets = {}) {
  const list = Array.isArray(sets) ? sets : Object.values(sets);
  let n = 0;
  for (const s of list) {
    if (!s || !s.id || ITEM_SETS[s.id]) continue;
    ITEM_SETS[s.id] = s;
    n++;
  }
  return n;
}

/** id 로 베이스 조회 (없으면 null) */
export function baseById(id) {
  return BASE_MAP.get(id) || null;
}

/** id 로 접사 조회 — 접두/접미/고유 고정접사를 모두 뒤진다 (세이브 복원용) */
export function affixById(id) {
  return AFFIX_MAP.get(id) || null;
}

/**
 * 해당 슬롯에서 ilvl 에 적합한 베이스 배열.
 * 현재 티어와 바로 아래 티어(tierWindow)만 남겨 저레벨 쓰레기 베이스가
 * 고레벨 드랍에 섞이지 않게 한다. 남는 게 없으면 조건을 완화한다.
 *
 * - `ring1`/`ring2` 는 같은 'ring' 풀을 쓴다.
 * - 옛 슬롯 이름도 받는다: `armor`→body, `accessory`→neck+ring.
 * - `weaponTypes` 에 방패(왼손 계통)가 섞여 있으면 offhand 베이스도 후보에 넣는다
 *   (클래스 equip 이 ['sword','shield'] 처럼 적혀 있으므로).
 *
 * @param {string} slot SLOTS 중 하나 (또는 'ring'/'armor'/'accessory')
 * @param {number} ilvl
 * @param {{includeUnique?:boolean, weaponTypes?:string[]|null, offhandTypes?:string[]|null, tierWindow?:number}} [opts]
 */
export function basesFor(slot, ilvl = 1, opts = {}) {
  const { includeUnique = false, weaponTypes = null, offhandTypes = null, tierWindow = 1 } = opts;
  const t = tierOf(ilvl);

  const pools = basePoolsFor(slot);
  // 방패처럼 무기 슬롯이 아닌 타입이 섞여 있으면 그 슬롯 풀도 함께 본다.
  // 이렇게 끌어온 풀에서는 weaponType 이 없는 베이스(보주/횃불/문장)를 제외한다.
  const borrowed = new Set();
  if (weaponTypes && slot === 'weapon') {
    for (const wt of weaponTypes) {
      const s = WEAPON_TYPES[wt] && WEAPON_TYPES[wt].slot;
      if (s && !pools.includes(s)) { pools.push(s); borrowed.add(s); }
    }
  }
  if (!pools.length) return [];

  const typeOk = (b) => {
    if (!weaponTypes) return true;
    if (b.slot !== 'weapon' && b.slot !== 'offhand') return true;
    if (b.weaponType) return weaponTypes.includes(b.weaponType);
    return !borrowed.has(b.slot);   // 무기 타입이 없는 왼손 장비는 직접 조회할 때만 통과
  };
  const ok = (b) =>
    pools.includes(b.slot) &&
    (includeUnique || !b.unique) &&
    typeOk(b) &&
    (!offhandTypes || b.slot !== 'offhand' || !b.offhandType || offhandTypes.includes(b.offhandType));

  let all = ITEM_BASES.filter((b) => ok(b) && b.minLv <= ilvl);
  if (!all.length) {
    // 무기 타입 제한 때문에 ilvl 에 맞는 게 하나도 없을 수 있다(예: Lv1 대검).
    // 이럴 땐 minLv 제한을 풀고 가장 낮은 등장 레벨의 베이스를 돌려준다.
    const relaxed = ITEM_BASES.filter(ok);
    if (!relaxed.length) return [];
    const lo = Math.min(...relaxed.map((b) => b.minLv));
    all = relaxed.filter((b) => b.minLv === lo);
  }
  const near = all.filter((b) => tierOf(b.minLv) >= t - tierWindow);
  return near.length ? near : all;
}

/** ilvl 에 등장 가능한 고유 아이템 목록 (slot 을 주면 그 슬롯만) */
export function uniquesFor(ilvl = 1, slot = null) {
  const pools = slot ? basePoolsFor(slot) : null;
  return ITEM_BASES.filter((b) => b.unique && b.minLv <= ilvl && (!pools || pools.includes(b.slot)));
}

/** ilvl 에서 뽑을 수 있는 접두사 풀 */
export function prefixesFor(ilvl = 1) {
  const t = tierOf(ilvl);
  const pool = PREFIXES.filter((a) => a.tierMin <= t);
  return pool.length ? pool : PREFIXES.filter((a) => a.tierMin === 0);
}

/** ilvl 에서 뽑을 수 있는 접미사 풀 */
export function suffixesFor(ilvl = 1) {
  const t = tierOf(ilvl);
  const pool = SUFFIXES.filter((a) => a.tierMin <= t);
  return pool.length ? pool : SUFFIXES.filter((a) => a.tierMin === 0);
}

/** 베이스가 속한 세트 정의 (없으면 null) */
export function setOf(baseId) {
  const b = baseById(baseId);
  return b && b.setId ? ITEM_SETS[b.setId] || null : null;
}

/**
 * 착용 중인 baseId 목록으로 발동한 세트 보너스 스탯을 합산한다.
 * 반환값도 절대값이므로 scaleAffixStats() 로 ilvl 스케일해서 쓴다.
 *
 * @param {string[]} baseIds 착용 중인 베이스 id 들
 * @param {{fullAt?:number}} [opts] fullAt = "풀세트"로 볼 착용 개수
 *   (양손무기면 9, 아니면 10 — equippableSlotCount 로 구한다).
 *   bonus 에 'full' 키가 있으면 이 값 이상일 때 발동한다.
 */
export function setBonusFor(baseIds = [], opts = {}) {
  const fullAt = Number(opts.fullAt) > 0 ? Number(opts.fullAt) : SLOTS.length;
  const count = new Map();
  for (const id of baseIds) {
    const s = setOf(id);
    if (s) count.set(s.id, (count.get(s.id) || 0) + 1);
  }
  const out = {};
  for (const [setId, n] of count) {
    const def = ITEM_SETS[setId];
    if (!def || !def.bonus) continue;
    for (const need of Object.keys(def.bonus)) {
      const req = need === 'full' ? fullAt : Number(need);
      if (!(n >= req)) continue;
      for (const k in def.bonus[need]) out[k] = (out[k] || 0) + def.bonus[need][k];
    }
  }
  return out;
}

/**
 * 발동한 세트 단계 목록 (UI 표기용).
 * @returns {{set:object, count:number, steps:Array<{need:number|'full', req:number, active:boolean, stats:object}>}[]}
 */
export function setStagesFor(baseIds = [], opts = {}) {
  const fullAt = Number(opts.fullAt) > 0 ? Number(opts.fullAt) : SLOTS.length;
  const count = new Map();
  for (const id of baseIds) {
    const s = setOf(id);
    if (s) count.set(s.id, (count.get(s.id) || 0) + 1);
  }
  const out = [];
  for (const [setId, n] of count) {
    const def = ITEM_SETS[setId];
    if (!def) continue;
    const steps = Object.keys(def.bonus || {}).map((need) => {
      const req = need === 'full' ? fullAt : Number(need);
      return { need: need === 'full' ? 'full' : Number(need), req, active: n >= req, stats: def.bonus[need] };
    }).sort((a, b) => a.req - b.req);
    out.push({ set: def, count: n, steps });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 스케일 헬퍼 (gear.js 용 — ★슬롯 계수가 여기서 곱해진다)
// ─────────────────────────────────────────────────────────────

const LV_SCALE = 0.13;    // 곱연산 스탯: ilvl 당 +13% (SPEC §3.3)
const FLAT_SCALE = 0.012; // crit/critDmg/eva 는 아주 완만하게만 오른다

/**
 * 임의의 스탯 뭉치에 슬롯 계수를 곱한다 (반올림 없음 — 마지막에 한 번만 반올림하라).
 * @param {object} stats
 * @param {string} slot
 */
export function applySlotPower(stats, slot) {
  const p = slotPowerOf(slot);
  if (p === 1) return { ...stats };
  const out = {};
  for (const k in stats) out[k] = stats[k] * p;
  return out;
}

/**
 * 베이스 스탯을 슬롯 계수 · ilvl · 희귀도에 맞춰 스케일.
 * @param {object} base 베이스 아이템
 * @param {number} ilvl
 * @param {number} rarity 0~5 (5 = 신화)
 * @param {{slot?:string}} [opts] 실제로 장착될 슬롯 (ring1/ring2 처럼 베이스 슬롯과 다를 때)
 */
export function scaleBaseStats(base, ilvl = 1, rarity = 0, opts = {}) {
  const r = clamp(Math.round(rarity), 0, RARITY_MULT.length - 1);
  const lvMul = 1 + LV_SCALE * (ilvl - 1);
  const rMul = RARITY_MULT[r];
  const sMul = slotPowerOf(opts.slot || base.slot);
  const out = {};
  for (const k in base.stats) {
    const v = base.stats[k] * sMul;
    if (FLAT_STAT_KEYS.includes(k)) {
      out[k] = Math.round(v * (1 + FLAT_SCALE * (ilvl - 1)) * (1 + (rMul - 1) * 0.5) * 10) / 10;
    } else {
      const s = v * lvMul * rMul;
      out[k] = s < 0 ? Math.min(-1, Math.round(s)) : Math.round(s);
    }
  }
  return out;
}

/**
 * 접사(또는 세트 보너스) 스탯을 ilvl 에 맞춰 스케일. 희귀도 배율은 곱하지 않는다.
 * @param {object} stats
 * @param {number} ilvl
 * @param {string|null} [slot] 주면 그 슬롯 계수를 곱한다.
 *   ★ 슬롯이 10개가 되면서 접사 총량도 함께 늘었다. gear.js 는 슬롯을 넘겨라.
 *   (생략하면 계수 1.0 — 옛 호출과 결과가 같다)
 */
export function scaleAffixStats(stats, ilvl = 1, slot = null) {
  const lvMul = 1 + LV_SCALE * (ilvl - 1);
  const sMul = slot ? slotPowerOf(slot) : 1;
  const out = {};
  for (const k in stats) {
    const v = stats[k] * sMul;
    if (FLAT_STAT_KEYS.includes(k)) {
      out[k] = Math.round(v * (1 + FLAT_SCALE * (ilvl - 1)) * 10) / 10;
    } else {
      const s = v * lvMul;
      out[k] = s < 0 ? -Math.max(1, Math.round(-s)) : Math.max(1, Math.round(s));
    }
  }
  return out;
}

/** 상점가/판매가 산정용 기준 가치 (골드) */
export function itemValue(base, ilvl = 1, rarity = 0) {
  const r = clamp(Math.round(rarity), 0, RARITY_MULT.length - 1);
  // 슬롯 계수가 낮은 부위는 값도 싸다 (완전 비례는 아니라 0.55 를 바닥으로 둔다)
  const slotMul = 0.55 + 0.45 * slotPowerOf(base.slot);
  const v = 24 * (1 + 0.34 * (ilvl - 1)) * Math.pow(RARITY_MULT[r], 2.1) * slotMul * (base.unique ? 3.2 : 1);
  return Math.max(10, Math.round(v / 5) * 5);
}
