// 클래스 트리 (SPEC §2.2 / §3.2). 순수 데이터 — DOM/Canvas 참조 금지.
// 1차 7종 → 2차 14종 → 3차 28종 → 4차 56종 = 총 105종.
// 4차 56종은 classes_t4.js 가 소유하고 여기서 병합한다. 3차의 next(4차 2종)는 여기서 채운다.
import { T4_CLASSES } from './classes_t4.js';

/**
 * 전투 길이 조절 노브.
 *
 * 이 게임은 전투를 "관전"시키는 게 핵심이므로 전투가 너무 빨리 끝나면 안 된다.
 * spd(행동 주기)를 낮추면 유닛이 굼떠 보이므로, HP만 올려 유닛당 필요한 타격 횟수를 늘린다.
 * 아군과 적이 같은 아키타입 표를 공유하므로 이 값을 바꿔도 승률은 거의 그대로 유지되고
 * 전투 지속 시간만 비례해서 늘어난다.
 *
 * 1.0 → Lv45 미러전 약 10초 (관전할 게 없다)
 * 2.6 → Lv45 미러전 약 25초 (목표)
 */
export const HP_SCALE = 2.6;

const hp = (v) => Math.round(v * HP_SCALE);

/** 아키타입 기준 스탯 (SPEC §2.2). 여기에 클래스 mods 가 곱해진다. */
export const ARCHETYPES = {
  tank:    { hp: hp(340), atk: 22, def: 31, res: 16, spd: 38, crit: 3,  critDmg: 50, eva: 2 },
  fighter: { hp: hp(245), atk: 34, def: 18, res: 10, spd: 48, crit: 8,  critDmg: 50, eva: 5 },
  lancer:  { hp: hp(255), atk: 32, def: 20, res: 11, spd: 45, crit: 6,  critDmg: 50, eva: 4 },
  archer:  { hp: hp(185), atk: 36, def: 11, res: 10, spd: 53, crit: 12, critDmg: 55, eva: 8 },
  rogue:   { hp: hp(180), atk: 33, def: 10, res: 9,  spd: 66, crit: 20, critDmg: 65, eva: 14 },
  mage:    { hp: hp(168), atk: 41, def: 8,  res: 21, spd: 42, crit: 8,  critDmg: 50, eva: 4 },
  healer:  { hp: hp(200), atk: 24, def: 13, res: 23, spd: 46, crit: 5,  critDmg: 50, eva: 5 },
};

/** 팔레트 레시피 (art/palette.js makePalette 인자). 순서: 피부/머리/금속/천/가죽/강조/마력광 */
const pal = (skin, hair, metal, cloth, leather, accent, glow = 'none') =>
  ({ skin, hair, metal, cloth, leather, accent, glow });

/** 스프라이트 레시피. 파츠 이름은 SPEC §4.4 어휘만 사용한다. */
const sp = (body, head, hair, helm, armor, cape, weapon, offhand, palette) =>
  ({ body, head, hair, helm, armor, cape, weapon, offhand, palette });

/** @type {Record<string, object>} */
const RAW = {
  // ═══════════════════════════════════════════════ 1차 (7종) — 주점 고용 가능
  swordsman: {
    name: '검사', tier: 1, arch: 'fighter', mods: { atk: 1.05, hp: 0.98 },
    role: '근접 딜러', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['sword', 'shield'], skills: ['slash'], next: ['berserker', 'swordmaster'],
    // 검사 계열 = 진홍(crimson). 1차는 얼굴이 보이는 코가리개 투구 + 짧은 붉은 망토.
    sprite: sp('body_normal', 'head_human', 'hair_short', 'helm_iron', 'armor_mail', 'cape_short', 'wpn_sword', 'shd_buckler',
      pal('pale', 'brown', 'iron', 'crimson', 'brown', 'bronze')),
    desc: '어느 전장에나 한둘은 있는, 균형 잡힌 검술 용병.',
  },
  spearman: {
    name: '창병', tier: 1, arch: 'lancer', mods: { atk: 1.03, def: 1.02 },
    role: '관통 근접', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'pierce',
    equip: ['spear', 'shield'], skills: ['thrust'], next: ['dragoon', 'halberdier'],
    // 창병 계열 = 황토(sand). 라운드 실드가 천 색을 크게 드러내 계열색을 읽히게 한다.
    sprite: sp('body_normal', 'head_human', 'hair_short', 'helm_iron', 'armor_leather', 'cape_none', 'wpn_spear', 'shd_round',
      pal('tan', 'black', 'iron', 'sand', 'brown', 'bronze')),
    desc: '긴 창으로 줄지어 선 적을 한 번에 꿰뚫는 보병.',
  },
  shieldman: {
    name: '방패병', tier: 1, arch: 'tank', mods: { def: 1.06, hp: 1.03, atk: 0.94 },
    role: '방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['mace', 'sword', 'shield'], skills: ['shield_bash'], next: ['knight', 'guardian'],
    // 방패병 계열 = 청(azure). 1차인데 통짜 투구(helm_great)를 쓰면 뒷모습처럼 보여
    // 얼굴이 트인 helm_iron 으로 바꿨다. 대신 큰 카이트 실드가 계열색을 넓게 보여 준다.
    sprite: sp('body_heavy', 'head_human', 'hair_short', 'helm_iron', 'armor_mail', 'cape_none', 'wpn_mace', 'shd_kite',
      pal('pale', 'black', 'iron', 'azure', 'dark', 'steel')),
    desc: '앞줄에서 버티는 것이 전부이자 전문인 사내.',
  },
  archer: {
    name: '궁수', tier: 1, arch: 'archer', mods: { atk: 1.04, hp: 0.97 },
    role: '원거리 딜러', dmgType: 'phys', range: 'ranged', rank: 2, basicFx: 'arrow',
    equip: ['bow', 'dagger'], skills: ['aimed_shot'], next: ['sniper', 'hunter'],
    // 궁수 계열 = 숲색(forest). 후드를 벗겨 얼굴과 금발 말총머리가 보이게 했다.
    sprite: sp('body_slim', 'head_human', 'hair_pony', 'helm_none', 'armor_leather', 'cape_short', 'wpn_bow', 'shd_none',
      pal('tan', 'blond', 'bronze', 'forest', 'tan', 'forest')),
    desc: '후열에서 조용히 적의 숫자를 줄여 나간다.',
  },
  rogue: {
    name: '도적', tier: 1, arch: 'rogue', mods: { spd: 1.04, atk: 1.02 },
    role: '후열 침투', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['dagger', 'sword'], skills: ['backstab'], next: ['assassin', 'outlaw'],
    // 도적 계열 = 야흑(night). 후드는 앞이 트여 있어 얼굴 방향이 읽힌다.
    sprite: sp('body_slim', 'head_human', 'hair_short', 'helm_hood', 'armor_leather', 'cape_short', 'wpn_dagger', 'shd_dagger',
      pal('pale', 'black', 'dark', 'night', 'dark', 'steel')),
    desc: '정면 승부를 경멸하고 언제나 등 뒤를 노린다.',
  },
  apprentice: {
    name: '견습마법사', tier: 1, arch: 'mage', mods: { atk: 1.02, hp: 0.98 },
    role: '마법 딜러', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'bolt',
    equip: ['staff', 'wand'], skills: ['magic_bolt'], next: ['elementalist', 'necromancer'],
    // 마법사 계열 = 자주(violet). 1차는 모자 없이 로브만 걸친 맨머리.
    sprite: sp('body_slim', 'head_human', 'hair_long', 'helm_none', 'armor_robe', 'cape_none', 'wpn_staff', 'shd_none',
      pal('pale', 'blue', 'bronze', 'violet', 'brown', 'silver', 'arcane')),
    desc: '탑에서 쫓겨났거나, 학비가 모자란 어린 술사.',
  },
  acolyte: {
    name: '수도사', tier: 1, arch: 'healer', mods: { res: 1.05, hp: 1.02 },
    role: '치유 지원', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'holy',
    equip: ['mace', 'staff'], skills: ['mend'], next: ['priest', 'monk'],
    // 수도사 계열 = 상아(ivory). 천 옷 전체가 계열색이라 멀리서도 흰 옷으로 읽힌다.
    sprite: sp('body_normal', 'head_human', 'hair_short', 'helm_hood', 'armor_cloth', 'cape_none', 'wpn_mace', 'shd_none',
      pal('pale', 'brown', 'bronze', 'ivory', 'tan', 'gold', 'holy')),
    desc: '전장을 순례지로 삼아 상처를 어루만지는 수행자.',
  },

  // ═══════════════════════════════════════════════ 2차 (14종)
  berserker: {
    name: '광전사', tier: 2, arch: 'fighter', mods: { atk: 1.24, hp: 1.06, def: 0.82, res: 0.9, crit: 1.3 },
    role: '광폭 딜러', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['greatsword', 'axe'], skills: ['slash', 'frenzy'], next: ['madgeneral', 'bloodfiend'],
    sprite: sp('body_hulk', 'head_human', 'hair_mohawk', 'helm_none', 'armor_bare', 'cape_tattered', 'wpn_greataxe', 'shd_none',
      pal('tan', 'red', 'blood', 'crimson', 'dark', 'blood', 'blood')),
    desc: '갑옷을 벗어던진 대신 두 배로 휘두른다.',
  },
  swordmaster: {
    name: '검성', tier: 2, arch: 'fighter', mods: { atk: 1.14, spd: 1.1, crit: 1.5, eva: 1.4, hp: 0.96 },
    role: '정예 검사', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['katana', 'sword'], skills: ['slash', 'crescent_slash'], next: ['swordgod', 'skysplitter'],
    sprite: sp('body_normal', 'head_human', 'hair_long', 'helm_circlet', 'armor_leather', 'cape_long', 'wpn_katana', 'shd_none',
      pal('pale', 'white', 'steel', 'crimson', 'dark', 'silver')),
    desc: '검 하나를 평생 갈아 온 자의 정갈한 살의.',
  },
  dragoon: {
    name: '창기병', tier: 2, arch: 'lancer', mods: { atk: 1.16, spd: 1.08, def: 1.02, hp: 1.02 },
    role: '돌격병', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'pierce',
    equip: ['spear', 'shield'], skills: ['thrust', 'charge_lance'], next: ['dragoonlord', 'skylancer'],
    sprite: sp('body_normal', 'head_human', 'hair_short', 'helm_plume', 'armor_plate', 'cape_short', 'wpn_pike', 'shd_round',
      pal('pale', 'blond', 'steel', 'sand', 'brown', 'gold')),
    desc: '말은 잃었어도 돌격 습관만은 남은 기병.',
  },
  halberdier: {
    name: '미늘창병', tier: 2, arch: 'lancer', mods: { atk: 1.06, def: 1.14, hp: 1.08, spd: 0.94 },
    role: '전열 통제', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['spear', 'scythe'], skills: ['thrust', 'sweep'], next: ['gatewarden', 'reaper'],
    sprite: sp('body_heavy', 'head_human', 'hair_beard', 'helm_iron', 'armor_mail', 'cape_short', 'wpn_halberd', 'shd_none',
      pal('tan', 'black', 'iron', 'sand', 'brown', 'bronze')),
    desc: '찌르고 베고 걸어 넘긴다. 미늘창 하나로 전부.',
  },
  knight: {
    name: '중갑기사', tier: 2, arch: 'tank', mods: { def: 1.14, hp: 1.1, atk: 1.02, spd: 0.94 },
    role: '중장 탱커', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['sword', 'mace', 'shield'], skills: ['shield_bash', 'bulwark_stance'], next: ['paladin', 'blackknight'],
    // 1차(방패병)에서 통짜 투구로 올라가는 지점. 여기부터가 진짜 중장갑이다.
    sprite: sp('body_heavy', 'head_human', 'hair_short', 'helm_great', 'armor_plate', 'cape_long', 'wpn_sword', 'shd_kite',
      pal('pale', 'brown', 'steel', 'azure', 'dark', 'silver')),
    desc: '작위는 팔아먹었지만 갑주와 긍지는 남겨 두었다.',
  },
  guardian: {
    name: '수호기사', tier: 2, arch: 'tank', mods: { def: 1.1, res: 1.2, hp: 1.12, atk: 0.9 },
    role: '보호 지원', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['mace', 'shield'], skills: ['shield_bash', 'aegis'], next: ['bulwark', 'oathshield'],
    sprite: sp('body_heavy', 'head_human', 'hair_short', 'helm_iron', 'armor_heavy', 'cape_short', 'wpn_mace', 'shd_tower',
      pal('tan', 'brown', 'steel', 'azure', 'dark', 'bronze')),
    desc: '제 몸보다 뒷줄의 동료를 먼저 세는 방패.',
  },
  sniper: {
    name: '저격수', tier: 2, arch: 'archer', mods: { atk: 1.16, crit: 1.4, spd: 0.96, hp: 0.94 },
    role: '후열 저격', dmgType: 'phys', range: 'ranged', rank: 2, basicFx: 'arrow',
    equip: ['bow', 'crossbow'], skills: ['aimed_shot', 'snipe'], next: ['masterarcher', 'shadowarcher'],
    sprite: sp('body_slim', 'head_human', 'hair_pony', 'helm_hood', 'armor_leather', 'cape_short', 'wpn_longbow', 'shd_none',
      pal('tan', 'brown', 'steel', 'forest', 'tan', 'bronze')),
    desc: '적장의 목값만으로 먹고사는 조용한 사수.',
  },
  hunter: {
    name: '사냥꾼', tier: 2, arch: 'archer', mods: { atk: 1.08, spd: 1.08, hp: 1.06, eva: 1.2 },
    role: '약화 사수', dmgType: 'phys', range: 'ranged', rank: 2, basicFx: 'arrow',
    equip: ['crossbow', 'bow', 'dagger'], skills: ['aimed_shot', 'hunters_mark'], next: ['beastlord', 'spiritranger'],
    sprite: sp('body_normal', 'head_human', 'hair_short', 'helm_none', 'armor_leather', 'cape_tattered', 'wpn_crossbow', 'shd_dagger',
      pal('tan', 'green', 'bronze', 'forest', 'green', 'forest')),
    desc: '짐승을 쫓던 눈으로 사람을 쫓게 된 자.',
  },
  assassin: {
    name: '암살자', tier: 2, arch: 'rogue', mods: { atk: 1.14, crit: 1.3, spd: 1.1, hp: 0.92 },
    role: '처형자', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['dagger', 'claw'], skills: ['backstab', 'assassinate'], next: ['shadowblade', 'venomfang'],
    // 경장 클래스라 얼굴을 통째로 덮는 가면 대신 앞이 트인 후드를 쓴다.
    sprite: sp('body_slim', 'head_human', 'hair_none', 'helm_hood', 'armor_leather', 'cape_short', 'wpn_twindagger', 'shd_none',
      pal('pale', 'black', 'dark', 'night', 'dark', 'violet', 'shadow')),
    desc: '이름도 얼굴도 없이 계약서 한 장으로만 존재한다.',
  },
  outlaw: {
    name: '무법자', tier: 2, arch: 'rogue', mods: { atk: 1.12, hp: 1.1, def: 1.15, crit: 1.1 },
    role: '난전 딜러', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['axe', 'dagger'], skills: ['backstab', 'cheap_shot'], next: ['banditking', 'bladedancer'],
    sprite: sp('body_normal', 'head_human', 'hair_mohawk', 'helm_none', 'armor_leather', 'cape_tattered', 'wpn_axe', 'shd_dagger',
      pal('tan', 'red', 'iron', 'night', 'brown', 'bronze')),
    desc: '현상금이 붙은 채로 현상금을 받으러 다닌다.',
  },
  elementalist: {
    name: '원소술사', tier: 2, arch: 'mage', mods: { atk: 1.16, res: 1.1, hp: 0.96 },
    role: '광역 마법', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'fire',
    equip: ['staff', 'wand', 'tome'], skills: ['magic_bolt', 'fireball'], next: ['archmage', 'stormcaller'],
    sprite: sp('body_slim', 'head_human', 'hair_long', 'helm_wizard', 'armor_robe', 'cape_short', 'wpn_staff', 'shd_orb',
      pal('pale', 'red', 'gold', 'violet', 'brown', 'ember', 'fire')),
    desc: '불과 바람을 다루되 아직 제 손끝은 자주 그을린다.',
  },
  necromancer: {
    name: '강령술사', tier: 2, arch: 'mage', mods: { atk: 1.08, hp: 1.12, res: 1.14, spd: 0.96 },
    role: '흡혈 마법', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'shadow',
    equip: ['wand', 'tome', 'scythe'], skills: ['magic_bolt', 'life_drain'], next: ['lichlord', 'plaguelord'],
    sprite: sp('body_slim', 'head_human', 'hair_long', 'helm_hood', 'armor_robe', 'cape_tattered', 'wpn_wand', 'shd_orb',
      pal('ash', 'black', 'bone', 'violet', 'dark', 'bone', 'shadow')),
    desc: '죽은 자의 온기를 빌려 제 목숨을 늘려 쓴다.',
  },
  priest: {
    name: '사제', tier: 2, arch: 'healer', mods: { res: 1.12, hp: 1.06, atk: 1.06 },
    role: '전담 치유사', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'holy',
    equip: ['staff', 'mace', 'tome'], skills: ['mend', 'heal_light'], next: ['highpriest', 'inquisitor'],
    sprite: sp('body_normal', 'head_human', 'hair_long', 'helm_circlet', 'armor_robe', 'cape_short', 'wpn_staff', 'shd_torch',
      pal('pale', 'blond', 'gold', 'ivory', 'tan', 'gold', 'holy')),
    desc: '기도값을 은화로 받는 데 익숙해진 성직자.',
  },
  monk: {
    name: '수도승', tier: 2, arch: 'fighter', mods: { atk: 1.12, spd: 1.14, def: 1.1, hp: 1.04, eva: 1.3 },
    role: '격투 근접', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['claw', 'mace'], skills: ['mend', 'palm_strike'], next: ['arhat', 'fallenmonk'],
    sprite: sp('body_normal', 'head_human', 'hair_bald', 'helm_none', 'armor_cloth', 'cape_none', 'wpn_claw', 'shd_none',
      pal('tan', 'black', 'bronze', 'ivory', 'tan', 'ember', 'holy')),
    desc: '기도 대신 주먹으로 수행을 이어 가기로 했다.',
  },

  // ═══════════════════════════════════════════════ 3차 (28종)
  // ── 검사 계열
  madgeneral: {
    name: '광기의 대장군', tier: 3, arch: 'fighter', mods: { atk: 1.34, hp: 1.18, def: 0.88, crit: 1.3, spd: 1.05 },
    role: '광역 지휘관', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['axe', 'greatsword'], skills: ['war_cry', 'mad_cleave'], next: ['madgeneral_apex', 'madgeneral_abyss'],
    sprite: sp('body_hulk', 'head_human', 'hair_mohawk', 'helm_horned', 'armor_heavy', 'cape_tattered', 'wpn_greataxe', 'shd_none',
      pal('red', 'red', 'blood', 'crimson', 'dark', 'blood', 'blood')),
    desc: '부하를 미치게 만드는 포효로 전장을 통째로 갈아엎는다.',
  },
  bloodfiend: {
    name: '혈귀검사', tier: 3, arch: 'fighter', mods: { atk: 1.3, spd: 1.16, crit: 1.5, hp: 0.94, def: 0.86, eva: 1.3 },
    role: '흡혈 딜러', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['katana', 'claw'], skills: ['blood_reave', 'crimson_pact'], next: ['bloodfiend_apex', 'bloodfiend_abyss'],
    sprite: sp('body_normal', 'head_demon', 'hair_long', 'helm_none', 'armor_leather', 'cape_wing', 'wpn_katana', 'shd_dagger',
      pal('ash', 'white', 'blood', 'crimson', 'dark', 'blood', 'blood')),
    desc: '베어야만 살고, 살기 위해 또 벤다.',
  },
  swordgod: {
    name: '검신', tier: 3, arch: 'fighter', mods: { atk: 1.28, spd: 1.14, crit: 1.7, critDmg: 1.2 },
    role: '단일 처형', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['katana', 'sword'], skills: ['divine_blade', 'thousand_cuts'], next: ['swordgod_apex', 'swordgod_abyss'],
    sprite: sp('body_normal', 'head_human', 'hair_long', 'helm_crown', 'armor_plate', 'cape_long', 'wpn_katana', 'shd_none',
      pal('pale', 'white', 'silver', 'crimson', 'tan', 'gold', 'holy')),
    desc: '검이 곧 신앙이 된 자리. 한 합이면 충분하다.',
  },
  skysplitter: {
    name: '파천검호', tier: 3, arch: 'fighter', mods: { atk: 1.32, def: 1.05, hp: 1.05, crit: 1.3, spd: 1.02 },
    role: '광역 반격', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['greatsword', 'katana'], skills: ['sky_cleave', 'counter_stance'], next: ['skysplitter_apex', 'skysplitter_abyss'],
    sprite: sp('body_normal', 'head_human', 'hair_pony', 'helm_plume', 'armor_mail', 'cape_long', 'wpn_greatsword', 'shd_none',
      pal('tan', 'black', 'steel', 'crimson', 'dark', 'silver', 'frost')),
    desc: '휘두른 자리에 하늘이 갈라진 금이 남는다.',
  },
  // ── 창병 계열
  dragoonlord: {
    name: '용기병 대장', tier: 3, arch: 'lancer', mods: { atk: 1.26, def: 1.14, hp: 1.14, spd: 1.04 },
    role: '돌격 지휘관', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'pierce',
    equip: ['spear', 'shield'], skills: ['dragon_charge', 'banner_of_valor'], next: ['dragoonlord_apex', 'dragoonlord_abyss'],
    sprite: sp('body_heavy', 'head_human', 'hair_short', 'helm_plume', 'armor_plate', 'cape_long', 'wpn_pike', 'shd_kite',
      pal('pale', 'blond', 'gold', 'sand', 'brown', 'gold', 'fire')),
    desc: '깃발을 앞세워 부대 전체를 돌격으로 끌고 간다.',
  },
  skylancer: {
    name: '천공창기사', tier: 3, arch: 'lancer', mods: { atk: 1.24, spd: 1.2, eva: 1.5, res: 1.2, hp: 0.98 },
    role: '뇌격 창기사', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'pierce',
    equip: ['spear', 'wand'], skills: ['heaven_pierce', 'sky_fall'], next: ['skylancer_apex', 'skylancer_abyss'],
    sprite: sp('body_normal', 'head_elf', 'hair_long', 'helm_circlet', 'armor_plate', 'cape_wing', 'wpn_spear', 'shd_buckler',
      pal('pale', 'blue', 'silver', 'sand', 'tan', 'silver', 'arcane')),
    desc: '창끝에 벼락을 얹고 하늘에서 내려꽂는다.',
  },
  gatewarden: {
    name: '관문수호자', tier: 3, arch: 'tank', mods: { def: 1.3, hp: 1.26, spd: 0.9 },
    role: '전열 봉쇄', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['spear', 'shield'], skills: ['iron_gate', 'warden_smash'], next: ['gatewarden_abyss', 'gatewarden_apex'],
    // 통짜 투구를 쓰는 몇 안 되는 클래스. 얼굴을 지운 것 자체가 "관문" 컨셉이다.
    sprite: sp('body_hulk', 'head_human', 'hair_none', 'helm_great', 'armor_heavy', 'cape_short', 'wpn_halberd', 'shd_tower',
      pal('tan', 'brown', 'steel', 'sand', 'dark', 'bronze')),
    desc: '이 자가 선 자리는 관문이 되어 아무도 지나지 못한다.',
  },
  reaper: {
    name: '사신낫병', tier: 3, arch: 'lancer', mods: { atk: 1.32, crit: 1.4, spd: 1.08, hp: 0.94, def: 0.9 },
    role: '처형 광역', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['scythe', 'spear'], skills: ['soul_reap', 'death_scythe'], next: ['reaper_apex', 'reaper_abyss'],
    sprite: sp('body_slim', 'head_skull', 'hair_none', 'helm_hood', 'armor_bone', 'cape_tattered', 'wpn_scythe', 'shd_none',
      pal('bone', 'white', 'bone', 'sand', 'dark', 'bronze', 'shadow')),
    desc: '전장에 널린 빈사자를 거두는 것이 그의 일이다.',
  },
  // ── 방패병 계열
  paladin: {
    name: '성전기사', tier: 3, arch: 'tank', mods: { def: 1.2, res: 1.3, hp: 1.18, atk: 1.1 },
    role: '신성 탱커', dmgType: 'magic', range: 'melee', rank: 1, basicFx: 'holy',
    equip: ['mace', 'sword', 'shield'], skills: ['holy_smite', 'sanctuary'], next: ['paladin_apex', 'paladin_abyss'],
    // 성전기사는 "심판자"보다 "기수"에 가깝다. 얼굴이 보이는 깃털 투구로 흑기사와 갈라놓는다.
    sprite: sp('body_heavy', 'head_human', 'hair_short', 'helm_plume', 'armor_plate', 'cape_long', 'wpn_mace', 'shd_kite',
      pal('pale', 'blond', 'gold', 'azure', 'tan', 'ivory', 'holy')),
    desc: '버티면서 치유하고, 치유하면서 심판한다.',
  },
  blackknight: {
    name: '흑기사', tier: 3, arch: 'fighter', mods: { atk: 1.3, hp: 1.12, def: 1.08, res: 0.92, crit: 1.2 },
    role: '중장 딜러', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['greatsword', 'sword'], skills: ['dread_slash', 'soul_siphon'], next: ['blackknight_apex', 'blackknight_abyss'],
    // 흑기사는 통짜 투구를 써도 되는 대표 컨셉. 계열색(청)은 망토로만 남겨 정체를 알린다.
    sprite: sp('body_heavy', 'head_human', 'hair_none', 'helm_great', 'armor_heavy', 'cape_long', 'wpn_greatsword', 'shd_none',
      pal('ash', 'black', 'dark', 'azure', 'dark', 'blood', 'shadow')),
    desc: '맹세를 저버린 대가로 갑주 안에 어둠을 채웠다.',
  },
  bulwark: {
    name: '불굴의 성벽', tier: 3, arch: 'tank', mods: { def: 1.38, hp: 1.3, res: 1.14, atk: 0.9, spd: 0.88 },
    role: '최종 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['mace', 'shield'], skills: ['unbreakable', 'shield_crush'], next: ['bulwark_abyss', 'bulwark_apex'],
    // 관문수호자와 실루엣이 겹치지 않도록 열린 투구 + 흰 수염으로 노병을 만든다.
    sprite: sp('body_hulk', 'head_human', 'hair_beard', 'helm_iron', 'armor_heavy', 'cape_long', 'wpn_hammer', 'shd_tower',
      pal('tan', 'white', 'steel', 'azure', 'dark', 'silver')),
    desc: '무너뜨리려면 성벽을 부수는 공성병기를 가져와야 한다.',
  },
  oathshield: {
    name: '서약의 방패', tier: 3, arch: 'healer', mods: { def: 1.5, hp: 1.24, res: 1.24, atk: 0.92, spd: 0.94 },
    role: '보호막 지원', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['mace', 'shield', 'tome'], skills: ['oath_ward', 'vow_of_light'], next: ['oathshield_abyss', 'oathshield_apex'],
    sprite: sp('body_heavy', 'head_human', 'hair_short', 'helm_crown', 'armor_plate', 'cape_long', 'wpn_mace', 'shd_tower',
      pal('pale', 'blond', 'silver', 'azure', 'tan', 'gold', 'arcane')),
    desc: '지키겠다는 맹세가 그대로 결계가 되어 부대를 감싼다.',
  },
  // ── 궁수 계열
  masterarcher: {
    name: '신궁', tier: 3, arch: 'archer', mods: { atk: 1.28, crit: 1.5, spd: 1.06 },
    role: '관통 저격', dmgType: 'phys', range: 'ranged', rank: 2, basicFx: 'arrow',
    equip: ['bow', 'crossbow'], skills: ['piercing_arrow', 'heart_seeker'], next: ['masterarcher_apex', 'masterarcher_abyss'],
    sprite: sp('body_slim', 'head_elf', 'hair_long', 'helm_circlet', 'armor_leather', 'cape_long', 'wpn_longbow', 'shd_none',
      pal('pale', 'blond', 'gold', 'forest', 'tan', 'gold', 'nature')),
    desc: '화살 한 대가 세 사람을 뚫는다는 소문이 사실이다.',
  },
  shadowarcher: {
    name: '그림자 사수', tier: 3, arch: 'rogue', mods: { atk: 1.22, crit: 1.4, spd: 1.12, eva: 1.3, hp: 0.94 },
    role: '후열 교란', dmgType: 'phys', range: 'ranged', rank: 2, basicFx: 'arrow',
    equip: ['crossbow', 'dagger'], skills: ['shadow_volley', 'veil_shot'], next: ['shadowarcher_apex', 'shadowarcher_abyss'],
    sprite: sp('body_slim', 'head_human', 'hair_short', 'helm_hood', 'armor_leather', 'cape_long', 'wpn_crossbow', 'shd_dagger',
      pal('ash', 'black', 'dark', 'forest', 'dark', 'violet', 'shadow')),
    desc: '어디서 쐈는지 아무도 모르는 화살만 남는다.',
  },
  beastlord: {
    name: '야수군주', tier: 3, arch: 'fighter', mods: { atk: 1.3, hp: 1.22, spd: 1.08, def: 1.06 },
    role: '야성 지휘관', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['claw', 'axe'], skills: ['beast_call', 'savage_maul'], next: ['beastlord_apex', 'beastlord_abyss'],
    sprite: sp('body_hulk', 'head_wolf', 'hair_mohawk', 'helm_none', 'armor_bare', 'cape_tattered', 'wpn_claw', 'shd_none',
      pal('tan', 'brown', 'bronze', 'forest', 'green', 'forest', 'nature')),
    desc: '짐승을 부리다 못해 스스로 무리의 우두머리가 되었다.',
  },
  spiritranger: {
    name: '정령궁수', tier: 3, arch: 'archer', mods: { atk: 1.22, res: 1.5, hp: 1.08, spd: 1.04 },
    role: '마법 사수', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'nature',
    equip: ['bow', 'staff'], skills: ['spirit_arrow', 'verdant_blessing'], next: ['spiritranger_apex', 'spiritranger_abyss'],
    sprite: sp('body_slim', 'head_elf', 'hair_long', 'helm_none', 'armor_cloth', 'cape_short', 'wpn_bow', 'shd_orb',
      pal('pale', 'green', 'silver', 'forest', 'green', 'teal', 'nature')),
    desc: '시위에 정령을 얹어 쏘고, 남은 기운으로 아군을 덮는다.',
  },
  // ── 도적 계열
  shadowblade: {
    name: '그림자 밀사', tier: 3, arch: 'rogue', mods: { atk: 1.28, crit: 1.5, spd: 1.16, eva: 1.35, hp: 0.92 },
    role: '후열 처형', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['dagger', 'claw', 'katana'], skills: ['shadow_step', 'phantom_veil'], next: ['shadowblade_apex', 'shadowblade_abyss'],
    // 암살자(후드)와 갈라놓기 위해 맨머리 백발로 간다. 가면은 쓰지 않는다.
    sprite: sp('body_slim', 'head_human', 'hair_short', 'helm_none', 'armor_leather', 'cape_long', 'wpn_twindagger', 'shd_dagger',
      pal('ash', 'white', 'dark', 'night', 'dark', 'silver', 'shadow')),
    desc: '그림자를 밟고 건너와 후열의 목만 정확히 가져간다.',
  },
  venomfang: {
    name: '독아', tier: 3, arch: 'rogue', mods: { atk: 1.22, crit: 1.3, spd: 1.12, hp: 1.02, res: 1.2 },
    role: '중독 딜러', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'poison',
    equip: ['dagger', 'claw'], skills: ['venom_strike', 'plague_dagger'], next: ['venomfang_apex', 'venomfang_abyss'],
    sprite: sp('body_slim', 'head_lizard', 'hair_none', 'helm_none', 'armor_leather', 'cape_short', 'wpn_dagger', 'shd_dagger',
      pal('green', 'green', 'bronze', 'night', 'green', 'forest', 'nature')),
    desc: '한 번 스치면 그날 밤을 넘기기 어렵다.',
  },
  banditking: {
    name: '도적왕', tier: 3, arch: 'rogue', mods: { atk: 1.24, hp: 1.2, def: 1.24, crit: 1.15 },
    role: '난전 두목', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['axe', 'sword'], skills: ['pillage', 'ambush_order'], next: ['banditking_apex', 'banditking_abyss'],
    sprite: sp('body_normal', 'head_human', 'hair_long', 'helm_crown', 'armor_mail', 'cape_long', 'wpn_axe', 'shd_buckler',
      pal('tan', 'red', 'gold', 'night', 'brown', 'gold')),
    desc: '산적 떼를 왕국처럼 굴리던 사내. 이제는 용병단 소속이다.',
  },
  bladedancer: {
    name: '칼날무희', tier: 3, arch: 'fighter', mods: { atk: 1.24, spd: 1.24, eva: 1.5, crit: 1.35, hp: 0.96 },
    role: '회피 광역', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['dagger', 'katana'], skills: ['blade_waltz', 'dance_of_edges'], next: ['bladedancer_apex', 'bladedancer_abyss'],
    sprite: sp('body_slim', 'head_human', 'hair_pony', 'helm_circlet', 'armor_cloth', 'cape_short', 'wpn_twindagger', 'shd_none',
      pal('pale', 'blond', 'silver', 'night', 'tan', 'rose')),
    desc: '춤이 끝날 때쯤이면 주위에 서 있는 적이 없다.',
  },
  // ── 마법사 계열
  archmage: {
    name: '대마법사', tier: 3, arch: 'mage', mods: { atk: 1.34, res: 1.24 },
    role: '광역 섬멸', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'bolt',
    equip: ['staff', 'tome', 'wand'], skills: ['meteor', 'arcane_surge'], next: ['archmage_apex', 'archmage_abyss'],
    sprite: sp('body_slim', 'head_human', 'hair_long', 'helm_wizard', 'armor_robe', 'cape_long', 'wpn_staff', 'shd_orb',
      pal('pale', 'white', 'gold', 'violet', 'brown', 'gold', 'arcane')),
    desc: '탑이 쫓아냈던 견습생이 탑을 사들일 값이 되었다.',
  },
  stormcaller: {
    name: '폭풍술사', tier: 3, arch: 'mage', mods: { atk: 1.28, spd: 1.2, crit: 1.4, res: 1.1, hp: 0.98 },
    role: '연쇄 마법', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'lightning',
    equip: ['wand', 'staff'], skills: ['chain_lightning', 'thunder_lance'], next: ['stormcaller_apex', 'stormcaller_abyss'],
    sprite: sp('body_normal', 'head_human', 'hair_mohawk', 'helm_circlet', 'armor_robe', 'cape_wing', 'wpn_wand', 'shd_orb',
      pal('tan', 'blue', 'silver', 'violet', 'dark', 'azure', 'frost')),
    desc: '구름을 부르는 대신 그 자리에서 벼락을 만든다.',
  },
  lichlord: {
    name: '사령왕', tier: 3, arch: 'mage', mods: { atk: 1.26, hp: 1.24, res: 1.3, spd: 0.96 },
    role: '저주 흡혈', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'shadow',
    equip: ['staff', 'tome', 'scythe'], skills: ['death_coil', 'curse_of_decay'], next: ['lichlord_apex', 'lichlord_abyss'],
    sprite: sp('body_slim', 'head_skull', 'hair_none', 'helm_crown', 'armor_bone', 'cape_long', 'wpn_staff', 'shd_orb',
      pal('bone', 'white', 'bone', 'violet', 'dark', 'gold', 'shadow')),
    desc: '자기 죽음을 계약서로 바꿔 치우고 왕관을 썼다.',
  },
  plaguelord: {
    name: '역병군주', tier: 3, arch: 'mage', mods: { atk: 1.2, hp: 1.3, res: 1.24, def: 1.2, spd: 0.92 },
    role: '도트 지속딜', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'poison',
    equip: ['scythe', 'tome'], skills: ['pestilence', 'rot_touch'], next: ['plaguelord_apex', 'plaguelord_abyss'],
    sprite: sp('body_heavy', 'head_demon', 'hair_none', 'helm_hood', 'armor_robe', 'cape_tattered', 'wpn_scythe', 'shd_none',
      pal('green', 'green', 'bone', 'violet', 'dark', 'forest', 'nature')),
    desc: '지나간 자리마다 마을 하나가 조용해진다.',
  },
  // ── 수도사 계열
  highpriest: {
    name: '대주교', tier: 3, arch: 'healer', mods: { res: 1.3, hp: 1.18, atk: 1.16, spd: 1.04 },
    role: '광역 치유', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'holy',
    equip: ['staff', 'tome'], skills: ['divine_grace', 'blessing_of_faith'], next: ['highpriest_abyss', 'highpriest_apex'],
    sprite: sp('body_normal', 'head_human', 'hair_long', 'helm_crown', 'armor_robe', 'cape_long', 'wpn_staff', 'shd_torch',
      pal('pale', 'white', 'gold', 'ivory', 'tan', 'gold', 'holy')),
    desc: '한 번의 기도로 부대 전원의 상처가 아문다.',
  },
  inquisitor: {
    name: '심판관', tier: 3, arch: 'mage', mods: { atk: 1.34, res: 1.16, def: 1.3, hp: 1.06 },
    role: '신성 처형', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'fire',
    equip: ['tome', 'mace', 'sword'], skills: ['judgement', 'flame_of_purge'], next: ['inquisitor_apex', 'inquisitor_abyss'],
    sprite: sp('body_normal', 'head_human', 'hair_short', 'helm_hood', 'armor_plate', 'cape_long', 'wpn_tome', 'shd_torch',
      pal('pale', 'black', 'silver', 'ivory', 'dark', 'crimson', 'fire')),
    desc: '치유를 포기한 사제가 손에 든 것은 죄인의 명부와 불이다.',
  },
  arhat: {
    name: '나한', tier: 3, arch: 'fighter', mods: { atk: 1.24, def: 1.26, hp: 1.2, spd: 1.1, eva: 1.3 },
    role: '반격 격투가', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['claw', 'staff'], skills: ['hundred_fists', 'iron_body'], next: ['arhat_apex', 'arhat_abyss'],
    sprite: sp('body_heavy', 'head_human', 'hair_bald', 'helm_none', 'armor_bare', 'cape_short', 'wpn_claw', 'shd_none',
      pal('tan', 'black', 'gold', 'ivory', 'tan', 'gold', 'holy')),
    desc: '깨달음의 끝에서 육신 자체가 무기가 되었다.',
  },
  fallenmonk: {
    name: '파계승', tier: 3, arch: 'fighter', mods: { atk: 1.36, spd: 1.14, hp: 1.08, def: 0.94, crit: 1.25 },
    role: '타락 격투가', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['claw', 'mace'], skills: ['demon_palm', 'karma_burst'], next: ['fallenmonk_apex', 'fallenmonk_abyss'],
    sprite: sp('body_hulk', 'head_human', 'hair_bald', 'helm_none', 'armor_bare', 'cape_tattered', 'wpn_hammer', 'shd_none',
      pal('ash', 'black', 'dark', 'ivory', 'dark', 'blood', 'shadow')),
    desc: '계율을 전부 깨뜨린 대신 업화를 손에 넣었다.',
  },
};

/** id 주입 */
for (const [id, c] of Object.entries(RAW)) c.id = id;

/** 전체 클래스 사전 (id -> Class). 1~3차(RAW) + 4차(T4_CLASSES) = 105종. */
export const CLASSES = { ...RAW, ...T4_CLASSES };

/** 1차 클래스 id 배열 (주점 고용 목록 순서) */
export const BASE_CLASSES = ['swordsman', 'spearman', 'shieldman', 'archer', 'rogue', 'apprentice', 'acolyte'];

/** 상위 클래스 id -> 하위(부모) 클래스 id */
const PARENT = (() => {
  const m = {};
  for (const c of Object.values(CLASSES)) for (const n of c.next || []) m[n] = c.id;
  return m;
})();

/** @returns {object|null} 없으면 null */
export function getClass(id) {
  return (id && CLASSES[id]) || null;
}

/**
 * 전직 후보 목록.
 * @param {string} id 현재 클래스 id
 * @returns {object[]} 상위 클래스 객체 배열 (3차면 빈 배열)
 */
export function promoteOptions(id) {
  const c = getClass(id);
  if (!c) return [];
  return (c.next || []).map(getClass).filter(Boolean);
}

/**
 * 1차부터 해당 클래스까지의 전직 계보.
 * @param {string} id
 * @returns {object[]} [1차, 2차, ...] 클래스 객체 배열 (없으면 빈 배열)
 */
export function classChain(id) {
  const out = [];
  let cur = getClass(id);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    out.unshift(cur);
    cur = getClass(PARENT[cur.id]);
  }
  return out;
}

/** 특정 차수의 클래스 목록 (UI 도감용) */
export function classesOfTier(tier) {
  return Object.values(CLASSES).filter((c) => c.tier === tier);
}
