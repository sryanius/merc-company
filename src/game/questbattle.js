/**
 * 의뢰 **전투 정의**의 절반 — state.js 를 안 문다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 떼나 (§152 ①). 서버가 「이 부대로 그 의뢰를 이길 수 있나」 를 물으려면
 *   전투를 **다시 돌려야** 하고, 그러려면 아군·적 정의를 서버가 만들 수 있어야 한다.
 *   quest.js 는 state 를 물어 통째로는 못 간다 — enemygen(§120)·questgen(§138)을
 *   같은 이유로 이미 뗐다. 이게 **세 번째**다.
 *
 * ★ 닫힘이 **하나도 안 는다** (실측 27 → 27). merc·squad·gear·pet·enemygen 이
 *   전부 이미 _power 묶음에 있기 때문이다.
 *
 * ★ 끊은 의존은 둘뿐이었다:
 *   · itemsById → day.js 에 이미 있다 (같은 함수다)
 *   · questBattleDefs 의 전역 기본값 → st 를 받게 했다
 *
 * ★★ **정의는 여기 한 벌뿐이다.** quest.js 는 이걸 import 해서 다시 내보낸다.
 *   거기서 다시 정의하지 마라 — 사본이 둘이면 반드시 갈라진다 (§94·§98·§107).
 *
 * @module game/questbattle
 */
import { clamp } from '../core/util.js';
import { itemsById } from './day.js';
import { getClass, classChain } from '../data/classes.js';
import { traitOfChain } from '../data/lineage.js';
import * as Merc from './merc.js';
import * as Squad from './squad.js';
import * as Pet from './pet.js';
/* 세트 고유 효과 조회용. **네임스페이스로 받는다** — setSpecialsFor 는 gear.js 쪽에서
 * 나중에 붙는 함수라, 이름을 콕 집어 import 하면 아직 없을 때 모듈 링크에서 터진다. */
import * as Gear from './gear.js';
import {
  FALLBACK_SLOTS, slotsOf, enemyStats, withFormation, enemyUnitDefs, hashStr,
} from './enemygen.js';
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
  const items = itemsById(st.items);
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
/**
 * ★ 전역 상태를 **안 본다.** 예전에는 네 번째 인자의 기본값이 전역이었고,
 *   그 한 줄 때문에 이 파일 전체가 state.js 를 물어 서버로 못 갔다.
 *   기본값이 필요한 옛 호출은 quest.js 의 얇은 껍데기가 채워 준다
 *   (실제 호출자는 전부 넘긴다 — 확인했다).
 */
export function questBattleDefs(quest, waveIndex = 0, st = null, squadId = null) {
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

