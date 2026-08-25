// 전투 AI — 타게팅 / 행동 선택.
// 순수 JS. DOM 참조 금지. engine.js 가 이 모듈을 import 한다 (역방향 의존 없음).
//
// 유닛은 engine 이 만든 런타임 유닛이며 최소한 다음을 갖는다:
//   { uid, side, idx, alive, hp, maxHp, x, y, st, buffs, dots, shield, stunUntil, cds, skillDefs }
import { clamp } from './util.js';

/** 힐/치유형 스킬을 쓰기 시작하는 HP 비율 임계값 */
export const HEAL_THRESHOLD = 0.7;

/** 근접 유닛이 "전열"로 인정하는 x 밴드 폭 (필드 단위) */
const FRONT_BAND = 14;

/** 전열도(높을수록 적진에 가까운 앞줄). 아군은 x가 클수록, 적군은 x가 작을수록 앞이다. */
const frontScore = (u) => (u.side === 'ally' ? u.x : -u.x);
const hpRatio = (u) => (u.maxHp > 0 ? u.hp / u.maxHp : 0);

/** dir: 1=오름차순, -1=내림차순. 동률은 생성 순서(idx)로 고정 → 결정론 유지 */
function rank(arr, key, dir) {
  return arr.slice().sort((a, b) => (key(a) - key(b)) * dir || a.idx - b.idx);
}

/** 실제로 피해를 주는 스킬인가 */
export function isDamaging(skill) {
  if (!skill) return false;
  const scope = skill.target || 'enemy';
  if (scope !== 'enemy' && scope !== 'allEnemy') return false;
  return (skill.power || 0) > 0 && !!skill.dmgType && skill.dmgType !== 'none';
}

/** 지원형(피해 없음) 스킬인가 */
export function isSupport(skill) {
  return !isDamaging(skill);
}

/**
 * 클래스/적 정의의 basicFx / basicRange / basicDmgType 로 기본공격 스킬을 만든다.
 * 기본공격은 데이터에 없고 엔진이 자동 생성한다 (power 1.0 고정, 쿨 없음).
 */
export function makeBasicSkill(unit) {
  const range = unit.basicRange === 'ranged' ? 'ranged' : 'melee';
  return {
    id: null,
    name: '기본 공격',
    cd: 0,
    power: 1.0,
    dmgType: unit.basicDmgType || 'phys',
    target: 'enemy',
    select: 'front',
    count: 1,
    range,
    fx: unit.basicFx || (range === 'ranged' ? 'arrow' : 'slash'),
    effects: [],
    basic: true,
    desc: '무기로 적을 친다.',
  };
}

/** 가장 앞줄 무리만 남긴다 (근접 유닛의 기본 성향) */
function frontGroup(pool) {
  let max = -Infinity;
  for (const u of pool) { const f = frontScore(u); if (f > max) max = f; }
  const g = pool.filter((u) => frontScore(u) >= max - FRONT_BAND);
  return g.length ? g : pool;
}

/**
 * 스킬의 대상 목록을 고른다.
 * select: front | back | lowestHp | highestAtk | random | self | lowestHpAlly
 * @returns {Array} 런타임 유닛 배열 (없으면 빈 배열)
 */
export function selectTargets(unit, skill, battle) {
  const scope = skill.target || 'enemy';
  if (scope === 'self') return unit.alive ? [unit] : [];

  const allies = battle.units.filter((u) => u.alive && u.side === unit.side);
  const foes = battle.units.filter((u) => u.alive && u.side !== unit.side);
  if (scope === 'allAlly') return allies;
  if (scope === 'allEnemy') return foes;

  const toAlly = scope === 'ally';
  const pool = toAlly ? allies : foes;
  if (!pool.length) return [];

  const sel = skill.select || (toAlly ? 'lowestHpAlly' : 'front');
  if (sel === 'self') return unit.alive ? [unit] : [];

  // 근접 유닛은 전열을 노린다. 단 도적류의 back(후열 침투)은 그대로 존중한다.
  let cand = pool;
  if (!toAlly && skill.range === 'melee' && sel !== 'back' && sel !== 'front') cand = frontGroup(pool);

  const count = clamp(Math.round(skill.count || 1), 1, cand.length);
  switch (sel) {
    case 'front': return rank(cand, frontScore, -1).slice(0, count);
    case 'back': return rank(cand, frontScore, 1).slice(0, count);
    case 'lowestHp':
    case 'lowestHpAlly': return rank(cand, hpRatio, 1).slice(0, count);
    case 'highestAtk': return rank(cand, (u) => u.st.atk, -1).slice(0, count);
    case 'random': return battle.rng.pickMany(cand, count);
    default: return rank(cand, frontScore, -1).slice(0, count);
  }
}

/** 이 효과가 대상에게 이미 걸려 있는가 (낭비 방지용) */
function effectRedundant(skill, e, t, battle) {
  switch (e.type) {
    case 'heal': return hpRatio(t) >= HEAL_THRESHOLD;
    case 'buff':
    case 'debuff': return t.buffs.some((b) => b.src === skill.id && b.stat === e.stat);
    case 'shield': return t.shield > 0;
    case 'dot': return t.dots.some((d) => d.src === skill.id);
    case 'stun': return t.stunUntil > battle.time;
    default: return false;
  }
}

/** 지금 이 스킬을 쓰는 게 의미가 있는가 */
function usable(unit, skill, targets, battle) {
  const effects = skill.effects || [];
  // 힐 계열은 아군 중 HP 70% 미만이 있을 때만. (풀피에 쏟아붓지 않는다)
  if (effects.some((e) => e.type === 'heal')) {
    const allies = battle.units.filter((u) => u.alive && u.side === unit.side);
    if (!allies.some((u) => hpRatio(u) < HEAL_THRESHOLD)) return false;
  }
  if (isDamaging(skill)) return true;
  // 피해가 없는 순수 지원기: 모든 대상에게 모든 효과가 이미 걸려 있으면 낭비다.
  if (!effects.length) return false;
  for (const t of targets) {
    for (const e of effects) {
      if (e.type === 'lifesteal') continue;
      if (!effectRedundant(skill, e, t, battle)) return true;
    }
  }
  return false;
}

/** 우선순위: 조건을 통과한 지원기 > 강한 공격기 > 약한 공격기 > 기본공격 */
function priorityOf(skill, idx) {
  if (typeof skill.priority === 'number') return skill.priority - idx * 0.001;
  const base = isDamaging(skill) ? 10 + (skill.power || 0) * 10 : 100;
  return base - idx * 0.001;
}

/**
 * 유닛이 지금 취할 행동을 고른다.
 * 쿨이 도는(=사용 가능한) 스킬 중 우선순위 최고를 쓰고, 없으면 기본공격.
 * @returns {{skill:object, targets:Array}|null} 대상이 아무도 없으면 null
 */
export function chooseAction(unit, battle) {
  const defs = unit.skillDefs || [];
  let best = null;
  let bestP = -Infinity;
  for (let i = 0; i < defs.length; i++) {
    const sk = defs[i];
    if (!sk) continue;
    if ((unit.cds[sk.id] || 0) > battle.time) continue;
    const targets = selectTargets(unit, sk, battle);
    if (!targets.length) continue;
    if (!usable(unit, sk, targets, battle)) continue;
    const p = priorityOf(sk, i);
    if (p > bestP) { bestP = p; best = { skill: sk, targets }; }
  }
  if (best) return best;

  if (!unit.basic) unit.basic = makeBasicSkill(unit);
  const targets = selectTargets(unit, unit.basic, battle);
  if (!targets.length) return null;
  return { skill: unit.basic, targets };
}
