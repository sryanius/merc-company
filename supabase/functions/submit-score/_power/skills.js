// 스킬 정의 (SPEC §3.1). 순수 데이터 — DOM/Canvas 참조 금지.
//
// ── 필드 규약 ────────────────────────────────────────────────────────────
//  cd        재사용 대기(초). 1~3차 5~14 / 4차 10~20
//  power     atk 배율. 단일 1.6~2.6 / 광역·다중 0.8~1.4 / 회복 1.0~1.8
//            4차 전용 스킬만 예외로 한 단계 위를 쓴다:
//              단일 2.6~3.6 / 광역·다중 1.4~2.0 / 회복 1.8~2.6
//            target 이 아군/자신이면 엔진은 최상위 power 로 피해를 계산하지 않는다.
//            (회복량은 반드시 effects 의 {type:'heal', power} 로 지정한다.
//             최상위 power 는 밸런스 표기용으로 같은 값을 함께 적어 둔다.)
//  dmgType   'phys' | 'magic' | 'none'   ('none' 이면 피해 없음 = 지원기)
//  target    'enemy' | 'ally' | 'self' | 'allEnemy' | 'allAlly'
//  select    'front' | 'back' | 'lowestHp' | 'highestAtk' | 'random' | 'self' | 'lowestHpAlly'
//            (allEnemy/allAlly/self 는 select 무시)
//  count     타겟 수. 2 이상이면 다중타격/관통으로 취급
//  range     'melee'(돌진 모션) | 'ranged'(제자리 + 투사체)
//  fx        slash pierce arrow bolt fire ice holy shadow nature lightning blunt poison buff heal
//
// ── effects 규약 ─────────────────────────────────────────────────────────
//  target 이 **없는** 효과는 이 스킬이 맞힌 대상 전원에게 적용된다.
//  target 이 **있는** 효과는 스킬 사용당 1회, 지정 범위에 적용된다.
//   heal      { power }                       회복량 = 시전자 atk * power
//   buff      { stat, amount, dur }           amount 는 비율 (0.3 = +30%)
//   debuff    { stat, amount, dur }           amount 는 음수
//   dot       { dmgType, power, tick, dur }   틱마다 atk * power 피해
//   shield    { power, dur }                  흡수량 = 시전자 atk * power
//   stun      { dur, chance }
//   lifesteal { ratio }                       가한 피해의 ratio 만큼 자가 회복
//   execute   { threshold, bonus }            대상 HP 비율 <= threshold 이면 피해 x(1+bonus)
//   counter   { ratio, dur }                  지속시간 동안 피격 시 atk*ratio 로 반격
//  ※ execute / counter 는 engine.applyEffect 에 케이스가 없으면 조용히 무시된다.
//    (그래서 이 두 효과를 쓰는 스킬은 기본 위력만으로도 제 몫을 하도록 잡아 두었다)
//    2026-07 현재 engine 이 실제로 처리하는 효과는 위 7종뿐이다 —
//    아래 4차 스킬은 execute/counter 를 쓰지 않고 7종 안에서만 성격을 만든다.
//
// ── 4차 스킬 id 규칙 (data/classes_t4.js 와의 계약) ────────────────────────
//  3차 클래스 28종 각각이 4차 후보 2종을 갖는다. 그 id 를 다음으로 못박는다:
//     4차 클래스 id  =  '<3차클래스id>_apex'   |  '<3차클래스id>_abyss'
//     4차 스킬   id  =  't4_<3차클래스id>_apex' | 't4_<3차클래스id>_abyss'
//  성격 분담: _apex  = 공격·폭발 (고위력 단일 / 광역 섬멸 / 처형)
//            _abyss = 지속·생존·제어 (도트 / 보호막 / 기절·약화 / 흡혈)

/** @type {Record<string, object>} */
const RAW = {
  // ══════════════════════════════════════════════════ 1차 클래스 (7)
  slash: {
    name: '베기', cd: 6, power: 1.9, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'slash',
    desc: '전방의 적을 힘껏 베어 넘긴다.',
  },
  thrust: {
    name: '관통 찌르기', cd: 7, power: 1.35, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 2, range: 'melee', fx: 'pierce',
    desc: '창을 내질러 일렬로 선 적 둘을 한 번에 꿰뚫는다.',
  },
  shield_bash: {
    name: '방패 강타', cd: 9, power: 1.6, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'blunt',
    effects: [{ type: 'stun', dur: 1.2, chance: 0.35 }],
    desc: '방패로 적의 투구를 후려쳐 잠시 기절시킨다.',
  },
  aimed_shot: {
    name: '조준 사격', cd: 7, power: 2.0, dmgType: 'phys',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'ranged', fx: 'arrow',
    desc: '가장 약해진 적을 침착하게 겨눠 쏜다.',
  },
  backstab: {
    name: '급습', cd: 7, power: 2.1, dmgType: 'phys',
    target: 'enemy', select: 'back', count: 1, range: 'melee', fx: 'slash',
    desc: '적진 뒤로 파고들어 무방비한 등을 찌른다.',
  },
  magic_bolt: {
    name: '마력탄', cd: 6, power: 1.9, dmgType: 'magic',
    target: 'enemy', select: 'random', count: 1, range: 'ranged', fx: 'bolt',
    desc: '응축한 마력 덩어리를 쏘아 보낸다.',
  },
  mend: {
    name: '치유의 손길', cd: 6, power: 2.0, dmgType: 'none',
    target: 'ally', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [{ type: 'heal', power: 2.0 }],
    desc: '가장 다친 아군의 상처를 어루만져 회복시킨다.',
  },

  // ══════════════════════════════════════════════════ 2차 클래스 (14)
  frenzy: {
    name: '광란', cd: 12, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.35, dur: 10 },
      { type: 'buff', stat: 'spd', amount: 0.2, dur: 10 },
    ],
    desc: '이성을 놓고 날뛰어 공격력과 속도를 끌어올린다.',
  },
  crescent_slash: {
    name: '월광참', cd: 9, power: 1.2, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 3, range: 'melee', fx: 'slash',
    desc: '초승달 궤적으로 앞줄의 적 셋을 한꺼번에 벤다.',
  },
  charge_lance: {
    name: '돌격창', cd: 10, power: 2.3, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'pierce',
    effects: [{ type: 'debuff', stat: 'def', amount: -0.25, dur: 6 }],
    desc: '말발굽처럼 내달려 적의 갑주를 찢어놓는다.',
  },
  sweep: {
    name: '미늘 휘두르기', cd: 8, power: 1.15, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 3, range: 'melee', fx: 'slash',
    effects: [{ type: 'stun', dur: 1.0, chance: 0.2 }],
    desc: '미늘창을 크게 휘둘러 앞줄을 통째로 쓸어버린다.',
  },
  bulwark_stance: {
    name: '방벽 태세', cd: 12, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'shield', power: 1.4, dur: 8 },
      { type: 'buff', stat: 'def', amount: 0.4, dur: 8 },
    ],
    desc: '방패를 세워 두터운 보호막과 방어력을 얻는다.',
  },
  aegis: {
    name: '수호의 결계', cd: 13, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [{ type: 'shield', power: 0.9, dur: 8 }],
    desc: '부대 전체에 결계를 둘러 피해를 흡수한다.',
  },
  snipe: {
    name: '저격', cd: 10, power: 2.5, dmgType: 'phys',
    target: 'enemy', select: 'back', count: 1, range: 'ranged', fx: 'arrow',
    desc: '적 후열의 요인을 단 한 발로 관통한다.',
  },
  hunters_mark: {
    name: '사냥꾼의 표식', cd: 8, power: 1.6, dmgType: 'phys',
    target: 'enemy', select: 'highestAtk', count: 1, range: 'ranged', fx: 'arrow',
    effects: [
      { type: 'debuff', stat: 'def', amount: -0.25, dur: 8 },
      { type: 'debuff', stat: 'spd', amount: -0.15, dur: 8 },
    ],
    desc: '가장 위협적인 적에게 표식을 남겨 굼뜨고 무르게 만든다.',
  },
  assassinate: {
    name: '암살', cd: 10, power: 2.4, dmgType: 'phys',
    target: 'enemy', select: 'back', count: 1, range: 'melee', fx: 'slash',
    desc: '기척을 지운 채 후열로 파고들어 급소에 칼을 꽂는다.',
  },
  cheap_shot: {
    name: '비열한 일격', cd: 8, power: 1.8, dmgType: 'phys',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'melee', fx: 'blunt',
    effects: [{ type: 'stun', dur: 1.0, chance: 0.4 }],
    desc: '규칙 따위 없다. 급소를 노려 적의 숨을 끊어놓는다.',
  },
  fireball: {
    name: '화염구', cd: 11, power: 1.1, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'fire',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.3, tick: 1, dur: 5 }],
    desc: '터지는 불덩이로 적 전체를 태우고 불씨를 남긴다.',
  },
  life_drain: {
    name: '생명 흡수', cd: 9, power: 1.8, dmgType: 'magic',
    target: 'enemy', select: 'highestAtk', count: 1, range: 'ranged', fx: 'shadow',
    effects: [{ type: 'lifesteal', ratio: 0.6 }],
    desc: '적의 생기를 빨아들여 자신의 상처를 메운다.',
  },
  heal_light: {
    name: '성광의 축복', cd: 7, power: 2.6, dmgType: 'none',
    target: 'ally', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [{ type: 'heal', power: 2.6 }],
    desc: '성스러운 빛으로 아군 하나를 크게 회복시킨다.',
  },
  palm_strike: {
    name: '붕권', cd: 8, power: 2.0, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'blunt',
    effects: [{ type: 'stun', dur: 0.9, chance: 0.25 }],
    desc: '기를 실은 장타로 적의 중심을 무너뜨린다.',
  },

  // ══════════════════════════════════════════════════ 3차 클래스 (56)
  // ── 광기의 대장군
  war_cry: {
    name: '전장의 포효', cd: 13, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.3, dur: 10 },
      { type: 'buff', stat: 'crit', amount: 0.3, dur: 10 },
    ],
    desc: '전장을 뒤흔드는 포효로 부대 전원의 투지를 끌어올린다.',
  },
  mad_cleave: {
    name: '광란의 참격', cd: 11, power: 1.3, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    desc: '적진 한복판을 미친 듯이 휘저어 전원을 베어젖힌다.',
  },
  // ── 혈귀검사
  blood_reave: {
    name: '피의 수확', cd: 9, power: 2.2, dmgType: 'phys',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'lifesteal', ratio: 0.5 }],
    desc: '적의 피를 베어 마시며 제 상처를 아물린다.',
  },
  crimson_pact: {
    name: '붉은 서약', cd: 14, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.45, dur: 9 },
      { type: 'buff', stat: 'crit', amount: 0.4, dur: 9 },
    ],
    desc: '제 피로 맺은 서약이 광포한 힘을 되돌려 준다.',
  },
  // ── 검신
  divine_blade: {
    name: '신검일섬', cd: 11, power: 2.6, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'slash',
    desc: '단 한 번의 섬광. 그것으로 승부가 끝난다.',
  },
  thousand_cuts: {
    name: '천검난무', cd: 12, power: 1.35, dmgType: 'phys',
    target: 'enemy', select: 'random', count: 3, range: 'melee', fx: 'slash',
    desc: '셀 수 없는 검격이 적진 곳곳을 난도질한다.',
  },
  // ── 파천검호
  sky_cleave: {
    name: '파천격', cd: 12, power: 1.25, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'debuff', stat: 'def', amount: -0.2, dur: 6 }],
    desc: '하늘을 가르는 검압이 적 전체의 갑주를 쪼갠다.',
  },
  counter_stance: {
    name: '발도 태세', cd: 11, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'eva', amount: 0.45, dur: 10 },
    ],
    desc: '칼집에 손을 얹고 숨을 죽인다. 한동안 어떤 칼날도 몸에 닿지 않는다.',
  },
  // ── 용기병 대장
  dragon_charge: {
    name: '용의 돌격', cd: 10, power: 2.4, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'pierce',
    effects: [{ type: 'stun', dur: 1.2, chance: 0.3 }],
    desc: '용의 기세로 돌진해 적을 꿰뚫고 넘어뜨린다.',
  },
  banner_of_valor: {
    name: '용맹의 깃발', cd: 13, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'def', amount: 0.25, dur: 10 },
      { type: 'buff', stat: 'spd', amount: 0.18, dur: 10 },
    ],
    desc: '깃발을 세워 아군의 방어와 진격 속도를 함께 높인다.',
  },
  // ── 천공창기사
  heaven_pierce: {
    name: '천공 관통', cd: 10, power: 1.4, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 3, range: 'melee', fx: 'pierce',
    desc: '창끝이 일직선으로 늘어선 적 셋을 한 번에 꿰뚫는다.',
  },
  sky_fall: {
    name: '낙뢰창', cd: 11, power: 2.2, dmgType: 'magic',
    target: 'enemy', select: 'back', count: 1, range: 'ranged', fx: 'lightning',
    effects: [{ type: 'stun', dur: 0.8, chance: 0.25 }],
    desc: '창에 벼락을 실어 적 후열 위로 내리꽂는다.',
  },
  // ── 관문수호자
  iron_gate: {
    name: '강철 관문', cd: 12, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'shield', power: 1.8, dur: 10 },
      { type: 'buff', stat: 'def', amount: 0.35, dur: 10 },
    ],
    desc: '스스로 관문이 되어 적의 진격을 틀어막는다.',
  },
  warden_smash: {
    name: '관문 강타', cd: 10, power: 1.6, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'blunt',
    effects: [{ type: 'stun', dur: 1.5, chance: 0.5 }],
    desc: '창대를 내리쳐 적을 오래도록 주저앉힌다.',
  },
  // ── 사신낫병
  soul_reap: {
    name: '영혼 수확', cd: 10, power: 2.3, dmgType: 'phys',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'melee', fx: 'slash',
    desc: '죽음에 가장 가까운 자부터 낫으로 거둬들인다.',
  },
  death_scythe: {
    name: '죽음의 낫', cd: 12, power: 1.15, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.35, tick: 1, dur: 6 }],
    desc: '사신의 낫이 적 전체에 죽음의 표식을 새긴다.',
  },
  // ── 성전기사
  holy_smite: {
    name: '성스러운 심판', cd: 9, power: 2.0, dmgType: 'magic',
    target: 'enemy', select: 'highestAtk', count: 1, range: 'melee', fx: 'holy',
    effects: [{ type: 'stun', dur: 1.0, chance: 0.3 }],
    desc: '신벌의 빛이 가장 사나운 적을 내리친다.',
  },
  sanctuary: {
    name: '성역', cd: 12, power: 1.7, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [{ type: 'heal', power: 1.7 }],
    desc: '성역을 펼쳐 부대 전원의 상처를 어루만진다.',
  },
  // ── 흑기사
  dread_slash: {
    name: '암흑참', cd: 9, power: 2.3, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'shadow',
    effects: [{ type: 'debuff', stat: 'atk', amount: -0.25, dur: 6 }],
    desc: '어둠을 머금은 칼날이 적의 전의까지 꺾어놓는다.',
  },
  soul_siphon: {
    name: '영혼 흡취', cd: 11, power: 1.7, dmgType: 'magic',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'ranged', fx: 'shadow',
    effects: [{ type: 'lifesteal', ratio: 0.7 }],
    desc: '적의 영혼을 빨아들여 자신의 생명으로 바꾼다.',
  },
  // ── 불굴의 성벽
  unbreakable: {
    name: '불굴', cd: 12, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'shield', power: 2.9, dur: 10 },
    ],
    desc: '무너지지 않는 각오로 두꺼운 보호막을 두른다.',
  },
  shield_crush: {
    name: '방패 분쇄', cd: 8, power: 1.6, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'blunt',
    effects: [{ type: 'stun', dur: 1.3, chance: 0.45 }],
    desc: '방패 모서리로 적의 투구를 짓이겨 버린다.',
  },
  // ── 서약의 방패
  oath_ward: {
    name: '서약의 가호', cd: 12, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [{ type: 'shield', power: 1.1, dur: 9 }],
    desc: '맹세의 빛이 부대 전원을 두껍게 감싼다.',
  },
  vow_of_light: {
    name: '빛의 서약', cd: 9, power: 2.6, dmgType: 'none',
    target: 'ally', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [
      { type: 'heal', power: 2.6 },
      { type: 'buff', stat: 'def', amount: 0.3, dur: 8 },
    ],
    desc: '가장 위태로운 아군을 치유하고 방어를 굳혀 준다.',
  },
  // ── 신궁
  piercing_arrow: {
    name: '파공시', cd: 10, power: 1.35, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 3, range: 'ranged', fx: 'arrow',
    desc: '화살 한 대가 늘어선 적 셋을 뚫고 지나간다.',
  },
  heart_seeker: {
    name: '심장 저격', cd: 12, power: 2.85, dmgType: 'phys',
    target: 'enemy', select: 'back', count: 1, range: 'ranged', fx: 'arrow',
    desc: '적장의 심장만을 노린 필살의 한 발.',
  },
  // ── 그림자 사수
  shadow_volley: {
    name: '그림자 연사', cd: 10, power: 1.3, dmgType: 'phys',
    target: 'enemy', select: 'random', count: 3, range: 'ranged', fx: 'arrow',
    desc: '어둠 속에서 세 발을 연달아 흩뿌린다.',
  },
  veil_shot: {
    name: '어둠의 화살', cd: 10, power: 2.3, dmgType: 'phys',
    target: 'enemy', select: 'back', count: 1, range: 'ranged', fx: 'shadow',
    effects: [{ type: 'debuff', stat: 'spd', amount: -0.3, dur: 6 }],
    desc: '그림자에 잠긴 화살이 적 후열의 발을 묶는다.',
  },
  // ── 야수군주
  beast_call: {
    name: '야수의 부름', cd: 13, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.22, dur: 10 },
      { type: 'buff', stat: 'spd', amount: 0.18, dur: 10 },
    ],
    desc: '야성의 함성으로 부대를 짐승처럼 몰아붙인다.',
  },
  savage_maul: {
    name: '맹수의 이빨', cd: 9, power: 2.2, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'lifesteal', ratio: 0.35 }],
    desc: '짐승의 이빨로 적을 물어뜯어 생기를 취한다.',
  },
  // ── 정령궁수
  spirit_arrow: {
    name: '정령의 화살', cd: 9, power: 2.2, dmgType: 'magic',
    target: 'enemy', select: 'random', count: 1, range: 'ranged', fx: 'nature',
    desc: '정령의 기운을 실은 화살이 갑주를 무시하고 파고든다.',
  },
  verdant_blessing: {
    name: '초록의 축복', cd: 11, power: 1.5, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [{ type: 'heal', power: 1.5 }],
    desc: '숲의 기운이 부대 전원의 상처를 덮어 준다.',
  },
  // ── 그림자 밀사
  shadow_step: {
    name: '그림자 도약', cd: 10, power: 2.75, dmgType: 'phys',
    target: 'enemy', select: 'back', count: 1, range: 'melee', fx: 'shadow',
    desc: '그림자를 밟고 후열로 뛰어들어 목을 노린다.',
  },
  phantom_veil: {
    name: '환영의 장막', cd: 12, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'eva', amount: 0.5, dur: 9 },
      { type: 'buff', stat: 'spd', amount: 0.25, dur: 9 },
    ],
    desc: '환영을 둘러 적의 시야에서 자취를 감춘다.',
  },
  // ── 독아
  venom_strike: {
    name: '맹독 일격', cd: 8, power: 1.8, dmgType: 'phys',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'melee', fx: 'poison',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.45, tick: 1, dur: 6 }],
    desc: '독을 바른 칼날로 적을 서서히 무너뜨린다.',
  },
  plague_dagger: {
    name: '역병의 단검', cd: 13, power: 0.9, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'poison',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.3, tick: 1, dur: 8 }],
    desc: '독무를 흩뿌려 적 전체를 오래도록 곪게 만든다.',
  },
  // ── 도적왕
  pillage: {
    name: '약탈', cd: 9, power: 2.2, dmgType: 'phys',
    target: 'enemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'debuff', stat: 'def', amount: -0.3, dur: 6 }],
    desc: '닥치는 대로 베고 빼앗아 적의 방비를 헐어낸다.',
  },
  ambush_order: {
    name: '매복 명령', cd: 13, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [{ type: 'buff', stat: 'crit', amount: 0.5, dur: 9 }],
    desc: '부하들에게 급소만 노리라 명령한다.',
  },
  // ── 칼날무희
  blade_waltz: {
    name: '칼날의 왈츠', cd: 10, power: 1.2, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    desc: '춤추듯 적진을 가로지르며 전원을 베어낸다.',
  },
  dance_of_edges: {
    name: '검무', cd: 11, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'spd', amount: 0.45, dur: 9 },
    ],
    desc: '끝나지 않는 검무로 몸놀림이 걷잡을 수 없이 빨라진다.',
  },
  // ── 대마법사
  meteor: {
    name: '메테오', cd: 14, power: 1.4, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'fire',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.35, tick: 1, dur: 6 }],
    desc: '하늘에서 불덩이를 떨어뜨려 전장을 통째로 태운다.',
  },
  arcane_surge: {
    name: '비전 폭주', cd: 13, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.45, dur: 9 },
      { type: 'buff', stat: 'spd', amount: 0.2, dur: 9 },
    ],
    desc: '비전 마력을 폭주시켜 주문의 위력을 끌어올린다.',
  },
  // ── 폭풍술사
  chain_lightning: {
    name: '연쇄 번개', cd: 10, power: 1.3, dmgType: 'magic',
    target: 'enemy', select: 'random', count: 3, range: 'ranged', fx: 'lightning',
    effects: [{ type: 'stun', dur: 0.7, chance: 0.2 }],
    desc: '번개가 적에서 적으로 튀며 세 명을 감전시킨다.',
  },
  thunder_lance: {
    name: '뇌창', cd: 9, power: 2.5, dmgType: 'magic',
    target: 'enemy', select: 'back', count: 1, range: 'ranged', fx: 'lightning',
    desc: '뇌전의 창이 적 후열을 단숨에 꿰뚫는다.',
  },
  // ── 사령왕
  death_coil: {
    name: '죽음의 고리', cd: 10, power: 2.4, dmgType: 'magic',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'ranged', fx: 'shadow',
    effects: [{ type: 'lifesteal', ratio: 0.5 }],
    desc: '죽음의 마력을 던져 적의 생명을 통째로 앗아 온다.',
  },
  curse_of_decay: {
    name: '부패의 저주', cd: 13, power: 0, dmgType: 'none',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'shadow',
    effects: [
      { type: 'dot', dmgType: 'magic', power: 0.35, tick: 1, dur: 8 },
      { type: 'debuff', stat: 'def', amount: -0.25, dur: 8 },
    ],
    desc: '적 전체를 부패시켜 안에서부터 허물어뜨린다.',
  },
  // ── 역병군주
  pestilence: {
    name: '역병 창궐', cd: 12, power: 1.1, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'poison',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.4, tick: 1, dur: 8 }],
    desc: '역병이 적진에 퍼져 하나도 남김없이 좀먹는다.',
  },
  rot_touch: {
    name: '부패의 손길', cd: 9, power: 2.1, dmgType: 'magic',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'poison',
    effects: [{ type: 'debuff', stat: 'res', amount: -0.3, dur: 7 }],
    desc: '닿은 자리부터 썩어들어가 마법 저항을 갉아먹는다.',
  },
  // ── 대주교
  divine_grace: {
    name: '신성한 은총', cd: 11, power: 1.9, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [{ type: 'heal', power: 1.9 }],
    desc: '은총의 비가 부대 전원을 감싸 회복시킨다.',
  },
  blessing_of_faith: {
    name: '신앙의 축복', cd: 13, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'def', amount: 0.3, dur: 10 },
      { type: 'buff', stat: 'res', amount: 0.3, dur: 10 },
    ],
    desc: '굳은 신앙으로 아군의 방어와 저항을 함께 세운다.',
  },
  // ── 심판관
  judgement: {
    name: '심판', cd: 10, power: 2.65, dmgType: 'magic',
    target: 'enemy', select: 'highestAtk', count: 1, range: 'ranged', fx: 'holy',
    desc: '죄 많은 자에게 한 치의 자비도 없는 심판을 내린다.',
  },
  flame_of_purge: {
    name: '정죄의 불길', cd: 12, power: 1.2, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'fire',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.35, tick: 1, dur: 6 }],
    desc: '정죄의 불길이 적 전체를 남김없이 사른다.',
  },
  // ── 나한
  hundred_fists: {
    name: '백보신권', cd: 9, power: 1.3, dmgType: 'phys',
    target: 'enemy', select: 'random', count: 3, range: 'melee', fx: 'blunt',
    desc: '보이지 않는 주먹이 사방의 적을 동시에 때린다.',
  },
  iron_body: {
    name: '금강불괴', cd: 11, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'shield', power: 2.2, dur: 9 },
    ],
    desc: '육신을 쇠처럼 단련해 웬만한 타격을 그대로 튕겨 낸다.',
  },
  // ── 파계승
  demon_palm: {
    name: '마라장', cd: 9, power: 2.4, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'shadow',
    effects: [{ type: 'lifesteal', ratio: 0.4 }],
    desc: '타락한 기를 실은 장타가 적의 생기를 앗아 온다.',
  },
  karma_burst: {
    name: '업화 폭발', cd: 12, power: 1.25, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'fire',
    desc: '쌓이고 쌓인 업이 불길이 되어 적진 한복판에서 터진다.',
  },

  // ══════════════════════════════════════════════════ 4차 클래스 (56)
  // id = 't4_<3차클래스id>_apex' | 't4_<3차클래스id>_abyss' (파일 상단 계약 참조)
  // apex  = 공격·폭발 / abyss = 지속·생존·제어

  // ── 검사 계열 ────────────────────────────────────────────────
  // madgeneral 광기의 대장군
  t4_madgeneral_apex: {
    name: '멸군참', cd: 17, power: 1.95, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    effects: [
      { type: 'debuff', stat: 'def', amount: -0.35, dur: 9 },
      { type: 'stun', dur: 1.2, chance: 0.3 },
    ],
    desc: '한 번 휘두르면 군세가 통째로 무너진다. 살아남은 자의 갑주도 남아 있지 않다.',
  },
  t4_madgeneral_abyss: {
    name: '광란의 군령', cd: 20, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.5, dur: 12 },
      { type: 'buff', stat: 'crit', amount: 0.6, dur: 12 },
      { type: 'buff', stat: 'spd', amount: 0.25, dur: 12 },
      { type: 'shield', power: 1.2, dur: 12 },
    ],
    desc: '광기를 명령으로 내린다. 부대 전원이 두려움을 잊고 짐승처럼 달려든다.',
  },
  // bloodfiend 혈귀검사
  t4_bloodfiend_apex: {
    name: '혈해일참', cd: 12, power: 3.1, dmgType: 'phys',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'lifesteal', ratio: 0.75 }],
    desc: '베어낸 피를 그대로 삼킨다. 빈사의 적일수록 더 달다.',
  },
  t4_bloodfiend_abyss: {
    name: '혈옥의 굴레', cd: 16, power: 1.5, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'shadow',
    effects: [
      { type: 'dot', dmgType: 'magic', power: 0.5, tick: 1, dur: 8 },
      { type: 'lifesteal', ratio: 0.6 },
    ],
    desc: '적진 전체를 피의 우리에 가둔다. 흘린 피는 전부 제 것이 된다.',
  },
  // swordgod 검신
  t4_swordgod_apex: {
    name: '무한일검', cd: 17, power: 3.5, dmgType: 'phys',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'buff', stat: 'spd', amount: 0.35, dur: 9, target: 'self' }],
    desc: '베는 순간과 베고 난 뒤가 구분되지 않는다. 한 합에 끝난 뒤 검이 더 빨라진다.',
  },
  t4_swordgod_abyss: {
    name: '수라의 폐검진', cd: 18, power: 1.6, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    effects: [
      { type: 'debuff', stat: 'atk', amount: -0.35, dur: 9 },
      { type: 'stun', dur: 1.2, chance: 0.35 },
    ],
    desc: '부러진 검을 땅에 꽂아 만든 진. 안에 든 자는 검을 들 힘조차 잃는다.',
  },
  // skysplitter 파천검호
  t4_skysplitter_apex: {
    name: '파천개벽', cd: 17, power: 2.0, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'debuff', stat: 'def', amount: -0.4, dur: 9 }],
    desc: '하늘이 갈라진 자리로 검압이 쏟아진다. 갑주는 종이처럼 벌어진다.',
  },
  t4_skysplitter_abyss: {
    name: '무형발도경', cd: 18, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'eva', amount: 0.55, dur: 12 },
      { type: 'shield', power: 2.6, dur: 12 },
      { type: 'debuff', stat: 'atk', amount: -0.25, dur: 10, target: 'allEnemy' },
    ],
    desc: '칼집에 손을 얹은 채 숨을 지운다. 적은 어디를 베어야 하는지조차 잊는다.',
  },

  // ── 창병 계열 ────────────────────────────────────────────────
  // dragoonlord 용기병 대장
  t4_dragoonlord_apex: {
    name: '용왕의 창강', cd: 14, power: 3.2, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'pierce',
    effects: [
      { type: 'stun', dur: 1.6, chance: 0.55 },
      { type: 'debuff', stat: 'def', amount: -0.3, dur: 8 },
    ],
    desc: '용의 기세를 창끝 하나에 몰아 꽂는다. 맞은 자는 일어서지 못한다.',
  },
  t4_dragoonlord_abyss: {
    name: '용린의 군기', cd: 19, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'def', amount: 0.4, dur: 12 },
      { type: 'buff', stat: 'res', amount: 0.4, dur: 12 },
      { type: 'buff', stat: 'spd', amount: 0.22, dur: 12 },
      { type: 'shield', power: 1.5, dur: 12 },
    ],
    desc: '용의 비늘로 짠 군기가 펄럭이는 동안 부대는 쓰러지지 않는다.',
  },
  // skylancer 천공창기사
  t4_skylancer_apex: {
    name: '천벌뇌창', cd: 15, power: 3.3, dmgType: 'magic',
    target: 'enemy', select: 'back', count: 1, range: 'ranged', fx: 'lightning',
    effects: [{ type: 'stun', dur: 1.4, chance: 0.5 }],
    desc: '구름을 찢고 내려온 벼락이 창끝을 따라 적 후열에 내리꽂힌다.',
  },
  t4_skylancer_abyss: {
    name: '뇌옥결계', cd: 18, power: 1.5, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'lightning',
    effects: [
      { type: 'stun', dur: 1.0, chance: 0.4 },
      { type: 'debuff', stat: 'spd', amount: -0.35, dur: 9 },
      { type: 'dot', dmgType: 'magic', power: 0.4, tick: 1, dur: 6 },
    ],
    desc: '전장을 번개의 우리로 덮는다. 발을 옮기는 자마다 감전된다.',
  },
  // gatewarden 관문수호자
  t4_gatewarden_apex: {
    name: '관문 붕괴타', cd: 14, power: 2.8, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'blunt',
    effects: [
      { type: 'stun', dur: 2.0, chance: 0.7 },
      { type: 'debuff', stat: 'spd', amount: -0.3, dur: 8 },
    ],
    desc: '관문을 닫는 힘으로 내리찍는다. 적은 오래도록 주저앉아 일어나지 못한다.',
  },
  t4_gatewarden_abyss: {
    name: '불락의 관문', cd: 20, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'shield', power: 1.7, dur: 13 },
      { type: 'buff', stat: 'def', amount: 0.35, dur: 13 },
      { type: 'shield', power: 2.0, dur: 13, target: 'self' },
    ],
    desc: '부대 앞에 보이지 않는 성문을 세운다. 문지기 자신이 가장 두꺼운 문이 된다.',
  },
  // reaper 사신낫병
  t4_reaper_apex: {
    name: '종말의 수확', cd: 15, power: 3.4, dmgType: 'phys',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'lifesteal', ratio: 0.4 }],
    desc: '죽음에 가장 가까운 자를 낫 한 번으로 거둔다. 유예는 없다.',
  },
  t4_reaper_abyss: {
    name: '만인의 장례', cd: 18, power: 1.5, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    effects: [
      { type: 'dot', dmgType: 'magic', power: 0.6, tick: 1, dur: 10 },
      { type: 'debuff', stat: 'res', amount: -0.3, dur: 10 },
    ],
    desc: '적 전원의 이름을 명부에 올린다. 적어 넣은 순서대로 숨이 끊긴다.',
  },

  // ── 방패병 계열 ──────────────────────────────────────────────
  // paladin 성전기사
  t4_paladin_apex: {
    name: '천벌의 심판검', cd: 14, power: 3.0, dmgType: 'magic',
    target: 'enemy', select: 'highestAtk', count: 1, range: 'melee', fx: 'holy',
    effects: [
      { type: 'stun', dur: 1.5, chance: 0.5 },
      { type: 'debuff', stat: 'atk', amount: -0.3, dur: 8 },
    ],
    desc: '하늘에서 내려온 빛이 검을 타고 흐른다. 가장 사나운 죄인부터 무릎을 꺾는다.',
  },
  t4_paladin_abyss: {
    name: '대성역', cd: 17, power: 2.4, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [
      { type: 'heal', power: 2.4 },
      { type: 'shield', power: 1.5, dur: 12 },
      { type: 'buff', stat: 'res', amount: 0.35, dur: 12 },
    ],
    desc: '발 딛은 자리가 성역이 된다. 그 안에서 아군은 상처도 저주도 받지 않는다.',
  },
  // blackknight 흑기사
  t4_blackknight_apex: {
    name: '심연대참', cd: 14, power: 3.3, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'shadow',
    effects: [
      { type: 'debuff', stat: 'atk', amount: -0.35, dur: 9 },
      { type: 'lifesteal', ratio: 0.45 },
    ],
    desc: '갑주 안에 채운 어둠을 전부 검에 쏟는다. 베인 자는 전의까지 빼앗긴다.',
  },
  t4_blackknight_abyss: {
    name: '영혼의 사슬', cd: 17, power: 1.6, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'shadow',
    effects: [
      { type: 'dot', dmgType: 'magic', power: 0.5, tick: 1, dur: 9 },
      { type: 'debuff', stat: 'atk', amount: -0.25, dur: 9 },
      { type: 'lifesteal', ratio: 0.5 },
    ],
    desc: '적 전원의 영혼에 사슬을 걸어 조금씩 끌어당긴다. 끌려온 만큼 제 상처가 아문다.',
  },
  // bulwark 불굴의 성벽
  t4_bulwark_apex: {
    name: '공성 분쇄타', cd: 14, power: 2.9, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'blunt',
    effects: [
      { type: 'stun', dur: 2.0, chance: 0.65 },
      { type: 'debuff', stat: 'def', amount: -0.35, dur: 8 },
    ],
    desc: '성벽을 부수러 온 공성추를 되돌려 준다. 방패가 아니라 망치를 든 날이다.',
  },
  t4_bulwark_abyss: {
    name: '영원의 성벽', cd: 20, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'shield', power: 1.8, dur: 14 },
      { type: 'buff', stat: 'def', amount: 0.45, dur: 14 },
      { type: 'buff', stat: 'res', amount: 0.4, dur: 14 },
      { type: 'shield', power: 2.4, dur: 14, target: 'self' },
    ],
    desc: '무너뜨리려면 성벽을 부수는 공성병기가 필요하다. 이제 부대 전체가 성벽이다.',
  },
  // oathshield 서약의 방패
  t4_oathshield_apex: {
    name: '서약의 파문', cd: 17, power: 1.7, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'holy',
    effects: [
      { type: 'stun', dur: 1.3, chance: 0.45 },
      { type: 'debuff', stat: 'atk', amount: -0.3, dur: 9 },
    ],
    desc: '맹세를 소리 내어 읊는다. 파문이 적진을 훑고 지나가면 손에서 무기가 흘러내린다.',
  },
  t4_oathshield_abyss: {
    name: '불멸의 서약', cd: 18, power: 2.2, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [
      { type: 'heal', power: 2.2 },
      { type: 'shield', power: 2.0, dur: 14 },
      { type: 'buff', stat: 'def', amount: 0.4, dur: 14 },
    ],
    desc: '지키겠다는 맹세가 끝내 깨지지 않는 결계가 되었다.',
  },

  // ── 궁수 계열 ────────────────────────────────────────────────
  // masterarcher 신궁
  t4_masterarcher_apex: {
    name: '천공일시', cd: 18, power: 3.5, dmgType: 'phys',
    target: 'enemy', select: 'back', count: 1, range: 'ranged', fx: 'arrow',
    effects: [{ type: 'buff', stat: 'critDmg', amount: 0.4, dur: 10, target: 'self' }],
    desc: '숨을 한 번 고르고 놓는다. 화살이 닿기 전에 이미 승부가 정해져 있다.',
  },
  t4_masterarcher_abyss: {
    name: '만시천강', cd: 16, power: 1.7, dmgType: 'phys',
    target: 'enemy', select: 'random', count: 4, range: 'ranged', fx: 'arrow',
    effects: [
      { type: 'debuff', stat: 'spd', amount: -0.3, dur: 9 },
      { type: 'dot', dmgType: 'phys', power: 0.4, tick: 1, dur: 6 },
    ],
    desc: '화살비가 그치지 않는다. 발을 옮기려 해도 다음 화살이 먼저 도착한다.',
  },
  // shadowarcher 그림자 사수
  t4_shadowarcher_apex: {
    name: '심연관통시', cd: 14, power: 3.2, dmgType: 'phys',
    target: 'enemy', select: 'back', count: 1, range: 'ranged', fx: 'shadow',
    effects: [{ type: 'debuff', stat: 'res', amount: -0.3, dur: 9 }],
    desc: '어둠을 뚫고 온 볼트가 후열의 급소를 정확히 관통한다.',
  },
  t4_shadowarcher_abyss: {
    name: '그림자 사슬', cd: 17, power: 1.5, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'shadow',
    effects: [
      { type: 'debuff', stat: 'spd', amount: -0.4, dur: 10 },
      { type: 'stun', dur: 1.0, chance: 0.3 },
      { type: 'dot', dmgType: 'magic', power: 0.35, tick: 1, dur: 8 },
    ],
    desc: '적의 그림자를 땅에 못박는다. 그림자가 묶인 자는 제 발도 옮기지 못한다.',
  },
  // beastlord 야수군주
  t4_beastlord_apex: {
    name: '야수왕의 포식', cd: 13, power: 3.2, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'slash',
    effects: [
      { type: 'lifesteal', ratio: 0.6 },
      { type: 'dot', dmgType: 'phys', power: 0.45, tick: 1, dur: 6 },
    ],
    desc: '물어뜯은 자리가 멎지 않는다. 무리의 왕은 먹이를 놓치지 않는다.',
  },
  t4_beastlord_abyss: {
    name: '군림하는 야성', cd: 19, power: 0, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.42, dur: 12 },
      { type: 'buff', stat: 'spd', amount: 0.3, dur: 12 },
      { type: 'buff', stat: 'crit', amount: 0.5, dur: 12 },
      { type: 'shield', power: 1.3, dur: 12 },
    ],
    desc: '무리의 왕이 울면 부대 전원이 짐승의 감각을 되찾는다.',
  },
  // spiritranger 정령궁수
  t4_spiritranger_apex: {
    name: '정령왕의 화살', cd: 14, power: 3.2, dmgType: 'magic',
    target: 'enemy', select: 'random', count: 1, range: 'ranged', fx: 'nature',
    effects: [{ type: 'debuff', stat: 'res', amount: -0.35, dur: 9 }],
    desc: '시위에 정령왕을 얹어 쏜다. 갑주도 결계도 그 앞에서는 의미가 없다.',
  },
  t4_spiritranger_abyss: {
    name: '세계수의 가호', cd: 17, power: 2.3, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [
      { type: 'heal', power: 2.3 },
      { type: 'buff', stat: 'res', amount: 0.4, dur: 12 },
      { type: 'buff', stat: 'def', amount: 0.3, dur: 12 },
      { type: 'shield', power: 1.3, dur: 12 },
    ],
    desc: '세계수의 뿌리가 전장 아래로 뻗는다. 밟고 선 아군의 상처가 함께 아문다.',
  },

  // ── 도적 계열 ────────────────────────────────────────────────
  // shadowblade 그림자 밀사
  t4_shadowblade_apex: {
    name: '단절의 일격', cd: 16, power: 3.5, dmgType: 'phys',
    target: 'enemy', select: 'back', count: 1, range: 'melee', fx: 'shadow',
    effects: [
      { type: 'lifesteal', ratio: 0.3 },
      { type: 'buff', stat: 'spd', amount: 0.35, dur: 9, target: 'self' },
    ],
    desc: '숨소리도 남기지 않고 건너와 목을 끊는다. 소리는 몸이 쓰러진 뒤에 들린다.',
  },
  t4_shadowblade_abyss: {
    name: '무영장막', cd: 18, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'eva', amount: 0.6, dur: 12 },
      { type: 'buff', stat: 'spd', amount: 0.4, dur: 12 },
      { type: 'buff', stat: 'crit', amount: 0.6, dur: 12 },
      { type: 'shield', power: 1.6, dur: 12 },
    ],
    desc: '그림자와 몸의 경계를 지운다. 벨 수 있는 자가 전장에 남아 있지 않다.',
  },
  // venomfang 독아
  t4_venomfang_apex: {
    name: '치사독아', cd: 13, power: 2.9, dmgType: 'phys',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'melee', fx: 'poison',
    effects: [
      { type: 'dot', dmgType: 'magic', power: 0.75, tick: 1, dur: 8 },
      { type: 'debuff', stat: 'res', amount: -0.3, dur: 8 },
    ],
    desc: '한 번 스치면 해독할 시간이 없다. 독이 심장에 닿는 데 여덟을 세면 충분하다.',
  },
  t4_venomfang_abyss: {
    name: '역병의 안개', cd: 18, power: 1.4, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'poison',
    effects: [
      { type: 'dot', dmgType: 'magic', power: 0.6, tick: 1, dur: 12 },
      { type: 'debuff', stat: 'res', amount: -0.3, dur: 12 },
      { type: 'debuff', stat: 'spd', amount: -0.25, dur: 12 },
    ],
    desc: '전장을 독무로 덮는다. 숨을 쉬는 것 자체가 상처가 된다.',
  },
  // banditking 도적왕
  t4_banditking_apex: {
    name: '왕의 약탈', cd: 16, power: 1.8, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'debuff', stat: 'def', amount: -0.4, dur: 9 }],
    desc: '눈에 보이는 것을 전부 벤 뒤 전부 가져간다. 갑옷도 예외가 아니다.',
  },
  t4_banditking_abyss: {
    name: '난전의 계략', cd: 18, power: 0, dmgType: 'none',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'shadow',
    effects: [
      { type: 'debuff', stat: 'atk', amount: -0.35, dur: 11 },
      { type: 'debuff', stat: 'def', amount: -0.35, dur: 11 },
      { type: 'debuff', stat: 'spd', amount: -0.3, dur: 11 },
    ],
    desc: '전장을 자기 소굴로 바꿔 버린다. 적은 어디서 칼이 오는지 끝까지 모른다.',
  },
  // bladedancer 칼날무희
  t4_bladedancer_apex: {
    name: '천검의 종막', cd: 16, power: 2.0, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    effects: [{ type: 'buff', stat: 'spd', amount: 0.3, dur: 9, target: 'self' }],
    desc: '춤의 마지막 박자에 모든 칼날이 동시에 닿는다.',
  },
  t4_bladedancer_abyss: {
    name: '칼날 폭풍', cd: 17, power: 1.5, dmgType: 'phys',
    target: 'allEnemy', select: 'random', count: 1, range: 'melee', fx: 'slash',
    effects: [
      { type: 'dot', dmgType: 'phys', power: 0.45, tick: 1, dur: 9 },
      { type: 'debuff', stat: 'def', amount: -0.25, dur: 9 },
      { type: 'buff', stat: 'eva', amount: 0.45, dur: 10, target: 'self' },
    ],
    desc: '멈추지 않는 칼날이 전장을 맴돈다. 춤이 이어지는 동안 본인은 닿지 않는다.',
  },

  // ── 마법사 계열 ──────────────────────────────────────────────
  // archmage 대마법사
  t4_archmage_apex: {
    name: '천상의 유성우', cd: 19, power: 2.0, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'fire',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.5, tick: 1, dur: 8 }],
    desc: '하늘이 무너져 내린다. 떨어진 자리마다 불이 꺼지지 않는다.',
  },
  t4_archmage_abyss: {
    name: '비전 대결계', cd: 18, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.6, dur: 12 },
      { type: 'buff', stat: 'spd', amount: 0.3, dur: 12 },
      { type: 'shield', power: 1.6, dur: 12, target: 'allAlly' },
    ],
    desc: '전장 위에 자기 마법 이론을 덮어쓴다. 결계 안에서는 술사의 법이 곧 물리다.',
  },
  // stormcaller 폭풍술사
  t4_stormcaller_apex: {
    name: '뇌신강림', cd: 15, power: 3.4, dmgType: 'magic',
    target: 'enemy', select: 'highestAtk', count: 1, range: 'ranged', fx: 'lightning',
    effects: [{ type: 'stun', dur: 1.5, chance: 0.5 }],
    desc: '벼락을 부르는 것이 아니라 직접 벼락이 된다. 가장 강한 적부터 지목한다.',
  },
  t4_stormcaller_abyss: {
    name: '폭풍의 사슬', cd: 16, power: 1.55, dmgType: 'magic',
    target: 'enemy', select: 'random', count: 5, range: 'ranged', fx: 'lightning',
    effects: [
      { type: 'stun', dur: 0.8, chance: 0.35 },
      { type: 'dot', dmgType: 'magic', power: 0.4, tick: 1, dur: 6 },
    ],
    desc: '번개가 적에서 적으로 옮겨 다니며 끊기지 않는다. 다섯 번째까지 감전된다.',
  },
  // lichlord 사령왕
  t4_lichlord_apex: {
    name: '사멸의 고리', cd: 14, power: 3.3, dmgType: 'magic',
    target: 'enemy', select: 'lowestHp', count: 1, range: 'ranged', fx: 'shadow',
    effects: [{ type: 'lifesteal', ratio: 0.7 }],
    desc: '죽음을 고리에 담아 던진다. 걸린 자의 남은 목숨은 전부 술사에게 넘어온다.',
  },
  t4_lichlord_abyss: {
    name: '영겁의 저주', cd: 19, power: 1.5, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'shadow',
    effects: [
      { type: 'dot', dmgType: 'magic', power: 0.6, tick: 1, dur: 12 },
      { type: 'debuff', stat: 'def', amount: -0.3, dur: 12 },
      { type: 'debuff', stat: 'res', amount: -0.3, dur: 12 },
      { type: 'lifesteal', ratio: 0.5 },
    ],
    desc: '적 전원에게 끝나지 않는 저주를 새긴다. 썩어가는 속도가 곧 술사의 회복량이다.',
  },
  // plaguelord 역병군주
  t4_plaguelord_apex: {
    name: '흑사 창궐', cd: 18, power: 1.9, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'poison',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.7, tick: 1, dur: 8 }],
    desc: '역병이 한꺼번에 터진다. 이 장면 뒤로 마을 하나가 조용해지곤 했다.',
  },
  t4_plaguelord_abyss: {
    name: '만병의 늪', cd: 19, power: 0, dmgType: 'none',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'poison',
    effects: [
      { type: 'dot', dmgType: 'magic', power: 0.55, tick: 1, dur: 14 },
      { type: 'debuff', stat: 'spd', amount: -0.3, dur: 14 },
      { type: 'debuff', stat: 'atk', amount: -0.25, dur: 14 },
    ],
    desc: '전장을 썩은 늪으로 바꾼다. 서 있기만 해도 살이 흘러내린다.',
  },

  // ── 수도사 계열 ──────────────────────────────────────────────
  // highpriest 대주교
  t4_highpriest_apex: {
    name: '천벌의 성광', cd: 17, power: 1.8, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'holy',
    effects: [
      { type: 'stun', dur: 1.2, chance: 0.4 },
      { type: 'debuff', stat: 'res', amount: -0.25, dur: 9 },
    ],
    desc: '기도가 끝나는 순간 하늘이 열린다. 빛에 닿은 자는 그 자리에 무릎을 꺾는다.',
  },
  t4_highpriest_abyss: {
    name: '만유의 은총', cd: 16, power: 2.6, dmgType: 'none',
    target: 'allAlly', select: 'lowestHpAlly', count: 1, range: 'ranged', fx: 'heal',
    effects: [
      { type: 'heal', power: 2.6 },
      { type: 'shield', power: 1.6, dur: 12 },
      { type: 'buff', stat: 'res', amount: 0.35, dur: 12 },
      { type: 'buff', stat: 'def', amount: 0.3, dur: 12 },
    ],
    desc: '한 번의 기도로 부대 전원이 다시 일어선다. 은총은 아직 마르지 않았다.',
  },
  // inquisitor 심판관
  t4_inquisitor_apex: {
    name: '최후의 심판', cd: 17, power: 3.5, dmgType: 'magic',
    target: 'enemy', select: 'highestAtk', count: 1, range: 'ranged', fx: 'holy',
    effects: [{ type: 'debuff', stat: 'res', amount: -0.3, dur: 9 }],
    desc: '명부의 마지막 줄을 읽어 내린다. 변론도 유예도 허용되지 않는다.',
  },
  t4_inquisitor_abyss: {
    name: '정죄의 화형장', cd: 18, power: 1.7, dmgType: 'magic',
    target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: 'fire',
    effects: [
      { type: 'dot', dmgType: 'magic', power: 0.65, tick: 1, dur: 10 },
      { type: 'debuff', stat: 'res', amount: -0.3, dur: 10 },
    ],
    desc: '전장을 화형장으로 선포한다. 불은 죄가 다 타야 꺼진다.',
  },
  // arhat 나한
  t4_arhat_apex: {
    name: '천수나한권', cd: 15, power: 1.75, dmgType: 'phys',
    target: 'enemy', select: 'random', count: 4, range: 'melee', fx: 'blunt',
    effects: [{ type: 'stun', dur: 0.9, chance: 0.3 }],
    desc: '천 개의 손이 동시에 뻗는다. 어느 주먹에 맞았는지 아무도 알지 못한다.',
  },
  t4_arhat_abyss: {
    name: '금강불괴진', cd: 18, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'shield', power: 3.6, dur: 14 },
      { type: 'buff', stat: 'def', amount: 0.5, dur: 14 },
      { type: 'buff', stat: 'res', amount: 0.5, dur: 14 },
      { type: 'buff', stat: 'eva', amount: 0.3, dur: 14 },
    ],
    desc: '육신을 쇠로 바꾸는 데 그치지 않고, 쇠보다 단단한 것으로 다시 바꾼다.',
  },
  // fallenmonk 파계승
  t4_fallenmonk_apex: {
    name: '마라파천장', cd: 14, power: 3.4, dmgType: 'phys',
    target: 'enemy', select: 'front', count: 1, range: 'melee', fx: 'shadow',
    effects: [
      { type: 'lifesteal', ratio: 0.5 },
      { type: 'debuff', stat: 'def', amount: -0.3, dur: 8 },
    ],
    desc: '깨뜨린 계율 전부를 손바닥 하나에 실었다. 막을 수 있는 자세가 존재하지 않는다.',
  },
  t4_fallenmonk_abyss: {
    name: '파계의 업장', cd: 18, power: 0, dmgType: 'none',
    target: 'self', select: 'self', count: 1, range: 'ranged', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.5, dur: 12 },
      { type: 'buff', stat: 'spd', amount: 0.28, dur: 12 },
      { type: 'buff', stat: 'crit', amount: 0.5, dur: 12 },
      { type: 'shield', power: 2.6, dur: 12 },
    ],
    desc: '쌓인 업이 갑주가 된다. 죄가 무거울수록 몸이 단단해지는 역설.',
  },
};

/** id 를 키에서 자동 주입 (선언 중복 방지) */
function stamp(map) {
  for (const [id, sk] of Object.entries(map)) {
    sk.id = id;
    if (sk.count == null) sk.count = 1;
    if (sk.effects == null) sk.effects = [];
  }
  return map;
}

/** 전체 스킬 사전 (id -> Skill). enemies.js 가 addSkills 로 적 전용 스킬을 덧붙인다. */
export const SKILLS = stamp(RAW);

/** @returns {object|null} 없으면 null */
export function getSkill(id) {
  return (id && SKILLS[id]) || null;
}

/**
 * 스킬 사전에 병합한다. (적 전용 스킬 등록용)
 * @param {Record<string, object>} map id -> Skill (id 필드는 생략 가능)
 * @returns {Record<string, object>} SKILLS
 */
export function addSkills(map) {
  if (!map) return SKILLS;
  Object.assign(SKILLS, stamp(map));
  return SKILLS;
}

/** 등록된 스킬 개수 (밸런스 테스트용) */
export const skillCount = () => Object.keys(SKILLS).length;
