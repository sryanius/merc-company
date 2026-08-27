/**
 * 게임의 절대 상한값 — **의존성이 0인 모듈**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 따로 뺐나
 *   랭킹 검증(`game/rules.js`)은 서버(Supabase Edge Function, Deno)에서도 돌아야 한다.
 *   그런데 이 값들이 원래 있던 곳은 `game/merc.js`(import 6개)와 `game/state.js`(import 14개)라,
 *   상수 하나 읽자고 **게임 전체를 서버로 끌고 가게 된다.**
 *
 *   그렇다고 서버 쪽에 값을 베껴 적으면 안 된다 — 손으로 베낀 두 번째 사본이 생기면
 *   밸런스를 고치는 날 정상 플레이어가 전원 거절당한다. 이 프로젝트에서 규칙이
 *   두 벌로 갈려 조용히 어긋난 사고가 이미 여러 번 있었다.
 *
 *   그래서 **정의는 여기 한 벌**만 두고, 원래 있던 자리에서는 다시 내보내기만 한다.
 *   기존 import 경로(`merc.js` 의 MAX_LEVEL 등)는 전부 그대로 동작한다.
 *
 * ★ 이 파일은 **아무것도 import 하지 않는다.** 그 성질이 존재 이유이므로 깨뜨리지 마라.
 *
 * @module data/limits
 */

/** 단원 최고 레벨 */
export const MAX_LEVEL = 80;

/** 1주의 일수 */
export const DAYS_PER_WEEK = 7;
/** 1개월의 주 수 */
export const WEEKS_PER_MONTH = 4;
/** 1개월의 일수 (28) */
export const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH;
/** 1년의 개월 수 */
export const MONTHS_PER_YEAR = 12;
/** 1년의 일수 (336) */
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

/** 부대 최대 수 */
export const MAX_SQUADS = 5;
/** 한 부대의 슬롯 수 */
export const SQUAD_SLOTS = 7;
/** 정원 상한 (state.js ROSTER_CAP_MAX 와 같은 값) */
export const ROSTER_CAP_MAX = 70;

/* ════════════════════════════════════════════════════════════════════════════
 * 도시 등급 배율 — **의뢰 보상과 고용가가 같은 기울기를 쓰게 하는 값**
 *
 * ★★ 원래 `game/quest.js` 에 있었다. 그런데 주점 생성기(`game/tavern.js`)가 이 둘을
 *   써야 하고, 그걸 서버로 보내려면 `quest.js` 를 통째로 물어야 했다 —
 *   그러면 `state.js` 까지 딸려 와 닫힘이 17개 494KB → 26개 813KB 가 된다
 *   (§108 이 끊어 놓은 것이 통째로 무너진다). 실측하고 옮겼다.
 *
 * ★ 여기가 맞는 자리인 이유: 이 파일은 **의존성 0 데이터 모듈**이고
 *   서버 묶음 셋(`_shared`·`_power`)에 전부 들어 있다.
 * ★ `quest.js` 는 이 둘을 **다시 내보낸다** — 부르는 쪽은 하나도 안 바뀐다.
 * ════════════════════════════════════════════════════════════════════════════ */

/** 도시 등급 → 적 스탯 배율 */
export const CITY_POWER = { 1: 1.00, 2: 1.18, 3: 1.38, 4: 1.62, 5: 1.90 };

/** 등급을 배율로 (범위 밖이면 1) */
export const cityPowerOf = (tier) => {
  const t = Math.round(Number(tier) || 1);
  return CITY_POWER[t < 1 ? 1 : (t > 5 ? 5 : t)] || 1;
};

/**
 * 보상이 도시 배율을 따라가는 지수.
 *
 * ★★ **이걸 빼먹으면 개편 전체가 무의미해진다.** 같은 랭크가 모든 도시에 나오는데
 *   보상이 같으면 다들 1등급 도시에서 S랭크만 돈다 — 위로 갈 이유가 사라진다.
 *   난이도가 배율² 로 오르므로 보상도 같은 지수로 맞춘다.
 *
 * ★ 고용가도 **같은 지수**를 쓴다 (`game/tavern.js`). 한쪽만 움직이면
 *   도시를 올라갈수록 수입과 지출이 벌어진다 — 스모크가 그걸 지킨다.
 */
export const CITY_REWARD_POW = 2.0;
