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
