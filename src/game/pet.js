/**
 * 펫 — 보유 · 배치 · 전투 투입
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 펫 인스턴스는 최소한만 저장한다: `{ uid, sid, grade, hp }`
 * 나머지(이름·스탯·역할·스프라이트)는 전부 `data/pets.js` 의 종 정의에서 파생한다.
 * 수백 마리를 보유해도 세이브가 커지지 않게 하려는 것이다.
 *
 * ★ 이 모듈이 펫 UnitDef 를 만드는 **유일한 곳**이어야 한다.
 *   이 프로젝트는 아군 UnitDef 조립 경로가 둘로 갈려(quest.js / squad.js) 진형과 세트 효과가
 *   각각 한 번씩 한쪽에만 배선돼 조용히 안 먹은 전례가 있다. 펫은 처음부터 한 곳에 모은다.
 *   (참고: `squad.js` 의 `squadUnitDefs` 는 **프로덕션 호출자가 0** 이다. 거기에만 배선하면
 *    검증 도구는 전부 초록불인데 게임에는 안 나온다.)
 *
 * @module game/pet
 */

import { clamp } from '../core/util.js';
import {
  PETS, PETS_PER_SQUAD, PET_GRADE_MULT, PET_TIER_MULT, PET_SLOTS,
  getPetSpecies, ROLE_NAME,
} from '../data/pets.js';

export { PETS_PER_SQUAD, ROLE_NAME };

/* ─────────────────────────── 인스턴스 ─────────────────────────── */

/**
 * @typedef {object} Pet
 * @property {string} uid   `pet_1` 형태. state.petSeq 로 만든다 (Math.random 금지 — 결정론)
 * @property {string} sid   종 id (data/pets.js)
 * @property {string} grade F~S
 * @property {number} [hp]  탑에서 층을 넘을 때 이월되는 현재 체력
 */

/**
 * 펫 인스턴스를 만든다.
 * uid 는 `state.petSeq` 를 증가시켜 뽑는다 — `core/rng.js` 의 `uid()` 는 `Math.random` 을 써서
 * 전투 결과 키(damageDealt/kills)가 매번 달라지고 재현이 깨진다.
 * @returns {Pet}
 */
export function makePet(st, sid, grade) {
  const sp = getPetSpecies(sid);
  if (!sp) return null;
  st.petSeq = (st.petSeq || 0) + 1;
  const stats = petStats({ sid, grade });
  return { uid: `pet_${st.petSeq}`, sid, grade: PET_GRADE_MULT[grade] ? grade : 'F', hp: stats.hp };
}

/** 보유 펫 목록 (항상 배열) */
export function allPets(st) {
  return Array.isArray(st.pets) ? st.pets : [];
}

/** uid 로 찾기 */
export function getPet(st, uid) {
  if (!uid) return null;
  return allPets(st).find((p) => p && p.uid === uid) || null;
}

/* ─────────────────────────── 스탯 ─────────────────────────── */

/**
 * 최종 스탯 = 종 기준값 × tier 배율 × 등급 배율.
 * 용병처럼 레벨이 없다 — 펫은 "어느 층에서 나왔나(tier)"와 "운(grade)"이 전부다.
 *
 * ★ 회복 펫의 `healPower` 는 **atk 에 곱한다.** 엔진의 회복량이
 *   `src.st.atk × effect.power` 라서 그 길밖에 없다(회복 전용 계수를 읽는 자리가 없다).
 *   부작용으로 회복 펫의 약한 기본 공격도 같이 세진다 — 의도한 절충이다.
 */
export function petStats(pet) {
  const sp = pet && getPetSpecies(pet.sid);
  if (!sp) return { hp: 1, atk: 1, def: 0, res: 0, spd: 40, crit: 0, critDmg: 50, eva: 0 };
  const tm = PET_TIER_MULT[clamp((sp.tier || 1) - 1, 0, PET_TIER_MULT.length - 1)] || 1;
  const gm = PET_GRADE_MULT[pet.grade] || 1;
  const m = tm * gm;
  const b = sp.base;
  const healBoost = sp.role === 'healer' ? (sp.ability?.healPower || 1) : 1;
  return {
    hp: Math.round(b.hp * m),
    atk: Math.round(b.atk * m * healBoost),
    def: Math.round(b.def * m),
    res: Math.round(b.res * m),
    // 속도·치명·회피는 배율을 반만 먹인다. 그대로 곱하면 상위 펫이 행동을 독점한다.
    spd: Math.round(b.spd * (1 + (m - 1) * 0.5)),
    crit: Math.round(clamp(b.crit * (1 + (m - 1) * 0.5), 0, 100)),
    critDmg: b.critDmg,
    eva: Math.round(clamp(b.eva * (1 + (m - 1) * 0.5), 0, 75)),
  };
}

/** 화면 표시용 전투력 (정렬·비교) */
export function petPower(pet) {
  const s = petStats(pet);
  return Math.round(s.hp * 0.25 + s.atk * 4 + s.def * 3 + s.res * 3 + s.spd * 1.5);
}

/* ─────────────────────────── 부대 배치 ─────────────────────────── */

/** 부대에 배치된 펫 uid 배열 (항상 길이 PETS_PER_SQUAD) */
export function petUidsOf(squad) {
  const a = Array.isArray(squad?.petUids) ? squad.petUids.slice(0, PETS_PER_SQUAD) : [];
  while (a.length < PETS_PER_SQUAD) a.push(null);
  return a;
}

/** 부대에 배치된 펫 인스턴스 (빈 칸 제외) */
export function squadPets(st, squad) {
  return petUidsOf(squad).map((u) => getPet(st, u)).filter(Boolean);
}

/** 이 펫이 배치된 부대 (없으면 null) */
export function squadOfPet(st, uid) {
  if (!uid) return null;
  return (st.squads || []).find((s) => petUidsOf(s).includes(uid)) || null;
}

/**
 * 펫을 부대 칸에 넣는다. 다른 부대에 있던 펫이면 거기서 뺀다 (한 마리는 한 부대에만).
 * @returns {{ok:boolean, error?:string}}
 */
export function assignPet(st, squadId, slot, petUid) {
  const sq = (st.squads || []).find((s) => s.id === squadId);
  if (!sq) return { ok: false, error: '부대를 찾을 수 없습니다.' };
  const i = clamp(Math.round(slot), 0, PETS_PER_SQUAD - 1);
  sq.petUids = petUidsOf(sq);

  if (petUid) {
    const pet = getPet(st, petUid);
    if (!pet) return { ok: false, error: '없는 펫입니다.' };
    // 다른 자리·다른 부대에 있으면 먼저 뺀다
    for (const s of st.squads || []) {
      s.petUids = petUidsOf(s);
      for (let k = 0; k < PETS_PER_SQUAD; k++) if (s.petUids[k] === petUid) s.petUids[k] = null;
    }
  }
  sq.petUids[i] = petUid || null;
  return { ok: true };
}

/** 펫을 놓아준다(삭제). 배치돼 있으면 자리도 비운다. */
export function releasePet(st, uid) {
  const before = allPets(st).length;
  for (const s of st.squads || []) {
    s.petUids = petUidsOf(s);
    for (let k = 0; k < PETS_PER_SQUAD; k++) if (s.petUids[k] === uid) s.petUids[k] = null;
  }
  st.pets = allPets(st).filter((p) => p && p.uid !== uid);
  return st.pets.length < before;
}

/* ─────────────────────────── 전투 투입 ─────────────────────────── */

/**
 * 지휘(buffer) 펫들이 부대 전체에 주는 스탯 배율.
 * ★ 엔진 버프(ST_KEYS)에는 hp 가 없어 **전투 중에는 최대 체력을 못 올린다.**
 *   그래서 버프를 UnitDef 를 만들 때(전투 전) 스탯에 곱한다 — 이러면 maxHp 까지 올라간다.
 * @returns {object|null} `{atk:0.12, def:0.09}` 형태. 지휘 펫이 없으면 null
 */
export function squadPetBuff(st, squad) {
  const pets = squadPets(st, squad).filter((p) => getPetSpecies(p.sid)?.role === 'buffer');
  if (!pets.length) return null;
  const out = {};
  for (const p of pets) {
    const sp = getPetSpecies(p.sid);
    const tm = PET_TIER_MULT[clamp((sp.tier || 1) - 1, 0, PET_TIER_MULT.length - 1)] || 1;
    const gm = PET_GRADE_MULT[p.grade] || 1;
    for (const [k, v] of Object.entries(sp.ability?.buff || {})) {
      out[k] = (out[k] || 0) + v * tm * gm;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 부대의 펫들을 전투 UnitDef 로 만든다.
 *
 * ★ 진형을 **일부러 안 건다.** `formationMods` 는 slotIndex 가 범위를 넘으면 조용히
 *   `slots[0]`(대부분 진형에서 전열) 보정을 걸어 버린다. 펫이 봉시진 전열 보정을
 *   받는 건 말이 안 되고, 크래시가 없어서 밸런스 도구도 못 잡는다.
 *   그래서 `slot` 만 직접 주고 `slotIndex` 는 넘기지 않는다.
 *
 * @param {object} st    게임 상태
 * @param {object} squad 부대
 * @returns {object[]} UnitDef 배열 (펫이 없으면 빈 배열)
 */
export function petUnitDefs(st, squad) {
  const pets = squadPets(st, squad);
  const out = [];
  pets.forEach((p, i) => {
    const sp = getPetSpecies(p.sid);
    if (!sp) return;
    const stats = petStats(p);
    const gm = PET_GRADE_MULT[p.grade] || 1;
    const def = {
      uid: p.uid,
      name: sp.name,
      side: 'ally',
      // ★ 엔진이 승패·MVP·시간초과 판정에서 펫을 빼는 데 쓰는 표식
      pet: true,
      petRole: sp.role,
      classId: null,
      enemyId: null,
      level: 1,
      grade: p.grade,
      stats,
      hp: clamp(Math.round(p.hp != null ? p.hp : stats.hp), 1, Math.round(stats.hp)),
      skills: Array.isArray(sp.skills) ? sp.skills.slice() : [],
      basicFx: sp.basicFx || 'slash',
      basicRange: sp.basicRange || 'melee',
      basicDmgType: sp.basicDmgType || 'phys',
      slot: PET_SLOTS[i] || PET_SLOTS[PET_SLOTS.length - 1],
      recipe: sp.sprite,
      boss: false,
      // 펫에는 세트 고유 효과가 없다 (세트는 용병 장비에서만 나온다)
      specials: [],
    };
    if (sp.role === 'guardian') {
      // 등급이 높을수록 더 자주 막지만 상한을 둔다 — 60% 를 넘으면 단원이 안 맞는다
      def.guardChance = clamp((sp.ability?.guardChance || 0) * gm, 0, 0.6);
      def.guardCut = clamp(sp.ability?.guardCut || 0, 0, 0.9);
    }
    out.push(def);
  });
  return out;
}

/* ─────────────────────────── 표시 ─────────────────────────── */

/** 펫 표시 이름 (`S 탑의 파수령`) */
export function petLabel(pet) {
  const sp = pet && getPetSpecies(pet.sid);
  return sp ? `${pet.grade} ${sp.name}` : '알 수 없는 펫';
}

/** 능력 한 줄 설명 — 등급까지 반영한 실제 수치로 적는다 */
export function petAbilityText(pet) {
  const sp = pet && getPetSpecies(pet.sid);
  if (!sp) return '';
  const gm = PET_GRADE_MULT[pet.grade] || 1;
  const tm = PET_TIER_MULT[clamp((sp.tier || 1) - 1, 0, PET_TIER_MULT.length - 1)] || 1;
  switch (sp.role) {
    case 'guardian': {
      const c = clamp((sp.ability?.guardChance || 0) * gm, 0, 0.6);
      const cut = clamp(sp.ability?.guardCut || 0, 0, 0.9);
      return `아군이 맞을 피해를 ${Math.round(c * 100)}% 확률로 대신 받는다 (피해 ${Math.round(cut * 100)}% 감소)`;
    }
    case 'buffer': {
      const parts = Object.entries(sp.ability?.buff || {})
        .map(([k, v]) => `${STAT_NAME[k] || k} +${Math.round(v * tm * gm * 100)}%`);
      return `부대 전체 ${parts.join(' · ')}`;
    }
    case 'healer':
      return '전투 중 가장 다친 아군을 회복시킨다';
    default:
      return '적을 직접 공격한다';
  }
}

const STAT_NAME = { atk: '공격', def: '방어', res: '저항', spd: '속도', crit: '치명', eva: '회피' };

/** 종 목록 (도감용) */
export { PETS, getPetSpecies };
