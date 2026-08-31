// 적 템플릿 + 적 부대 구성. SPEC §3.5.
// 순수 JS (DOM 참조 금지). 적 전용 스킬은 모듈 로드 시 skills.js 에 등록된다.
import { clamp } from './util.js';
import { rng as globalRng } from './rng.js';
import { addSkills } from './skills.js';
import { FORMATIONS, getFormation } from './formations.js';

// ---------------------------------------------------------------------------
// 1. 적 전용 스킬
//    id 는 전부 'e_' 접두사. 클래스 스킬과 id 가 충돌해 덮어쓰는 사고를 막는다.
// ---------------------------------------------------------------------------

const SKILL_BASE = {
  cd: 8, power: 1.5, dmgType: 'phys', target: 'enemy', select: 'random',
  count: 1, range: 'melee', fx: 'slash',
};

const SKILL_DEFS = [
  // --- 고블린 ---
  { id: 'e_goblin_stab', name: '고블린 찌르기', cd: 6, power: 1.7, select: 'front', fx: 'pierce',
    desc: '전열의 적을 낡은 단검으로 빠르게 찌른다.' },
  { id: 'e_goblin_sling', name: '돌팔매', cd: 7, power: 1.4, range: 'ranged', fx: 'blunt',
    effects: [{ type: 'stun', dur: 0.8, chance: 0.18 }],
    desc: '돌멩이를 날려 운이 좋으면 적을 잠시 비틀거리게 한다.' },
  { id: 'e_goblin_bomb', name: '조잡한 폭탄', cd: 15, power: 1.5, target: 'allEnemy', range: 'ranged', fx: 'fire',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.2, tick: 1, dur: 4 }],
    desc: '적 전체에 화약 뭉치를 던져 터뜨리고 불을 붙인다.' },
  { id: 'e_goblin_rally', name: '고블린 함성', cd: 13, power: 0, dmgType: 'none', target: 'allAlly', select: 'self',
    range: 'melee', fx: 'buff',
    effects: [{ type: 'buff', stat: 'atk', amount: 0.22, dur: 8, target: 'allAlly' }],
    desc: '악을 쓰며 무리 전체의 사기를 끌어올린다.' },
  { id: 'e_goblin_hex', name: '주술사의 저주', cd: 9, power: 1.1, dmgType: 'magic', select: 'highestAtk',
    range: 'ranged', fx: 'shadow',
    effects: [{ type: 'debuff', stat: 'atk', amount: -0.22, dur: 6 }],
    desc: '가장 위협적인 적의 힘을 빨아들인다.' },
  { id: 'e_chief_roar', name: '족장의 포효', cd: 15, power: 0, dmgType: 'none', target: 'allAlly', select: 'self',
    range: 'melee', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.3, dur: 10, target: 'allAlly' },
      { type: 'buff', stat: 'spd', amount: 0.15, dur: 10, target: 'allAlly' },
    ],
    desc: '족장의 울부짖음에 부하들이 미쳐 날뛴다.' },

  // --- 야수 ---
  { id: 'e_beast_bite', name: '물어뜯기', cd: 5, power: 1.7, select: 'lowestHp', fx: 'slash',
    effects: [{ type: 'lifesteal', ratio: 0.25 }],
    desc: '약해진 먹잇감의 목덜미를 물고 피를 빤다.' },
  { id: 'e_pack_howl', name: '무리의 울음', cd: 12, power: 0, dmgType: 'none', target: 'allAlly', select: 'self',
    range: 'melee', fx: 'buff',
    effects: [{ type: 'buff', stat: 'spd', amount: 0.25, dur: 10, target: 'allAlly' }],
    desc: '길게 울어 무리의 사냥 본능을 깨운다.' },
  { id: 'e_rend', name: '갈퀴 발톱', cd: 7, power: 1.25, count: 2, fx: 'slash',
    effects: [{ type: 'dot', dmgType: 'phys', power: 0.2, tick: 1, dur: 4 }],
    desc: '두 명을 할퀴어 피가 멎지 않는 상처를 남긴다.' },
  { id: 'e_pounce', name: '도약 덮치기', cd: 9, power: 1.9, select: 'back', fx: 'blunt',
    effects: [{ type: 'stun', dur: 1.2, chance: 0.3 }],
    desc: '후열까지 단숨에 뛰어들어 덮친다.' },
  { id: 'e_maul', name: '육중한 후려치기', cd: 8, power: 2.05, select: 'front', fx: 'blunt',
    desc: '거대한 앞발로 전열을 통째로 후려친다.' },
  { id: 'e_wing_gust', name: '날개 돌풍', cd: 10, power: 1.35, target: 'allEnemy', range: 'ranged', fx: 'nature',
    effects: [{ type: 'debuff', stat: 'spd', amount: -0.2, dur: 6 }],
    desc: '날갯짓으로 모래바람을 일으켜 적의 발을 묶는다.' },

  // --- 산적/도적 ---
  { id: 'e_bandit_flurry', name: '난도질', cd: 6, power: 1.2, count: 2, select: 'front', fx: 'slash',
    desc: '거칠게 두 번 휘둘러 전열을 헤집는다.' },
  { id: 'e_throw_knife', name: '투척 단검', cd: 7, power: 1.5, range: 'ranged', fx: 'pierce',
    effects: [{ type: 'debuff', stat: 'def', amount: -0.18, dur: 6 }],
    desc: '갑옷 틈을 노려 단검을 던진다.' },
  { id: 'e_crossbow_bolt', name: '석궁 사격', cd: 8, power: 2.0, select: 'highestAtk', range: 'ranged', fx: 'arrow',
    desc: '가장 위험한 적을 조준해 볼트를 박아 넣는다.' },
  { id: 'e_smoke_bomb', name: '연막탄', cd: 15, power: 0, dmgType: 'none', target: 'allEnemy', range: 'ranged', fx: 'shadow',
    effects: [{ type: 'debuff', stat: 'spd', amount: -0.2, dur: 7 }],
    desc: '매캐한 연막을 퍼뜨려 적 전체의 움직임을 흐트러뜨린다.' },
  { id: 'e_boss_command', name: '두목의 호령', cd: 14, power: 0, dmgType: 'none', target: 'allAlly', select: 'self',
    range: 'melee', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.28, dur: 10, target: 'allAlly' },
      { type: 'buff', stat: 'def', amount: 0.2, dur: 10, target: 'allAlly' },
    ],
    desc: '한마디로 부하들을 다잡아 대열을 굳힌다.' },

  // --- 오크 ---
  { id: 'e_orc_cleave', name: '오크 참격', cd: 7, power: 1.6, count: 2, select: 'front', fx: 'slash',
    desc: '도끼를 크게 휘둘러 전열 둘을 함께 벤다.' },
  { id: 'e_orc_quake', name: '대지 강타', cd: 12, power: 1.5, target: 'allEnemy', range: 'ranged', fx: 'blunt',
    effects: [{ type: 'stun', dur: 1.0, chance: 0.25 }],
    desc: '땅을 내리쳐 전장 전체를 뒤흔든다.' },
  { id: 'e_war_cry', name: '전투의 함성', cd: 13, power: 0, dmgType: 'none', target: 'allAlly', select: 'self',
    range: 'melee', fx: 'buff',
    effects: [{ type: 'buff', stat: 'atk', amount: 0.3, dur: 10, target: 'allAlly' }],
    desc: '전장을 울리는 함성으로 아군의 공격력을 끌어올린다.' },
  { id: 'e_berserk', name: '광란', cd: 12, power: 0, dmgType: 'none', target: 'self', select: 'self',
    range: 'melee', fx: 'buff',
    effects: [
      { type: 'buff', stat: 'atk', amount: 0.5, dur: 10, target: 'self' },
      { type: 'debuff', stat: 'def', amount: -0.25, dur: 10 },
    ],
    desc: '방어를 내던지고 피에 굶주린 상태가 된다.' },
  { id: 'e_execute', name: '참수', cd: 10, power: 2.8, select: 'lowestHp', fx: 'slash',
    desc: '빈사의 적을 단칼에 끝낸다.' },

  // --- 언데드 ---
  { id: 'e_bone_slash', name: '뼈 가르기', cd: 6, power: 1.6, select: 'front', fx: 'slash',
    desc: '녹슨 검으로 전열을 베어 넘긴다.' },
  { id: 'e_grave_chill', name: '무덤 한기', cd: 11, power: 1.2, dmgType: 'magic', target: 'allEnemy',
    range: 'ranged', fx: 'ice',
    effects: [{ type: 'debuff', stat: 'spd', amount: -0.22, dur: 6 }],
    desc: '무덤 속 냉기가 적 전체의 뼛속을 얼린다.' },
  { id: 'e_ghoul_rend', name: '구울의 손톱', cd: 7, power: 1.5, select: 'lowestHp', fx: 'poison',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.25, tick: 1, dur: 5 }],
    desc: '썩은 손톱으로 할퀴어 시독을 옮긴다.' },
  { id: 'e_soul_drain', name: '영혼 흡수', cd: 9, power: 1.7, dmgType: 'magic', range: 'ranged', fx: 'shadow',
    effects: [{ type: 'lifesteal', ratio: 0.5 }],
    desc: '적의 생명력을 뽑아 자신의 것으로 삼는다.' },
  { id: 'e_bone_ward', name: '뼈 방패', cd: 12, power: 0, dmgType: 'none', target: 'ally', select: 'lowestHpAlly',
    range: 'ranged', fx: 'buff',
    effects: [{ type: 'shield', power: 1.1, dur: 8 }],
    desc: '뼛조각을 불러 모아 아군을 감싼다.' },
  { id: 'e_curse_decay', name: '부패의 저주', cd: 10, power: 1.0, dmgType: 'magic', range: 'ranged', fx: 'shadow',
    effects: [
      { type: 'debuff', stat: 'def', amount: -0.25, dur: 7 },
      { type: 'dot', dmgType: 'magic', power: 0.3, tick: 1, dur: 6 },
    ],
    desc: '살과 갑옷을 함께 썩게 만드는 저주.' },
  { id: 'e_lich_nova', name: '사령의 폭발', cd: 13, power: 2.2, dmgType: 'magic', target: 'allEnemy',
    range: 'ranged', fx: 'shadow',
    effects: [{ type: 'debuff', stat: 'res', amount: -0.2, dur: 6 }],
    desc: '죽음의 파동이 전장을 휩쓴다.' },

  // --- 트롤/오우거 ---
  { id: 'e_regen', name: '재생', cd: 10, power: 0, dmgType: 'none', target: 'self', select: 'self',
    range: 'melee', fx: 'heal',
    effects: [{ type: 'heal', power: 1.6, target: 'self' }],
    desc: '찢긴 살점이 눈앞에서 다시 붙는다.' },
  { id: 'e_ogre_club', name: '곤봉 강타', cd: 8, power: 2.1, select: 'front', fx: 'blunt',
    effects: [{ type: 'stun', dur: 1.3, chance: 0.3 }],
    desc: '통나무만 한 곤봉으로 내리찍는다.' },
  { id: 'e_boulder_toss', name: '바위 투척', cd: 9, power: 1.85, select: 'back', range: 'ranged', fx: 'blunt',
    desc: '바위를 뽑아 후열을 향해 던진다.' },

  // --- 다크엘프 ---
  { id: 'e_shadow_bolt', name: '그림자 화살', cd: 6, power: 1.8, dmgType: 'magic', range: 'ranged', fx: 'shadow',
    desc: '응축된 어둠을 화살처럼 쏘아 보낸다.' },
  { id: 'e_venom_arrow', name: '맹독 화살', cd: 8, power: 1.6, select: 'back', range: 'ranged', fx: 'arrow',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.28, tick: 1, dur: 6 }],
    desc: '독을 바른 화살로 후열을 노린다.' },
  { id: 'e_mind_spike', name: '정신 꿰뚫기', cd: 10, power: 1.6, dmgType: 'magic', select: 'highestAtk',
    range: 'ranged', fx: 'bolt',
    effects: [{ type: 'stun', dur: 1.2, chance: 0.35 }],
    desc: '정신을 직접 찔러 잠시 넋을 빼놓는다.' },
  { id: 'e_dark_ritual', name: '어둠의 의식', cd: 14, power: 0, dmgType: 'none', target: 'allAlly', select: 'self',
    range: 'ranged', fx: 'heal',
    effects: [
      { type: 'heal', power: 1.2, target: 'allAlly' },
      { type: 'buff', stat: 'res', amount: 0.25, dur: 8, target: 'allAlly' },
    ],
    desc: '검은 제단의 힘으로 아군의 상처를 메운다.' },

  // --- 사교도 ---
  { id: 'e_blood_offering', name: '피의 공물', cd: 13, power: 0, dmgType: 'none', target: 'allAlly', select: 'self',
    range: 'melee', fx: 'buff',
    effects: [{ type: 'buff', stat: 'atk', amount: 0.35, dur: 8, target: 'allAlly' }],
    desc: '제 피를 바쳐 광신도들의 광기를 부추긴다.' },
  { id: 'e_unholy_mend', name: '사악한 치유', cd: 8, power: 0, dmgType: 'none', target: 'ally', select: 'lowestHpAlly',
    range: 'ranged', fx: 'heal',
    effects: [{ type: 'heal', power: 1.7, target: 'ally' }],
    desc: '금단의 기도로 상처를 억지로 아물게 한다.' },
  { id: 'e_flame_call', name: '화염 소환', cd: 9, power: 1.9, dmgType: 'magic', range: 'ranged', fx: 'fire',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.25, tick: 1, dur: 4 }],
    desc: '심연에서 불길을 끌어올려 적을 태운다.' },

  // --- 리자드맨 ---
  { id: 'e_lizard_spear', name: '도마뱀 창격', cd: 7, power: 1.8, select: 'front', fx: 'pierce',
    desc: '긴 창으로 전열을 꿰뚫는다.' },
  { id: 'e_tail_sweep', name: '꼬리 후리기', cd: 9, power: 1.35, count: 2, select: 'front', fx: 'blunt',
    effects: [{ type: 'stun', dur: 1.0, chance: 0.25 }],
    desc: '단단한 꼬리로 전열을 쓸어버린다.' },
  { id: 'e_venom_spit', name: '독액 뱉기', cd: 8, power: 1.3, dmgType: 'magic', range: 'ranged', fx: 'poison',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.32, tick: 1, dur: 6 }],
    desc: '삭히는 독액을 뱉어낸다.' },

  // --- 정령 ---
  { id: 'e_flame_burst', name: '화염 폭발', cd: 11, power: 1.8, dmgType: 'magic', target: 'allEnemy',
    range: 'ranged', fx: 'fire',
    desc: '전장 한복판에서 불꽃이 터진다.' },
  { id: 'e_frost_shard', name: '서리 파편', cd: 7, power: 1.7, dmgType: 'magic', range: 'ranged', fx: 'ice',
    effects: [{ type: 'debuff', stat: 'spd', amount: -0.2, dur: 6 }],
    desc: '얼음 조각이 적을 꿰뚫고 몸을 굳힌다.' },
  { id: 'e_stone_guard', name: '바위 수호', cd: 12, power: 0, dmgType: 'none', target: 'allAlly', select: 'self',
    range: 'ranged', fx: 'buff',
    effects: [{ type: 'shield', power: 0.9, dur: 8 }],
    desc: '땅에서 솟은 암석이 아군 전체를 감싼다.' },
  { id: 'e_storm_bolt', name: '뇌격', cd: 8, power: 2.0, dmgType: 'magic', select: 'highestAtk',
    range: 'ranged', fx: 'lightning',
    desc: '벼락이 가장 강한 적에게 내리꽂힌다.' },

  // --- 악마/용 ---
  { id: 'e_hellfire', name: '지옥불', cd: 12, power: 2.0, dmgType: 'magic', target: 'allEnemy',
    range: 'ranged', fx: 'fire',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.3, tick: 1, dur: 5 }],
    desc: '검붉은 불길이 적 전체를 집어삼킨다.' },
  { id: 'e_demon_claw', name: '악마의 손톱', cd: 6, power: 1.8, select: 'front', fx: 'shadow',
    effects: [{ type: 'lifesteal', ratio: 0.3 }],
    desc: '영혼째 찢어발기며 생명을 빨아들인다.' },
  { id: 'e_terror_gaze', name: '공포의 응시', cd: 14, power: 0, dmgType: 'none', target: 'allEnemy',
    range: 'ranged', fx: 'shadow',
    effects: [
      { type: 'stun', dur: 1.5, chance: 0.35 },
      { type: 'debuff', stat: 'atk', amount: -0.2, dur: 6 },
    ],
    desc: '마주친 눈길만으로 적의 넋을 얼린다.' },
  { id: 'e_dragon_breath', name: '용의 숨결', cd: 13, power: 2.6, dmgType: 'magic', target: 'allEnemy',
    range: 'ranged', fx: 'fire',
    effects: [{ type: 'dot', dmgType: 'magic', power: 0.35, tick: 1, dur: 5 }],
    desc: '모든 것을 재로 만드는 화염의 숨결.' },
  { id: 'e_wing_buffet', name: '날개 강타', cd: 9, power: 1.7, target: 'allEnemy', range: 'ranged', fx: 'blunt',
    effects: [{ type: 'debuff', stat: 'spd', amount: -0.15, dur: 5 }],
    desc: '거대한 날개로 전열을 통째로 날려버린다.' },
];

/** 적 전용 스킬 맵 (id -> Skill). skills.js 에 등록된 것과 동일 객체. */
export const ENEMY_SKILLS = {};
for (const s of SKILL_DEFS) {
  const full = { ...SKILL_BASE, ...s };
  if (!full.effects || !full.effects.length) delete full.effects;
  ENEMY_SKILLS[full.id] = full;
}
// skills.js 의 addSkills 는 id 맵을 받는다. 배열만 받는 구현일 경우를 대비해 한 번 더 시도한다.
try { addSkills(ENEMY_SKILLS); } catch { addSkills(Object.values(ENEMY_SKILLS)); }

/* ── 지원 역할 판정 (설계 F) ──
 * "적 부대에도 힐러·버퍼를 섞어라"를 데이터로 판정하기 위해, 적 전용 스킬 중
 * **아군을 회복/보호/강화하는 것**을 두 집합으로 나눈다.
 *   HEAL  : 아군 회복·실드  (탱커를 계속 세워 둬서 플레이어가 화력 집중을 강요받는다)
 *   BUFF  : 아군 능력치 강화 (시간이 갈수록 적이 세지므로 장기전이 불리해진다)
 * `target:'self'` 는 제외한다 — e_regen/e_berserk 같은 자기 유지는 부대 지원이 아니다.
 */
const HEAL_SKILL_IDS = new Set();
const BUFF_SKILL_IDS = new Set();
for (const s of Object.values(ENEMY_SKILLS)) {
  const allyTarget = s.target === 'ally' || s.target === 'allAlly';
  if (!allyTarget) continue;
  for (const ef of s.effects || []) {
    if (!ef) continue;
    if (ef.type === 'heal' || ef.type === 'shield') HEAL_SKILL_IDS.add(s.id);
    else if (ef.type === 'buff') BUFF_SKILL_IDS.add(s.id);
  }
}
const hasAny = (ids, set) => (Array.isArray(ids) ? ids : []).some((id) => set.has(id));
/** 아군을 회복·보호하는 적인가 (힐러 역할). */
export const isHealerEnemy = (e) => !!e && (hasAny(e.skills, HEAL_SKILL_IDS) || e.arch === 'healer');
/** 아군을 강화하는 적인가 (버퍼 역할). */
export const isBufferEnemy = (e) => !!e && hasAny(e.skills, BUFF_SKILL_IDS);
/** 힐러 또는 버퍼 — 부대에 하나쯤 섞여야 하는 지원형. */
export const isSupportEnemy = (e) => isHealerEnemy(e) || isBufferEnemy(e);

/* ── 정예(Elite) 의뢰 (설계 E) ──
 * 고난도 도전 콘텐츠. 의뢰 쪽(`game/quest.js`)이 `quest.elite` 를 정하고, 여기서는
 * 그 플래그를 받아 **적 유닛에 배율과 표식을 실어 보내는 일만** 한다.
 * 스탯을 직접 곱하지 않는 이유: 적 최종 스탯은 quest.js `enemyStats()` 가 계산하기 때문이다.
 *
 * ★ `eliteMult` 는 **최종 배율**이다. 챔피언은 1.30 × 1.60 이 아니라 1.60 하나만 받는다.
 *   quest.js 는 받은 값을 그대로 한 번만 곱하면 된다.
 */
/** 정예 의뢰의 적 전원에게 붙는 스탯 배율. */
export const ELITE_MULT = 1.30;
/** 그중 1~2기('정예' 개체)에게 붙는 스탯 배율. ELITE_MULT 를 대체한다(곱하지 않는다). */
export const ELITE_CHAMPION_MULT = 1.60;
/** 정예 개체 이름 접두사. 전장에서 바로 읽히도록 이름 앞에 붙는다. */
export const ELITE_PREFIX = '정예 ';
/** 한 웨이브에 세우는 정예 개체 수 [최소, 최대]. */
export const ELITE_CHAMPIONS = [1, 2];
/** 적 레벨 상한 (설계 A: 만렙 80). quest.js 의 clamp 와 같은 값이어야 한다. */
export const MAX_ENEMY_LEVEL = 80;

// ---------------------------------------------------------------------------
// 2. 적 템플릿
// ---------------------------------------------------------------------------

const ENEMY_BASE = {
  arch: 'fighter', mods: {}, dmgType: 'phys', range: 'melee', basicFx: 'slash',
  skills: [], tier: 1, biome: ['plains'], boss: false, expMul: 1, goldMul: 1,
};

const PAL_BASE = { skin: 'pale', hair: 'black', metal: 'iron', cloth: 'ash', leather: 'brown', accent: 'bronze', glow: 'none' };
const SPRITE_BASE = {
  body: 'body_normal', head: 'head_human', hair: 'hair_none', helm: 'helm_none',
  armor: 'armor_leather', cape: 'cape_none', weapon: 'wpn_none', offhand: 'shd_none',
};
/** 스프라이트 레시피 축약 헬퍼 (SPEC §4.4 어휘만 사용). */
const sp = (o = {}) => ({ ...SPRITE_BASE, ...o, palette: { ...PAL_BASE, ...(o.palette || {}) } });

const ENEMY_DEFS = [
  // ===================== 고블린 =====================
  { id: 'goblin_grunt', name: '고블린 병졸', arch: 'fighter', mods: { hp: 0.76, atk: 0.86, def: 0.85 },
    skills: ['e_goblin_stab'], tier: 1, biome: ['forest', 'cave', 'plains'], expMul: 0.9, goldMul: 0.9,
    sprite: sp({ body: 'body_slim', head: 'head_goblin', armor: 'armor_leather', weapon: 'wpn_dagger', offhand: 'shd_buckler',
      palette: { skin: 'green', cloth: 'forest', leather: 'brown', metal: 'bronze' } }),
    desc: '수는 많고 겁은 더 많다. 그래도 칼은 쥐고 있다.' },
  { id: 'goblin_archer', name: '고블린 궁수', arch: 'archer', mods: { hp: 0.74, atk: 0.9 },
    range: 'ranged', basicFx: 'arrow', skills: ['e_goblin_sling'], tier: 1, biome: ['forest', 'cave', 'plains'],
    expMul: 0.9, goldMul: 0.9,
    sprite: sp({ body: 'body_slim', head: 'head_goblin', armor: 'armor_leather', weapon: 'wpn_bow',
      palette: { skin: 'green', cloth: 'sand', leather: 'tan', metal: 'bronze' } }),
    desc: '나무 위에서 조잡한 화살을 날린다.' },
  { id: 'goblin_shaman', name: '고블린 주술사', arch: 'healer', mods: { hp: 0.58, atk: 0.72, res: 0.88 },
    dmgType: 'magic', range: 'ranged', basicFx: 'nature', skills: ['e_unholy_mend', 'e_goblin_hex'],
    tier: 2, biome: ['forest', 'cave', 'swamp'], expMul: 1.1, goldMul: 1.1,
    sprite: sp({ body: 'body_slim', head: 'head_goblin', helm: 'helm_hood', armor: 'armor_robe', weapon: 'wpn_staff',
      palette: { skin: 'green', cloth: 'violet', glow: 'nature', accent: 'bone' } }),
    desc: '뼈 지팡이를 흔들며 부족의 상처를 꿰맨다.' },
  { id: 'goblin_rider', name: '고블린 늑대기수', arch: 'lancer', mods: { hp: 0.68, atk: 0.76, spd: 1.2 },
    skills: ['e_goblin_stab', 'e_pounce'], tier: 2, biome: ['plains', 'forest', 'cave'], expMul: 1.1, goldMul: 1.1,
    sprite: sp({ body: 'body_slim', head: 'head_goblin', helm: 'helm_iron', armor: 'armor_leather', weapon: 'wpn_spear',
      palette: { skin: 'green', cloth: 'crimson', leather: 'dark', metal: 'iron' } }),
    desc: '늑대를 몰고 다니며 후열까지 파고든다.' },
  { id: 'goblin_bomber', name: '고블린 폭탄병', arch: 'rogue', mods: { hp: 0.56, atk: 0.8, spd: 0.9 },
    range: 'ranged', basicFx: 'fire', skills: ['e_goblin_bomb'], tier: 2, biome: ['cave', 'mountain', 'forest'],
    expMul: 1.15, goldMul: 1.2,
    // 경장 잡졸에 얼굴 가면을 씌우면 전투 화면에서 뒷모습처럼 보인다. 후드로 대체.
    sprite: sp({ body: 'body_slim', head: 'head_goblin', helm: 'helm_hood', armor: 'armor_leather', offhand: 'shd_orb',
      palette: { skin: 'green', cloth: 'ember', leather: 'brown', glow: 'fire' } }),
    desc: '자기 폭탄에 먼저 죽는 일도 흔하다.' },
  { id: 'hobgoblin', name: '홉고블린', arch: 'fighter', mods: { hp: 1.21, atk: 1.21, def: 1.26 },
    skills: ['e_goblin_stab', 'e_goblin_rally'], tier: 3, biome: ['cave', 'mountain', 'forest'], expMul: 1.2, goldMul: 1.2,
    sprite: sp({ body: 'body_heavy', head: 'head_goblin', helm: 'helm_iron', armor: 'armor_mail', weapon: 'wpn_axe',
      offhand: 'shd_round', palette: { skin: 'green', cloth: 'crimson', metal: 'iron', accent: 'gold' } }),
    desc: '고블린 무리를 통솔하는 덩치 큰 사촌.' },

  // ===================== 야수 =====================
  { id: 'gray_wolf', name: '회색 늑대', arch: 'rogue', mods: { hp: 0.76, atk: 0.9, def: 0.74 },
    skills: ['e_beast_bite'], tier: 1, biome: ['forest', 'plains', 'tundra', 'coast'], expMul: 0.85, goldMul: 0.5,
    sprite: sp({ body: 'body_slim', head: 'head_wolf', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'grey', hair: 'white', leather: 'dark' } }),
    desc: '굶주린 눈으로 대열의 빈틈을 노린다.' },
  { id: 'wild_boar', name: '멧돼지', arch: 'tank', mods: { hp: 0.95, atk: 0.9, def: 0.9, spd: 0.9 },
    skills: ['e_maul'], tier: 1, biome: ['forest', 'plains', 'mountain'], expMul: 0.85, goldMul: 0.5,
    sprite: sp({ body: 'body_heavy', head: 'head_wolf', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'tan', hair: 'brown', leather: 'brown' } }),
    desc: '한 번 돌진하면 멈출 줄을 모른다.' },
  { id: 'dire_wolf', name: '다이어 울프', arch: 'fighter', mods: { hp: 0.76, atk: 0.84, spd: 1.15 },
    skills: ['e_beast_bite', 'e_pack_howl'], tier: 2, biome: ['forest', 'tundra', 'mountain'], expMul: 1.0, goldMul: 0.6,
    sprite: sp({ body: 'body_normal', head: 'head_wolf', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'ash', hair: 'black', leather: 'dark' } }),
    desc: '말만 한 덩치의 늑대. 무리로만 움직인다.' },
  { id: 'cave_spider', name: '동굴 거미', arch: 'rogue', mods: { hp: 0.6, atk: 0.76, spd: 1.1 },
    skills: ['e_venom_spit'], tier: 2, biome: ['cave', 'forest', 'swamp'], expMul: 1.0, goldMul: 0.7,
    sprite: sp({ body: 'body_normal', head: 'head_lizard', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'ash', leather: 'dark', glow: 'nature' } }),
    desc: '천장에서 소리 없이 내려온다.' },
  { id: 'cave_bear', name: '동굴 곰', arch: 'tank', mods: { hp: 1.44, atk: 1.26, def: 1.21, spd: 0.85 },
    skills: ['e_maul', 'e_rend'], tier: 3, biome: ['cave', 'mountain', 'forest'], expMul: 1.15, goldMul: 0.8,
    sprite: sp({ body: 'body_hulk', head: 'head_wolf', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'dark', hair: 'brown', leather: 'brown' } }),
    desc: '동굴 하나를 통째로 자기 굴로 삼은 짐승.' },
  { id: 'harpy', name: '하피', arch: 'rogue', mods: { hp: 0.98, atk: 1.21, spd: 1.25, eva: 0 },
    skills: ['e_wing_gust', 'e_rend'], tier: 3, biome: ['mountain', 'coast', 'desert'], expMul: 1.15, goldMul: 1.0,
    sprite: sp({ body: 'body_slim', head: 'head_human', hair: 'hair_long', cape: 'cape_wing', armor: 'armor_bare',
      weapon: 'wpn_claw', palette: { skin: 'ash', hair: 'black', cloth: 'teal', leather: 'dark' } }),
    desc: '절벽 위에서 급강하해 대열을 흩는다.' },
  { id: 'saber_cat', name: '검치호', arch: 'rogue', mods: { hp: 1.09, atk: 1.38, spd: 1.2 },
    skills: ['e_pounce', 'e_beast_bite'], tier: 3, biome: ['tundra', 'mountain', 'forest'], expMul: 1.15, goldMul: 0.8,
    sprite: sp({ body: 'body_normal', head: 'head_wolf', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'bone', hair: 'white', leather: 'tan' } }),
    desc: '눈보라 속에서 후열만 골라 덮친다.' },

  // ===================== 산적/도적단 =====================
  { id: 'bandit_thug', name: '산적 졸개', arch: 'fighter', mods: { hp: 0.9, atk: 0.95 },
    skills: ['e_bandit_flurry'], tier: 1, biome: ['plains', 'forest', 'coast', 'desert'], expMul: 1.0, goldMul: 1.3,
    sprite: sp({ body: 'body_normal', head: 'head_human', hair: 'hair_short', armor: 'armor_leather', weapon: 'wpn_axe',
      palette: { skin: 'tan', hair: 'brown', cloth: 'sand', leather: 'brown' } }),
    desc: '길목을 막고 통행세를 뜯는 잡배.' },
  { id: 'bandit_archer', name: '산적 궁수', arch: 'archer', mods: { hp: 0.85, atk: 1 },
    range: 'ranged', basicFx: 'arrow', skills: ['e_throw_knife'], tier: 1, biome: ['plains', 'forest', 'coast', 'desert'],
    expMul: 1.0, goldMul: 1.3,
    sprite: sp({ body: 'body_slim', head: 'head_human', helm: 'helm_hood', armor: 'armor_leather', weapon: 'wpn_bow',
      palette: { skin: 'pale', hair: 'brown', cloth: 'forest', leather: 'green' } }),
    desc: '수풀에 숨어 먼저 쏘고 도망친다.' },
  { id: 'cutthroat', name: '노상강도', arch: 'rogue', mods: { hp: 0.68, atk: 0.84, spd: 1.1 },
    skills: ['e_bandit_flurry', 'e_smoke_bomb'], tier: 2, biome: ['plains', 'coast', 'forest'], expMul: 1.1, goldMul: 1.5,
    sprite: sp({ body: 'body_slim', head: 'head_human', helm: 'helm_hood', armor: 'armor_leather', weapon: 'wpn_twindagger',
      palette: { skin: 'pale', hair: 'black', cloth: 'night', leather: 'dark', accent: 'silver' } }),
    desc: '목을 노리는 데 익숙한 손놀림.' },
  { id: 'bandit_brute', name: '산적 파수꾼', arch: 'tank', mods: { hp: 0.88, atk: 0.76, def: 0.88 },
    basicFx: 'blunt', skills: ['e_ogre_club'], tier: 2, biome: ['plains', 'forest', 'mountain'], expMul: 1.1, goldMul: 1.4,
    sprite: sp({ body: 'body_heavy', head: 'head_human', helm: 'helm_iron', armor: 'armor_mail', weapon: 'wpn_mace',
      offhand: 'shd_kite', palette: { skin: 'tan', hair: 'black', cloth: 'crimson', metal: 'iron' } }),
    desc: '두목의 천막 앞을 지키는 덩치.' },
  { id: 'highwayman', name: '노상 습격자', arch: 'archer', mods: { hp: 1.09, atk: 1.26 },
    range: 'ranged', basicFx: 'arrow', skills: ['e_crossbow_bolt'], tier: 3, biome: ['desert', 'plains', 'coast'],
    expMul: 1.2, goldMul: 1.5,
    sprite: sp({ body: 'body_normal', head: 'head_human', hair: 'hair_short', helm: 'helm_hood', armor: 'armor_leather',
      cape: 'cape_short', weapon: 'wpn_crossbow',
      palette: { skin: 'tan', hair: 'black', cloth: 'ash', leather: 'dark', accent: 'steel' } }),
    desc: '대상(隊商)만 골라 터는 노련한 사수.' },
  { id: 'rogue_mage', name: '탈주 마법사', arch: 'mage', mods: { hp: 0.98, atk: 1.32, res: 1.26 },
    dmgType: 'magic', range: 'ranged', basicFx: 'bolt', skills: ['e_flame_call', 'e_frost_shard'],
    tier: 3, biome: ['forest', 'plains', 'coast'], expMul: 1.3, goldMul: 1.4,
    sprite: sp({ body: 'body_slim', head: 'head_human', hair: 'hair_long', helm: 'helm_wizard', armor: 'armor_robe',
      weapon: 'wpn_staff', palette: { skin: 'pale', hair: 'white', cloth: 'azure', glow: 'arcane', accent: 'silver' } }),
    desc: '탑에서 쫓겨나 산적에게 몸을 의탁했다.' },

  // ===================== 오크 =====================
  { id: 'orc_warrior', name: '오크 전사', arch: 'fighter', mods: { hp: 0.88, atk: 0.84, def: 0.84 },
    skills: ['e_orc_cleave'], tier: 2, biome: ['mountain', 'plains', 'cave'], expMul: 1.1, goldMul: 1.1,
    sprite: sp({ body: 'body_heavy', head: 'head_orc', armor: 'armor_leather', weapon: 'wpn_axe', offhand: 'shd_round',
      palette: { skin: 'green', hair: 'black', cloth: 'ember', leather: 'dark', metal: 'iron' } }),
    desc: '전투 그 자체를 즐기는 종족의 표준.' },
  { id: 'orc_archer', name: '오크 사수', arch: 'archer', mods: { hp: 0.8, atk: 0.84, spd: 0.95 },
    range: 'ranged', basicFx: 'arrow', skills: ['e_venom_arrow'], tier: 2, biome: ['mountain', 'plains', 'cave'],
    expMul: 1.1, goldMul: 1.1,
    sprite: sp({ body: 'body_heavy', head: 'head_orc', armor: 'armor_leather', weapon: 'wpn_longbow',
      palette: { skin: 'green', hair: 'black', cloth: 'sand', leather: 'brown' } }),
    desc: '사람 키만 한 활을 힘으로 당긴다.' },
  { id: 'orc_berserker', name: '오크 광전사', arch: 'fighter', mods: { hp: 1.32, atk: 1.49, def: 0.98 },
    skills: ['e_berserk', 'e_orc_cleave'], tier: 3, biome: ['mountain', 'plains', 'cave', 'tundra'], expMul: 1.25, goldMul: 1.2,
    sprite: sp({ body: 'body_hulk', head: 'head_orc', hair: 'hair_mohawk', armor: 'armor_bare', weapon: 'wpn_greataxe',
      palette: { skin: 'green', hair: 'red', cloth: 'crimson', leather: 'dark', accent: 'blood' } }),
    desc: '갑옷 대신 상처를 두르고 달려든다.' },
  { id: 'orc_shaman', name: '오크 주술사', arch: 'healer', mods: { hp: 1.09, atk: 1.15, res: 1.32 },
    dmgType: 'magic', range: 'ranged', basicFx: 'nature', skills: ['e_war_cry', 'e_unholy_mend'],
    tier: 3, biome: ['mountain', 'plains', 'swamp'], expMul: 1.3, goldMul: 1.3,
    // 오크는 주술사라도 덩치로 읽혀야 한다 (고블린 주술사와 혼동 방지).
    sprite: sp({ body: 'body_heavy', head: 'head_orc', helm: 'helm_hood', armor: 'armor_robe', weapon: 'wpn_staff',
      palette: { skin: 'green', cloth: 'forest', glow: 'nature', accent: 'bone' } }),
    desc: '조상의 영을 불러 전사들을 일으켜 세운다.' },
  { id: 'orc_shieldbearer', name: '오크 방패병', arch: 'tank', mods: { hp: 1.49, atk: 1.03, def: 1.44 },
    basicFx: 'blunt', skills: ['e_orc_quake'], tier: 3, biome: ['mountain', 'cave', 'plains'], expMul: 1.25, goldMul: 1.2,
    sprite: sp({ body: 'body_hulk', head: 'head_orc', helm: 'helm_great', armor: 'armor_plate', weapon: 'wpn_mace',
      offhand: 'shd_tower', palette: { skin: 'green', cloth: 'night', metal: 'dark', accent: 'bronze' } }),
    desc: '문짝만 한 방패로 길목을 통째로 막는다.' },

  // ===================== 언데드 =====================
  { id: 'skeleton_soldier', name: '해골 병사', arch: 'fighter', mods: { hp: 0.79, atk: 0.95, def: 0.95 },
    skills: ['e_bone_slash'], tier: 1, biome: ['cave', 'swamp', 'desert'], expMul: 1.0, goldMul: 0.8,
    sprite: sp({ body: 'body_slim', head: 'head_skull', armor: 'armor_bone', weapon: 'wpn_sword', offhand: 'shd_buckler',
      palette: { skin: 'bone', metal: 'bone', cloth: 'ash', leather: 'dark' } }),
    desc: '수백 년 전 전장의 잔해가 다시 일어섰다.' },
  { id: 'skeleton_archer', name: '해골 궁수', arch: 'archer', mods: { hp: 0.56, atk: 0.76 },
    range: 'ranged', basicFx: 'arrow', skills: ['e_venom_arrow'], tier: 2, biome: ['cave', 'swamp', 'desert'],
    expMul: 1.05, goldMul: 0.8,
    sprite: sp({ body: 'body_slim', head: 'head_skull', armor: 'armor_bone', weapon: 'wpn_bow',
      palette: { skin: 'bone', metal: 'bone', cloth: 'night', leather: 'dark' } }),
    desc: '눈구멍에서 푸른 불이 조준을 대신한다.' },
  { id: 'plague_zombie', name: '역병 시체', arch: 'tank', mods: { hp: 0.92, atk: 0.68, def: 0.72, spd: 0.7 },
    skills: ['e_ghoul_rend'], tier: 2, biome: ['swamp', 'cave', 'coast'], expMul: 1.0, goldMul: 0.7,
    sprite: sp({ body: 'body_heavy', head: 'head_skull', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'ash', cloth: 'forest', leather: 'dark', glow: 'nature' } }),
    desc: '느리지만 좀처럼 쓰러지지 않는다.' },
  { id: 'ghoul', name: '구울', arch: 'rogue', mods: { hp: 0.72, atk: 0.84, spd: 1.05 },
    skills: ['e_ghoul_rend', 'e_beast_bite'], tier: 2, biome: ['swamp', 'cave', 'tundra'], expMul: 1.1, goldMul: 0.9,
    sprite: sp({ body: 'body_normal', head: 'head_skull', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'ash', cloth: 'ash', leather: 'dark', glow: 'shadow' } }),
    desc: '시체를 파먹다 산 자의 냄새를 맡았다.' },
  { id: 'wight', name: '망령', arch: 'mage', mods: { hp: 0.98, atk: 1.32, res: 1.38 },
    dmgType: 'magic', range: 'ranged', basicFx: 'shadow', skills: ['e_soul_drain', 'e_grave_chill'],
    tier: 3, biome: ['swamp', 'tundra', 'cave'], expMul: 1.3, goldMul: 1.1,
    sprite: sp({ body: 'body_slim', head: 'head_skull', armor: 'armor_robe', cape: 'cape_tattered', weapon: 'wpn_wand',
      palette: { skin: 'bone', cloth: 'night', glow: 'shadow', accent: 'violet' } }),
    desc: '원한만 남아 떠도는 형체.' },
  { id: 'bone_knight', name: '해골 기사', arch: 'tank', mods: { hp: 2.16, atk: 1.84, def: 2.09 },
    skills: ['e_bone_slash', 'e_curse_decay'], tier: 4, biome: ['cave', 'desert', 'coast', 'tundra'], expMul: 1.4, goldMul: 1.4,
    sprite: sp({ body: 'body_heavy', head: 'head_skull', helm: 'helm_great', armor: 'armor_plate', cape: 'cape_tattered',
      weapon: 'wpn_greatsword', offhand: 'shd_kite', palette: { skin: 'bone', metal: 'dark', cloth: 'crimson', glow: 'shadow', accent: 'blood' } }),
    desc: '맹세를 지키느라 죽어서도 갑주를 벗지 못했다.' },
  { id: 'necromancer', name: '강령술사', arch: 'mage', mods: { hp: 1.44, atk: 2, res: 1.92 },
    dmgType: 'magic', range: 'ranged', basicFx: 'shadow', skills: ['e_curse_decay', 'e_bone_ward'],
    tier: 4, biome: ['swamp', 'cave', 'desert'], expMul: 1.5, goldMul: 1.5,
    sprite: sp({ body: 'body_slim', head: 'head_human', helm: 'helm_hood', armor: 'armor_robe', cape: 'cape_long',
      weapon: 'wpn_staff', palette: { skin: 'pale', hair: 'black', cloth: 'violet', glow: 'shadow', metal: 'bone' } }),
    desc: '무덤을 파헤쳐 병사를 모으는 자.' },

  // ===================== 트롤/오우거 =====================
  { id: 'swamp_troll', name: '늪지 트롤', arch: 'tank', mods: { hp: 1.61, atk: 1.26, def: 1.26, spd: 0.85 },
    basicFx: 'blunt', skills: ['e_regen', 'e_maul'], tier: 3, biome: ['swamp', 'forest', 'coast'], expMul: 1.3, goldMul: 1.2,
    sprite: sp({ body: 'body_hulk', head: 'head_orc', armor: 'armor_bare', weapon: 'wpn_mace',
      palette: { skin: 'green', hair: 'green', cloth: 'forest', leather: 'green' } }),
    desc: '베어도 붙는다. 태워야 죽는다.' },
  { id: 'cave_troll', name: '동굴 트롤', arch: 'tank', mods: { hp: 2.49, atk: 1.92, def: 1.84, spd: 0.8 },
    basicFx: 'blunt', skills: ['e_regen', 'e_boulder_toss'], tier: 4, biome: ['cave', 'mountain'], expMul: 1.4, goldMul: 1.3,
    sprite: sp({ body: 'body_hulk', head: 'head_orc', armor: 'armor_bare', weapon: 'wpn_hammer',
      palette: { skin: 'grey', hair: 'black', cloth: 'ash', leather: 'dark' } }),
    desc: '햇빛을 피해 깊은 굴에 사는 거구.' },
  { id: 'ogre_bruiser', name: '오우거 파괴자', arch: 'tank', mods: { hp: 2.41, atk: 2.16, def: 1.68, spd: 0.8 },
    basicFx: 'blunt', skills: ['e_ogre_club', 'e_orc_quake'], tier: 4, biome: ['mountain', 'cave', 'plains', 'swamp'],
    expMul: 1.45, goldMul: 1.4,
    sprite: sp({ body: 'body_hulk', head: 'head_orc', helm: 'helm_mask', armor: 'armor_leather', weapon: 'wpn_hammer',
      palette: { skin: 'tan', hair: 'brown', cloth: 'sand', leather: 'brown', metal: 'iron' } }),
    desc: '한 방에 대열이 무너진다.' },
  { id: 'frost_ogre', name: '서리 오우거', arch: 'tank', mods: { hp: 2.41, atk: 2.09, def: 1.84, spd: 0.8 },
    basicFx: 'ice', skills: ['e_ogre_club', 'e_grave_chill'], tier: 4, biome: ['tundra', 'mountain'], expMul: 1.45, goldMul: 1.4,
    sprite: sp({ body: 'body_hulk', head: 'head_orc', armor: 'armor_heavy', weapon: 'wpn_greataxe',
      palette: { skin: 'grey', hair: 'white', cloth: 'azure', metal: 'silver', glow: 'frost' } }),
    desc: '숨결마다 서리가 내려앉는다.' },

  // ===================== 다크엘프 =====================
  { id: 'darkelf_blade', name: '다크엘프 검무사', arch: 'rogue', mods: { hp: 1.03, atk: 1.32, spd: 1.2 },
    skills: ['e_bandit_flurry', 'e_execute'], tier: 3, biome: ['forest', 'cave', 'mountain'], expMul: 1.3, goldMul: 1.4,
    sprite: sp({ body: 'body_slim', head: 'head_elf', hair: 'hair_long', armor: 'armor_leather', weapon: 'wpn_twindagger',
      palette: { skin: 'ash', hair: 'white', cloth: 'night', leather: 'dark', accent: 'violet' } }),
    desc: '춤추듯 파고들어 목을 그어 놓는다.' },
  { id: 'darkelf_ranger', name: '다크엘프 사수', arch: 'archer', mods: { hp: 0.98, atk: 1.38 },
    range: 'ranged', basicFx: 'arrow', skills: ['e_venom_arrow', 'e_crossbow_bolt'], tier: 3, biome: ['forest', 'cave', 'swamp'],
    expMul: 1.3, goldMul: 1.4,
    sprite: sp({ body: 'body_slim', head: 'head_elf', hair: 'hair_pony', helm: 'helm_hood', armor: 'armor_leather',
      weapon: 'wpn_longbow', palette: { skin: 'ash', hair: 'white', cloth: 'teal', leather: 'dark' } }),
    desc: '어둠 속에서도 후열의 심장을 맞춘다.' },
  { id: 'darkelf_warlock', name: '다크엘프 흑마도사', arch: 'mage', mods: { hp: 1.44, atk: 2.09, res: 1.92 },
    dmgType: 'magic', range: 'ranged', basicFx: 'shadow', skills: ['e_shadow_bolt', 'e_mind_spike'],
    tier: 4, biome: ['forest', 'cave', 'swamp'], expMul: 1.5, goldMul: 1.6,
    sprite: sp({ body: 'body_slim', head: 'head_elf', hair: 'hair_long', helm: 'helm_circlet', armor: 'armor_robe',
      cape: 'cape_long', weapon: 'wpn_wand', offhand: 'shd_orb',
      palette: { skin: 'ash', hair: 'white', cloth: 'violet', glow: 'shadow', metal: 'silver', accent: 'silver' } }),
    desc: '심연과 계약해 그림자를 부린다.' },

  // ===================== 사교도 =====================
  { id: 'cultist_acolyte', name: '사교도 신도', arch: 'mage', mods: { hp: 0.64, atk: 0.8, res: 0.84 },
    dmgType: 'magic', range: 'ranged', basicFx: 'fire', skills: ['e_flame_call'], tier: 2, biome: ['plains', 'swamp', 'cave', 'desert'],
    expMul: 1.1, goldMul: 1.2,
    sprite: sp({ body: 'body_slim', head: 'head_human', helm: 'helm_hood', armor: 'armor_robe', weapon: 'wpn_dagger',
      palette: { skin: 'pale', hair: 'black', cloth: 'crimson', glow: 'blood', accent: 'gold' } }),
    desc: '얼굴을 가린 채 금서의 구절을 읊는다.' },
  { id: 'cultist_zealot', name: '광신도', arch: 'fighter', mods: { hp: 1.15, atk: 1.32, def: 1.03 },
    skills: ['e_blood_offering', 'e_execute'], tier: 3, biome: ['plains', 'swamp', 'cave', 'desert'], expMul: 1.25, goldMul: 1.2,
    sprite: sp({ body: 'body_normal', head: 'head_human', helm: 'helm_hood', armor: 'armor_cloth', weapon: 'wpn_scythe',
      cape: 'cape_tattered',
      palette: { skin: 'pale', hair: 'black', cloth: 'crimson', metal: 'blood', glow: 'blood' } }),
    desc: '죽음을 축복이라 믿기에 멈추지 않는다.' },
  { id: 'cult_priest', name: '사교 사제', arch: 'healer', mods: { hp: 1.52, atk: 1.76, res: 2 },
    dmgType: 'magic', range: 'ranged', basicFx: 'shadow', skills: ['e_unholy_mend', 'e_curse_decay'],
    tier: 4, biome: ['swamp', 'cave', 'desert', 'plains'], expMul: 1.45, goldMul: 1.5,
    sprite: sp({ body: 'body_normal', head: 'head_human', helm: 'helm_hood', armor: 'armor_robe', cape: 'cape_long',
      weapon: 'wpn_staff', offhand: 'shd_torch',
      palette: { skin: 'pale', hair: 'black', cloth: 'crimson', glow: 'blood', metal: 'gold', accent: 'gold' } }),
    desc: '제단의 피로 신도들의 상처를 덮는다.' },

  // ===================== 리자드맨 =====================
  { id: 'lizardman_scout', name: '리자드맨 정찰병', arch: 'rogue', mods: { hp: 0.68, atk: 0.8, spd: 1.15 },
    skills: ['e_venom_spit'], tier: 2, biome: ['swamp', 'coast', 'forest'], expMul: 1.05, goldMul: 1.0,
    sprite: sp({ body: 'body_slim', head: 'head_lizard', armor: 'armor_leather', weapon: 'wpn_dagger',
      palette: { skin: 'green', cloth: 'teal', leather: 'green', accent: 'bronze' } }),
    desc: '늪 수면 아래로 소리 없이 다가온다.' },
  { id: 'lizardman_spear', name: '리자드맨 창병', arch: 'lancer', mods: { hp: 0.8, atk: 0.8, def: 0.84 },
    basicFx: 'pierce', skills: ['e_lizard_spear'], tier: 2, biome: ['swamp', 'coast'], expMul: 1.05, goldMul: 1.0,
    sprite: sp({ body: 'body_normal', head: 'head_lizard', armor: 'armor_leather', weapon: 'wpn_spear', offhand: 'shd_round',
      palette: { skin: 'green', cloth: 'sand', leather: 'green', metal: 'bronze' } }),
    desc: '진흙 속에 창을 세우고 대열을 이룬다.' },
  { id: 'lizardman_shaman', name: '리자드맨 주술사', arch: 'healer', mods: { hp: 1.09, atk: 1.21, res: 1.38 },
    dmgType: 'magic', range: 'ranged', basicFx: 'nature', skills: ['e_unholy_mend', 'e_venom_spit'],
    tier: 3, biome: ['swamp', 'coast'], expMul: 1.25, goldMul: 1.2,
    sprite: sp({ body: 'body_normal', head: 'head_lizard', helm: 'helm_hood', armor: 'armor_robe', weapon: 'wpn_staff',
      palette: { skin: 'green', cloth: 'teal', glow: 'nature', accent: 'bone' } }),
    desc: '늪의 정령에게 부족의 상처를 맡긴다.' },
  { id: 'lizardman_bruiser', name: '리자드맨 파괴자', arch: 'fighter', mods: { hp: 2, atk: 2, def: 1.76 },
    skills: ['e_tail_sweep', 'e_lizard_spear'], tier: 4, biome: ['swamp', 'coast', 'cave'], expMul: 1.4, goldMul: 1.35,
    sprite: sp({ body: 'body_hulk', head: 'head_lizard', helm: 'helm_horned', armor: 'armor_mail', weapon: 'wpn_halberd',
      palette: { skin: 'green', cloth: 'ember', metal: 'bronze', leather: 'dark', accent: 'gold' } }),
    desc: '꼬리 한 번에 전열이 날아간다.' },

  // ===================== 정령 =====================
  { id: 'flame_wisp', name: '화염 정령', arch: 'mage', mods: { hp: 0.6, atk: 0.92, res: 0.92, spd: 1.1 },
    dmgType: 'magic', range: 'ranged', basicFx: 'fire', skills: ['e_flame_call'], tier: 2, biome: ['desert', 'mountain', 'cave'],
    expMul: 1.15, goldMul: 0.9,
    // 정령은 뿔 달린 머리를 쓰지 않는다 — '붉음 + 뿔' 은 악마 전용 신호로 남긴다.
    sprite: sp({ body: 'body_slim', head: 'head_human', hair: 'hair_mohawk', armor: 'armor_bare', cape: 'cape_tattered',
      offhand: 'shd_orb',
      palette: { skin: 'red', hair: 'red', cloth: 'ember', glow: 'fire', metal: 'gold', accent: 'gold' } }),
    desc: '형체 없이 타오르며 떠다닌다.' },
  { id: 'frost_spirit', name: '서리 정령', arch: 'mage', mods: { hp: 0.98, atk: 1.38, res: 1.44 },
    dmgType: 'magic', range: 'ranged', basicFx: 'ice', skills: ['e_frost_shard', 'e_grave_chill'],
    tier: 3, biome: ['tundra', 'mountain', 'coast'], expMul: 1.3, goldMul: 1.0,
    sprite: sp({ body: 'body_slim', head: 'head_human', hair: 'hair_long', armor: 'armor_bare', cape: 'cape_short',
      offhand: 'shd_orb',
      palette: { skin: 'grey', hair: 'white', cloth: 'azure', glow: 'frost', metal: 'silver', accent: 'silver' } }),
    desc: '지나간 자리마다 얼음꽃이 핀다.' },
  // 설계 F: tundra·coast 의 tier 2~3 풀에는 아군을 치유하는 적이 하나도 없었다.
  // D·C 랭크가 이 두 지형에서만 유독 헐거워지는 원인이라 지원형을 하나 채워 넣는다.
  // 스탯은 동급 주술사(리자드맨/오크)와 같은 대역이다 — 난이도를 올리는 건 역할이지 수치가 아니다.
  { id: 'hoarfrost_seer', name: '서리 예언자', arch: 'healer', mods: { hp: 1.09, atk: 1.21, def: 0.95, res: 1.38 },
    dmgType: 'magic', range: 'ranged', basicFx: 'ice', skills: ['e_unholy_mend', 'e_grave_chill'],
    tier: 3, biome: ['tundra', 'coast', 'mountain'], expMul: 1.25, goldMul: 1.2,
    sprite: sp({ body: 'body_normal', head: 'head_human', hair: 'hair_long', helm: 'helm_hood', armor: 'armor_robe',
      cape: 'cape_short', weapon: 'wpn_staff', offhand: 'shd_orb',
      palette: { skin: 'pale', hair: 'white', cloth: 'azure', metal: 'silver', glow: 'frost', accent: 'silver' } }),
    desc: '얼음에 비친 앞날을 읽고 부족의 상처를 덮는다.' },
  { id: 'stone_golem', name: '바위 골렘', arch: 'tank', mods: { hp: 2.56, atk: 1.76, def: 2.32, res: 1.92, spd: 0.7 },
    basicFx: 'blunt', skills: ['e_stone_guard', 'e_boulder_toss'], tier: 4, biome: ['mountain', 'cave', 'desert'],
    expMul: 1.45, goldMul: 1.3,
    sprite: sp({ body: 'body_hulk', head: 'head_human', armor: 'armor_heavy',
      palette: { skin: 'grey', cloth: 'ash', metal: 'dark', leather: 'dark', glow: 'arcane', accent: 'silver' } }),
    desc: '고대의 문지기. 명령이 끝났음을 모른다.' },
  { id: 'storm_wisp', name: '폭풍 정령', arch: 'mage', mods: { hp: 1.44, atk: 2.09, res: 1.92, spd: 1.15 },
    dmgType: 'magic', range: 'ranged', basicFx: 'lightning', skills: ['e_storm_bolt', 'e_wing_gust'],
    tier: 4, biome: ['coast', 'plains', 'tundra', 'mountain'], expMul: 1.45, goldMul: 1.2,
    sprite: sp({ body: 'body_slim', head: 'head_human', hair: 'hair_mohawk', armor: 'armor_bare', cape: 'cape_wing',
      offhand: 'shd_orb',
      palette: { skin: 'ash', hair: 'blue', cloth: 'azure', glow: 'arcane', metal: 'silver', accent: 'silver' } }),
    desc: '벼락을 몸에 두르고 해안을 떠돈다.' },

  // ===================== 악마 =====================
  { id: 'imp', name: '임프', arch: 'rogue', mods: { hp: 0.6, atk: 0.8, spd: 1.25 },
    dmgType: 'magic', range: 'ranged', basicFx: 'fire', skills: ['e_flame_call'], tier: 2, biome: ['cave', 'desert', 'swamp'],
    expMul: 1.1, goldMul: 1.1,
    sprite: sp({ body: 'body_slim', head: 'head_demon', cape: 'cape_wing', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'red', cloth: 'ember', leather: 'dark', glow: 'fire' } }),
    desc: '낄낄거리며 불씨를 던지고 도망간다.' },
  { id: 'hellhound', name: '지옥견', arch: 'fighter', mods: { hp: 1.84, atk: 2.09, spd: 1.2 },
    basicFx: 'fire', skills: ['e_beast_bite', 'e_flame_burst'], tier: 4, biome: ['desert', 'cave', 'mountain'],
    expMul: 1.4, goldMul: 1.3,
    sprite: sp({ body: 'body_normal', head: 'head_wolf', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'red', hair: 'red', cloth: 'ember', leather: 'dark', glow: 'fire' } }),
    desc: '숨을 쉴 때마다 재가 흩날린다.' },
  { id: 'succubus', name: '서큐버스', arch: 'mage', mods: { hp: 1.52, atk: 2.09, res: 2, spd: 1.1 },
    dmgType: 'magic', range: 'ranged', basicFx: 'shadow', skills: ['e_soul_drain', 'e_mind_spike'],
    tier: 4, biome: ['cave', 'swamp', 'plains'], expMul: 1.5, goldMul: 1.6,
    sprite: sp({ body: 'body_slim', head: 'head_demon', hair: 'hair_long', cape: 'cape_wing', armor: 'armor_cloth',
      weapon: 'wpn_wand', palette: { skin: 'red', hair: 'black', cloth: 'rose', glow: 'shadow', accent: 'violet' } }),
    desc: '눈을 마주치는 순간 이미 늦었다.' },
  /* ── tier 5 = S랭크 전용 대역. 4차 전직(배율 2.10) 부대의 상대다 ──
   * 계산 근거(밸런스 담당은 이 문단만 보면 된다):
   *   Lv80 4차 용병의 스탯 배율 = TIER_MULT 2.10 × GRADE_MULT(C 기준 1.06) ≈ 2.23
   *   적은 차수·등급 배율이 없으므로 그 몫을 전부 `mods` 로 짊어져야 한다.
   *   레벨로는 못 메운다 — 적 레벨도 80 에서 clamp 되므로 만렙 부대 앞에서는
   *   quest.js 의 레벨 노브(RANK_CREEP/PROMO_STEP)가 **효과를 잃는다**(HANDOFF §7 교훈).
   * 그래서 3차 시절(용병 1.66 / 적 평균 1.85~1.87, 실측 S 승률 74%)의 비율을
   *   적/용병 = 1.05 → **1.18** 로 끌어올렸다. tier 5 평균 mods: hp 2.63 / atk 2.58.
   * 목표(설계 F)는 S 40~56% 다. 더 조여야 하면 T5_SCALE 하나만 올려라.
   */
  { id: 'demon_warrior', name: '악마 전사', arch: 'fighter', mods: { hp: 2.58, atk: 2.45, def: 2.10, res: 1.85 },
    basicFx: 'shadow', skills: ['e_demon_claw', 'e_hellfire'], tier: 5, biome: ['cave', 'desert', 'swamp', 'mountain'],
    expMul: 1.7, goldMul: 1.7,
    sprite: sp({ body: 'body_hulk', head: 'head_demon', helm: 'helm_horned', armor: 'armor_heavy', cape: 'cape_tattered',
      weapon: 'wpn_greatsword', palette: { skin: 'red', cloth: 'night', metal: 'dark', glow: 'fire', accent: 'blood' } }),
    desc: '심연의 군세에서 가장 흔한 병졸. 그래도 인간보다 강하다.' },
  { id: 'abyss_reaper', name: '심연의 사신', arch: 'rogue', mods: { hp: 2.10, atk: 2.58, def: 1.52, spd: 1.3 },
    basicFx: 'shadow', skills: ['e_execute', 'e_terror_gaze'], tier: 5, biome: ['cave', 'swamp', 'tundra', 'desert'],
    expMul: 1.8, goldMul: 1.8,
    sprite: sp({ body: 'body_normal', head: 'head_demon', helm: 'helm_hood', armor: 'armor_cloth', cape: 'cape_long',
      weapon: 'wpn_scythe', palette: { skin: 'red', cloth: 'night', metal: 'dark', glow: 'shadow', accent: 'violet' } }),
    desc: '낫이 지나간 자리에는 이름조차 남지 않는다.' },

  // ===================== 심연의 정예 (tier 5 · S랭크 전용) =====================
  // ★ S랭크는 이 대역만 상대한다(buildEnemySquad 가 tier 5 에서 spread 0 을 쓴다).
  //   그래서 8종 안에 **전열 벽 2 · 힐러 2 · 버퍼 1 · 원거리 2 · 침투 1** 을 모두 넣어
  //   플레이어가 "탱커·힐러·광역·단일" 조합을 전부 고민해야 이길 수 있게 만든다.
  //   지형 8종 전부에 근접 2기 이상 + 원거리 1기 이상 + 지원 1기 이상이 남도록 배분했다.
  { id: 'abyss_hierophant', name: '심연의 대사제', arch: 'healer',
    mods: { hp: 2.58, atk: 2.35, def: 1.78, res: 2.72, spd: 1.05 },
    dmgType: 'magic', range: 'ranged', basicFx: 'shadow', skills: ['e_unholy_mend', 'e_dark_ritual'],
    tier: 5, biome: ['cave', 'swamp', 'desert', 'plains', 'mountain'], expMul: 1.8, goldMul: 1.9,
    sprite: sp({ body: 'body_normal', head: 'head_demon', helm: 'helm_hood', armor: 'armor_robe', cape: 'cape_long',
      weapon: 'wpn_staff', offhand: 'shd_orb',
      palette: { skin: 'red', cloth: 'violet', metal: 'gold', glow: 'shadow', accent: 'gold' } }),
    desc: '쓰러진 군세를 다시 일으켜 세운다. 먼저 이쪽을 끊어야 한다.' },
  { id: 'blight_druid', name: '역병의 드루이드', arch: 'healer',
    mods: { hp: 2.52, atk: 2.30, def: 1.82, res: 2.62 },
    dmgType: 'magic', range: 'ranged', basicFx: 'nature', skills: ['e_unholy_mend', 'e_curse_decay'],
    tier: 5, biome: ['forest', 'swamp', 'coast', 'tundra'], expMul: 1.8, goldMul: 1.85,
    sprite: sp({ body: 'body_normal', head: 'head_human', hair: 'hair_long', helm: 'helm_hood', armor: 'armor_robe',
      cape: 'cape_tattered', weapon: 'wpn_staff', offhand: 'shd_orb',
      palette: { skin: 'ash', hair: 'green', cloth: 'forest', metal: 'bone', glow: 'nature', accent: 'bone' } }),
    desc: '숲을 썩혀 아군의 상처와 바꿔 먹는 자.' },
  { id: 'void_sentinel', name: '공허의 파수병', arch: 'tank',
    mods: { hp: 3.66, atk: 2.30, def: 3.15, res: 2.62, spd: 0.85 },
    basicFx: 'blunt', skills: ['e_stone_guard', 'e_orc_quake'],
    tier: 5, biome: ['mountain', 'cave', 'tundra', 'coast'], expMul: 1.75, goldMul: 1.7,
    sprite: sp({ body: 'body_hulk', head: 'head_skull', helm: 'helm_great', armor: 'armor_heavy', weapon: 'wpn_hammer',
      offhand: 'shd_tower',
      palette: { skin: 'bone', cloth: 'night', metal: 'dark', leather: 'dark', glow: 'arcane', accent: 'violet' } }),
    desc: '문을 지키라는 명령만 남은 갑주. 전열이 통째로 막힌다.' },
  { id: 'iron_juggernaut', name: '강철 거상', arch: 'tank',
    mods: { hp: 3.58, atk: 2.45, def: 3.00, res: 2.15, spd: 0.85 },
    basicFx: 'blunt', skills: ['e_ogre_club', 'e_stone_guard'],
    tier: 5, biome: ['plains', 'desert', 'mountain', 'coast'], expMul: 1.75, goldMul: 1.7,
    sprite: sp({ body: 'body_hulk', head: 'head_human', helm: 'helm_great', armor: 'armor_plate', weapon: 'wpn_mace',
      offhand: 'shd_tower',
      palette: { skin: 'grey', cloth: 'ash', metal: 'steel', leather: 'dark', glow: 'arcane', accent: 'silver' } }),
    desc: '움직일 때마다 땅이 눌린다. 뚫으려 하지 말고 돌아가야 한다.' },
  { id: 'storm_herald', name: '폭풍의 전령', arch: 'mage',
    mods: { hp: 2.25, atk: 3.00, def: 1.62, res: 2.52, spd: 1.15 },
    dmgType: 'magic', range: 'ranged', basicFx: 'lightning', skills: ['e_storm_bolt', 'e_flame_burst'],
    tier: 5, biome: ['coast', 'plains', 'tundra', 'mountain'], expMul: 1.85, goldMul: 1.8,
    sprite: sp({ body: 'body_slim', head: 'head_elf', hair: 'hair_long', helm: 'helm_circlet', armor: 'armor_robe',
      cape: 'cape_wing', weapon: 'wpn_wand', offhand: 'shd_orb',
      palette: { skin: 'ash', hair: 'blue', cloth: 'azure', metal: 'silver', glow: 'arcane', accent: 'silver' } }),
    desc: '구름을 끌고 다니며 가장 강한 자에게 벼락을 내린다.' },
  { id: 'abyss_marksman', name: '심연의 저격수', arch: 'archer',
    mods: { hp: 2.20, atk: 2.92, def: 1.68, spd: 1.10 },
    range: 'ranged', basicFx: 'arrow', skills: ['e_crossbow_bolt', 'e_venom_arrow'],
    tier: 5, biome: ['forest', 'plains', 'desert', 'coast'], expMul: 1.8, goldMul: 1.8,
    sprite: sp({ body: 'body_normal', head: 'head_demon', helm: 'helm_hood', armor: 'armor_leather', cape: 'cape_short',
      weapon: 'wpn_crossbow',
      palette: { skin: 'red', cloth: 'night', metal: 'blood', leather: 'dark', glow: 'fire', accent: 'blood' } }),
    desc: '후열의 마법사부터 지운다. 시야에 들어가면 이미 늦었다.' },
  { id: 'blood_captain', name: '피의 백부장', arch: 'fighter',
    mods: { hp: 2.78, atk: 2.68, def: 2.20, res: 1.78 },
    skills: ['e_war_cry', 'e_execute'],
    tier: 5, biome: ['plains', 'mountain', 'forest', 'tundra'], expMul: 1.8, goldMul: 1.9,
    sprite: sp({ body: 'body_hulk', head: 'head_human', hair: 'hair_beard', helm: 'helm_horned', armor: 'armor_heavy',
      cape: 'cape_long', weapon: 'wpn_greatsword',
      palette: { skin: 'tan', hair: 'red', cloth: 'crimson', metal: 'blood', glow: 'fire', accent: 'gold' } }),
    desc: '함성 한 번에 군세가 달라진다. 빈사의 적은 반드시 끝낸다.' },
  { id: 'nightmare_stalker', name: '악몽의 추적자', arch: 'rogue',
    mods: { hp: 2.05, atk: 2.72, def: 1.58, spd: 1.35 },
    basicFx: 'shadow', skills: ['e_pounce', 'e_mind_spike'],
    tier: 5, biome: ['forest', 'swamp', 'tundra', 'cave'], expMul: 1.8, goldMul: 1.85,
    sprite: sp({ body: 'body_slim', head: 'head_demon', helm: 'helm_mask', armor: 'armor_leather', cape: 'cape_tattered',
      weapon: 'wpn_twindagger',
      palette: { skin: 'ash', cloth: 'night', metal: 'dark', leather: 'dark', glow: 'shadow', accent: 'violet' } }),
    desc: '전열을 넘어 후열로 곧장 뛰어든다. 진형이 의미를 잃는다.' },

  // ===================== 보스 =====================
  { id: 'goblin_chief', name: '고블린 족장', arch: 'fighter', boss: true,
    mods: { hp: 3.06, atk: 1.15, def: 1.1, spd: 1.05 },
    skills: ['e_chief_roar', 'e_orc_cleave'], tier: 1, biome: ['forest', 'cave', 'plains'], expMul: 3.5, goldMul: 4.0,
    // 보스는 왕관 + 긴 망토 + 큰 무기로 잡졸과 확실히 갈라놓는다.
    sprite: sp({ body: 'body_heavy', head: 'head_goblin', helm: 'helm_crown', armor: 'armor_mail', cape: 'cape_long',
      weapon: 'wpn_greataxe', offhand: 'shd_round',
      palette: { skin: 'green', hair: 'red', cloth: 'crimson', metal: 'bronze', accent: 'bone', glow: 'none' } }),
    desc: '해골 왕관을 쓴 고블린 무리의 우두머리.' },
  { id: 'alpha_wolf', name: '늑대 군주', arch: 'fighter', boss: true,
    mods: { hp: 2.72, atk: 1.12, def: 0.92, spd: 1.3 },
    skills: ['e_pack_howl', 'e_pounce', 'e_beast_bite'], tier: 2, biome: ['forest', 'tundra', 'plains'],
    expMul: 3.6, goldMul: 3.0,
    // 짐승 보스는 망토·왕관이 어울리지 않으므로 덩치(hulk)와 서리 광채로 위압감을 준다.
    sprite: sp({ body: 'body_hulk', head: 'head_wolf', armor: 'armor_bare', weapon: 'wpn_claw',
      palette: { skin: 'grey', hair: 'white', leather: 'dark', glow: 'frost' } }),
    desc: '숲의 모든 늑대가 이 울음에 따른다.' },
  { id: 'bandit_lord', name: '산적 두목', arch: 'fighter', boss: true,
    mods: { hp: 3.04, atk: 1.12, def: 1.04 },
    skills: ['e_boss_command', 'e_bandit_flurry', 'e_execute'], tier: 2, biome: ['plains', 'forest', 'coast', 'desert'],
    expMul: 3.8, goldMul: 5.0,
    sprite: sp({ body: 'body_heavy', head: 'head_human', hair: 'hair_beard', helm: 'helm_plume', armor: 'armor_mail',
      cape: 'cape_long', weapon: 'wpn_greatsword',
      palette: { skin: 'tan', hair: 'black', cloth: 'crimson', metal: 'steel', accent: 'gold' } }),
    desc: '현상금이 웬만한 기사보다 비싸다.' },
  { id: 'cult_hierarch', name: '사교 대주교', arch: 'mage', boss: true,
    mods: { hp: 3.6, atk: 1.5, res: 1.5, def: 1.1 },
    dmgType: 'magic', range: 'ranged', basicFx: 'shadow',
    skills: ['e_hellfire', 'e_blood_offering', 'e_curse_decay'], tier: 3, biome: ['swamp', 'plains', 'desert', 'cave'],
    expMul: 4.0, goldMul: 4.5,
    sprite: sp({ body: 'body_normal', head: 'head_human', helm: 'helm_crown', armor: 'armor_robe', cape: 'cape_long',
      weapon: 'wpn_staff', offhand: 'shd_orb',
      palette: { skin: 'pale', hair: 'white', cloth: 'crimson', metal: 'gold', glow: 'blood', accent: 'gold' } }),
    desc: '피의 제단 앞에서 세상의 끝을 노래한다.' },
  { id: 'orc_warlord', name: '오크 워로드', arch: 'fighter', boss: true,
    mods: { hp: 4.2, atk: 1.5, def: 1.4 },
    skills: ['e_war_cry', 'e_orc_quake', 'e_execute'], tier: 3, biome: ['mountain', 'plains', 'cave', 'tundra'],
    expMul: 4.2, goldMul: 4.2,
    sprite: sp({ body: 'body_hulk', head: 'head_orc', helm: 'helm_horned', armor: 'armor_plate', cape: 'cape_long',
      weapon: 'wpn_greataxe', palette: { skin: 'green', hair: 'black', cloth: 'crimson', metal: 'dark', accent: 'blood' } }),
    desc: '부족 전체를 하나의 군대로 묶은 전쟁군주.' },
  { id: 'ancient_troll', name: '고대 트롤', arch: 'tank', boss: true,
    mods: { hp: 5.75, atk: 1.96, def: 1.96, spd: 0.85 },
    basicFx: 'blunt', skills: ['e_regen', 'e_ogre_club', 'e_boulder_toss'], tier: 4, biome: ['swamp', 'mountain', 'cave', 'forest'],
    expMul: 4.5, goldMul: 4.0,
    sprite: sp({ body: 'body_hulk', head: 'head_orc', hair: 'hair_long', armor: 'armor_bare', cape: 'cape_tattered',
      weapon: 'wpn_hammer',
      palette: { skin: 'green', hair: 'green', cloth: 'forest', leather: 'green', glow: 'nature' } }),
    desc: '늪보다 오래 살았고, 늪보다 끈질기다.' },
  { id: 'darkelf_priestess', name: '다크엘프 여사제', arch: 'healer', boss: true,
    mods: { hp: 4.37, atk: 2.03, res: 2.09, spd: 1.15 },
    dmgType: 'magic', range: 'ranged', basicFx: 'shadow',
    skills: ['e_dark_ritual', 'e_shadow_bolt', 'e_mind_spike'], tier: 4, biome: ['forest', 'cave', 'swamp'],
    expMul: 4.5, goldMul: 5.0,
    sprite: sp({ body: 'body_slim', head: 'head_elf', hair: 'hair_long', helm: 'helm_crown', armor: 'armor_robe',
      cape: 'cape_long', weapon: 'wpn_staff', offhand: 'shd_orb',
      palette: { skin: 'ash', hair: 'white', cloth: 'violet', metal: 'silver', glow: 'shadow', accent: 'silver' } }),
    desc: '거미 여신의 이름으로 어둠을 집행한다.' },
  /* ── tier 5 보스 = S랭크 전용 ──
   * 위의 tier 5 잡졸을 끌어올린 만큼 보스도 같이 올려야 한다. 그대로 두면 **보스가 자기
   * 호위보다 약하게 때리는** 우스운 상태가 된다(예전 값: 보스 atk 1.85~1.95 < 잡졸 2.45~3.00).
   * 비율은 3차 시절 그대로 유지했다 — 보스 hp ≈ 같은 tier 잡졸 평균의 2.2~2.9배,
   * atk ≈ 1.20배. 실제로 S랭크 보스전 적/아군 총 HP 비는 1.23 → 1.34 로만 움직인다.
   * ※ 랭크별 보스 damp(`BOSS_SCALE`)는 quest.js 소유다. 여기서는 템플릿만 만진다.
   */
  { id: 'lich', name: '리치', arch: 'mage', boss: true,
    mods: { hp: 5.60, atk: 3.10, res: 2.80, def: 1.95 },
    dmgType: 'magic', range: 'ranged', basicFx: 'shadow',
    skills: ['e_lich_nova', 'e_curse_decay', 'e_grave_chill'], tier: 5, biome: ['cave', 'swamp', 'tundra', 'desert'],
    expMul: 5.5, goldMul: 6.0,
    sprite: sp({ body: 'body_slim', head: 'head_skull', helm: 'helm_crown', armor: 'armor_robe', cape: 'cape_long',
      weapon: 'wpn_staff', offhand: 'shd_orb',
      palette: { skin: 'bone', cloth: 'night', metal: 'gold', glow: 'shadow', accent: 'violet' } }),
    desc: '죽음을 거래해 영생을 산 대마법사의 잔재.' },
  { id: 'demon_lord', name: '악마 군주', arch: 'fighter', boss: true,
    mods: { hp: 6.70, atk: 3.15, def: 2.60, res: 2.40 },
    basicFx: 'shadow', skills: ['e_hellfire', 'e_terror_gaze', 'e_demon_claw'], tier: 5, biome: ['cave', 'desert', 'swamp'],
    expMul: 6.0, goldMul: 6.5,
    sprite: sp({ body: 'body_hulk', head: 'head_demon', helm: 'helm_horned', armor: 'armor_heavy', cape: 'cape_wing',
      weapon: 'wpn_greatsword', offhand: 'shd_torch',
      palette: { skin: 'red', cloth: 'night', metal: 'dark', glow: 'fire', accent: 'blood' } }),
    desc: '군단 하나를 혼자 상대할 수 있는 존재.' },
  { id: 'flame_dragon', name: '화염룡', arch: 'tank', boss: true,
    mods: { hp: 7.70, atk: 3.20, def: 2.70, res: 2.70, spd: 1.05 },
    dmgType: 'magic', basicFx: 'fire', skills: ['e_dragon_breath', 'e_wing_buffet', 'e_maul'],
    tier: 5, biome: ['mountain', 'cave', 'desert'], expMul: 7.0, goldMul: 8.0,
    sprite: sp({ body: 'body_hulk', head: 'head_demon', helm: 'helm_horned', armor: 'armor_heavy', cape: 'cape_wing',
      weapon: 'wpn_claw', palette: { skin: 'red', cloth: 'ember', metal: 'blood', glow: 'fire', accent: 'gold' } }),
    desc: '산 하나를 둥지로 삼은 늙은 용. 도망칠 수 있다면 도망쳐라.' },
  // 기존 tier 5 보스 3종은 cave/desert/swamp/mountain/tundra 에만 살았다. 그래서 평야·숲·해안의
  // S랭크 의뢰는 보스가 떠도 tier 4 보스로 대체돼 유독 헐거웠다. 두 종을 더해 8지형을 덮는다.
  { id: 'void_titan', name: '공허의 거신', arch: 'tank', boss: true,
    mods: { hp: 7.40, atk: 3.10, def: 2.90, res: 2.60, spd: 0.85 },
    basicFx: 'blunt', skills: ['e_stone_guard', 'e_orc_quake', 'e_boulder_toss'],
    tier: 5, biome: ['plains', 'coast', 'mountain', 'tundra'], expMul: 6.5, goldMul: 7.0,
    sprite: sp({ body: 'body_hulk', head: 'head_skull', helm: 'helm_crown', armor: 'armor_heavy', cape: 'cape_long',
      weapon: 'wpn_hammer', offhand: 'shd_tower',
      palette: { skin: 'bone', cloth: 'night', metal: 'dark', leather: 'dark', glow: 'arcane', accent: 'violet' } }),
    desc: '별이 떨어진 자리에 남은 거신. 아군까지 암석으로 감싸며 걸어온다.' },
  { id: 'blight_archon', name: '역병의 아르콘', arch: 'healer', boss: true,
    mods: { hp: 6.00, atk: 3.05, def: 2.10, res: 2.85, spd: 1.05 },
    dmgType: 'magic', range: 'ranged', basicFx: 'nature',
    skills: ['e_dark_ritual', 'e_hellfire', 'e_curse_decay'],
    tier: 5, biome: ['forest', 'swamp', 'coast', 'plains'], expMul: 6.5, goldMul: 7.0,
    sprite: sp({ body: 'body_normal', head: 'head_demon', hair: 'hair_long', helm: 'helm_crown', armor: 'armor_robe',
      cape: 'cape_wing', weapon: 'wpn_staff', offhand: 'shd_orb',
      palette: { skin: 'ash', hair: 'green', cloth: 'forest', metal: 'gold', glow: 'nature', accent: 'gold' } }),
    desc: '숲째로 썩혀 군세를 되살린다. 화력을 나누면 절대 못 죽인다.' },
];

/** 적 템플릿 맵 (id -> Enemy). */
export const ENEMIES = {};
for (const e of ENEMY_DEFS) {
  ENEMIES[e.id] = { ...ENEMY_BASE, ...e, sprite: e.sprite || sp({}) };
}

/* ── 통짜 전투 시트(battleSheet) 배정 ─────────────────────────────────
 *
 * ★★ 파츠 조립은 «사람 몸 + 갈아끼우는 머리·무기» 다. 늑대·곰은 그래서 **사람 몸에
 *   동물 머리만 얹힌 모습**이 됐고, 바위 골렘은 깡마른 사람이었다. 파츠를 아무리
 *   고쳐도 구조가 틀린 것은 안 고쳐진다 — 이런 적만 통짜 그림(HANDOFF §61)으로 간다.
 *
 * ★ 한 장이 여러 적을 덮는다: 팔레트가 색을 정하므로 회색늑대·동굴곰·검치호·지옥견이
 *   같은 그림을 쓰고, 화염/서리/폭풍 정령도 같은 그림이다. 그래서 시트 그림에는
 *   «불꽃 빨강» 같은 고유색을 박지 않고 마력광 문자(f/g/G)로만 그린다.
 *
 * ★ 무기를 든 인간형 적은 여기 넣지 않는다 — 통짜 그림은 무기를 함께 굽기 때문에
 *   «고블린 병졸(단검)» 과 «고블린 궁수(활)» 가 같은 그림을 쓸 수 없다. 그쪽은 조립이 맞다.
 *
 * 시트 열 장이 다 없으면 spritegen 의 sheetOf 가 조용히 조립으로 물러난다 (안전망).
 */
const BATTLE_SHEET = {
  bt_beast: ['gray_wolf', 'wild_boar', 'dire_wolf', 'cave_bear', 'saber_cat', 'hellhound', 'alpha_wolf'],
  bt_spirit: ['flame_wisp', 'frost_spirit', 'storm_wisp'],
  /* 강철 거상은 방패·철퇴·판금을 갖춘 «중장 인간형» 이다 — 무기가 그림에 구워지면
   * 안 되므로 조립에 남긴다. 통짜로 가는 것은 무기를 안 든 구조체뿐이다.
   * 통짜로 가는 것은 무기를 안 든 구조체뿐이다. */
  bt_golem: ['stone_golem'],
  bt_spider: ['cave_spider'],
  bt_harpy: ['harpy'],
  bt_dragon: ['flame_dragon'],
};
for (const [sheet, ids] of Object.entries(BATTLE_SHEET)) {
  for (const id of ids) {
    const e = ENEMIES[id];
    if (e && e.sprite) e.sprite.battleSheet = sheet;
  }
}

/** 순회용 배열 (ENEMIES 와 동일 객체 참조). */
export const ENEMY_LIST = Object.values(ENEMIES);
/** 보스 목록 (배열). ENEMIES 안에도 그대로 들어있다. */
export const BOSSES = ENEMY_LIST.filter((e) => e.boss);

// ---------------------------------------------------------------------------
// 3. 조회 헬퍼
// ---------------------------------------------------------------------------

export function getEnemy(id) {
  return ENEMIES[id] || null;
}

/** 레벨 -> 난이도 대역(tier) 추정. */
export function tierForLevel(level) {
  const lv = Math.max(1, Math.round(level || 1));
  if (lv <= 8) return 1;
  if (lv <= 18) return 2;
  if (lv <= 30) return 3;
  if (lv <= 44) return 4;
  return 5;
}

const inBiome = (e, biome) => !biome || !Array.isArray(e.biome) || e.biome.includes(biome) || e.biome.includes('any');

/**
 * 특정 지역/난이도에 등장 가능한 적 목록.
 * @param {string} biome 'plains'|'forest'|'mountain'|'desert'|'swamp'|'coast'|'tundra'|'cave'
 * @param {number} tier 1~5
 * @param {{boss?:boolean, spread?:number}} [opt] boss=true 면 보스만, spread 는 아래로 허용할 tier 폭
 * @returns {object[]} 적 템플릿 배열 (비어 있지 않도록 단계적으로 조건을 완화한다)
 */
export function enemiesFor(biome, tier, opt = {}) {
  const boss = !!opt.boss;
  const spread = opt.spread == null ? 1 : opt.spread;
  const t = clamp(Math.round(tier || 1), 1, 5);
  const pool = ENEMY_LIST.filter((e) => !!e.boss === boss);
  const tries = [
    (e) => inBiome(e, biome) && e.tier <= t && e.tier >= t - spread,
    (e) => inBiome(e, biome) && e.tier <= t,
    (e) => inBiome(e, biome) && e.tier <= t + 1,
    // 지역에 해당 대역의 적이 아예 없으면, 지역을 버리기보다 대역을 먼저 포기한다.
    // (실제 스탯은 tier 가 아니라 소환 레벨이 결정하므로 지역 일관성이 더 중요하다)
    (e) => inBiome(e, biome),
    (e) => e.tier <= t && e.tier >= t - spread,
    (e) => e.tier <= t,
    () => true,
  ];
  for (const f of tries) {
    const out = pool.filter(f);
    if (out.length) return out;
  }
  return pool;
}

// ---------------------------------------------------------------------------
// 4. 부대 구성
// ---------------------------------------------------------------------------

const isRangedEnemy = (e) => e.range === 'ranged' || e.arch === 'archer' || e.arch === 'mage' || e.arch === 'healer';

/** FORMATIONS 가 맵이든 배열이든 동작하도록 감싼 조회. */
function formationIds() {
  const src = Array.isArray(FORMATIONS) ? FORMATIONS.map((f) => f && f.id) : Object.keys(FORMATIONS || {});
  return src.filter(Boolean);
}
function lookupFormation(id) {
  if (typeof getFormation === 'function') {
    const f = getFormation(id);
    if (f) return f;
  }
  if (Array.isArray(FORMATIONS)) return FORMATIONS.find((f) => f && f.id === id) || null;
  return (FORMATIONS && FORMATIONS[id]) || null;
}

/** 적이 쓸 진형 id 를 고른다. data/formations.js 에 실제 존재하는 id 만 반환. */
function pickFormationId(tier, boss, r) {
  const ids = formationIds().filter((id) => {
    const f = lookupFormation(id);
    return f && Array.isArray(f.slots) && f.slots.length >= 7;
  });
  if (!ids.length) return formationIds()[0] || 'basic';
  // 낮은 티어의 잡졸은 단순한 진형만, 상위/보스전은 고급 진형까지 허용
  const maxTier = boss ? 3 : tier <= 1 ? 1 : tier <= 3 ? 2 : 3;
  const ok = ids.filter((id) => (lookupFormation(id).tier || 1) <= maxTier);
  return r.pick(ok.length ? ok : ids);
}

/** 진형 슬롯 인덱스를 전열(x 작은 순)부터 나열. */
function slotOrder(formationId) {
  const f = lookupFormation(formationId);
  const slots = f && Array.isArray(f.slots) ? f.slots : null;
  const idx = [0, 1, 2, 3, 4, 5, 6];
  if (!slots || slots.length < 7) return idx;
  return idx.sort((a, b) => (slots[a].x - slots[b].x) || (slots[a].y - slots[b].y));
}

/** 풀에 등장하는 적들이 보유한 적 스킬 id 집합 (정예 챔피언의 추가 스킬 후보). */
function collectPoolSkills(pool) {
  const set = new Set();
  for (const e of pool) for (const id of (e && e.skills) || []) set.add(id);
  return [...set];
}

/**
 * 정예(설계 E) 표식을 유닛에 실는다. **스탯을 직접 곱하지 않는다** —
 * 적 최종 스탯은 quest.js `enemyStats` 가 계산하므로, 여기서는 배율/표식만 얹고
 * quest.js 가 `eliteMult` 를 읽어 한 번만 곱한다.
 *   - 전원: `eliteMult = ELITE_MULT`(1.30)
 *   - 챔피언 1~2기(보스 제외): `champion=true` / `eliteMult = ELITE_CHAMPION_MULT`(1.60, **대체**)
 *     / `nameOverride = '정예 '+이름` / `skills = 원래 스킬 + 같은 tier 풀 스킬 1개`
 * @param {object[]} placed     슬롯이 배정된 전체 유닛 (보스 포함)
 * @param {object[]} champPool  챔피언 후보 (보스를 제외한 호위 유닛)
 * @param {string[]} poolSkills 추가 스킬 후보 id 목록
 * @param {RNG} r
 */
function markElite(placed, champPool, poolSkills, r) {
  for (const u of placed) u.eliteMult = ELITE_MULT;
  const cands = champPool.length ? champPool : placed;
  if (!cands.length) return;
  const n = clamp(r.int(ELITE_CHAMPIONS[0], ELITE_CHAMPIONS[1]), 1, cands.length);
  for (const u of r.pickMany(cands, n)) {
    const e = getEnemy(u.enemyId);
    if (!e) continue;
    u.champion = true;
    u.eliteMult = ELITE_CHAMPION_MULT;            // 1.30 을 곱하지 않고 대체한다
    u.nameOverride = ELITE_PREFIX + e.name;
    const own = Array.isArray(e.skills) ? e.skills.slice() : [];
    const extraPool = poolSkills.filter((id) => !own.includes(id));
    const extra = extraPool.length ? r.pick(extraPool) : null;
    u.skills = extra ? [...own, extra] : own;     // quest.js 는 u.skills 가 있으면 이걸 쓴다
  }
}

/**
 * 적 부대를 구성한다.
 * @param {object} opt {biome, tier, level, count, boss, elite, rng} — quest 힌트를 그대로 넘겨도 된다.
 * @param {object} [rngArg] buildEnemySquad(quest, rng) 형태 호출 지원
 * @returns {{units:{enemyId, level, slotIndex, eliteMult?, champion?, nameOverride?, skills?}[], formationId:string}}
 *   정예가 아니면 유닛은 `{enemyId, level, slotIndex}` 그대로다(기존 호출과 동일).
 *   `opt.elite` 면 전원에 `eliteMult`, 1~2기에 `champion/nameOverride/skills` 가 추가로 실린다.
 */
export function buildEnemySquad(opt = {}, rngArg = null) {
  const r = opt.rng || rngArg || globalRng;
  const biome = opt.biome || 'plains';
  const level = clamp(Math.round(opt.level != null ? opt.level : 5), 1, MAX_ENEMY_LEVEL);
  const tier = clamp(Math.round(opt.tier != null ? opt.tier : tierForLevel(level)), 1, 5);
  const boss = !!opt.boss;
  const elite = !!opt.elite;

  let count = opt.count != null ? Math.round(opt.count) : boss ? r.int(5, 7) : r.int(3, 6);
  count = clamp(count, 1, 7);
  if (boss) count = clamp(Math.max(count, 5), 5, 7); // 보스 1 + 호위 4~6

  const formationId = pickFormationId(tier, boss, r);
  const order = slotOrder(formationId);
  const used = new Set();
  const takeFront = () => {
    for (const i of order) if (!used.has(i)) { used.add(i); return i; }
    return -1;
  };
  const takeBack = () => {
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      if (!used.has(i)) { used.add(i); return i; }
    }
    return -1;
  };

  // S랭크(tier 5)는 tier 5 대역만 상대한다. spread 0 으로 tier 4 잡졸의 희석을 막아
  // 4차 부대(TIER_MULT 2.10)에 맞는 세기를 유지한다. 그 외 tier 는 한 단계 아래까지 섞는다.
  const spread = tier >= 5 ? 0 : 1;
  const pool = enemiesFor(biome, tier, { spread });
  const meleePool = pool.filter((e) => !isRangedEnemy(e));
  const rangedPool = pool.filter(isRangedEnemy);
  const poolSkills = collectPoolSkills(pool);
  const units = [];
  const escortUnits = [];   // 정예 챔피언 후보 (보스 제외)
  const lvOf = (bonus = 0) => clamp(level + bonus, 1, MAX_ENEMY_LEVEL);

  // 보스 배치: 근접형은 최전열, 시전형은 최후열에 세운다.
  if (boss) {
    const bossPool = enemiesFor(biome, tier, { boss: true, spread: 1 });
    const b = r.pick(bossPool);
    const slotIndex = isRangedEnemy(b) ? takeBack() : takeFront();
    units.push({ enemyId: b.id, level: lvOf(2), slotIndex });
  }

  const escorts = count - units.length;
  if (escorts > 0) {
    // 후열(원거리) 비율 ~40%. 전열이 반드시 1명 이상 남도록 조정한다.
    let rangedCount = escorts <= 1 ? (meleePool.length ? 0 : escorts)
      : escorts === 2 ? 1
      : Math.max(1, Math.round(escorts * 0.4));
    if (escorts >= 4 && r.chance(0.35)) rangedCount += 1;
    rangedCount = clamp(rangedCount, 0, escorts - (escorts > 1 ? 1 : 0));
    if (!rangedPool.length) rangedCount = 0;
    if (!meleePool.length) rangedCount = escorts;
    const meleeCount = escorts - rangedCount;

    /* ── 설계 F: 지원형·전열벽 보장 ──
     * 원거리만 있거나 힐러가 전혀 없는 적 부대는 플레이어가 조합을 고민할 필요도 없이 무너진다.
     * tier 3(D·C) 이상·정예·보스전에서는 힐러/버퍼를 최소 1기 세워 화력 집중을 강요하고,
     * tier 4(B) 이상·정예에서는 전열에 탱커를 하나 심어 벽을 만든다.
     * tier 1(F·E)은 손대지 않는다 — 초반 보호(설계 F). 지형 풀에 해당 역할이 없으면 강제하지 않는다. */
    const wantSupport = tier >= 3 || boss || elite;
    const wantTank = tier >= 4 || elite;
    const rangedSupport = rangedPool.filter(isSupportEnemy);
    const meleeSupport = meleePool.filter(isSupportEnemy);
    const meleeTanks = meleePool.filter((e) => e.arch === 'tank');
    // 원거리 지원이 있으면 후열에, 없으면 전열 버퍼로 지원형을 채운다.
    const meleeSupportFirst = wantSupport && !rangedSupport.length && meleeSupport.length > 0 && meleeCount > 0;
    // 탱커 슬롯: 전열 지원이 0번을 차지하면 1번으로 민다.
    const tankSlot = wantTank && meleeTanks.length ? (meleeSupportFirst ? 1 : 0) : -1;
    let supportDone = false;

    for (let i = 0; i < meleeCount; i++) {
      let e;
      if (meleeSupportFirst && i === 0) e = r.pick(meleeSupport);
      else if (i === tankSlot) e = r.pick(meleeTanks);
      else e = r.pick(meleePool.length ? meleePool : pool);
      if (isSupportEnemy(e)) supportDone = true;
      const u = { enemyId: e.id, level: lvOf(r.int(-1, 1)), slotIndex: takeFront() };
      units.push(u); escortUnits.push(u);
    }
    for (let i = 0; i < rangedCount; i++) {
      let e;
      if (wantSupport && !supportDone && rangedSupport.length && i === 0) e = r.pick(rangedSupport);
      else e = r.pick(rangedPool.length ? rangedPool : pool);
      if (isSupportEnemy(e)) supportDone = true;
      const u = { enemyId: e.id, level: lvOf(r.int(-1, 1)), slotIndex: takeBack() };
      units.push(u); escortUnits.push(u);
    }
  }

  const placed = units.filter((u) => u.slotIndex >= 0);
  // 정예(설계 E): 전원 강화 + 챔피언 1~2기(보스 제외).
  if (elite && placed.length) markElite(placed, escortUnits.filter((u) => u.slotIndex >= 0), poolSkills, r);

  const out = placed.sort((a, b) => a.slotIndex - b.slotIndex);
  return { units: out, formationId };
}
