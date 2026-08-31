// 의뢰 생성 / 전투 정의 변환 / 보상 정산.
// 순수 JS: DOM을 만지지 않는다. state.js와 순환 참조라 네임스페이스로 받는다.
import { clamp, num } from '../core/util.js';
import { rng } from '../core/rng.js';
import { getCity, REGIONS } from '../data/world.js';
import { getClass, promoteOptions, classChain } from '../data/classes.js';
import { traitOfChain } from '../data/lineage.js';
import { buildEnemySquad, enemiesFor } from '../data/enemies.js';
import * as State from './state.js';
import * as Merc from './merc.js';
import * as Squad from './squad.js';
import * as Pet from './pet.js';
// 세트 고유 효과 조회용. **네임스페이스로 받는다** — `setSpecialsFor` 는 gear.js 쪽에서 나중에
// 붙는 함수라, 이름을 콕 집어 import 하면 아직 없을 때 모듈 링크 단계에서 통째로 터진다.
import * as Gear from './gear.js';
/* ★★ 적 생성부는 **의존성 가벼운 모듈**로 떼어 놨다 (`game/enemygen.js`).
 *   나락·탑을 서버에서 다시 돌리려면 «적을 만드는 절반»만 필요한데, 이 파일은
 *   state·gear·squad·pet·world 를 전부 물어서 통째로는 서버로 못 간다.
 *   ★ 여기서 다시 정의하지 마라 — **정의는 enemygen.js 한 벌뿐이다.** 아래는 재수출이다. */
import {
  MAX_QUEST_LEVEL, RANK_IDX, RANK_POWER, GROWTH_RATE, FALLBACK_SLOTS, ELITE_PREFIX,
  hashStr, slotsOf, enemyStats, withFormation, enemyUnitDefs,
} from './enemygen.js';

/** 적 생성부의 공개 이름들 — 기존 `import { … } from './quest.js'` 를 전부 그대로 살린다. */
export { MAX_QUEST_LEVEL, ELITE_PREFIX, enemyStats, enemyUnitDefs };

/* ------------------------------------------------------------------ 상수 */

/* ══════════════════════════════════════════════════════════════════════════
 * 의뢰 **생성** 절반은 `game/questgen.js` 로 옮겼다 (§138).
 *
 * ★★ `export … from` 은 **지역 바인딩을 안 만든다.** 이 파일이 직접 쓰는 이름은
 *   아래 `import` 로 따로 받는다 — 안 해서 `cityPowerOf is not defined` 로 터진 적이 있다.
 * ══════════════════════════════════════════════════════════════════════════ */
export {
  RANKS, RANK_LEVEL, SUBS, SUB_LABEL, SUB_NAME, SUB_POWER, RANK_SUB_LEVEL,
  subOf, rankLabelOf, subLevelRange,
  ELITE_MIN_RANK, ELITE_LABEL, ELITE_WARN, isEliteQuest, normalizeQuest,
  GOLD_MULT, RANK_DAYS, CITY_LEVEL_FLOOR, cityLevelFloorOf,
  REP_GAIN, QUEST_TYPES, QUEST_COUNT_MIN, QUEST_COUNT_MAX,
  CITY_POWER, cityPowerOf, CITY_REWARD_POW,
} from './questgen.js';

import * as Gen from './questgen.js';
/* 이 파일이 **직접 쓰는** 것들 (재수출만으로는 안 보인다) */
import {
  rankLabelOf, isEliteQuest, REP_GAIN,
  ELITE_RENOWN, WOUND_CHANCE, WOUND_DAYS, DOWN_HP_WIN, HP_FLOOR, repLoss,
} from './questgen.js';

/**
 * 도시의 의뢰 목록을 생성한다 — **얇은 껍데기다.**
 *
 * ★ 규칙은 `questgen.genQuests` 한 벌이다. 여기서 하는 일은 하나뿐이다:
 *   부대 수를 안 주면 **전역 상태에서 읽어** 넘긴다. 그 한 줄 때문에 생성부 전체가
 *   서버로 못 가고 있었다 (§138).
 *
 * ★★ 서버는 반드시 `squadCount` 를 **명시해서** 부른다. 안 주면 1부대로 보고
 *   목록이 6~7건만 생겨 7번 이후 의뢰가 «없는 의뢰» 가 된다.
 *
 * @param {string} cityId
 * @param {number} day
 * @param {object} r RNG 인스턴스
 * @param {number} [squadCount] 부대 수. 생략하면 전역 상태에서 읽고, 없으면 1로 본다.
 * @returns {Array} Quest[]
 */
export function genQuests(cityId, day = 1, r = rng, squadCount = null) {
  let live = 0;
  try { live = (State.state?.squads || []).length; } catch { live = 0; }
  return Gen.genQuests(cityId, day, r, Gen.resolveSquadCount(squadCount, live));
}

/* ------------------------------------------------------------------ 전투 정의 */

/* ★ 적을 만드는 절반(enemyUnitDefs · enemyStats · slotsOf · withFormation · applyMult ·
 *   dampBoss · eliteResolver 와 그 상수들)은 `game/enemygen.js` 로 옮겼다.
 *   이 파일이 무는 것(state·gear·squad·pet·world) 없이도 돌아야 서버가 나락·탑을
 *   다시 계산할 수 있기 때문이다. 아래 아군 경로는 거기서 import 해 **같은 함수**를 쓴다 —
 *   진형 효과가 한쪽에만 걸리면 랭크 튜닝이 통째로 어긋난다. */

/** 부상 판정 — squad.js의 canDeploy와 같은 기준을 써야 벤치 인원이 어긋나지 않는다. */
function isBenched(m, day) {
  if (!m) return true;
  if (typeof Merc.isWounded === 'function') return !!Merc.isWounded(m, day);
  return m.status === 'wounded';
}

/** 전열 판정 기준 (SPEC §3.4: slot.x < 0.34 = front). squad.js와 같은 값을 쓴다. */
const FRONT_X = 0.34;

/**
 * 그 용병에게 **지금 발동 중인 세트 고유 효과**를 UnitDef 형태로 뽑는다.
 *
 * 진실의 원천은 `data/sets.js` 의 `special`/`specialParams` 하나뿐이다.
 * gear.js 가 `setSpecialsFor(merc, itemsById)` 로 넘겨 주고, 여기서는 엔진 계약 형태인
 * `[{ id, params }]` 로만 정규화한다.
 *
 * ★ `squad.js squadUnitDefs` 와 **완전히 같은 규칙이어야 한다.** 의뢰·던전 전투는 이 파일의
 *   allyUnitDefs 경로를, 나머지는 squad.js 경로를 탄다 — 한쪽만 배선하면 3차 세션의
 *   "진형이 의뢰 전투에만 안 걸리던" 버그가 그대로 재현된다.
 *
 * 고유 효과는 **아군 전용**이다. enemyUnitDefs 에는 절대 싣지 않는다.
 * 결정론: 입력 순서를 보존하고(Set 은 삽입 순서) 무작위 요소를 쓰지 않는다.
 *
 * @param {object} m
 * @param {object|Array|Map|null} itemsById
 * @returns {Array<{id:string, params:object}>} 없으면 빈 배열
 */
function mercSpecials(m, itemsById) {
  if (!m) return [];
  let raw = null;
  try {
    // gear.js 가 전용 함수를 제공하면 그걸 쓰고, 아직 없으면 세트 보너스에서 직접 꺼낸다.
    if (typeof Gear.setSpecialsFor === 'function') raw = Gear.setSpecialsFor(m, itemsById);
    else if (typeof Merc.mercSetBonus === 'function') raw = (Merc.mercSetBonus(m, itemsById) || {}).specials;
  } catch (e) {
    console.warn('[quest] 세트 고유 효과 조회 실패', e);
    raw = null;
  }
  if (!Array.isArray(raw) || !raw.length) return [];

  const out = [];
  const seen = new Set();
  for (const sp of raw) {
    const id = (typeof sp === 'string') ? sp : (sp && sp.id);
    if (!id || typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const p = sp && sp.params;
    out.push({ id, params: (p && typeof p === 'object') ? { ...p } : {} });
  }
  return out;
}

/* ★ PvP 방어 편성 등록이 이걸 그대로 쓴다 (src/net/pvp.js).
 *   «전투에 실제로 나가는 유닛» 과 «순위표에 올리는 유닛» 이 다르면 그 자체가 구멍이다 —
 *   같은 함수를 쓰는 것이 그걸 막는 가장 싼 방법이다. */
export function allyUnitDefs(st, squad, opts = {}) {
  const items = State.itemsById(st.items);
  const slots = slotsOf(squad.formationId);
  const day = st?.day || 0;
  const out = [];
  // 부상자는 자동으로 벤치된다.
  //
  // 남은 인원의 재배치는 **전열이 통째로 비었을 때만** 한다.
  // 예전에는 부상자가 없어도 무조건 슬롯 0..n-1 로 압축했다. 그러면 4인 부대의
  // 견습마법사(기본 HP 168)가 매 전투 x=0.14 최전열에 서고, 정작 후열 슬롯은 비었다.
  // 전열에 아직 사람이 서 있으면 후열은 (엔진 타게팅상) 이미 보호받으므로 건드리지 않는다.
  // squad.js squadUnitDefs 와 같은 규칙이다 — 두 경로가 다른 진형을 만들면 안 된다.
  const roster = st.roster || [];
  const filled = [];
  squad.memberUids.forEach((mu, i) => {
    const m = mu ? roster.find((x) => x.uid === mu) : null;
    /* ★★ `ignoreWounds` — **PvP 등록은 부상을 안 본다.**
     *
     *   의뢰에서 부상자를 빼는 건 맞다 — 지금 못 나가는 사람이니까.
     *   그런데 PvP 등록은 «내 용병단의 사진» 이라 그대로 적용하면
     *   나락·탑을 돌고 온 직후엔 부대가 **통째로 비어버린다.**
     *   제작자가 그걸 겪었다 — 3·4·5부대가 «용병 1명 + 펫 3» 으로 등록돼
     *   0.5초만에 녹았다 (진단 판 53). 게다가 등록은 스냅샷이라
     *   나중에 다 나아도 그 상태로 굳어 있는다. */
    const skip = opts.ignoreWounds ? !m : (!m || isBenched(m, day));
    if (!skip && getClass(m.classId)) filled.push({ merc: m, slotIndex: i });
  });
  const slotX = (i) => {
    const s = slots[i] || FALLBACK_SLOTS[i];
    return s && s.x != null ? s.x : 0.5;
  };
  let placed = filled;
  if (filled.length && !filled.some((e) => slotX(e.slotIndex) < FRONT_X)) {
    // 전열이 비었다 — 전열부터 다시 채운다. 앞뒤 순서는 보존한다.
    const order = slots
      .map((s, i) => ({ i, x: (s && s.x) != null ? s.x : 0.5 }))
      .sort((a, b) => (a.x - b.x) || (a.i - b.i))
      .map((o) => o.i);
    const rank = new Map(order.map((si, k) => [si, k]));
    const queue = filled.slice().sort((a, b) => {
      const ra = rank.has(a.slotIndex) ? rank.get(a.slotIndex) : a.slotIndex;
      const rb = rank.has(b.slotIndex) ? rank.get(b.slotIndex) : b.slotIndex;
      return ra - rb;
    });
    placed = queue.map((e, k) => ({ merc: e.merc, slotIndex: order[k] != null ? order[k] : e.slotIndex }));
    placed.sort((a, b) => a.slotIndex - b.slotIndex);
  }

  // ★ 지휘(buffer) 펫 배율. **전투 전에** 스탯에 곱해야 최대 체력까지 오른다 —
  //   엔진의 버프 대상 스탯 목록(ST_KEYS)에는 hp 가 없어서 전투 중에는 못 올린다.
  const petBuff = Pet.squadPetBuff(st, squad);

  placed.forEach(({ merc: m, slotIndex }) => {
    const cls = getClass(m.classId);
    const si = clamp(slotIndex, 0, 6);
    let stats = withFormation(
      Merc.mercStats(m, { items }), squad.formationId, si,
      { arch: cls && cls.arch, classId: m.classId });
    if (petBuff) stats = applyPetBuff(stats, petBuff);
    out.push({
      uid: m.uid,
      name: m.name,
      side: 'ally',
      classId: m.classId,
      enemyId: null,
      level: m.level,
      grade: m.grade,
      stats,
      hp: clamp(Math.round(m.hp || stats.hp), 1, Math.round(stats.hp)),
      skills: Array.isArray(cls.skills) ? cls.skills.slice() : [],
      basicFx: cls.basicFx || 'slash',
      basicRange: cls.range || 'melee',
      basicDmgType: cls.dmgType || 'phys',
      slot: slots[si],
      slotIndex: si,
      recipe: typeof Merc.mercSprite === 'function' ? Merc.mercSprite(m) : cls.sprite,
      boss: false,
      // 세트 고유 효과 (풀세트에서만 붙는다). 아군 전용 — enemyUnitDefs 에는 싣지 않는다.
      specials: mercSpecials(m, items),
      /* ★★ 계열 특성 — «즉사를 스킬 조합으로 막는다» (data/lineage.js).
       *   펎name 의 `guardChance` 와 같은 방식으로 **숫자로 박아서** 넘긴다 —
       *   엔진이 클래스 표를 몰라도 도고, PvP 처럼 편성을 통째로 올리는 경로에도 실린다. */
      ...(traitOfChain(classChain(m.classId)) || {}),
    });
  });

  // ★ 펫을 뒤에 붙인다. 진형 슬롯(7칸)은 건드리지 않는다 — game/pet.js 주석 참조.
  //   여기가 **프로덕션 아군 경로**다. squad.js 의 squadUnitDefs 는 호출자가 없으므로
  //   거기에만 배선하면 게임에는 펫이 안 나온다.
  for (const pd of Pet.petUnitDefs(st, squad)) out.push(pd);

  return out;
}

/**
 * 지휘 펫 배율을 스탯에 곱한다. hp 를 포함한 전 스탯이 대상이라 `scaleStats` 와 달리
 * 최대 체력도 오른다.
 */
function applyPetBuff(stats, buff) {
  const out = { ...stats };
  for (const [k, v] of Object.entries(buff)) {
    if (typeof out[k] !== 'number') continue;
    out[k] = out[k] * (1 + v);
  }
  // 파생 스탯 정리 — 치명/회피는 비율 스탯이라 상한을 넘기면 안 된다
  if (out.crit != null) out.crit = clamp(out.crit, 0, 100);
  if (out.eva != null) out.eva = clamp(out.eva, 0, 75);
  return out;
}

/**
 * createBattle에 넘길 설정을 만든다.
 * @param {object} quest
 * @param {number} waveIndex
 * @param {object} st  게임 상태 (기본: 전역 state)
 * @param {string} squadId
 */
export function questBattleDefs(quest, waveIndex = 0, st = State.state, squadId = null) {
  const squad = (squadId ? (st.squads || []).find((s) => s.id === squadId) : null) || (st.squads || [])[0];
  if (!squad) throw new Error('출정할 부대가 없습니다.');
  const wave = quest.waves[clamp(waveIndex, 0, quest.waves.length - 1)];
  if (!wave) throw new Error('웨이브 정보가 없습니다.');

  const allies = allyUnitDefs(st, squad);
  const enemies = enemyUnitDefs(wave, quest, waveIndex);
  const allyFormationId = squad.formationId || 'basic';
  const enemyFormationId = wave.formationId || 'basic';

  return {
    allies,
    enemies,
    allyFormationId,
    enemyFormationId,
    // 별칭 (렌더러/엔진이 다른 이름을 볼 수도 있어 함께 넣는다)
    formation: allyFormationId,
    formationId: allyFormationId,
    biome: quest.scene || quest.biome,      // 배경용. 옛 세이브엔 scene 이 없다
    seed: (hashStr(`${quest.id}#${waveIndex}#${squad.id}`) ^ (st.seed >>> 0)) >>> 0,
    questId: quest.id,
    waveIndex,
    waveCount: quest.waves.length,
    squadId: squad.id,
  };
}

/* ------------------------------------------------- 웨이브 인계 (다웨이브 의뢰) */

/**
 * 웨이브 사이 회복량 (최대 체력 대비).
 *
 * ★ 예전에는 `ui/battle.js` 안에만 있었다. 그런데 `game/forecast.js` 가
 *   "이 의뢰를 실제로 돌리면 어떻게 되나"를 재려면 **같은 규칙**을 써야 한다.
 *   상수와 인계 함수를 여기로 올려 두 경로가 한 벌만 보게 했다 —
 *   이 저장소는 같은 규칙이 두 곳에 복사돼 한쪽만 고쳐진 사고가 반복됐다.
 */
export const WAVE_HEAL = 0.15;

/**
 * 앞 웨이브의 체력을 다음 웨이브 편성에 얹는다.
 *
 * - `carry` 에 없는 단원은 그대로(만피) 둔다 — 첫 웨이브가 그렇다.
 * - `hp <= 0` 인 단원은 **편성에서 뺀다.** 1 로 clamp 하면 쓰러진 사람이 되살아난다.
 * - 살아남은 단원은 `WAVE_HEAL` 만큼 회복하되 최대 체력을 넘지 않는다.
 *
 * @param {Array<object>} allyDefs  questBattleDefs().allies
 * @param {Object<string,{hp:number,maxHp:number}>|null} carry
 * @returns {Array<object>}
 */
export function applyWaveCarry(allyDefs, carry) {
  const list = allyDefs || [];
  if (!carry || !Object.keys(carry).length) return list;
  return list.map((d) => {
    const c = carry[d.uid];
    if (!c) return d;
    if (c.hp <= 0) return null;
    return { ...d, hp: clamp(Math.round(c.hp + c.maxHp * WAVE_HEAL), 1, c.maxHp) };
  }).filter(Boolean);
}

/**
 * 전투가 끝난 시점의 아군 체력을 인계 형태로 읽는다.
 * 쓰러진 단원은 `hp: 0` 으로 남긴다 — 다음 웨이브에서 빼야 하므로 지우면 안 된다.
 *
 * ★★ **반드시 앞 인계에 누적해라.** `readWaveCarry(units, {})` 처럼 매 웨이브
 *    새 객체를 주면 **쓰러진 단원이 되살아난다.**
 *
 *      1웨이브에서 쓰러짐 → 2웨이브 편성에서 빠짐 → 2웨이브 `units` 에 없음
 *      → 새 인계에 그 사람 항목이 없음 → 3웨이브에서 `applyWaveCarry` 가
 *        "인계에 없으니 처음 나온 사람" 으로 보고 **만피로 세운다**
 *
 *    실제로 `tools/balance.mjs` 를 공용 함수로 합치면서 이 실수를 했고,
 *    3웨이브 의뢰가 쉬워져 B·A 랭크 승률이 목표를 넘겼다 (HANDOFF §28.2).
 *    올바른 쓰임은 `carry = readWaveCarry(b.units, carry || {})` 다.
 *
 * @param {Array<object>} units  battle.units
 * @param {Object<string,{hp:number,maxHp:number}>} [into]  **앞 웨이브의 인계**를 넘겨라
 */
export function readWaveCarry(units, into = {}) {
  for (const u of units || []) {
    if (u.side !== 'ally') continue;
    into[u.uid] = { hp: u.alive ? Math.max(1, Math.round(u.hp)) : 0, maxHp: u.maxHp };
  }
  return into;
}

/* ------------------------------------------------------------------ 보상 */

const winnerOf = (res) => res?.winner ?? res?.result?.winner ?? (res?.win === true ? 'ally' : null);

function isWin(result) {
  if (!result) return false;
  if (Array.isArray(result)) return result.length > 0 && result.every((r) => winnerOf(r) === 'ally');
  return winnerOf(result) === 'ally';
}

/**
 * 전투 결과로 보상을 굴린다. 패배 시 경험치 일부만 준다.
 * @returns {{gold:number, exp:number, renown:number, items:Array}}
 */
export function questRewards(quest, result, r = rng) {
  const base = quest?.reward || { gold: 0, exp: 0, renown: 0, itemRolls: [] };
  if (!isWin(result)) {
    /* ★ 실패해도 **간 만큼은** 경험치를 준다 (설계 3b, HANDOFF §27).
     *   예전에는 진행도와 무관하게 일괄 25% 였다. 그래서 1웨이브에서 전멸한 판과
     *   마지막 웨이브를 코앞에서 놓친 판이 똑같았다 — 이 게임에서 승패가
     *   사실상 이진이라(§24) 플레이어가 실력 차이를 느낄 창구가 없었던 이유 중 하나다.
     *
     *   보수·명성·전리품은 그대로 0 이다. **제작자 결정: 경험치만.**
     *   골드를 주면 수급이 늘어 earlygame 경제·나락 수입표·랭킹 골드 상한을
     *   전부 다시 재야 하는데, 「헛되지 않았다」는 느낌은 경험치만으로도 난다.
     *
     *   상수는 **총량이 예전과 같도록** 실측으로 잡았다 (`tools/.expcurve` 로 확인).
     *   경험치 가중 평균 진행도가 0.146 이라 0.17 + 0.55 × 0.146 = 0.250 = 예전과 같다.
     *   처음에 0.15 로 뒀더니 총량이 -7.9% 였다 — 일찍 지는 의뢰일수록 기본 경험치가
     *   커서, 단순 평균 진행도(0.175)로 계산하면 어긋난다.
     *   경제 총량은 그대로 두고 **폭만** 만든 것이다: 1웨 전멸 0.17 → 막판 석패 0.72.
     *
     *   `progress` 가 없으면 예전 값(0.25)을 쓴다 — 옛 세이브·다른 호출자 보호. */
    const p = result && result.progress != null ? clamp(Number(result.progress) || 0, 0, 1) : null;
    const share = p == null ? 0.25 : LOSS_EXP_FLOOR + LOSS_EXP_SPAN * p;
    return { gold: 0, exp: Math.round((base.exp || 0) * share), renown: 0, items: [] };
  }
  const gold = Math.round((base.gold || 0) * r.float(0.94, 1.14));
  const exp = Math.round((base.exp || 0) * r.float(0.96, 1.08));
  const renown = base.renown || 0;
  const items = [];
  for (const roll of base.itemRolls || []) {
    const it = State.rollLoot({ ilvl: roll.ilvl, rarityBonus: roll.rarityBonus || 0, rng: r });
    if (it) items.push(it);
  }
  return { gold, exp, renown, items };
}

/** 실패 경험치 하한 (1웨이브에서 바로 전멸) */
export const LOSS_EXP_FLOOR = 0.17;
/** 진행도 1.0 일 때 더해지는 몫 — 막판 석패는 0.15+0.55 = 승리의 70% */
export const LOSS_EXP_SPAN = 0.55;

/**
 * 의뢰를 **얼마나 해냈나** (0 = 1웨이브에서 바로 전멸, 1 = 완주).
 *
 *     진행도 = (넘긴 웨이브 수 + 마지막 전투에서 남은 아군 전력) / 전체 웨이브 수
 *
 * ★ "남은 아군 전력" 은 인원과 체력을 반씩 본다. `engine.js result.margin` 과 같은 정의다 —
 *   7명이 다 살았지만 빈사인 것과 4명이 멀쩡한 것을 같게 볼 수 없다.
 *
 * ★ 처음에는 마지막 전투의 margin 만 봤는데 **비단조**가 나왔다.
 *   2웨이브에서 진 판이 1웨이브에서 진 판보다 낮게 찍혔다 — 어디까지 갔는지가 빠져서다
 *   (`tools/margin.mjs` 에서 같은 함정을 밟았다. HANDOFF §25.3).
 *
 * ★ margin 이 없는 결과도 있다 (옛 세이브, `ui/battle.js` 의 후퇴 경로가 만드는 빈 결과).
 *   그때는 남은 전력을 0 으로 본다 — 없는 정보를 후하게 쳐주지 않는다.
 */
export function questProgress(quest, list) {
  const total = ((quest && quest.waves) || []).length || 1;
  let won = 0;
  let left = 0;
  for (const res of list || []) {
    if (winnerOf(res) === 'ally') { won++; continue; }
    const m = res && res.margin;
    left = m && m.allyCount > 0 ? 0.5 * (m.allyAlive / m.allyCount) + 0.5 * m.allyHp : 0;
    break;                                  // 처음 진 웨이브에서 끝난다
  }
  return clamp((won + left) / total, 0, 1);
}

/* ------------------------------------------------------------------ 정산 */

function normalizeResults(results) {
  if (!results) return { list: [], squadId: null };
  if (Array.isArray(results)) return { list: results.filter(Boolean), squadId: null };
  if (Array.isArray(results.results)) return { list: results.results.filter(Boolean), squadId: results.squadId || null };
  if (Array.isArray(results.list)) return { list: results.list.filter(Boolean), squadId: results.squadId || null };
  return { list: [results], squadId: results.squadId || null };
}

/** 웨이브별 결과에서 uid -> 최종 HP 를 모은다 (마지막 값 우선). */
function collectHp(list) {
  const hp = {};
  for (const res of list) {
    const src = res?.finalHp || res?.hpByUid || null;
    if (src && typeof src === 'object') for (const [k, v] of Object.entries(src)) hp[k] = v;
    const units = Array.isArray(res?.units) ? res.units : null;
    if (units) for (const u of units) if (u?.uid != null) hp[u.uid] = u.alive === false ? 0 : (u.hp ?? hp[u.uid]);
  }
  return hp;
}

function collectKills(list, uid) {
  let n = 0;
  for (const res of list) {
    const k = res?.kills;
    if (!k) continue;
    if (typeof k === 'object' && !Array.isArray(k)) n += k[uid] || 0;
  }
  return n;
}

/**
 * 의뢰 결과를 상태에 반영한다.
 * 보상 지급 / 경험치 분배(생존 100%, 다운 60%) / 부상 처리 / 로그 기록.
 *
 * 부상 규칙(설계 A):
 *  - 의뢰 성공 → 다운돼도 부상 없음. ready, HP는 maxHp의 25%로 회복.
 *  - 의뢰 실패 → 다운된 용병만 WOUND_CHANCE[랭크] 확률로 부상(2~4일).
 *                부상이 아니면 ready + HP는 maxHp의 15%.
 *  - 어느 경우에도 HP를 1로 떨어뜨리지 않는다 (하한 HP_FLOOR).
 *
 * @returns {{win, gold, exp, renown, items, levelUps, wounded, downed, promotions}}
 */
export function applyQuestResult(quest, results) {
  const st = State.state;
  const { list, squadId } = normalizeResults(results);
  const win = list.length > 0 && list.every((r) => winnerOf(r) === 'ally');

  // 참여 용병 추리기
  let squad = squadId ? (st.squads || []).find((s) => s.id === squadId) : null;
  let uids = squad ? squad.memberUids.filter(Boolean) : [];
  if (!uids.length) {
    const set = new Set();
    for (const res of list) {
      for (const u of res?.survivors || []) set.add(u);
      for (const k of Object.keys(res?.damageDealt || {})) set.add(k);
      for (const u of Array.isArray(res?.units) ? res.units : []) if (u?.uid) set.add(u.uid);
    }
    uids = [...set];
  }
  const members = uids.map((u) => (st.roster || []).find((m) => m.uid === u)).filter(Boolean);
  // squadId 를 못 받았으면 참여 용병의 소속으로 역추적한다 — 파견 잠금을 놓치면 안 된다.
  if (!squad) {
    const guess = members.find((m) => m.squadId)?.squadId || null;
    if (guess) squad = (st.squads || []).find((s) => s.id === guess) || null;
  }

  const progress = questProgress(quest, list);
  const rew = questRewards(quest, win ? { winner: 'ally' } : { winner: 'enemy', progress }, rng);

  // 전투 통계
  for (const res of list) {
    if (winnerOf(res) === 'ally') st.stats.battlesWon++;
    else st.stats.battlesLost++;
  }

  // 부상 판정
  const last = list[list.length - 1] || {};
  const survivors = new Set(Array.isArray(last.survivors) ? last.survivors : []);
  const hpMap = collectHp(list);
  const itemIdx = State.itemsById(st.items);

  const levelUps = [];
  const wounded = [];
  const downed = [];
  const woundChance = WOUND_CHANCE[RANK_IDX[quest?.rank] ?? 0] ?? 0.2;
  for (const m of members) {
    const known = hpMap[m.uid];
    const down = known != null ? known <= 0 : !survivors.has(m.uid);

    const before = m.level;
    const share = down ? 0.6 : 1.0;
    const gain = Math.max(0, Math.round(rew.exp * share));
    if (gain > 0) {
      try { Merc.gainExp(m, gain); } catch (e) { console.warn('[quest] gainExp 실패', e); }
    }
    if (m.level > before) levelUps.push({ uid: m.uid, name: m.name, from: before, to: m.level });

    // maxHp는 레벨업을 반영한 뒤에 구한다. 아래 회복량이 전부 maxHp 비율이라
    // 낡은 값을 쓰면 레벨업한 용병만 손해를 본다.
    let maxHp = m.maxHp || 1;
    try { maxHp = Math.max(1, Math.round(Merc.mercStats(m, { items: itemIdx }).hp)); } catch { /* 스탯 계산 실패 시 기존 값 유지 */ }
    m.maxHp = maxHp;

    const floor = Math.max(1, Math.round(maxHp * HP_FLOOR));
    if (down) {
      // 성공하면 부상 없음. 실패했을 때만, 그것도 확률적으로만 부상이 된다.
      if (!win && rng.chance(woundChance)) {
        m.status = 'wounded';
        m.woundUntil = st.day + rng.int(WOUND_DAYS[0], WOUND_DAYS[1]);
        m.hp = floor;
        wounded.push({ uid: m.uid, name: m.name, until: m.woundUntil });
      } else {
        m.status = 'ready';
        m.hp = clamp(Math.round(maxHp * (win ? DOWN_HP_WIN : HP_FLOOR)), floor, maxHp);
        downed.push({ uid: m.uid, name: m.name, hp: m.hp });
      }
    } else {
      m.status = 'ready';
      // 살아남았어도 HP가 바닥이면 다음 전투에서 즉사한다. 하한을 둬서 나선을 끊는다.
      m.hp = clamp(Math.round(known != null ? known : (m.hp || maxHp)), floor, maxHp);
    }
    m.battles = (m.battles || 0) + list.length;
    m.kills = (m.kills || 0) + collectKills(list, m.uid);
  }

  // 보상 반영
  if (rew.gold) State.addGold(rew.gold);
  if (rew.renown) st.renown = Math.max(0, st.renown + rew.renown);
  for (const it of rew.items) State.addItem(it);

  // 로그
  const qLabel = `${rankLabelOf(quest)}${isEliteQuest(quest) ? ' 정예' : ''}`;
  if (win) {
    st.stats.questsDone++;
    State.addLog(`[${qLabel}] ${quest.name} — 의뢰 성공! ${num(rew.gold)}G, 명성 +${rew.renown}.`);
    if (rew.items.length) State.addLog(`전리품 획득: ${rew.items.map((i) => i.name).join(', ')}`);
    removeQuest(st, quest);
  } else {
    State.addLog(`[${qLabel}] ${quest.name} — 의뢰 실패. 부대가 후퇴했다.`);
  }
  // ── 도시 평판 ──
  // state.js 의 addRep 이 0~100 clamp 와 로그를 책임진다. 아직 없는 버전과도 물려 돌아야 하므로
  // 함수 존재를 확인하고 부른다(없으면 상태는 그대로 두고 UI 표기용 값만 만든다).
  const rep = applyReputation(st, quest, win);

  if (levelUps.length) State.addLog(`레벨 업: ${levelUps.map((l) => `${l.name} Lv.${l.to}`).join(', ')}`);
  if (downed.length) State.addLog(`전투 불능에서 회복: ${downed.map((d) => d.name).join(', ')} — 부상은 면했다.`);
  if (wounded.length) State.addLog(`부상자 발생: ${wounded.map((w) => `${w.name}(${w.until}일차 복귀)`).join(', ')}`);

  // 전직 가능 알림
  const promotions = [];
  for (const m of members) {
    let ok = false;
    try { ok = !!Merc.canPromote(m); } catch { ok = false; }
    if (!ok) continue;
    let options = [];
    try { options = promoteOptions(m.classId) || []; } catch { options = []; }
    if (!options.length) continue;
    promotions.push({ uid: m.uid, name: m.name, level: m.level, classId: m.classId, options });
  }
  if (promotions.length) {
    State.addLog(`전직 가능: ${promotions.map((p) => p.name).join(', ')} — 용병단 화면에서 승격시킬 수 있다.`);
  }

  // ── 파견 잠금 ──
  // 예전에는 여기서 advanceDays(quest.days) 를 불러 날짜를 자동으로 넘겼다. 그래서 하루에
  // 한 부대만 움직일 수 있었고 부대를 여러 개 둘 이유가 없었다.
  // 이제 날짜는 플레이어가 도시 화면에서 직접 넘긴다. 대신 **출정한 부대만** 잠근다.
  // 성공/실패 모두 잠근다 — 다녀오는 데 걸린 시간은 결과와 무관하다.
  const days = Math.max(0, Math.round(quest?.days || 0));
  let dispatch = null;
  if (squad && days > 0) {
    try {
      const d = Squad.dispatchSquad(st, squad.id, days);
      if (d && d.ok && d.returnDay > st.day) {
        dispatch = { squadId: squad.id, name: squad.name, days, returnDay: d.returnDay };
        State.addLog(`${squad.name}은(는) 원정 중이다. ${d.returnDay}일차에 복귀한다. (${days}일)`);
      }
    } catch (e) {
      console.warn('[quest] 부대 파견 처리 실패', e);
    }
  }

  return {
    win, gold: rew.gold, exp: rew.exp, renown: rew.renown, items: rew.items,
    levelUps, wounded, downed, promotions,
    // 평판 변동 (설계 A). delta 는 0~100 clamp 를 **반영한 실제 변동량**이므로
    // 이미 100인 도시에서 성공하면 delta 는 0 이다. UI는 이 값을 그대로 표기하면 된다.
    rep,
    // UI 참고용: 날짜는 여기서 넘기지 않는다. 부대만 days 일 잠긴다.
    days, dispatch, squadId: squad ? squad.id : null,
  };
}

/**
 * 의뢰 결과를 그 도시의 평판에 반영한다.
 * @returns {{cityId:string, delta:number, after:number|null}|null}
 */
function applyReputation(st, quest, win) {
  const cityId = quest?.cityId || null;
  if (!cityId) return null;
  const baseGain = REP_GAIN[quest?.rank] ?? REP_GAIN.F;
  // 정예 의뢰는 평판 획득도 ×1.5 (설계 E). 실패 하락폭은 그 절반(repLoss)이 그대로 적용된다.
  const gain = Math.max(1, Math.round(baseGain * (isEliteQuest(quest) ? ELITE_RENOWN : 1)));
  const want = win ? gain : -repLoss(gain);

  const readRep = () => {
    try {
      if (typeof State.getRep === 'function') {
        const v = Number(State.getRep(cityId));
        return Number.isFinite(v) ? v : null;
      }
      const v = Number(st?.reputation?.[cityId]);
      return Number.isFinite(v) ? v : null;
    } catch { return null; }
  };

  const before = readRep();
  if (typeof State.addRep !== 'function') {
    // 평판 API가 아직 없는 빌드 — 상태는 건드리지 않고 요청값만 돌려준다.
    return { cityId, delta: want, after: before };
  }
  try {
    const res = State.addRep(cityId, want);
    let after = null;
    if (typeof res === 'number' && Number.isFinite(res)) after = res;
    else if (res && Number.isFinite(Number(res.after))) after = Number(res.after);
    else after = readRep();
    const delta = (before != null && after != null) ? after - before : want;
    return { cityId, delta, after };
  } catch (e) {
    console.warn('[quest] 평판 반영 실패', e);
    return { cityId, delta: 0, after: before };
  }
}

function removeQuest(st, quest) {
  const entry = st.quests?.[quest.cityId];
  if (!entry || !Array.isArray(entry.list)) return;
  const i = entry.list.findIndex((q) => q.id === quest.id);
  if (i >= 0) entry.list.splice(i, 1);
}
