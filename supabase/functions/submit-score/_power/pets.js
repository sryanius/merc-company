/**
 * 펫 — 무한의 탑에서 얻는 부대 단위 동료
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 펫은 **부대에 3마리까지** 배치하며, 전투에서 진형 밖 고정 열에 선다.
 * 용병처럼 성장하지 않는다 — 등급(F~S)과 종(tier)이 성능을 전부 결정한다.
 *
 * ── 왜 진형 슬롯을 안 쓰나 (중요)
 * `quest.js` 의 `slotsOf()` 는 `f.slots.length === 7` 이 아니면 진형을 통째로
 * `FALLBACK_SLOTS` 로 갈아 버린다. 진형 데이터를 10칸으로 늘리는 순간
 * **플레이어가 골드로 산 진형 12개가 전부 기본 좌표·무보정이 된다** (예외도 로그도 없다).
 * 그래서 펫은 진형과 무관한 `PET_SLOTS` 고정 좌표에 세우고 `formationMods` 를 아예 안 건다.
 *
 * ── 역할 4종과 구현 방식 (역할마다 붙는 자리가 다르다)
 *   attacker  적을 때린다            → 그냥 유닛으로 세우면 끝. 엔진 수정 없음.
 *   healer    아군을 회복시킨다      → 기존 'heal' 효과 어휘를 쓰는 스킬. 엔진 수정 없음.
 *   buffer    아군 능력치를 올린다   → **UnitDef 를 만들 때 스탯에 곱한다**(전투 전).
 *                                      엔진 버프(ST_KEYS)에는 hp 가 없어 최대 체력을 못 올리는데,
 *                                      전투 전에 곱하면 maxHp 까지 올라간다.
 *   guardian  확률적으로 대신 맞는다 → **엔진에 재대상(redirect) 훅이 없어서 engine.js 를 고쳤다.**
 *                                      `applyDamage` 참고. 펫이 없으면 난수를 안 굴린다(결정론 보존).
 *
 * @module data/pets
 */

import { addSkills } from './skills.js';

/* ─────────────────────────── 펫 전용 스킬 ───────────────────────────
 * `enemies.js` 와 같은 방식으로 전역 스킬 사전에 덧붙인다.
 * ★ 주의: 엔진의 스킬 해석기는 **모르는 id 를 조용히 버린다**(빈 skillDefs → 기본공격만).
 *   즉 이 모듈을 import 하지 않은 경로에서 펫 UnitDef 를 만들면 회복 펫이 아무 것도 안 한다.
 *   펫 UnitDef 를 만드는 곳은 반드시 game/pet.js 를 거치게 하고, 그쪽이 이 모듈을 import 한다.
 */
addSkills({
  pet_mend: {
    name: '상처 핥기', cd: 7, power: 2.2, dmgType: 'none',
    target: 'ally', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [{ type: 'heal', power: 2.2 }],
    desc: '가장 다친 아군 하나를 회복시킨다.',
  },
  pet_bless: {
    name: '깃든 가호', cd: 15, power: 1.2, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [
      { type: 'heal', power: 1.2 },
      { type: 'buff', stat: 'def', amount: 0.15, dur: 10 },
    ],
    desc: '부대 전원을 조금 회복시키고 잠시 단단하게 만든다.',
  },
});

/* ─────────────────────────── 상수 ─────────────────────────── */

/** 한 부대에 배치할 수 있는 펫 수 */
export const PETS_PER_SQUAD = 3;

/** 펫 등급 — 용병과 같은 어휘를 쓴다 (merc.js GRADES) */
export const PET_GRADES = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];

/**
 * 등급 배율. 용병의 GRADE_MULT(0.78~1.55)보다 폭이 좁다 —
 * 펫은 3마리가 곱해져 들어오므로 같은 폭을 주면 상위 등급이 전투를 지배한다.
 */
export const PET_GRADE_MULT = { F: 0.80, E: 0.90, D: 1.00, C: 1.12, B: 1.26, A: 1.44, S: 1.68 };

/**
 * 종 등급(tier) 배율. tier 는 "어느 층대에서 나오는가" 이기도 하다.
 * 등급과 곱해지므로 tier5 S = 1.95 × 1.68 = 3.28 배.
 */
export const PET_TIER_MULT = [1.00, 1.18, 1.38, 1.62, 1.95];

/**
 * 펫이 서는 자리 (진형 좌표계와 같은 0~1 정규 좌표).
 * x=0.96 은 후열(0.80)보다 더 뒤 — 근접 적의 frontGroup 표적에서 벗어난다.
 * 다만 원거리 스킬의 select:'random' 은 후열도 고르므로 **안 맞는 건 아니다**.
 */
export const PET_SLOTS = [
  { x: 0.96, y: 0.20 },
  { x: 0.96, y: 0.50 },
  { x: 0.96, y: 0.80 },
];

/* ─────────────────────────── 종 정의 ───────────────────────────
 * mods 는 아키타입 대비 배율이 아니라 **절대 기준 스탯**이다.
 * 용병/적과 스탯 파이프라인을 공유하지 않는다 — 펫은 레벨이 없기 때문이다.
 * 최종 스탯 = base × PET_TIER_MULT[tier-1] × PET_GRADE_MULT[grade] (game/pet.js)
 */

const PAL = (o) => ({ skin: 'pale', cloth: 'ash', leather: 'brown', metal: 'iron', hair: 'black', ...o });

/** 스프라이트 리그가 32x40 이족 인간형 고정이라 4족·비행은 만들 수 없다.
 *  수인(늑대/도마뱀/악마 머리)과 정령(해골+로브) 계열로 표현한다. */
const sp = (o = {}) => ({
  body: 'body_slim', head: 'head_human', hair: 'hair_none', armor: 'armor_bare',
  arm: 'arm_slim', leg: 'leg_bare', ...o,
  palette: PAL(o.palette || {}),
});

/**
 * @typedef {object} PetSpecies
 * @property {string} id
 * @property {string} name
 * @property {'attacker'|'healer'|'buffer'|'guardian'} role
 * @property {number} tier 1~5
 * @property {object} base 기준 스탯
 * @property {object} ability 역할별 파라미터 (game/pet.js 가 해석)
 * @property {string[]} [skills] attacker/healer 가 쓰는 스킬 id
 */

/** @type {PetSpecies[]} */
const PET_DEFS = [
  /* ═══════════════ tier 1 — 1~100층 ═══════════════ */
  { id: 'pet_wisp', name: '불씨 정령', role: 'attacker', tier: 1,
    base: { hp: 210, atk: 26, def: 6, res: 14, spd: 44, crit: 6, critDmg: 50, eva: 8 },
    ability: {}, basicRange: 'ranged', basicFx: 'fire', basicDmgType: 'magic',
    sprite: sp({ head: 'head_skull', armor: 'armor_robe', helm: 'helm_hood', weapon: 'wpn_wand',
      palette: { skin: 'bone', cloth: 'crimson', metal: 'gold' } }),
    desc: '손바닥만 한 불덩이. 성질이 급해 먼저 튀어나간다.' },

  { id: 'pet_pup', name: '늑대 새끼', role: 'attacker', tier: 1,
    base: { hp: 260, atk: 24, def: 10, res: 6, spd: 48, crit: 10, critDmg: 55, eva: 10 },
    ability: {}, basicRange: 'melee', basicFx: 'slash', basicDmgType: 'phys',
    sprite: sp({ head: 'head_wolf', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'ash', hair: 'white' } }),
    desc: '아직 무리를 못 이룬다. 그래도 이빨은 진짜다.' },

  { id: 'pet_moss', name: '이끼 요정', role: 'healer', tier: 1,
    base: { hp: 230, atk: 18, def: 8, res: 18, spd: 40, crit: 0, critDmg: 50, eva: 6 },
    ability: { healPower: 0.85 }, skills: ['pet_mend'],
    basicRange: 'ranged', basicFx: 'holy', basicDmgType: 'magic',
    sprite: sp({ head: 'head_elf', hair: 'hair_long', armor: 'armor_cloth', weapon: 'wpn_staff',
      palette: { skin: 'pale', cloth: 'forest', hair: 'green' } }),
    desc: '상처에 이끼를 덮어 준다. 흉은 지지만 피는 멎는다.' },

  { id: 'pet_shell', name: '돌껍질 두꺼비', role: 'guardian', tier: 1,
    base: { hp: 420, atk: 12, def: 26, res: 16, spd: 30, crit: 0, critDmg: 50, eva: 0 },
    ability: { guardChance: 0.14, guardCut: 0.20 },
    basicRange: 'melee', basicFx: 'blunt', basicDmgType: 'phys',
    sprite: sp({ body: 'body_heavy', head: 'head_lizard', armor: 'armor_bone', arm: 'arm_heavy',
      palette: { skin: 'green', leather: 'dark' } }),
    desc: '느리지만 앞에 선다. 등껍질이 방패보다 두껍다.' },

  /* ═══════════════ tier 2 — 100~200층 ═══════════════ */
  { id: 'pet_imp', name: '작은 마귀', role: 'attacker', tier: 2,
    base: { hp: 250, atk: 34, def: 8, res: 18, spd: 52, crit: 12, critDmg: 60, eva: 12 },
    ability: {}, basicRange: 'ranged', basicFx: 'shadow', basicDmgType: 'magic',
    sprite: sp({ head: 'head_demon', armor: 'armor_cloth', cape: 'cape_wing', weapon: 'wpn_dagger',
      palette: { skin: 'red', cloth: 'night', metal: 'bronze' } }),
    desc: '남의 불행을 즐긴다. 그 취향이 아군일 때는 쓸모가 있다.' },

  { id: 'pet_lantern', name: '등불 지기', role: 'buffer', tier: 2,
    base: { hp: 270, atk: 16, def: 12, res: 22, spd: 38, crit: 0, critDmg: 50, eva: 6 },
    ability: { buff: { atk: 0.05, crit: 0.03 } },
    basicRange: 'ranged', basicFx: 'holy', basicDmgType: 'magic',
    sprite: sp({ head: 'head_human', hair: 'hair_short', armor: 'armor_cloth', offhand: 'shd_torch',
      palette: { cloth: 'sand', metal: 'gold' } }),
    desc: '앞을 밝혀 준다. 밝으면 칼도 잘 든다.' },

  { id: 'pet_kite', name: '바위 방패솔개', role: 'guardian', tier: 2,
    base: { hp: 520, atk: 16, def: 32, res: 22, spd: 34, crit: 0, critDmg: 50, eva: 4 },
    ability: { guardChance: 0.18, guardCut: 0.25 },
    basicRange: 'melee', basicFx: 'blunt', basicDmgType: 'phys',
    sprite: sp({ body: 'body_heavy', head: 'head_orc', armor: 'armor_mail', offhand: 'shd_kite', arm: 'arm_heavy',
      palette: { skin: 'green', metal: 'iron' } }),
    desc: '날개를 펴 앞을 가린다. 그게 이 새의 사냥법이다.' },

  /* ═══════════════ tier 3 — 200~320층 ═══════════════ */
  { id: 'pet_saint', name: '작은 성물', role: 'healer', tier: 3,
    base: { hp: 340, atk: 26, def: 14, res: 30, spd: 44, crit: 0, critDmg: 50, eva: 8 },
    ability: { healPower: 1.15 }, skills: ['pet_mend', 'pet_bless'],
    basicRange: 'ranged', basicFx: 'holy', basicDmgType: 'magic',
    sprite: sp({ head: 'head_skull', helm: 'helm_circlet', armor: 'armor_robe', offhand: 'shd_orb',
      palette: { skin: 'bone', cloth: 'ivory', metal: 'gold' } }),
    desc: '누가 모셨는지는 잊혔다. 손길만 남았다.' },

  { id: 'pet_fang', name: '서리 이빨', role: 'attacker', tier: 3,
    base: { hp: 360, atk: 46, def: 16, res: 14, spd: 56, crit: 16, critDmg: 65, eva: 14 },
    ability: {}, basicRange: 'melee', basicFx: 'bolt', basicDmgType: 'magic',
    sprite: sp({ head: 'head_wolf', armor: 'armor_leather', weapon: 'wpn_claw', cape: 'cape_short',
      palette: { skin: 'pale', hair: 'white', cloth: 'azure' } }),
    desc: '숨을 뱉으면 서리가 앉는다. 물리면 더 춥다.' },

  { id: 'pet_banner', name: '전열 군기', role: 'buffer', tier: 3,
    base: { hp: 380, atk: 20, def: 20, res: 26, spd: 40, crit: 0, critDmg: 50, eva: 4 },
    ability: { buff: { atk: 0.08, def: 0.06, res: 0.06 } },
    basicRange: 'melee', basicFx: 'slash', basicDmgType: 'phys',
    sprite: sp({ head: 'head_human', helm: 'helm_plume', armor: 'armor_mail', weapon: 'wpn_spear', cape: 'cape_long',
      palette: { cloth: 'crimson', metal: 'steel' } }),
    desc: '깃발이 서 있는 한 줄은 무너지지 않는다.' },

  /* ═══════════════ tier 4 — 320~430층 ═══════════════ */
  { id: 'pet_aegis', name: '무쇠 수호령', role: 'guardian', tier: 4,
    base: { hp: 820, atk: 26, def: 48, res: 38, spd: 36, crit: 0, critDmg: 50, eva: 2 },
    ability: { guardChance: 0.24, guardCut: 0.32 },
    basicRange: 'melee', basicFx: 'blunt', basicDmgType: 'phys',
    sprite: sp({ body: 'body_hulk', head: 'head_skull', helm: 'helm_great', armor: 'armor_plate',
      offhand: 'shd_tower', arm: 'arm_heavy', leg: 'leg_plate',
      palette: { skin: 'bone', metal: 'steel' } }),
    desc: '주인이 죽는 꼴을 두 번은 못 본다.' },

  { id: 'pet_ember', name: '잿불 사냥개', role: 'attacker', tier: 4,
    base: { hp: 480, atk: 64, def: 22, res: 22, spd: 60, crit: 20, critDmg: 70, eva: 16 },
    ability: {}, basicRange: 'melee', basicFx: 'fire', basicDmgType: 'magic',
    sprite: sp({ body: 'body_normal', head: 'head_wolf', armor: 'armor_bone', weapon: 'wpn_claw',
      palette: { skin: 'red', hair: 'red', leather: 'dark' } }),
    desc: '타 죽고도 사냥을 멈추지 않았다.' },

  { id: 'pet_chalice', name: '피의 성배', role: 'healer', tier: 4,
    base: { hp: 520, atk: 40, def: 20, res: 40, spd: 46, crit: 0, critDmg: 50, eva: 8 },
    ability: { healPower: 1.55 }, skills: ['pet_mend', 'pet_bless'],
    basicRange: 'ranged', basicFx: 'shadow', basicDmgType: 'magic',
    sprite: sp({ head: 'head_demon', helm: 'helm_hood', armor: 'armor_robe', offhand: 'shd_orb',
      palette: { skin: 'red', cloth: 'night', metal: 'gold' } }),
    desc: '채운 만큼 돌려준다. 무엇으로 채웠는지는 묻지 않는 편이 좋다.' },

  /* ═══════════════ tier 5 — 430~500층 ═══════════════ */
  { id: 'pet_starcalf', name: '별을 문 짐승', role: 'buffer', tier: 5,
    base: { hp: 700, atk: 34, def: 32, res: 46, spd: 44, crit: 0, critDmg: 50, eva: 6 },
    ability: { buff: { atk: 0.12, def: 0.09, res: 0.09, spd: 0.05 } },
    basicRange: 'ranged', basicFx: 'holy', basicDmgType: 'magic',
    sprite: sp({ body: 'body_normal', head: 'head_lizard', helm: 'helm_crown', armor: 'armor_robe',
      cape: 'cape_long', offhand: 'shd_orb',
      palette: { skin: 'grey', cloth: 'night', metal: 'gold' } }),
    desc: '입에 문 별빛이 부대 전체에 내린다.' },

  { id: 'pet_warden', name: '탑의 파수령', role: 'guardian', tier: 5,
    base: { hp: 1180, atk: 40, def: 66, res: 54, spd: 38, crit: 0, critDmg: 50, eva: 2 },
    ability: { guardChance: 0.30, guardCut: 0.40 },
    basicRange: 'melee', basicFx: 'blunt', basicDmgType: 'phys',
    sprite: sp({ body: 'body_hulk', head: 'head_demon', helm: 'helm_horned', armor: 'armor_heavy',
      offhand: 'shd_tower', arm: 'arm_heavy', leg: 'leg_plate', cape: 'cape_tattered',
      palette: { skin: 'dark', metal: 'dark' } }),
    desc: '탑을 지키던 것이 이제 네 뒤에 선다.' },

  { id: 'pet_eclipse', name: '월식의 검귀', role: 'attacker', tier: 5,
    base: { hp: 660, atk: 92, def: 30, res: 30, spd: 64, crit: 24, critDmg: 80, eva: 18 },
    ability: {}, basicRange: 'melee', basicFx: 'shadow', basicDmgType: 'phys',
    sprite: sp({ body: 'body_normal', head: 'head_skull', helm: 'helm_mask', armor: 'armor_leather',
      weapon: 'wpn_katana', cape: 'cape_tattered',
      palette: { skin: 'bone', cloth: 'night', metal: 'dark' } }),
    desc: '달이 가려진 밤에만 칼을 뽑았다고 한다.' },
];

/* ─────────────────────────── 조회 ─────────────────────────── */

/* ── 통짜 전투 시트(battleSheet) 배정 ─────────────────────────────────
 *
 * ★★ 펫 16종이 **전부 사람 몸**이었다. 조립은 «사람 골격 + 갈아끼우는 머리·무기» 라
 *   늑대 새끼도 두꺼비도 정령도 사람 형상으로 나왔다 (HANDOFF §62 의 적과 같은 원인,
 *   다만 펫은 예외 없이 전부 해당됐다). 게다가 용병과 **같은 키**로 서서 동반자로 안 읽혔다.
 *
 * 통짜 그림은 크기까지 그림이 정한다 — 펫 시트는 키 40~62px 로 그려 용병의 절반쯤이 된다.
 * 팔레트가 색을 정하므로 한 장이 여러 마리를 덮는다.
 *
 * 시트 열 장이 다 없으면 spritegen 의 sheetOf 가 조용히 조립으로 물러난다 (안전망).
 */
const PET_SHEET = {
  bt_pbeast: ['pet_pup', 'pet_fang', 'pet_ember', 'pet_starcalf'],
  bt_pwisp: ['pet_wisp', 'pet_moss', 'pet_lantern'],
  bt_prelic: ['pet_saint', 'pet_banner', 'pet_chalice'],
  bt_ptoad: ['pet_shell'],
  bt_pimp: ['pet_imp'],
  bt_pbird: ['pet_kite'],
  bt_pward: ['pet_aegis', 'pet_warden'],
  bt_psword: ['pet_eclipse'],
};
for (const [sheet, ids] of Object.entries(PET_SHEET)) {
  for (const id of ids) {
    const pet = PET_DEFS.find((p) => p.id === id);
    if (pet && pet.sprite) pet.sprite.battleSheet = sheet;
  }
}

const BY_ID = new Map(PET_DEFS.map((p) => [p.id, p]));

/** 전체 펫 종 목록 (읽기 전용으로 다뤄라) */
export const PETS = PET_DEFS;

/** @returns {PetSpecies|null} */
export function getPetSpecies(id) {
  return BY_ID.get(id) || null;
}

/** 특정 tier 의 펫 종 목록 */
export function petsOfTier(tier) {
  return PET_DEFS.filter((p) => p.tier === tier);
}

/** 역할 한국어 이름 */
export const ROLE_NAME = {
  attacker: '공격',
  healer: '회복',
  buffer: '지휘',
  guardian: '수호',
};

/** 역할 설명 — UI 툴팁용 */
export const ROLE_DESC = {
  attacker: '적을 직접 공격한다.',
  healer: '전투 중 아군을 회복시킨다.',
  buffer: '전투 시작 전부터 부대 전체의 능력치를 올린다.',
  guardian: '아군이 맞을 피해를 확률적으로 대신 받는다.',
};
