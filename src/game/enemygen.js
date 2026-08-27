/**
 * 적 생성 — **의존성이 가벼운 모듈**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 따로 뺐나
 *   나락·탑을 **서버에서 다시 돌리려면 «적을 만드는 절반»만** 있으면 된다.
 *   아군은 클라이언트가 편성을 올린다 (PvP 의 `pvp_defense.units` 와 같은 방식).
 *   그런데 원래 있던 자리(`game/quest.js`)는 state·gear·squad·pet·world 를 전부 물어서,
 *   적 스탯 하나 계산하자고 **게임 전체를 서버로 끌고 가게 된다.**
 *
 *   그렇다고 서버 쪽에 공식을 베껴 적으면 안 된다 — 손으로 베낀 두 번째 사본이 생기면
 *   밸런스를 고치는 날 클라와 서버의 판정이 조용히 갈린다. `data/limits.js` 가 같은 이유로
 *   먼저 뜯겨 나왔고, 그 머리말에 사고 이력이 적혀 있다.
 *
 *   그래서 **정의는 여기 한 벌**만 두고, `quest.js` 는 여기서 import 해 다시 내보낸다.
 *   기존 import 경로(`quest.js` 의 `enemyUnitDefs`·`enemyStats`·`MAX_QUEST_LEVEL` 등)는
 *   전부 그대로 동작한다.
 *
 * ★★ 이 파일의 import 는 **아래 여섯 줄이 전부여야 한다.** 그 성질이 존재 이유다.
 *   state/gear/squad/pet/world/merc 를 물기 시작하면 다시 게임 전체가 딸려 온다.
 *   (`data/enemies.js` 가 무는 것 — core/util·core/rng·data/skills·data/formations — 까지가
 *   서버로 넘어가는 경계다.)
 *
 * @module game/enemygen
 */
import { clamp, scaleStats } from '../core/util.js';
import { ARCHETYPES } from '../data/classes.js';
import { getEnemy } from '../data/enemies.js';
import { getFormation, formationMods } from '../data/formations.js';
import { MAX_LEVEL } from '../data/limits.js';

/* ------------------------------------------------------------------ 상수 */

/** 레벨 상한 (권장 레벨·적 레벨·전리품 ilvl 공용).
 *  단원 최고 레벨과 **반드시 같은 값**이라서 `data/limits.js` 에서 그대로 받아 온다.
 *  (예전에는 여기에 80 을 직접 적어 뒀다 — 순환 참조를 피하려던 것이었는데,
 *  limits.js 는 아무것도 import 하지 않으므로 순환이 생기지 않는다.) */
export const MAX_QUEST_LEVEL = MAX_LEVEL;

export const RANK_IDX = { F: 0, E: 1, D: 2, C: 3, B: 4, A: 5, S: 6 };

/** 랭크별 적 스탯 직접 배율 — **1차 튜닝 노브** (설계 F) */
// 레벨 보정(RANK_CREEP)은 덧셈이라 고레벨 랭크에서 효과가 급격히 약해진다.
//   growth(lv+d)/growth(lv) = 1 + 0.085d/growth(lv)  ← 분모가 커질수록 이득이 줄어든다.
// 반대로 이 배율은 레벨과 무관하게 일정하게 먹힌다. 목표 대역(설계 F)을 맞출 때는
// 이 표를 0.02 단위로 움직여라 (경험적으로 0.02 ≈ 승률 3~5%p).
//   F 88~100% / E 72~86 / D 62~78 / C 55~70 / B 48~64 / A 44~60 / S 40~56
// **F는 1.00 고정** — 초반 보호 구간이라 절대 올리지 않는다.
// ※ hp/atk/def/res/spd 전부에 곱해진다. 한쪽에서 HP와 화력이 함께 k배가 되면 체감은
//   대략 k² 이므로 큰 값을 한 번에 넣지 마라.
// ★ D 는 1.14 였다. 진형 6종의 전열 페널티를 줄이면서 **적 진형도 같이 강해져** D 승률이
//   63.0% → 58.9% 로 목표(62~78%) 밖으로 떨어졌다. D 만 0.01 내려 64.8% 로 복귀시켰다.
//   이 표는 매우 민감하다 — 실측으로 A 를 0.04 내리자 51.9% → 79.3% 로 뛰었다. 0.01 단위로 만져라.
export const RANK_POWER = [1.00, 1.04, 1.13, 1.12, 1.09, 1.06, 1.08];

export const GROWTH_RATE = 0.085;
const SCALING_KEYS = ['hp', 'atk', 'def', 'res', 'spd'];
const FLAT_KEYS = ['crit', 'critDmg', 'eva'];
const ENEMY_GRADE = ['E', 'D', 'C', 'B', 'A'];
export const FALLBACK_SLOTS = [
  { x: 0.10, y: 0.28 }, { x: 0.10, y: 0.72 }, { x: 0.38, y: 0.14 },
  { x: 0.38, y: 0.50 }, { x: 0.38, y: 0.86 }, { x: 0.74, y: 0.30 }, { x: 0.74, y: 0.70 },
];

/* ── 정예(Elite) 배율 (설계 E) ───────────────────────────────────────
 * 정예가 «언제 뜨는가»(ELITE_CHANCE)·«보상이 얼마인가»(ELITE_REWARD)는 의뢰 생성 쪽 이야기라
 * `quest.js` 에 남아 있다. 여기 있는 것은 **적 스탯에 실제로 곱해지는 값**뿐이다.
 */
/** 정예 의뢰 적 전원 스탯 배율.
 *  ※ 7차 세션: 원래 1.30 이었는데 hp·atk·def·res 전부에 1.30 을 곱하면 실효 전투력이
 *  약 1.30²≈1.7배가 되어, 목표 승률 대역에 맞춰 둔 일반 의뢰를 승률 0~4%로 짓밟았다(실측
 *  하락폭 -52~-78%p). 목표는 같은 랭크 일반 대비 -18~28%p 이므로 배율을 크게 낮췄다. */
const ELITE_MULT = 1.035;
/** 그중 챔피언(정예 개체) 스탯 배율 — ELITE_MULT 를 곱하지 않고 **대체**한다.
 *  1~2기만 붙는 개체라 조금 더 세게 둔다(전장에서 '정예' 접두사로 바로 보인다). */
const ELITE_CHAMP_MULT = 1.10;
/** 챔피언 수 [최소, 최대] */
const ELITE_CHAMPS = [1, 2];
/** 스탯 배율이 spd 에 반영되는 비율.
 *  hp/atk/def/res 는 배율을 그대로 받지만 spd 까지 1.6배면 적이 두 배로 행동해 관전이
 *  불가능해진다(피해량이 아니라 행동 횟수가 두 배가 된다). 속도는 일부만 올린다. */
const ELITE_SPD_SHARE = 0.25;
/** 전장에서 바로 보이도록 이름에 붙는 접두사 */
export const ELITE_PREFIX = '정예 ';

/**
 * 낮은 랭크의 보스를 눌러준다.
 *
 * 보스는 같은 tier 일반 적의 약 2배 세기로 설계돼 있다. 3차 전직을 마친 B~S랭크 부대에게는
 * 알맞지만, E·D·C 랭크에서는 부대가 그 배율을 감당하지 못해 **보스전 승률이 0%** 였다(실측).
 * 보스가 뜬 의뢰는 사실상 자동 패배였다는 뜻이다.
 * 등장 빈도를 줄이는 대신, 낮은 랭크에서는 배율 자체를 낮춰 "어렵지만 이길 수는 있는" 수준으로 만든다.
 */
const BOSS_SCALE = { F: 0.34, E: 0.34, D: 0.45, C: 0.62, B: 0.80, A: 0.85, S: 0.90 };
const BOSS_SCALE_KEYS = ['hp', 'atk', 'def', 'res'];

/* ------------------------------------------------------------------ 도구 */

/** FNV-1a 32bit — 시드·uid 를 결정론으로 만든다 */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function slotsOf(formationId) {
  const f = getFormation(formationId) || getFormation('basic');
  return f && Array.isArray(f.slots) && f.slots.length === 7 ? f.slots : FALLBACK_SLOTS;
}

/** 적 최종 스탯. SPEC §2.1 (등급/차수 배율 없음, mods는 아키타입 대비 배율) */
export function enemyStats(enemy, level) {
  const base = ARCHETYPES[enemy?.arch] || ARCHETYPES.fighter;
  const mods = enemy?.mods || {};
  const lv = clamp(Math.round(level || 1), 1, MAX_QUEST_LEVEL);
  const growth = 1 + GROWTH_RATE * (lv - 1);
  const out = {};
  for (const k of SCALING_KEYS) out[k] = Math.max(1, Math.round(base[k] * (mods[k] ?? 1) * growth));
  for (const k of FLAT_KEYS) out[k] = Math.round(base[k] * (mods[k] ?? 1));
  return out;
}

/**
 * 진형 효과를 스탯에 반영한다.
 *
 * 이게 빠져 있으면 진형을 사고 바꿔도 전투 결과가 전혀 달라지지 않는다.
 * `squad.js` 의 squadUnitDefs 는 적용하고 있었지만, 의뢰 전투는 `quest.js` 의
 * allyUnitDefs/enemyUnitDefs 경로를 타기 때문에 그동안 통째로 누락돼 있었다.
 *
 * 반드시 **아군과 적 양쪽 모두** 적용해야 한다. 한쪽만 적용하면 일방적인 버프가 되어
 * 랭크별 난이도 튜닝이 전부 어긋난다. (그래서 아군 쪽 quest.js 도 이 함수를 쓴다.)
 */
export function withFormation(stats, formationId, slotIndex, unit) {
  try {
    const mods = formationMods(formationId || 'basic', slotIndex, unit);
    return mods ? scaleStats(stats, mods) : stats;
  } catch (e) {
    console.warn('[enemygen] 진형 효과 계산 실패', e);
    return stats;
  }
}

function dampBoss(stats, enemy, rank) {
  const k = BOSS_SCALE[rank];
  if (!enemy?.boss || k == null || k === 1) return stats;
  const out = { ...stats };
  for (const key of BOSS_SCALE_KEYS) out[key] = Math.max(1, Math.round(out[key] * k));
  return out;
}

/**
 * 스탯 배율을 SCALING_KEYS 에 곱한다. spd 만 spdShare 비율로 눌러 적용할 수 있다.
 * 정예 배율(1.60)을 spd 에 그대로 곱하면 적이 두 배로 행동해 관전이 불가능해지므로
 * spd 는 일부만(ELITE_SPD_SHARE) 올린다. 랭크 난이도 배율(RANK_POWER)은 spdShare=1 로 전부 곱한다.
 */
function applyMult(stats, mult, spdShare = 1) {
  if (!Number.isFinite(mult) || mult === 1) return stats;
  const out = { ...stats };
  for (const k of SCALING_KEYS) {
    const share = k === 'spd' ? spdShare : 1;
    out[k] = Math.max(1, Math.round(out[k] * (1 + (mult - 1) * share)));
  }
  return out;
}

/**
 * 웨이브의 정예 배치를 정한다(설계 E).
 * enemies.js 가 유닛마다 eliteMult/champion/nameOverride 를 실어 줬으면 그대로 쓰고(권장 경로),
 * 아직 안 실렸는데 quest.elite/ wave.elite 만 켜져 있으면 여기서 폴백으로 계산한다 —
 * 그래야 enemies.js 갱신 여부와 무관하게 정예 의뢰가 실제로 강해진다.
 * @returns {(i:number, u:object)=>{mult:number, champion:boolean, nameOverride:(string|null)}}
 */
function eliteResolver(wave, quest, waveIndex) {
  const annotated = wave.units.some((u) => Number.isFinite(u?.eliteMult));
  const on = annotated || !!(wave.elite || (quest && quest.elite));
  if (!on) return () => ({ mult: 1, champion: false, nameOverride: null });
  // 폴백: 앞쪽(전열, slotIndex 오름차순) 1~2기를 챔피언으로. 시드는 의뢰+웨이브로 결정론.
  const seed = hashStr(`${quest?.id || 'q'}#elite#${waveIndex}`);
  const champN = clamp(ELITE_CHAMPS[0] + (seed % 100 < 45 ? 1 : 0), ELITE_CHAMPS[0], ELITE_CHAMPS[1]);
  const champSet = new Set();
  for (let k = 0; k < wave.units.length && champSet.size < champN; k++) champSet.add(k);
  return (i, u) => {
    if (Number.isFinite(u?.eliteMult)) {
      return { mult: u.eliteMult, champion: !!u.champion, nameOverride: u.nameOverride || null };
    }
    const champion = champSet.has(i);
    return { mult: champion ? ELITE_CHAMP_MULT : ELITE_MULT, champion, nameOverride: null };
  };
}

/* ------------------------------------------------------------------ 본체 */

/**
 * 웨이브 하나를 전투 유닛 정의(UnitDef[])로 바꾼다.
 *
 * 입력은 **직렬화 가능한 것만** 받는다 — 웨이브(units/formationId/power/elite)와
 * 의뢰의 몇 필드(id/rank/elite)뿐이다. 그래서 서버에서도 같은 입력으로 같은 적이 나온다.
 * @returns {Array} UnitDef[]
 */
export function enemyUnitDefs(wave, quest, waveIndex) {
  const slots = slotsOf(wave.formationId);
  const nameCount = new Map();
  for (const u of wave.units) nameCount.set(u.enemyId, (nameCount.get(u.enemyId) || 0) + 1);
  const seenName = new Map();
  // 웨이브 스탯 배율(설계 F). 옛 세이브(power 없음)는 랭크 기준 RANK_POWER 로 폴백한다.
  const wavePower = Number.isFinite(wave.power) ? wave.power : (RANK_POWER[RANK_IDX[quest?.rank] ?? 0] ?? 1);
  const resolveElite = eliteResolver(wave, quest, waveIndex);

  return wave.units.map((u, i) => {
    const e = getEnemy(u.enemyId);
    if (!e) return null;
    const n = (seenName.get(u.enemyId) || 0) + 1;
    seenName.set(u.enemyId, n);
    const label = nameCount.get(u.enemyId) > 1 ? `${e.name} ${n}` : e.name;
    const si = clamp(u.slotIndex ?? i, 0, 6);
    const elite = resolveElite(i, u);

    // 스탯 파이프라인: 기본 → 랭크 배율(spd 전부) → 정예 배율(spd 일부) → 보스 감쇠 → 진형.
    let stats = enemyStats(e, u.level);
    stats = applyMult(stats, wavePower, 1);
    stats = applyMult(stats, elite.mult, ELITE_SPD_SHARE);
    stats = dampBoss(stats, e, quest.rank);
    stats = withFormation(stats, wave.formationId, si, { arch: e.arch, classId: null, boss: !!e.boss });

    // 정예 개체는 전장에서 바로 읽히도록 이름에 '정예 ' 접두사가 붙는다(또는 enemies.js 의 nameOverride).
    let name = label;
    if (elite.nameOverride) name = elite.nameOverride;
    else if (elite.champion) name = `${ELITE_PREFIX}${label}`;

    // 스킬: 적 기본 스킬 + enemies.js 가 정예 개체에 얹은 추가 스킬(addSkills).
    const skills = Array.isArray(e.skills) ? e.skills.slice() : [];
    if (Array.isArray(u.addSkills)) for (const s of u.addSkills) if (s && !skills.includes(s)) skills.push(s);

    return {
      uid: `en_${hashStr(quest.id).toString(36)}_${waveIndex}_${i}`,
      name,
      side: 'enemy',
      enemyId: e.id,
      classId: null,
      level: u.level,
      grade: e.boss ? 'S' : ENEMY_GRADE[clamp((e.tier || 1) - 1, 0, 4)],
      stats,
      skills,
      basicFx: e.basicFx || 'slash',
      basicRange: e.range || 'melee',
      basicDmgType: e.dmgType || 'phys',
      slot: slots[si],
      slotIndex: si,
      recipe: e.sprite,
      boss: !!e.boss,
      champion: !!elite.champion,
    };
  }).filter(Boolean);
}
