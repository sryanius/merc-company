/**
 * 계열 특성 — 「즉사를 스킬 조합으로 막는다」
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 제작자 요구: 「방패병한테 가드같은걸 줘서 대신 맞는다던가 · 힐러가 힐을 넣어서 즉사를
 *   방지한다던가 · 방패병의 파티 전체 보호로 맞는 딜을 줄인다던가 이런식으로 스킬을
 *   조합시켜서 즉사는 안당하는 방식으로」
 *
 * ★★ 그리고 곧바로 붙은 단서: 「근데 이럼 방패병 역할이 커지는데 다른 계열들도
 *   먼가 특화 기능들이 더 있으면 좋겠다」.
 *   보호 수단을 방패병에 몰면 **방패병이 필수 유닛**이 된다. 그래서 7계열에 **나눠** 붙인다 —
 *   어떤 계열을 골라도 «즉사를 막는 자기 방식» 이 하나씩 있다.
 *
 * ★ 수도사 계열만 **2차 갈래로 갈린다** (사제 / 수도승). 나머지는 뿌리 하나로 묶인다.
 *
 * ★★ 특성은 **UnitDef 에 숫자로 박아서** 엔진에 넘긴다 (펫의 `guardChance` 와 같은 방식).
 *   엔진이 클래스 표를 몰라도 되고, PvP 처럼 편성을 통째로 올리는 경로에서도 그대로 실린다.
 *
 * ★ 세기는 **차수에 비례**한다. 1차가 맛보기, 4차가 제 몫을 한다.
 *
 * @module data/lineage
 */

/** 차수별 배수 — 1차는 맛보기, 4차가 온전한 값 */
export const TIER_SCALE = [0.4, 0.6, 0.8, 1.0];

/**
 * 뿌리(1차 클래스 id) → 특성.
 * 값은 **4차 기준**이다. 실제 값은 `TIER_SCALE` 로 깎인다.
 */
export const LINEAGE_TRAIT = {
  /* 방패병 — 표적을 자기로 끌어온다. 둘을 같이 가져서 «벽» 이라는 정체성이 분명하다. */
  shieldman: {
    label: '수호',
    note: '뒷사람 대신 맞고, 적 근접을 자기 쪽으로 끌어온다',
    guardChance: 0.10,   // 아군이 맞을 때 대신 맞을 확률 (실측 0.30 은 과했다)
    guardCut: 0.45,      // 대신 맞을 때 깎이는 피해
    taunt: 1,            // 적 근접의 표적 우선순위를 자기로
  },
  /* 검사 — 맞을수록 되받아친다. 버티는 게 아니라 «맞바꾸는» 쪽. */
  swordsman: {
    label: '반격',
    note: '근접 공격을 받으면 되받아친다',
    riposte: 1.40,       // 받은 피해의 이만큼을 되돌려준다 (근접 피격에 한함)
  },
  /* 창병 — 파고드는 근접을 중간에서 막는다. §85 의 «돌진 시간» 과 정확히 맞물린다. */
  spearman: {
    label: '요격',
    note: '뒤로 파고드는 적 근접을 중간에서 가로챈다',
    /* ★ 실측으로 0.45 는 **눈에 띄게 세었다** — 라운드로빈 100%.
     *   파고드는 피해를 사실상 전부 앞으로 돌렸다. 절반으로 낮춘다. */
    intercept: 0.60,     // 파고드는 적 근접을 자기가 대신 받는 확률
  },
  /* 궁수 — 접근 자체를 늦춘다. 창병이 «가로챈다» 면 궁수는 «느리게 만든다». */
  archer: {
    label: '견제',
    note: '적의 돌진을 느리게 만든다',
    /* ★ 실측으로 0.30 은 **너무 세었다** — 같은 클래스에 특성만 갈아 끼운 라운드로빈에서
     *   98% 를 찍었다 (다음이 수호 79%, 무특성 22%). 상한까지 같이 낮춘다. */
    chargeSlow: 0.26,    // 적 근접의 돌진 시간이 이만큼 늘어난다
  },
  /* 도적 — 자기만 산다. 남을 못 지키는 대신 자기가 안 맞는다. */
  rogue: {
    label: '은신',
    note: '적 근접이 다른 표적을 먼저 고른다',
    shy: 1,              // 다른 표적이 있으면 근접이 도적을 안 고른다
    evaBonus: 3,         // 회피 가산 (%)
  },
  /* 마법사 — 이미 있는 흡수 방패를 계열 색으로. 개전부터 방패를 두르고 시작한다. */
  apprentice: {
    label: '마력 방벽',
    note: '전투를 흡수 방패를 두르고 시작한다',
    wardShield: 0.60,    // 최대 HP 의 이만큼을 방패로 들고 시작
  },
  /* 수도사 — 2차에서 갈린다. 뿌리(1차)는 사제 쪽의 약한 형태를 갖는다. */
  acolyte: {
    label: '가호',
    note: '치명적인 일격을 한 번 견딘다',
    deathWard: 1,        // 전투당 이 횟수만큼 치명타를 체력 1로 견딘다
  },
};

/**
 * 2차 갈래로 갈리는 계열. 뿌리가 여기 있으면 **체인에 이 id 가 있는지**로 고른다.
 * ★ 수도사만 갈린다 — 「사제는 즉사 방지, 수도승은 파티 피해 감소」 (제작자 배분).
 */
export const BRANCH_TRAIT = {
  priest: {
    label: '축복',
    note: '진영 전체가 치명적인 일격을 한 번 견딘다',
    deathWard: 4,
    deathWardParty: 1,   // 자기뿐 아니라 진영 전체에 준다
  },
  monk: {
    label: '금강',
    note: '진영 전체가 받는 피해를 줄인다',
    dmgCutAura: 0.06,    // 진영 전체 피해 감소 (겹치면 합산 후 상한)
  },
};

/** 진영 전체 피해 감소의 상한 — 수도승을 여럿 넣어도 여기서 멈춘다 */
export const AURA_CAP = 0.30;

/** 돌진 늦추기 상한 — 궁수를 여럿 넣어도 여기서 멈춘다.
 *  ★ `engine.js` 의 SLOW_CAP 과 **같은 값**이어야 한다 (smoke 가 맞춰 본다). */
export const SLOW_CAP = 0.35;

/**
 * 클래스 하나의 계열 특성을 낸다.
 *
 * @param {Array<{id:string, tier?:number}>} chain `classes.js` 의 `classChain(classId)`
 * @returns {object|null} UnitDef 에 얹을 숫자들 (없으면 null)
 */
export function traitOfChain(chain) {
  if (!Array.isArray(chain) || !chain.length) return null;
  const root = chain[0];
  const self = chain[chain.length - 1];
  const base = LINEAGE_TRAIT[root.id];
  if (!base) return null;

  /* 갈래가 있으면 갈래 것이 이긴다 (수도사 → 사제 / 수도승) */
  let pick = base;
  for (const c of chain) {
    if (BRANCH_TRAIT[c.id]) { pick = BRANCH_TRAIT[c.id]; break; }
  }

  const tier = Math.max(1, Math.min(4, Number(self.tier) || 1));
  const k = TIER_SCALE[tier - 1];
  const out = { traitLabel: pick.label };
  for (const [key, v] of Object.entries(pick)) {
    if (key === 'label' || key === 'note') continue;
    /* 횟수(정수 1)는 안 깎는다 — 0.4번 견딜 수는 없다. 1차도 한 번은 견딘다. */
    out[key] = (key === 'deathWard' || key === 'deathWardParty' || key === 'taunt' || key === 'shy')
      ? v
      : Math.round(v * k * 1000) / 1000;
  }
  return out;
}
