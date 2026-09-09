// §174 src/data/heroes.js 생성기 — t4.json(기계 필드) + herotext.json(작가 원고, 없으면 자리표시) → 파일 하나
const fs = require('fs');
/* ★ §183 원고(t4.json·herotext.json)는 이 스크립트 옆 data/ 에 있다 */
const S = __dirname + '/data';
const t4 = JSON.parse(fs.readFileSync(`${S}/t4.json`, 'utf8'));
let text = {};
try { for (const h of JSON.parse(fs.readFileSync(`${S}/herotext.json`, 'utf8'))) text[h.id] = h; } catch { text = {}; }

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/* gen_hero_art.mjs lookOf() 와 같은 식 — 일러스트의 머리색이 곧 그 영웅의 색이다 */
const HAIR = ['silver hair', 'jet black hair', 'blonde hair', 'crimson red hair', 'snow white hair', 'dark brown hair',
  'navy blue hair', 'ash gray hair', 'platinum blonde hair', 'auburn hair', 'golden hair', 'dark blue hair',
  'chestnut brown hair', 'copper red hair', 'black hair with silver streaks', 'pale blonde hair'];
const HAIR_HEX = {
  'silver hair': '#d8dce8', 'jet black hair': '#9a9cb8', 'blonde hair': '#f2d27a', 'crimson red hair': '#e0433f',
  'snow white hair': '#f4f4f8', 'dark brown hair': '#c08a5a', 'navy blue hair': '#6b84e6', 'ash gray hair': '#b8bcc8',
  'platinum blonde hair': '#f6e7b5', 'auburn hair': '#d0703f', 'golden hair': '#ffc94a', 'dark blue hair': '#5e78e0',
  'chestnut brown hair': '#c08a58', 'copper red hair': '#e6773f', 'black hair with silver streaks': '#c0c4d0', 'pale blonde hair': '#f7e6c0',
};
const ROOT_ORDER = ['swordsman', 'spearman', 'shieldman', 'archer', 'rogue', 'apprentice', 'acolyte'];
t4.sort((a, b) => ROOT_ORDER.indexOf(a.root) - ROOT_ORDER.indexOf(b.root) || a.parentName.localeCompare(b.parentName, 'ko') || (a.id.endsWith('_apex') ? 0 : 1) - (b.id.endsWith('_apex') ? 0 : 1));

let missing = 0;
const rows = t4.map((c, i) => {
  const t = text[c.id];
  const hair = HAIR[(i * 7 + 3) % HAIR.length];
  const color = HAIR_HEX[hair];
  if (!t) missing++;
  const name = t ? t.name : `${c.name}`;
  const title = t ? t.title : '이름 없는 전설';
  const story = t ? t.story : `${c.rootName}의 길 끝에서 ${c.name}에 이른 자. 그 이름은 아직 기록되지 않았다.`;
  const skillName = t ? t.skillName : '고유기';
  const skillDesc = t ? t.skillDesc : '영웅의 고유 기술.';
  const skill2Name = t ? t.skill2Name : '각성기';
  const skill2Desc = t ? t.skill2Desc : '각성한 영웅의 기술.';
  return `  ${c.id}: {\n    arch: ${q(c.arch)}, dmgType: ${q(c.dmgType)}, range: ${q(c.range)}, fx: ${q(c.basicFx)}, root: ${q(c.root)},\n    hair: ${q(hair)}, color: ${q(color)},\n`
    + `    name: ${q(name)}, title: ${q(title)},\n    story: ${q(story)},\n`
    + `    skillName: ${q(skillName)}, skillDesc: ${q(skillDesc)},\n    skill2Name: ${q(skill2Name)}, skill2Desc: ${q(skill2Desc)},\n  },`;
});

const out = `/**
 * 영웅 — S 위의 존재 (§174)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 제작자 요구(2026-09-08):
 *   「S등급 위의 영웅. 주점에서 S 가 뽑힐 때 주사위를 한 번 더 굴려 1/2 로 영웅. 4차 클래스별로 한 명(56명),
 *    고유한 일러스트와 짧은 스토리, 전투에서 더 화려한 고유 스킬. 1렙부터 4차 클래스로 시작하고
 *    80레벨에 각성석 30개로 각성하면 100레벨까지 크고 고유 스킬이 하나 더 생긴다.」
 *
 * ── 표현
 *   · 영웅은 **등급 'S' + \`merc.hero = <4차 클래스 id>\`** 다. 등급 글자를 새로 만들지 않는다 —
 *     S 를 세는 규칙(rules.js sMercs · 서버 s_mercs · 명물 확률 상한)이 전부 \`grade === 'S'\` 라서,
 *     새 글자를 두면 그 규칙들이 조용히 영웅을 놓친다. 화면은 \`gradeKeyOf(merc)\` 로 «H» 를 따로 그린다.
 *   · 영웅 id = 4차 클래스 id (한 클래스에 한 명). \`merc.classId === merc.hero\` 가 항상 성립한다 (state 정규화가 지킨다).
 *   · 각성: \`merc.awakened\`. 레벨 상한이 80 → 100 (\`merc.js levelCapOf\`), 두 번째 고유 스킬이 열린다.
 *
 * ── 고유 스킬은 **계열(arch)별 틀**에 영웅마다 이름·문구·속성을 입힌 것이다 (\`buildHeroSkills\`).
 *   엔진이 실제로 처리하는 7종 효과(heal/buff/debuff/dot/shield/stun/lifesteal) 안에서만 만든다.
 *   id 는 \`hero_<클래스id>\` / \`hero2_<클래스id>\`. skills.js 가 모듈 끝에서 addSkills 로 합친다 —
 *   그래서 서버 엔진 사본(_engine)에도 같이 실린다 (여기 없으면 서버 재현에서 조용히 사라진다 — pets.js 의 그 함정).
 *   \`priority\` 200/210 — 쿨이 돌면 다른 스킬보다 먼저 쓴다 (ai.js priorityOf).
 *
 * ── 이 파일은 limits.js 만 문다 (서버 묶음에 그대로 들어간다). 텍스트는 작가 에이전트가 썼다 (HANDOFF §174).
 *
 * @module data/heroes
 */
import { HERO_MAX_LEVEL, HERO_AWAKEN_LEVEL, HERO_AWAKEN_STONES, HERO_CHANCE_ON_S } from './limits.js';

export { HERO_MAX_LEVEL, HERO_AWAKEN_LEVEL, HERO_AWAKEN_STONES, HERO_CHANCE_ON_S };

/**
 * 영웅 정의. 키 = 4차 클래스 id = 영웅 id.
 * arch/dmgType/range/fx/root 는 classes_t4.js 의 값을 **베껴 둔 것**이다 — 여기서 classes 를 import 하면
 * skills.js ↔ classes.js 가 서로를 물게 된다. 스모크가 두 표를 대조한다.
 */
const RAW = {
${rows.join('\n')}
};

/* ─────────────────────────── 고유 스킬 틀 (계열별) ───────────────────────────
 * 숫자는 4차 스킬 규약(단일 2.6~3.6 / 광역 1.4~2.0 / 회복 1.8~2.6)의 **한 단계 위**다.
 * 각성 스킬(s2)은 그보다 크다. 밸런스는 tools/abysswall.mjs 로 잰다 (§175).
 */
const dmg = (h) => (h.dmgType === 'none' ? 'magic' : h.dmgType);
const KIT = {
  tank: {
    s1: (h) => ({
      cd: 20, power: 1.6, dmgType: 'none', target: 'allAlly', select: 'self', count: 1, range: 'ranged', fx: 'buff',
      effects: [{ type: 'shield', power: 1.6, dur: 8, target: 'allAlly' }, { type: 'buff', stat: 'def', amount: 0.45, dur: 8, target: 'self' }],
    }),
    s2: (h) => ({
      cd: 22, power: 1.8, dmgType: dmg(h), target: 'allEnemy', select: 'random', count: 1, range: h.range, fx: h.fx,
      effects: [{ type: 'stun', dur: 0.9, chance: 0.7 }],
    }),
  },
  healer: {
    s1: () => ({
      cd: 18, power: 2.0, dmgType: 'none', target: 'allAlly', select: 'self', count: 1, range: 'ranged', fx: 'heal',
      effects: [{ type: 'heal', power: 2.0, target: 'allAlly' }, { type: 'buff', stat: 'atk', amount: 0.25, dur: 10, target: 'allAlly' }],
    }),
    s2: () => ({
      cd: 22, power: 3.5, dmgType: 'none', target: 'allAlly', select: 'self', count: 1, range: 'ranged', fx: 'holy',
      effects: [{ type: 'shield', power: 2.0, dur: 10, target: 'allAlly' }, { type: 'heal', power: 3.5, target: 'ally' }],
    }),
  },
  fighter: {
    s1: (h) => ({
      cd: 16, power: 3.6, dmgType: dmg(h), target: 'enemy', select: 'front', count: 1, range: h.range, fx: h.fx,
      effects: [{ type: 'stun', dur: 1.0, chance: 0.7 }],
    }),
    s2: (h) => ({
      cd: 20, power: 2.2, dmgType: dmg(h), target: 'allEnemy', select: 'random', count: 1, range: h.range, fx: h.fx,
      effects: [{ type: 'dot', dmgType: dmg(h), power: 0.35, tick: 1, dur: 6 }],
    }),
  },
  rogue: {
    s1: (h) => ({
      cd: 16, power: 4.0, dmgType: dmg(h), target: 'enemy', select: 'lowestHp', count: 1, range: h.range, fx: h.fx,
      effects: [{ type: 'lifesteal', ratio: 0.5 }],
    }),
    s2: (h) => ({
      cd: 20, power: 2.6, dmgType: dmg(h), target: 'enemy', select: 'random', count: 3, range: h.range, fx: h.fx,
      effects: [{ type: 'debuff', stat: 'def', amount: -0.3, dur: 8 }],
    }),
  },
  lancer: {
    s1: (h) => ({
      cd: 16, power: 3.2, dmgType: dmg(h), target: 'enemy', select: 'front', count: 2, range: h.range, fx: h.fx,
      effects: [{ type: 'stun', dur: 0.8, chance: 0.6 }],
    }),
    s2: (h) => ({
      cd: 20, power: 2.2, dmgType: dmg(h), target: 'allEnemy', select: 'random', count: 1, range: h.range, fx: h.fx,
      effects: [{ type: 'buff', stat: 'spd', amount: 0.3, dur: 8, target: 'self' }],
    }),
  },
  archer: {
    s1: (h) => ({
      cd: 18, power: 2.0, dmgType: dmg(h), target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: h.fx,
      effects: [],
    }),
    s2: (h) => ({
      cd: 20, power: 4.5, dmgType: dmg(h), target: 'enemy', select: 'highestAtk', count: 1, range: 'ranged', fx: h.fx,
      effects: [{ type: 'debuff', stat: 'atk', amount: -0.3, dur: 8 }],
    }),
  },
  mage: {
    s1: (h) => ({
      cd: 18, power: 2.2, dmgType: dmg(h), target: 'allEnemy', select: 'random', count: 1, range: 'ranged', fx: h.fx,
      effects: [{ type: 'dot', dmgType: dmg(h), power: 0.4, tick: 1, dur: 6 }],
    }),
    s2: (h) => ({
      cd: 20, power: 3.2, dmgType: dmg(h), target: 'enemy', select: 'random', count: 3, range: 'ranged', fx: h.fx,
      effects: [{ type: 'stun', dur: 0.6, chance: 0.6 }],
    }),
  },
};

/** 계열별 틀 이름 (도감·상세 표기용) */
export const KIT_LABEL = {
  tank: '수호', healer: '축복', fighter: '맹공', rogue: '암살', lancer: '관통', archer: '일제 사격', mage: '재앙',
};

/* ─────────────────────────── 테마 (§177) ───────────────────────────
 * 제작자: 「특정 색으로 강조하지 말고 UI 를 다르게 — 영웅마다 특색이 없어 보인다」.
 * 영웅의 색 = **일러스트의 머리색**(\`color\`, 그림과 같은 값) · 속성 = 고유 스킬 fx · 문장 = 계열.
 * 도감 카드·명부 카드·상세·이름표·초상 후광이 전부 이 셋으로 갈린다. 분홍(GRADE_COLOR.H)은 색이 없을 때의 폴백이다.
 */
export const HERO_ELEMENT = {
  fire: { name: '화염', color: '#ff7a2a' }, ice: { name: '한기', color: '#6fd8ff' }, holy: { name: '신성', color: '#ffd36b' },
  shadow: { name: '암흑', color: '#a56bff' }, nature: { name: '정령', color: '#6fd86a' }, lightning: { name: '뇌전', color: '#ffe14a' },
  poison: { name: '맹독', color: '#a6e34a' }, bolt: { name: '마력', color: '#8f7bff' }, slash: { name: '검격', color: '#e6e9f5' },
  pierce: { name: '관통', color: '#e6e9f5' }, arrow: { name: '화살', color: '#e6e9f5' }, blunt: { name: '타격', color: '#ffb36b' },
  heal: { name: '치유', color: '#8fe0a6' }, buff: { name: '가호', color: '#ffd36b' },
};
/** 계열 문장 (1차 클래스 id) */
export const HERO_CREST = { swordsman: '⚔', spearman: '🔱', shieldman: '🛡', archer: '🏹', rogue: '🗡', apprentice: '✦', acolyte: '✚' };

/** 이 영웅의 화면 테마 — { color, hair, element:{name,color}, crest, kit } */
export function heroTheme(hero) {
  const h = typeof hero === 'string' ? HEROES[hero] : hero;
  if (!h) return { color: '#ff7fd8', hair: '', element: { name: '', color: '#ff7fd8' }, crest: '★', kit: '' };
  return {
    color: h.color || '#ff7fd8',
    hair: h.hair || '',
    element: HERO_ELEMENT[h.fx] || { name: '', color: h.color || '#ff7fd8' },
    crest: HERO_CREST[h.root] || '★',
    kit: KIT_LABEL[h.arch] || '',
  };
}

/** 영웅 색 하나만 (UI 의 짧은 호출용). 모르는 id 면 분홍. */
export function heroColorOf(id) {
  const h = id && HEROES[id];
  return (h && h.color) || '#ff7fd8';
}

/** id 주입 + 스킬 id 부여 */
function stamp(map) {
  const out = {};
  for (const [id, h] of Object.entries(map)) {
    out[id] = { ...h, id, classId: id, skill: \`hero_\${id}\`, skill2: \`hero2_\${id}\` };
  }
  return out;
}

/** @type {Record<string, object>} 영웅 id → 정의 */
export const HEROES = stamp(RAW);
/** 영웅 id 목록 (계열 → 3차 → apex/abyss 순) */
export const HERO_IDS = Object.keys(HEROES);

/** @returns {object|null} */
export function getHero(id) {
  return (id && HEROES[id]) || null;
}

/** 이 용병이 영웅이면 그 정의, 아니면 null. **클래스가 영웅 클래스와 같을 때만** 인정한다. */
export function heroOf(merc) {
  if (!merc || !merc.hero) return null;
  const h = HEROES[merc.hero];
  return h && h.classId === merc.classId ? h : null;
}

/** 영웅인가 */
export function isHero(merc) {
  return !!heroOf(merc);
}

/** 각성했나 */
export function isAwakened(merc) {
  return !!(heroOf(merc) && merc.awakened);
}

/**
 * 이 용병이 전투에 들고 나갈 고유 스킬 id (0~2개). 편성(allyUnitDefs)이 클래스 스킬 뒤에 붙인다.
 * ★ 문자열만 돌려준다 — 실제 정의는 skills.js 사전에 있어야 하고, 없으면 엔진이 조용히 버린다.
 */
export function heroSkillIds(merc) {
  const h = heroOf(merc);
  if (!h) return [];
  return merc.awakened ? [h.skill, h.skill2] : [h.skill];
}

/**
 * 고유 스킬 112개를 만든다 (skills.js 가 addSkills 로 합친다).
 * 영웅마다 **새 객체**를 만든다 — 같은 틀이라도 effects 배열을 공유하지 않는다.
 */
export function buildHeroSkills() {
  const out = {};
  for (const h of Object.values(HEROES)) {
    const kit = KIT[h.arch] || KIT.fighter;
    out[h.skill] = { name: h.skillName, desc: h.skillDesc, hero: true, ult: 1, priority: 200, ...kit.s1(h) };
    out[h.skill2] = { name: h.skill2Name, desc: h.skill2Desc, hero: true, ult: 2, priority: 210, ...kit.s2(h) };
  }
  return out;
}
`;
fs.writeFileSync('C:/claude/game/src/data/heroes.js', out.replace(/\r?\n/g, '\r\n'));
console.log(`✓ src/data/heroes.js (${t4.length}명 · 원고 없음 ${missing}명)`);
