// 4차 클래스 (SPEC §3.2). 순수 데이터 — DOM/Canvas 참조 금지.
//
// 3차 28종이 각각 2종의 4차 후보를 갖는다 → 56종. 총 클래스 수 7+14+28+56 = 105종.
// 두 후보는 반드시 성격이 갈린다: 하나는 극단적 공격(스탯을 몰고 방어를 버린다),
// 다른 하나는 생존·지원(아키타입까지 바꿔 역할을 옮긴다).
//
// 규칙
//  - `tier: 4`, `next: []` (여기가 트리의 끝이다)
//  - `skills` = [3차에서 물려받은 스킬 1개, `t4_<id>`]. 4차 전용 스킬 id 규칙은
//    **`t4_<클래스id>`** 로 고정이다 (data/skills.js 담당이 같은 규칙으로 추가한다).
//  - 스프라이트는 SPEC §4.4 어휘 안에서 가장 화려한 조합만 쓴다
//    (cape_long/cape_wing · helm_crown/helm_plume/helm_horned · accent 'gold' · glow).
//  - 3차 → 4차 계보가 팔레트로 읽혀야 한다. 계열색(cloth)은 부모를 그대로 물려받는다:
//    검사 crimson · 창병 sand · 방패병 azure · 궁수 forest · 도적 night · 마법사 violet · 수도사 ivory
//
// 3차의 `next` 는 classes.js 가 소유한다 (다른 차수와 같은 방식). 여기서는 정의만 한다.

/** 팔레트 레시피 (art/palette.js makePalette 인자). 순서: 피부/머리/금속/천/가죽/강조/마력광 */
const pal = (skin, hair, metal, cloth, leather, accent, glow = 'none') =>
  ({ skin, hair, metal, cloth, leather, accent, glow });

/** 스프라이트 레시피. 파츠 이름은 SPEC §4.4 어휘만 사용한다. */
const sp = (body, head, hair, helm, armor, cape, weapon, offhand, palette) =>
  ({ body, head, hair, helm, armor, cape, weapon, offhand, palette });

/**
 * 4차 정의 원본. `keep` 은 3차에서 물려받는 스킬 id (아래 조립부가 `t4_<id>` 와 함께 묶는다).
 * @type {Record<string, object>}
 */
const RAW = {
  // ═════════════════════ 검사 계열 (swordsman) ═════════════════════
  // 광기의 대장군 → 멸망의 군신 / 혈기의 대원수
  madgeneral_apex: {
    name: '멸망의 군신', arch: 'fighter', mods: { atk: 1.52, hp: 1.14, def: 0.80, res: 0.86, crit: 1.35, spd: 1.08 },
    role: '광역 섬멸 지휘관', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['greatsword', 'axe'], keep: 'mad_cleave',
    sprite: sp('body_hulk', 'head_demon', 'hair_mohawk', 'helm_horned', 'armor_heavy', 'cape_wing', 'wpn_greataxe', 'shd_none',
      pal('red', 'red', 'blood', 'crimson', 'dark', 'gold', 'blood')),
    desc: '광기가 갑주를 뚫고 나온 자리. 그가 지나간 전열에는 이름조차 남지 않는다.',
  },
  madgeneral_abyss: {
    name: '혈기의 대원수', arch: 'tank', mods: { def: 1.32, hp: 1.40, atk: 1.16, res: 1.18, spd: 0.96 },
    role: '전군 강화 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['axe', 'sword', 'shield'], keep: 'war_cry',
    sprite: sp('body_hulk', 'head_human', 'hair_beard', 'helm_crown', 'armor_heavy', 'cape_long', 'wpn_greataxe', 'shd_tower',
      pal('tan', 'white', 'blood', 'crimson', 'dark', 'gold', 'blood')),
    desc: '포효 한 번에 부대가 다시 일어선다. 그 자신은 애초에 넘어지지 않는다.',
  },
  // 혈귀검사 → 진혈군주 / 불사의 혈염귀
  bloodfiend_apex: {
    name: '진혈군주', arch: 'rogue', mods: { atk: 1.44, spd: 1.26, crit: 1.75, critDmg: 1.30, hp: 0.86, def: 0.76, eva: 1.40 },
    role: '흡혈 처형자', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['katana', 'claw'], keep: 'blood_reave',
    sprite: sp('body_slim', 'head_demon', 'hair_long', 'helm_crown', 'armor_leather', 'cape_wing', 'wpn_katana', 'shd_dagger',
      pal('ash', 'white', 'blood', 'crimson', 'dark', 'gold', 'blood')),
    desc: '피를 마시는 것이 아니라, 피가 스스로 그에게 흘러간다.',
  },
  bloodfiend_abyss: {
    name: '불사의 혈염귀', arch: 'tank', mods: { hp: 1.44, def: 1.20, res: 1.22, atk: 1.20, spd: 1.02 },
    role: '흡혈 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['claw', 'greatsword'], keep: 'crimson_pact',
    sprite: sp('body_hulk', 'head_demon', 'hair_none', 'helm_horned', 'armor_bone', 'cape_wing', 'wpn_claw', 'shd_none',
      pal('red', 'black', 'blood', 'crimson', 'dark', 'blood', 'blood')),
    desc: '베여도 죽지 않고, 죽지 않는 대신 영원히 굶주린다.',
  },
  // 검신 → 무한의 검성 / 폐검의 수라
  swordgod_apex: {
    name: '무한의 검성', arch: 'fighter', mods: { atk: 1.46, spd: 1.24, crit: 1.85, critDmg: 1.40, hp: 0.92, def: 0.88 },
    role: '단일 극처형', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['katana', 'sword'], keep: 'divine_blade',
    sprite: sp('body_normal', 'head_human', 'hair_long', 'helm_crown', 'armor_plate', 'cape_long', 'wpn_katana', 'shd_none',
      pal('pale', 'white', 'silver', 'crimson', 'tan', 'gold', 'holy')),
    desc: '한 합에 끝나지 않는 상대를 만난 적이 없어, 두 합을 배우지 못했다.',
  },
  swordgod_abyss: {
    name: '폐검의 수라', arch: 'rogue', mods: { atk: 1.34, spd: 1.30, eva: 1.70, crit: 1.50, hp: 1.10, def: 0.90, res: 1.12 },
    role: '회피 반격 검객', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['katana', 'dagger'], keep: 'thousand_cuts',
    sprite: sp('body_slim', 'head_human', 'hair_long', 'helm_none', 'armor_bare', 'cape_tattered', 'wpn_katana', 'shd_dagger',
      pal('ash', 'white', 'blood', 'night', 'dark', 'crimson', 'shadow')),
    desc: '부러진 검만 골라 쓴다. 어차피 그의 손에서는 전부 한 번만 쓰이니까.',
  },
  // 파천검호 → 개천검제 / 만검의 벽
  skysplitter_apex: {
    name: '개천검제', arch: 'fighter', mods: { atk: 1.50, hp: 1.08, def: 0.94, crit: 1.35, spd: 1.10 },
    role: '광역 참격', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['greatsword', 'katana'], keep: 'sky_cleave',
    sprite: sp('body_hulk', 'head_human', 'hair_pony', 'helm_plume', 'armor_plate', 'cape_wing', 'wpn_greatsword', 'shd_none',
      pal('tan', 'white', 'steel', 'crimson', 'dark', 'gold', 'frost')),
    desc: '내려친 자리에 하늘이 아니라 적의 전열이 통째로 갈라져 있다.',
  },
  skysplitter_abyss: {
    name: '만검의 벽', arch: 'tank', mods: { def: 1.34, hp: 1.34, atk: 1.18, res: 1.16, crit: 1.20 },
    role: '반격 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['greatsword', 'sword', 'shield'], keep: 'counter_stance',
    sprite: sp('body_heavy', 'head_human', 'hair_short', 'helm_crown', 'armor_heavy', 'cape_long', 'wpn_greatsword', 'shd_kite',
      pal('pale', 'black', 'steel', 'crimson', 'dark', 'silver', 'frost')),
    desc: '먼저 베는 법을 잊은 대신, 베려 든 자를 반드시 되돌려 베는 법을 얻었다.',
  },

  // ═════════════════════ 창병 계열 (spearman) ═════════════════════
  // 용기병 대장 → 창룡제 / 불멸의 기수
  dragoonlord_apex: {
    name: '창룡제', arch: 'lancer', mods: { atk: 1.48, spd: 1.16, hp: 1.10, def: 1.00, crit: 1.30 },
    role: '돌격 섬멸', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'pierce',
    equip: ['spear', 'axe'], keep: 'dragon_charge',
    sprite: sp('body_heavy', 'head_human', 'hair_long', 'helm_crown', 'armor_plate', 'cape_wing', 'wpn_pike', 'shd_none',
      pal('pale', 'blond', 'gold', 'sand', 'brown', 'gold', 'fire')),
    desc: '용을 잡던 창이 이제는 용의 이름으로 불린다.',
  },
  dragoonlord_abyss: {
    name: '불멸의 기수', arch: 'tank', mods: { def: 1.30, hp: 1.38, res: 1.20, atk: 1.14, spd: 1.02 },
    role: '깃발 지원 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'pierce',
    equip: ['spear', 'shield'], keep: 'banner_of_valor',
    sprite: sp('body_heavy', 'head_human', 'hair_short', 'helm_plume', 'armor_heavy', 'cape_long', 'wpn_halberd', 'shd_tower',
      pal('tan', 'blond', 'gold', 'sand', 'tan', 'gold', 'holy')),
    desc: '깃대를 쥔 손이 부러지기 전에 전장이 먼저 끝난다.',
  },
  // 천공창기사 → 뇌신창제 / 천풍의 성창
  skylancer_apex: {
    name: '뇌신창제', arch: 'lancer', mods: { atk: 1.46, spd: 1.28, crit: 1.50, res: 1.20, hp: 0.94, def: 0.86 },
    role: '뇌격 돌격', dmgType: 'magic', range: 'melee', rank: 1, basicFx: 'lightning',
    equip: ['spear', 'wand'], keep: 'sky_fall',
    sprite: sp('body_normal', 'head_elf', 'hair_long', 'helm_crown', 'armor_plate', 'cape_wing', 'wpn_spear', 'shd_orb',
      pal('pale', 'blue', 'silver', 'sand', 'tan', 'gold', 'frost')),
    desc: '창을 던지면 벼락이 먼저 도착해 자리를 비워 둔다.',
  },
  skylancer_abyss: {
    name: '천풍의 성창', arch: 'lancer', mods: { eva: 1.90, spd: 1.32, res: 1.34, hp: 1.14, atk: 1.20, def: 1.06 },
    role: '회피 지원 창기사', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'pierce',
    equip: ['spear', 'staff'], keep: 'heaven_pierce',
    sprite: sp('body_slim', 'head_elf', 'hair_long', 'helm_circlet', 'armor_cloth', 'cape_wing', 'wpn_spear', 'shd_buckler',
      pal('pale', 'white', 'silver', 'sand', 'tan', 'silver', 'arcane')),
    desc: '갑주를 바람으로 갈아입었다. 맞지 않으면 뚫릴 일도 없다.',
  },
  // 관문수호자 → 불괴의 세계문 / 철문의 패왕
  gatewarden_abyss: {
    name: '불괴의 세계문', arch: 'tank', mods: { def: 1.60, hp: 1.46, res: 1.24, atk: 0.90, spd: 0.84 },
    role: '절대 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['spear', 'shield'], keep: 'iron_gate',
    sprite: sp('body_hulk', 'head_human', 'hair_none', 'helm_great', 'armor_heavy', 'cape_long', 'wpn_hammer', 'shd_tower',
      pal('tan', 'brown', 'steel', 'sand', 'dark', 'gold', 'arcane')),
    desc: '그가 선 곳은 문이 아니라 벽이다. 열리는 쪽은 이쪽이 정한다.',
  },
  gatewarden_apex: {
    name: '철문의 패왕', arch: 'tank', mods: { atk: 1.40, def: 1.20, hp: 1.24, crit: 1.25, spd: 0.96 },
    role: '공성형 탱커', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['spear', 'axe', 'shield'], keep: 'warden_smash',
    sprite: sp('body_hulk', 'head_human', 'hair_mohawk', 'helm_horned', 'armor_heavy', 'cape_tattered', 'wpn_greataxe', 'shd_tower',
      pal('tan', 'red', 'bronze', 'sand', 'dark', 'gold', 'fire')),
    desc: '지키는 법을 다 배운 뒤, 부수는 쪽이 빠르다는 걸 깨달았다.',
  },
  // 사신낫병 → 사신군주 / 혼백의 수확자
  reaper_apex: {
    name: '사신군주', arch: 'rogue', mods: { atk: 1.44, crit: 1.80, critDmg: 1.35, spd: 1.24, hp: 0.88, def: 0.82 },
    role: '광역 처형', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['scythe', 'dagger'], keep: 'death_scythe',
    sprite: sp('body_slim', 'head_skull', 'hair_none', 'helm_crown', 'armor_bone', 'cape_wing', 'wpn_scythe', 'shd_none',
      pal('bone', 'white', 'bone', 'sand', 'dark', 'gold', 'shadow')),
    desc: '거두는 자에서 거두라 명하는 자가 되었다.',
  },
  reaper_abyss: {
    name: '혼백의 수확자', arch: 'tank', mods: { hp: 1.42, def: 1.26, res: 1.30, atk: 1.18, spd: 0.92 },
    role: '흡수 방벽', dmgType: 'magic', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['scythe', 'shield'], keep: 'soul_reap',
    sprite: sp('body_heavy', 'head_skull', 'hair_none', 'helm_hood', 'armor_bone', 'cape_long', 'wpn_scythe', 'shd_none',
      pal('bone', 'white', 'bone', 'sand', 'dark', 'gold', 'shadow')),
    desc: '앞줄에서 죽음을 먼저 받아 두고, 그것으로 뒷줄을 먹인다.',
  },

  // ═════════════════════ 방패병 계열 (shieldman) ═════════════════════
  // 성전기사 → 광휘의 성왕 / 성역의 수호성인
  paladin_apex: {
    name: '광휘의 성왕', arch: 'tank', mods: { atk: 1.44, res: 1.30, def: 1.10, hp: 1.16, crit: 1.25 },
    role: '신성 공격 탱커', dmgType: 'magic', range: 'melee', rank: 1, basicFx: 'holy',
    equip: ['sword', 'mace', 'shield'], keep: 'holy_smite',
    sprite: sp('body_heavy', 'head_human', 'hair_long', 'helm_crown', 'armor_plate', 'cape_wing', 'wpn_greatsword', 'shd_kite',
      pal('pale', 'blond', 'gold', 'azure', 'tan', 'gold', 'holy')),
    desc: '방패를 든 손으로 심판까지 하기로 했다.',
  },
  paladin_abyss: {
    name: '성역의 수호성인', arch: 'healer', mods: { def: 1.36, res: 1.44, hp: 1.30, atk: 0.96, spd: 0.98 },
    role: '성역 보호 지원', dmgType: 'magic', range: 'melee', rank: 1, basicFx: 'holy',
    equip: ['mace', 'shield', 'tome'], keep: 'sanctuary',
    sprite: sp('body_heavy', 'head_human', 'hair_short', 'helm_crown', 'armor_plate', 'cape_long', 'wpn_mace', 'shd_tower',
      pal('pale', 'white', 'silver', 'azure', 'tan', 'ivory', 'holy')),
    desc: '그가 발을 붙인 반경 안에서는 아무도 쓰러지지 못한다.',
  },
  // 흑기사 → 암흑의 폐왕 / 영혼포식자
  blackknight_apex: {
    name: '암흑의 폐왕', arch: 'fighter', mods: { atk: 1.52, hp: 1.06, def: 1.00, res: 0.86, crit: 1.30, spd: 1.06 },
    role: '중장 극딜', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['greatsword', 'axe'], keep: 'dread_slash',
    sprite: sp('body_hulk', 'head_human', 'hair_none', 'helm_horned', 'armor_heavy', 'cape_wing', 'wpn_greatsword', 'shd_none',
      pal('ash', 'black', 'dark', 'azure', 'dark', 'blood', 'shadow')),
    desc: '버린 왕국의 이름을 갑주 안쪽에 새기고 다닌다.',
  },
  blackknight_abyss: {
    name: '영혼포식자', arch: 'tank', mods: { hp: 1.40, def: 1.28, res: 1.10, atk: 1.22, spd: 0.98 },
    role: '흡혈 중장', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['greatsword', 'scythe'], keep: 'soul_siphon',
    sprite: sp('body_hulk', 'head_skull', 'hair_none', 'helm_great', 'armor_bone', 'cape_long', 'wpn_scythe', 'shd_none',
      pal('bone', 'black', 'dark', 'azure', 'dark', 'violet', 'shadow')),
    desc: '갑주 안에 남은 것은 사람이 아니라 삼켜 온 목숨들이다.',
  },
  // 불굴의 성벽 → 부동의 대성벽 / 분쇄의 거벽
  bulwark_abyss: {
    name: '부동의 대성벽', arch: 'tank', mods: { def: 1.66, hp: 1.50, res: 1.24, atk: 0.88, spd: 0.82 },
    role: '최종 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['mace', 'shield'], keep: 'unbreakable',
    sprite: sp('body_hulk', 'head_human', 'hair_beard', 'helm_crown', 'armor_heavy', 'cape_long', 'wpn_hammer', 'shd_tower',
      pal('tan', 'white', 'steel', 'azure', 'dark', 'gold', 'arcane')),
    desc: '공성병기를 끌고 와도 늦었다. 이미 이쪽이 성이다.',
  },
  bulwark_apex: {
    name: '분쇄의 거벽', arch: 'tank', mods: { atk: 1.44, def: 1.24, hp: 1.26, crit: 1.30, spd: 0.94 },
    role: '공격 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['mace', 'axe', 'shield'], keep: 'shield_crush',
    sprite: sp('body_hulk', 'head_human', 'hair_mohawk', 'helm_horned', 'armor_heavy', 'cape_wing', 'wpn_hammer', 'shd_kite',
      pal('tan', 'red', 'bronze', 'azure', 'dark', 'gold', 'fire')),
    desc: '방패로 막는 것보다 방패로 치는 게 빠르다는 결론에 도달했다.',
  },
  // 서약의 방패 → 영원한 서약 / 파약의 성기사
  oathshield_abyss: {
    name: '영원한 서약', arch: 'healer', mods: { def: 1.70, hp: 1.34, res: 1.40, atk: 0.90, spd: 0.94 },
    role: '결계 지원', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['mace', 'shield', 'tome'], keep: 'oath_ward',
    sprite: sp('body_heavy', 'head_human', 'hair_long', 'helm_crown', 'armor_plate', 'cape_wing', 'wpn_mace', 'shd_tower',
      pal('pale', 'white', 'silver', 'azure', 'tan', 'gold', 'arcane')),
    desc: '맹세가 문장이 되고, 문장이 부대를 감싸는 결계가 되었다.',
  },
  oathshield_apex: {
    name: '파약의 성기사', arch: 'tank', mods: { atk: 1.42, def: 1.24, res: 1.26, hp: 1.14, crit: 1.20 },
    role: '파약 공격 탱커', dmgType: 'magic', range: 'melee', rank: 1, basicFx: 'holy',
    equip: ['sword', 'mace', 'shield'], keep: 'vow_of_light',
    sprite: sp('body_heavy', 'head_human', 'hair_short', 'helm_plume', 'armor_plate', 'cape_long', 'wpn_sword', 'shd_kite',
      pal('pale', 'black', 'gold', 'azure', 'dark', 'crimson', 'holy')),
    desc: '지키겠다는 맹세를 깨고, 대신 갚겠다는 맹세를 새로 했다.',
  },

  // ═════════════════════ 궁수 계열 (archer) ═════════════════════
  // 신궁 → 성락의 궁신 / 천리의 풍궁수
  masterarcher_apex: {
    name: '성락의 궁신', arch: 'archer', mods: { atk: 1.46, crit: 1.80, critDmg: 1.35, spd: 1.12, hp: 0.90, def: 0.86 },
    role: '극저격', dmgType: 'phys', range: 'ranged', rank: 2, basicFx: 'arrow',
    equip: ['bow', 'crossbow'], keep: 'heart_seeker',
    sprite: sp('body_slim', 'head_elf', 'hair_long', 'helm_crown', 'armor_leather', 'cape_wing', 'wpn_longbow', 'shd_none',
      pal('pale', 'blond', 'gold', 'forest', 'tan', 'gold', 'holy')),
    desc: '화살이 아니라 별을 떨어뜨린다는 말을 굳이 부정하지 않는다.',
  },
  masterarcher_abyss: {
    name: '천리의 풍궁수', arch: 'archer', mods: { atk: 1.30, spd: 1.24, eva: 1.70, res: 1.24, hp: 1.16 },
    role: '회피 관통 사수', dmgType: 'phys', range: 'ranged', rank: 2, basicFx: 'arrow',
    equip: ['bow', 'staff'], keep: 'piercing_arrow',
    sprite: sp('body_slim', 'head_elf', 'hair_pony', 'helm_circlet', 'armor_cloth', 'cape_long', 'wpn_longbow', 'shd_orb',
      pal('pale', 'white', 'silver', 'forest', 'tan', 'silver', 'nature')),
    desc: '바람을 읽는 단계를 지나, 바람에게 화살을 맡기는 단계에 왔다.',
  },
  // 그림자 사수 → 공허의 사수 / 망령 추적자
  shadowarcher_apex: {
    name: '공허의 사수', arch: 'rogue', mods: { atk: 1.40, crit: 1.70, spd: 1.26, eva: 1.50, hp: 0.88, def: 0.80 },
    role: '후열 극처형', dmgType: 'phys', range: 'ranged', rank: 2, basicFx: 'shadow',
    equip: ['crossbow', 'dagger'], keep: 'shadow_volley',
    sprite: sp('body_slim', 'head_human', 'hair_short', 'helm_hood', 'armor_leather', 'cape_wing', 'wpn_crossbow', 'shd_dagger',
      pal('ash', 'black', 'dark', 'forest', 'dark', 'gold', 'shadow')),
    desc: '쏜 자리도 맞은 자리도 남지 않는다. 사람만 없어진다.',
  },
  shadowarcher_abyss: {
    name: '망령 추적자', arch: 'archer', mods: { atk: 1.26, res: 1.30, hp: 1.20, spd: 1.16, eva: 1.45 },
    role: '저주 추적 사수', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'shadow',
    equip: ['crossbow', 'bow'], keep: 'veil_shot',
    sprite: sp('body_slim', 'head_human', 'hair_long', 'helm_hood', 'armor_cloth', 'cape_long', 'wpn_crossbow', 'shd_orb',
      pal('ash', 'white', 'silver', 'forest', 'dark', 'violet', 'shadow')),
    desc: '표식을 남기는 대신 망령을 붙여 보낸다. 도망칠 방향이 사라진다.',
  },
  // 야수군주 → 태초의 야왕 / 만수의 대군주
  beastlord_apex: {
    name: '태초의 야왕', arch: 'fighter', mods: { atk: 1.50, hp: 1.18, spd: 1.14, def: 0.94, crit: 1.30 },
    role: '야성 극딜', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['claw', 'axe'], keep: 'savage_maul',
    sprite: sp('body_hulk', 'head_wolf', 'hair_mohawk', 'helm_horned', 'armor_bare', 'cape_wing', 'wpn_claw', 'shd_none',
      pal('tan', 'brown', 'bronze', 'forest', 'green', 'gold', 'fire')),
    desc: '무리를 이끄는 단계를 지나, 무리가 그를 따라 우는 단계에 왔다.',
  },
  beastlord_abyss: {
    name: '만수의 대군주', arch: 'tank', mods: { hp: 1.44, def: 1.30, res: 1.22, atk: 1.16, spd: 1.00 },
    role: '야성 방벽 지휘', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['claw', 'axe', 'shield'], keep: 'beast_call',
    sprite: sp('body_hulk', 'head_wolf', 'hair_long', 'helm_crown', 'armor_bone', 'cape_long', 'wpn_claw', 'shd_tower',
      pal('tan', 'white', 'bone', 'forest', 'green', 'gold', 'nature')),
    desc: '짐승의 왕관을 쓴 자. 한 번 부르면 숲 전체가 대답한다.',
  },
  // 정령궁수 → 세계수의 궁성 / 정령의 화신
  spiritranger_apex: {
    name: '세계수의 궁성', arch: 'mage', mods: { atk: 1.46, res: 1.30, hp: 0.96, spd: 1.10, crit: 1.30 },
    role: '정령 광역 사격', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'nature',
    equip: ['bow', 'staff', 'tome'], keep: 'spirit_arrow',
    sprite: sp('body_slim', 'head_elf', 'hair_long', 'helm_crown', 'armor_robe', 'cape_wing', 'wpn_longbow', 'shd_orb',
      pal('pale', 'green', 'gold', 'forest', 'green', 'gold', 'nature')),
    desc: '시위를 당기면 세계수의 뿌리가 함께 당겨진다.',
  },
  spiritranger_abyss: {
    name: '정령의 화신', arch: 'healer', mods: { res: 1.46, hp: 1.26, atk: 1.16, spd: 1.08, def: 1.10 },
    role: '정령 치유 지원', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'nature',
    equip: ['bow', 'staff'], keep: 'verdant_blessing',
    sprite: sp('body_slim', 'head_elf', 'hair_long', 'helm_circlet', 'armor_robe', 'cape_wing', 'wpn_staff', 'shd_orb',
      pal('pale', 'white', 'silver', 'forest', 'green', 'teal', 'nature')),
    desc: '사람의 몸을 빌린 정령인지 정령을 빌린 사람인지, 아무도 묻지 않는다.',
  },

  // ═════════════════════ 도적 계열 (rogue) ═════════════════════
  // 그림자 밀사 → 밤의 군주 / 환영의 무영객
  shadowblade_apex: {
    name: '밤의 군주', arch: 'rogue', mods: { atk: 1.46, crit: 1.85, critDmg: 1.40, spd: 1.30, hp: 0.86, def: 0.78, eva: 1.50 },
    role: '후열 극처형', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['dagger', 'katana', 'claw'], keep: 'shadow_step',
    sprite: sp('body_slim', 'head_human', 'hair_short', 'helm_crown', 'armor_leather', 'cape_wing', 'wpn_twindagger', 'shd_dagger',
      pal('ash', 'white', 'dark', 'night', 'dark', 'gold', 'shadow')),
    desc: '밤에 값을 매기던 자가 밤을 소유하게 되었다.',
  },
  shadowblade_abyss: {
    name: '환영의 무영객', arch: 'rogue', mods: { eva: 2.00, spd: 1.34, atk: 1.24, hp: 1.14, res: 1.24 },
    role: '회피 교란', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['dagger', 'claw'], keep: 'phantom_veil',
    sprite: sp('body_slim', 'head_human', 'hair_long', 'helm_hood', 'armor_cloth', 'cape_long', 'wpn_twindagger', 'shd_none',
      pal('ash', 'white', 'silver', 'night', 'dark', 'violet', 'shadow')),
    desc: '지금까지 베인 것은 언제나 그의 잔상뿐이었다.',
  },
  // 독아 → 만독의 아왕 / 부식의 독왕
  venomfang_apex: {
    name: '만독의 아왕', arch: 'rogue', mods: { atk: 1.42, crit: 1.60, spd: 1.26, res: 1.20, hp: 0.94, def: 0.86 },
    role: '극중독 딜러', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'poison',
    equip: ['dagger', 'claw'], keep: 'venom_strike',
    sprite: sp('body_slim', 'head_lizard', 'hair_none', 'helm_crown', 'armor_leather', 'cape_wing', 'wpn_twindagger', 'shd_dagger',
      pal('green', 'green', 'gold', 'night', 'green', 'gold', 'nature')),
    desc: '스치기만 해도 끝난다. 스치지 않는 법을 아는 자가 없다.',
  },
  venomfang_abyss: {
    name: '부식의 독왕', arch: 'fighter', mods: { hp: 1.34, def: 1.22, res: 1.34, atk: 1.22, spd: 1.08 },
    role: '중독 지속 전열', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'poison',
    equip: ['dagger', 'scythe'], keep: 'plague_dagger',
    sprite: sp('body_normal', 'head_lizard', 'hair_none', 'helm_hood', 'armor_bone', 'cape_long', 'wpn_scythe', 'shd_dagger',
      pal('green', 'green', 'bone', 'night', 'green', 'forest', 'nature')),
    desc: '제 몸까지 함께 썩혀 가며 적의 전열을 붙잡아 둔다.',
  },
  // 도적왕 → 암흑가의 패왕 / 흑막의 대영주
  banditking_apex: {
    name: '암흑가의 패왕', arch: 'rogue', mods: { atk: 1.44, hp: 1.22, def: 1.20, crit: 1.35, spd: 1.14 },
    role: '난전 극딜', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['axe', 'sword'], keep: 'pillage',
    sprite: sp('body_normal', 'head_human', 'hair_long', 'helm_crown', 'armor_mail', 'cape_wing', 'wpn_greataxe', 'shd_buckler',
      pal('tan', 'red', 'gold', 'night', 'brown', 'gold', 'fire')),
    desc: '산적 떼가 왕국이 되고, 왕국이 다시 그의 사업이 되었다.',
  },
  banditking_abyss: {
    name: '흑막의 대영주', arch: 'tank', mods: { hp: 1.42, def: 1.34, res: 1.20, atk: 1.16, spd: 1.02 },
    role: '지휘 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['axe', 'sword', 'shield'], keep: 'ambush_order',
    sprite: sp('body_heavy', 'head_human', 'hair_beard', 'helm_crown', 'armor_plate', 'cape_long', 'wpn_axe', 'shd_tower',
      pal('tan', 'black', 'gold', 'night', 'brown', 'gold', 'shadow')),
    desc: '직접 칼을 드는 일이 드물어졌다. 그래서 아직 살아 있다.',
  },
  // 칼날무희 → 절검의 무성 / 천무의 환영무희
  bladedancer_apex: {
    name: '절검의 무성', arch: 'fighter', mods: { atk: 1.44, spd: 1.32, crit: 1.60, eva: 1.60, hp: 0.92, def: 0.86 },
    role: '광역 참격 무희', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['dagger', 'katana'], keep: 'dance_of_edges',
    sprite: sp('body_slim', 'head_human', 'hair_pony', 'helm_crown', 'armor_cloth', 'cape_wing', 'wpn_twindagger', 'shd_none',
      pal('pale', 'blond', 'gold', 'night', 'tan', 'gold', 'arcane')),
    desc: '춤이 검이 되고, 검이 다시 한 곡이 되었다.',
  },
  bladedancer_abyss: {
    name: '천무의 환영무희', arch: 'rogue', mods: { eva: 2.10, spd: 1.36, atk: 1.24, hp: 1.12, res: 1.26 },
    role: '극회피 교란', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'slash',
    equip: ['dagger', 'katana'], keep: 'blade_waltz',
    sprite: sp('body_slim', 'head_human', 'hair_long', 'helm_circlet', 'armor_cloth', 'cape_long', 'wpn_katana', 'shd_dagger',
      pal('pale', 'white', 'silver', 'night', 'tan', 'rose', 'arcane')),
    desc: '한 명이 춤을 추는데 그림자는 여섯 개가 흔들린다.',
  },

  // ═════════════════════ 마법사 계열 (apprentice) ═════════════════════
  // 대마법사 → 허공의 마도제 / 만상의 현왕
  archmage_apex: {
    name: '허공의 마도제', arch: 'mage', mods: { atk: 1.56, res: 1.26, hp: 0.92, spd: 1.06 },
    role: '광역 극섬멸', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'bolt',
    equip: ['staff', 'tome', 'wand'], keep: 'meteor',
    sprite: sp('body_slim', 'head_human', 'hair_long', 'helm_crown', 'armor_robe', 'cape_wing', 'wpn_staff', 'shd_orb',
      pal('pale', 'white', 'gold', 'violet', 'brown', 'gold', 'arcane')),
    desc: '주문을 외우지 않는다. 허공이 알아서 자리를 비켜 준다.',
  },
  archmage_abyss: {
    name: '만상의 현왕', arch: 'mage', mods: { atk: 1.24, res: 1.44, hp: 1.30, def: 1.24, spd: 1.10 },
    role: '강화 지원 마도사', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'bolt',
    equip: ['tome', 'staff'], keep: 'arcane_surge',
    sprite: sp('body_normal', 'head_human', 'hair_long', 'helm_wizard', 'armor_robe', 'cape_long', 'wpn_tome', 'shd_orb',
      pal('pale', 'blue', 'silver', 'violet', 'tan', 'silver', 'arcane')),
    desc: '세상을 태우는 법 대신 세상을 고쳐 쓰는 법을 골랐다.',
  },
  // 폭풍술사 → 천뢰의 폭풍제 / 폭풍의 성자
  stormcaller_apex: {
    name: '천뢰의 폭풍제', arch: 'mage', mods: { atk: 1.50, spd: 1.30, crit: 1.60, res: 1.14, hp: 0.92 },
    role: '연쇄 뇌격', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'lightning',
    equip: ['wand', 'staff'], keep: 'chain_lightning',
    sprite: sp('body_normal', 'head_human', 'hair_mohawk', 'helm_crown', 'armor_robe', 'cape_wing', 'wpn_wand', 'shd_orb',
      pal('tan', 'blue', 'silver', 'violet', 'dark', 'gold', 'frost')),
    desc: '구름을 기다리지 않는다. 그가 서면 그 자리가 뇌우다.',
  },
  stormcaller_abyss: {
    name: '폭풍의 성자', arch: 'healer', mods: { res: 1.40, hp: 1.28, atk: 1.26, def: 1.24, spd: 1.16 },
    role: '뇌우 치유 지원', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'lightning',
    equip: ['staff', 'tome'], keep: 'thunder_lance',
    sprite: sp('body_normal', 'head_human', 'hair_long', 'helm_circlet', 'armor_robe', 'cape_long', 'wpn_staff', 'shd_orb',
      pal('pale', 'white', 'steel', 'violet', 'tan', 'azure', 'frost')),
    desc: '벼락으로 상처를 지지고, 같은 벼락으로 적을 지운다.',
  },
  // 사령왕 → 불사의 사령제 / 명계의 수호자
  lichlord_apex: {
    name: '불사의 사령제', arch: 'mage', mods: { atk: 1.50, res: 1.30, hp: 1.10, spd: 1.02 },
    role: '저주 극딜', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'shadow',
    equip: ['staff', 'tome', 'scythe'], keep: 'death_coil',
    sprite: sp('body_slim', 'head_skull', 'hair_none', 'helm_crown', 'armor_bone', 'cape_wing', 'wpn_staff', 'shd_orb',
      pal('bone', 'white', 'bone', 'violet', 'dark', 'gold', 'shadow')),
    desc: '왕관을 쓴 해골. 죽음을 계약이 아니라 영지로 갖는다.',
  },
  lichlord_abyss: {
    name: '명계의 수호자', arch: 'healer', mods: { hp: 1.40, res: 1.42, def: 1.26, atk: 1.18, spd: 0.98 },
    role: '저주 흡수 지원', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'shadow',
    equip: ['tome', 'scythe'], keep: 'curse_of_decay',
    sprite: sp('body_normal', 'head_skull', 'hair_none', 'helm_hood', 'armor_bone', 'cape_long', 'wpn_scythe', 'shd_torch',
      pal('bone', 'white', 'bone', 'violet', 'dark', 'violet', 'shadow')),
    desc: '산 자와 죽은 자의 경계에 서서, 이쪽 사람만 골라 돌려보낸다.',
  },
  // 역병군주 → 만역의 대군주 / 부패의 거체
  plaguelord_apex: {
    name: '만역의 대군주', arch: 'mage', mods: { atk: 1.44, hp: 1.24, res: 1.24, def: 1.14, spd: 1.00 },
    role: '광역 도트', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'poison',
    equip: ['scythe', 'tome'], keep: 'pestilence',
    sprite: sp('body_heavy', 'head_demon', 'hair_none', 'helm_crown', 'armor_robe', 'cape_wing', 'wpn_scythe', 'shd_orb',
      pal('green', 'green', 'bone', 'violet', 'dark', 'gold', 'nature')),
    desc: '역병에 이름을 붙이는 것이 취미다. 대부분 도시 이름이다.',
  },
  plaguelord_abyss: {
    name: '부패의 거체', arch: 'tank', mods: { hp: 1.60, def: 1.40, res: 1.34, atk: 1.02, spd: 0.86 },
    role: '부패 방벽', dmgType: 'magic', range: 'melee', rank: 1, basicFx: 'poison',
    equip: ['scythe', 'mace'], keep: 'rot_touch',
    sprite: sp('body_hulk', 'head_demon', 'hair_none', 'helm_horned', 'armor_bone', 'cape_long', 'wpn_scythe', 'shd_none',
      pal('green', 'green', 'bone', 'violet', 'dark', 'forest', 'nature')),
    desc: '썩는 속도보다 부풀어 오르는 속도가 빨라, 결국 벽이 되었다.',
  },

  // ═════════════════════ 수도사 계열 (acolyte) ═════════════════════
  // 대주교 → 성좌의 교황 / 전쟁의 대사제
  highpriest_abyss: {
    name: '성좌의 교황', arch: 'healer', mods: { res: 1.46, hp: 1.30, atk: 1.26, spd: 1.14 },
    role: '광역 극치유', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'holy',
    equip: ['staff', 'tome'], keep: 'divine_grace',
    sprite: sp('body_normal', 'head_human', 'hair_long', 'helm_crown', 'armor_robe', 'cape_wing', 'wpn_staff', 'shd_torch',
      pal('pale', 'white', 'gold', 'ivory', 'tan', 'gold', 'holy')),
    desc: '기도 한 줄에 부대가 통째로 일어선다. 값은 나중에 청구된다.',
  },
  highpriest_apex: {
    name: '전쟁의 대사제', arch: 'mage', mods: { atk: 1.48, res: 1.24, hp: 1.10, def: 1.10, crit: 1.20 },
    role: '신성 화력', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'holy',
    equip: ['mace', 'staff', 'tome'], keep: 'blessing_of_faith',
    sprite: sp('body_normal', 'head_human', 'hair_short', 'helm_plume', 'armor_plate', 'cape_long', 'wpn_mace', 'shd_torch',
      pal('pale', 'blond', 'gold', 'ivory', 'dark', 'crimson', 'holy')),
    desc: '치유는 부하에게 맡기고, 본인은 심판만 담당한다.',
  },
  // 심판관 → 대심문관 / 정화의 화신
  inquisitor_apex: {
    name: '대심문관', arch: 'mage', mods: { atk: 1.54, res: 1.20, def: 1.24, hp: 1.02, crit: 1.30 },
    role: '신성 극처형', dmgType: 'magic', range: 'ranged', rank: 2, basicFx: 'fire',
    equip: ['tome', 'sword', 'mace'], keep: 'judgement',
    sprite: sp('body_normal', 'head_human', 'hair_short', 'helm_crown', 'armor_plate', 'cape_wing', 'wpn_tome', 'shd_torch',
      pal('pale', 'black', 'gold', 'ivory', 'dark', 'crimson', 'fire')),
    desc: '명부에 이름이 오르는 순간 재판은 이미 끝나 있다.',
  },
  inquisitor_abyss: {
    name: '정화의 화신', arch: 'tank', mods: { def: 1.40, hp: 1.38, res: 1.30, atk: 1.16, spd: 0.96 },
    role: '정화 화염 방벽', dmgType: 'magic', range: 'melee', rank: 1, basicFx: 'fire',
    equip: ['mace', 'sword', 'shield'], keep: 'flame_of_purge',
    sprite: sp('body_heavy', 'head_human', 'hair_none', 'helm_great', 'armor_plate', 'cape_long', 'wpn_mace', 'shd_kite',
      pal('pale', 'black', 'gold', 'ivory', 'dark', 'ember', 'fire')),
    desc: '스스로 화형대가 되어 앞줄에 선다. 타는 쪽은 언제나 상대다.',
  },
  // 나한 → 무극의 투신 / 금강불괴
  arhat_apex: {
    name: '무극의 투신', arch: 'fighter', mods: { atk: 1.46, spd: 1.28, crit: 1.40, def: 1.10, hp: 1.06, eva: 1.40 },
    role: '연격 격투가', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['claw', 'staff'], keep: 'hundred_fists',
    sprite: sp('body_heavy', 'head_human', 'hair_bald', 'helm_crown', 'armor_bare', 'cape_wing', 'wpn_claw', 'shd_none',
      pal('tan', 'black', 'gold', 'ivory', 'tan', 'gold', 'holy')),
    desc: '주먹이 백 번 나갈 동안 상대는 한 번도 나가지 못한다.',
  },
  arhat_abyss: {
    name: '금강불괴', arch: 'tank', mods: { def: 1.50, hp: 1.46, res: 1.36, atk: 1.06, spd: 0.94, eva: 1.30 },
    role: '불괴 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'blunt',
    equip: ['claw', 'staff', 'mace'], keep: 'iron_body',
    sprite: sp('body_hulk', 'head_human', 'hair_bald', 'helm_circlet', 'armor_bare', 'cape_long', 'wpn_claw', 'shd_none',
      pal('tan', 'black', 'gold', 'ivory', 'tan', 'gold', 'arcane')),
    desc: '갑주를 걸치지 않는다. 육신이 이미 갑주보다 단단하다.',
  },
  // 파계승 → 아수라 파계존 / 업화의 대존자
  fallenmonk_apex: {
    name: '아수라 파계존', arch: 'fighter', mods: { atk: 1.56, spd: 1.22, crit: 1.35, hp: 1.06, def: 0.90 },
    role: '타락 극딜', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['claw', 'mace'], keep: 'demon_palm',
    sprite: sp('body_hulk', 'head_demon', 'hair_bald', 'helm_horned', 'armor_bare', 'cape_wing', 'wpn_hammer', 'shd_none',
      pal('ash', 'black', 'dark', 'ivory', 'dark', 'blood', 'shadow')),
    desc: '계율을 어긴 대가로 팔이 여섯 개인 꿈을 매일 꾼다.',
  },
  fallenmonk_abyss: {
    name: '업화의 대존자', arch: 'tank', mods: { hp: 1.44, def: 1.32, res: 1.24, atk: 1.22, spd: 1.00 },
    role: '업화 반격 방벽', dmgType: 'phys', range: 'melee', rank: 1, basicFx: 'shadow',
    equip: ['claw', 'mace'], keep: 'karma_burst',
    sprite: sp('body_hulk', 'head_demon', 'hair_bald', 'helm_crown', 'armor_bare', 'cape_long', 'wpn_claw', 'shd_none',
      pal('red', 'black', 'blood', 'ivory', 'dark', 'gold', 'fire')),
    desc: '남의 업까지 대신 태우기로 했다. 그래서 그의 불은 꺼지지 않는다.',
  },
};

/**
 * 조립 — SPEC §3.2 Class 형태로 정규화한다.
 * `keep` 은 최종 객체에 남기지 않고 `skills` 로 흡수한다.
 * @type {Record<string, object>}
 */
export const T4_CLASSES = {};
for (const [id, c] of Object.entries(RAW)) {
  T4_CLASSES[id] = {
    id,
    name: c.name,
    tier: 4,
    arch: c.arch,
    mods: c.mods,
    role: c.role,
    dmgType: c.dmgType,
    range: c.range,
    rank: c.rank,
    basicFx: c.basicFx,
    equip: c.equip,
    skills: [c.keep, `t4_${id}`],
    next: [],
    sprite: c.sprite,
    desc: c.desc,
  };
}

/** 4차 id 배열 (도감/검증용) */
export const T4_IDS = Object.keys(T4_CLASSES);
