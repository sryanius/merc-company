// 의뢰 생성 / 전투 정의 변환 / 보상 정산.
// 순수 JS: DOM을 만지지 않는다. state.js와 순환 참조라 네임스페이스로 받는다.
import { clamp, num, scaleStats } from '../core/util.js';
import { rng } from '../core/rng.js';
import { getCity, REGIONS } from '../data/world.js';
import { ARCHETYPES, getClass, promoteOptions } from '../data/classes.js';
import { getFormation, formationMods } from '../data/formations.js';
import { buildEnemySquad, getEnemy, enemiesFor } from '../data/enemies.js';
import * as State from './state.js';
import * as Merc from './merc.js';
import * as Squad from './squad.js';
import * as Pet from './pet.js';
// 세트 고유 효과 조회용. **네임스페이스로 받는다** — `setSpecialsFor` 는 gear.js 쪽에서 나중에
// 붙는 함수라, 이름을 콕 집어 import 하면 아직 없을 때 모듈 링크 단계에서 통째로 터진다.
import * as Gear from './gear.js';

/* ------------------------------------------------------------------ 상수 */

export const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
const RANK_IDX = { F: 0, E: 1, D: 2, C: 3, B: 4, A: 5, S: 6 };
/* ════════════════════════════════════════════════════════════════════════
 *  난이도 설계 (설계 C·D·E·F)
 * ════════════════════════════════════════════════════════════════════════
 * 레벨 상한이 60 → 80 으로 오르고 4차 전직(Lv55 · TIER_MULT 2.10)이 생기면서
 * 난이도 축을 셋으로 나눴다.
 *   1) 랭크 F~S        — 권장 레벨 대역. **하나의 랭크 = 하나의 전직 차수.**
 *   2) 서브랭크 -/기본/+ — 랭크 하나를 3등분해 21단계. 레벨·적 수·보상이 갈린다.
 *   3) 정예(elite)     — 랭크와 직교하는 고난도 플래그. 적 전원 강화 + 정예 개체.
 *
 * 튜닝 순서(효과가 매끄러운 것부터): RANK_POWER(연속) → RANK_CREEP(정수 레벨)
 *   → 적 수 공식 → RANK_WAVES / BOSS_CHANCE / RANK_TIER.
 * **F랭크는 손대지 않는다** — 첫 전투에서 전멸하면 게임이 시작되지 않는다.
 */

/** 레벨 상한 (권장 레벨·적 레벨·전리품 ilvl 공용).
 *  merc.js `MAX_LEVEL` 과 **반드시 같은 값**이어야 한다.
 *  여기서 import 하지 않는 이유: merc → state → quest → merc 순환이라
 *  최상위에서 `Merc.MAX_LEVEL` 을 읽으면 TDZ ReferenceError 가 날 수 있다. */
export const MAX_QUEST_LEVEL = 80;

/** 랭크별 권장 레벨 구간 */
// ── 설계 원칙: 하나의 랭크는 하나의 전직 차수 안에만 들어간다 ──
// 용병은 전직 시점(Lv15 → 1.30배, Lv35 → 1.66배, Lv55 → 2.10배)에 스탯이 계단식으로
// 뛰지만 적에게는 그런 배율이 없다. 그래서 적 레벨에 차수 보정을 얹어야 하는데, 예전 표는
// B가 [26,40]으로 Lv35 경계를 관통하고 있었다. 그 상태로 보정을 넣으면 같은 B랭크 안에서
// 2차 부대는 짓밟히고 3차 부대는 헐거워져 한쪽이 반드시 무너진다(실측 B 47~52%).
// 차수 경계가 1/15/35/55 로 넷이 된 지금도 원칙은 그대로다.
//   F [1,7]  E [8,14]            → 1차
//   D [15,24] C [25,34]          → 2차
//   B [35,44] A [45,54]          → 3차
//   S [55,80]                    → 4차
// S 구간이 26레벨로 넓지만 서브랭크(S- 55~63 / S 64~71 / S+ 72~80)가 그걸 쪼갠다.
export const RANK_LEVEL = {
  F: [1, 7], E: [8, 14], D: [15, 24], C: [25, 34], B: [35, 44], A: [45, 54], S: [55, MAX_QUEST_LEVEL],
};
/* ── 서브랭크 (설계 D) ────────────────────────────────────────────────
 * 랭크 하나를 `-` / 기본 / `+` 셋으로 쪼개 21단계를 만든다.
 * **`quest.rank` 은 F~S 문자 그대로 유지한다** — 기존 코드가 rank 문자로 분기하는 곳이
 * 많아서 rank 문자열에 기호를 섞으면 전부 깨진다. 서브랭크는 `quest.sub` (-1|0|1) 에 따로
 * 두고, 표시용 문자열만 `quest.rankLabel` ('E+' 같은 형태) 로 함께 실어 준다.
 */
export const SUBS = [-1, 0, 1];
/** 표시용 기호 (UI 가 `rank + SUB_LABEL[sub]` 로 쓰면 된다) */
export const SUB_LABEL = { '-1': '-', 0: '', 1: '+' };
/** 표시용 한국어 이름 */
export const SUB_NAME = { '-1': '입문', 0: '표준', 1: '고난도' };
/** 서브랭크별 적 레벨 보정.
 *  ※ 7차 세션: 절대 레벨 델타는 (1) 랭크마다 상대 효과가 달라지고(저레벨에서 +1이 크다)
 *  (2) S 권장 레벨이 Lv80 상한에 닿으면 사라진다. 그래서 서브랭크 난이도는 아래 SUB_POWER
 *  (레벨 무관·상한 무관 스탯 배율)로 균일하게 가르고, 레벨 델타는 0으로 둔다.
 *  (서브랭크가 '권장 레벨 밴드'를 나누는 것과는 별개다 — 그건 RANK_SUB_LEVEL 이 담당한다.) */
const SUB_LEVEL = { '-1': 0, 0: 0, 1: 0 };
/** 서브랭크별 적 수 보정 (상한 7은 공식 쪽에서 걸린다).
 *  ※ 7차 세션: 원래 '+' 에 +1기를 줬는데, 오토배틀러에서 +1기는 저랭크(기본 적 4~5기)에서
 *  20~30%p 스윙이라 목표(-8~15%p)를 크게 넘겼고, S(적 수 상한 7)에서는 반대로 묻혔다.
 *  랭크마다 효과가 들쭉날쭉해 승률 스프레드가 D+ -60%p / S+ +37%p 로 깨졌다(실측).
 *  적 수 대신 **SUB_POWER(레벨 상한과 무관한 스탯 배율)** 로 균일하게 가른다. */
const SUB_SIZE = { '-1': 0, 0: 0, 1: 0 };
/** 서브랭크별 적 스탯 배율 — 레벨 상한(Lv80)에서도 일정하게 먹히는 주 노브.
 *  '+' 는 S 권장 레벨(72~80)이 상한에 닿아 레벨 보정이 사라져도 이 배율로 난이도를 유지한다. */
export const SUB_POWER = { '-1': 0.978, 0: 1, 1: 1.027 };
/** 서브랭크별 보상 배율 (골드·경험치·명성) */
const SUB_REWARD = { '-1': 0.80, 0: 1, 1: 1.35 };
/** 서브랭크 등장 비중 — '-'(입문)를 가장 많이 띄운다 */
const SUB_WEIGHT = { '-1': 5, 0: 3.4, 1: 1.6 };

/** -1|0|1 로 정규화. 필드가 없는 옛 세이브·잘못된 값은 0(기본)으로 본다. */
function normSub(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}
/** 의뢰(또는 숫자)에서 서브랭크를 읽는다. */
export function subOf(quest) {
  if (quest == null) return 0;
  if (typeof quest === 'number' || typeof quest === 'string') return normSub(quest);
  return normSub(quest.sub);
}
/**
 * 표시용 랭크 문자열. `rankLabelOf(quest)` 또는 `rankLabelOf('E', 1)` 둘 다 받는다.
 * 서브랭크 필드가 없는 옛 의뢰는 랭크 문자만 돌려준다.
 */
export function rankLabelOf(quest, sub = null) {
  if (typeof quest === 'string') {
    const rk = RANKS.includes(quest) ? quest : 'F';
    return `${rk}${SUB_LABEL[normSub(sub)] || ''}`;
  }
  const rk = RANKS.includes(quest?.rank) ? quest.rank : 'F';
  if (quest && quest.sub == null && sub == null) return rk;
  const s = sub != null ? normSub(sub) : subOf(quest);
  return `${rk}${SUB_LABEL[s] || ''}`;
}

/** 랭크 안에서 서브랭크가 나눠 갖는 권장 레벨 구간을 3등분한다 (남는 레벨은 양 끝에 먼저). */
function splitBand(lo, hi) {
  const n = Math.max(3, hi - lo + 1);
  const base = Math.floor(n / 3);
  const rem = n % 3;
  const sizes = [base + (rem >= 1 ? 1 : 0), base, base + (rem >= 2 ? 1 : 0)];
  const out = {};
  let cur = lo;
  SUBS.forEach((s, i) => {
    const end = i === SUBS.length - 1 ? hi : Math.min(hi, cur + Math.max(1, sizes[i]) - 1);
    out[s] = [cur, Math.max(cur, end)];
    cur = end + 1;
  });
  return out;
}
/** 랭크 × 서브랭크 권장 레벨 표. 예: RANK_SUB_LEVEL.S['-1'] === [55,63] */
export const RANK_SUB_LEVEL = Object.fromEntries(
  RANKS.map((rk) => [rk, splitBand(...(RANK_LEVEL[rk] || [1, 7]))]));
/** 서브랭크까지 반영한 권장 레벨 구간 [lo, hi] */
export function subLevelRange(rank, sub = 0) {
  const t = RANK_SUB_LEVEL[rank];
  if (!t) return (RANK_LEVEL[rank] || [1, 7]).slice();
  return (t[normSub(sub)] || t[0]).slice();
}

/* ── 정예(Elite) 의뢰 (설계 E) ────────────────────────────────────────
 * "정예 등급으로 더 어려운 게 필요하다" — 랭크와 직교하는 고난도 도전 콘텐츠다.
 * D랭크 이상에서만 뜨고(초반 보호), 적 전원이 강화되며 그중 1~2기는 '정예' 접두사가 붙는
 * 챔피언이 된다. 목표는 같은 랭크 일반 의뢰보다 승률 18~28%p 낮은 것.
 * 보상은 골드·경험치 ×2.2 / 평판 ×1.5 / 전리품 희귀도 +1단계로 확실히 보답한다.
 */
/** 정예가 뜰 수 있는 최소 랭크 */
export const ELITE_MIN_RANK = 'D';
/** 랭크별 정예 등장 확률 (서브랭크 보정 전) */
const ELITE_CHANCE = { F: 0, E: 0, D: 0.12, C: 0.13, B: 0.14, A: 0.15, S: 0.16 };
/** 서브랭크 보정 — S+ 가 0.16 + 0.04 = 0.20 이 되도록 맞춘 값 */
const ELITE_SUB_CHANCE = { '-1': -0.02, 0: 0, 1: 0.04 };
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
/** UI 배지/경고에 쓸 문자열 */
export const ELITE_LABEL = '정예';
export const ELITE_WARN = '정예 의뢰다. 적이 전원 강화되어 있고 정예 개체가 섞여 있다 — 권장 레벨을 넘겨 도전하는 편이 안전하다.';
/** 정예 보상 배율 */
const ELITE_REWARD = 2.2;      // 골드·경험치
const ELITE_RENOWN = 1.5;      // 명성·평판
/** 전리품 희귀도 보너스 +1단계 (gear.js rarityWeights 의 step 계수 기준으로 1.0 = 한 단계) */
const ELITE_RARITY_BONUS = 1.0;

/** 정예 의뢰인가 (필드 없는 옛 의뢰는 false) */
export function isEliteQuest(quest) {
  return !!(quest && quest.elite);
}

/**
 * 필드 없는 옛 세이브의 의뢰를 정규화한다. `sub`/`rankLabel`/`elite` 를 채워 준다.
 * 같은 객체를 고쳐서 돌려준다 (state.js 가 로드 시 훑어도 되고, 안 훑어도
 * 이 파일의 모든 읽기 경로가 방어적으로 동작한다).
 */
export function normalizeQuest(q) {
  if (!q || typeof q !== 'object') return q;
  if (!RANKS.includes(q.rank)) q.rank = 'F';
  q.sub = normSub(q.sub);
  q.elite = !!q.elite;
  q.rankLabel = `${q.rank}${SUB_LABEL[q.sub] || ''}`;
  return q;
}

/** 보상 배율 (랭크 인덱스) */
// 랭크 구간이 겹치지 않게 바뀌면서 랭크가 오를수록 권장 레벨도 반드시 올라간다.
// 보상은 (60 + level*13) * RANK_MULT 이므로 레벨과 배율이 함께 올라 단조 증가가 유지된다.
const RANK_MULT = [1, 1.7, 2.8, 4.5, 7.2, 11.5, 18];

/** 의뢰 보상 **골드**에만 걸리는 전역 계수. 경제가 흔들리면 여기부터 만져라. */
export const GOLD_MULT = 1.20;
/** 랭크별 웨이브 수 [최소, 최대] */
// 웨이브 수가 체감 난이도를 가장 크게 좌우한다(HP가 다음 웨이브로 이어지므로).
// F는 항상 1웨이브, E는 1~2웨이브다. 초반 부대에게 2웨이브는 사실상 두 배 난이도다.
// B~S는 3웨이브 고정이다. 웨이브는 ±1 이 곧 ±30% 난이도라 눈금이 너무 굵으므로,
// 미세 조정은 RANK_POWER / RANK_CREEP 으로 하고 이 표는 되도록 건드리지 않는다.
const RANK_WAVES = { F: [1, 1], E: [1, 2], D: [2, 2], C: [2, 3], B: [3, 3], A: [3, 3], S: [3, 3] };
/** 랭크별 소요 일수 [최소, 최대] — 부대가 원정으로 잠기는 기간 */
// 파견 모델의 핵심 노브다. 전투/보상은 즉시 처리되지만 **부대는 이 일수만큼 잠긴다**.
// 날짜는 플레이어가 직접 넘기므로, 이 값이 곧 "이 부대를 며칠 못 쓰는가" 다.
//   저랭크 = 짧게 → 부대 여러 개로 하루에 여러 건을 도는 회전 전략
//   고랭크 = 길게 → 한 방으로 크게 버는 대신 그 부대를 오래 묶는 전략
// 두 전략이 갈리도록 랭크가 오를수록 단조 증가시킨다.
export const RANK_DAYS = {
  F: [1, 1], E: [1, 2], D: [2, 3], C: [3, 4], B: [4, 5], A: [5, 6], S: [6, 7],
};
/** 랭크별 적 레벨 보정 — 용병만 받는 전직 차수 배율을 레벨 성장률로 환산한 값 */
// 용병의 차수 배율(2차 1.30 / 3차 1.66 / 4차 2.10)을 레벨 성장률 8.5%/lv 로 환산하면
//   2차: 0.30 / 0.085 ≈ 3.5  →  +4
//   3차: 0.66 / 0.085 ≈ 7.8  →  +8
//   4차: 1.10 / 0.085 ≈ 12.9 →  +13   (설계 A: S랭크는 4차 부대가 상대다)
// 예전에는 `ctx.level >= 35 ? 12 : 0` 처럼 레벨로 분기했는데, 랭크가 차수 경계를 걸치면
// 같은 랭크 안에서 보정이 갈렸다. RANK_LEVEL을 차수에 맞춰 자른 지금은 랭크 인덱스만 보면 된다.
// ※ 이 환산은 근사다. 성장은 곱이 아니라 덧셈(1+0.085*(lv-1))이라 레벨 +d 로 배율 ×k 를
//   정확히 상쇄할 수는 없다. 정밀 조정은 아래 RANK_POWER(곱연산)로 한다.
const PROMO_STEP = [0, 0, 4, 4, 2, 8, 13];
/** 랭크별 추가 레벨 보정 — 차수 외의 격차(등급 배율·장비·적 풀 세기)를 메우는 잔여 노브 */
// PROMO_STEP은 차수 배율만 상쇄한다. 나머지 격차를 여기서 맞춘다.
// F는 0으로 못 박는다 — 초반은 무조건 쉬워야 한다(설계 F).
// B가 음수인 이유: RANK_TIER에서 B의 상대를 tier 3 → 4 로 한 단계 올렸다.
//   tier 4 일반 적은 tier 3 보다 평균 38% 강해서, 예전 레벨 보정(+7)을 그대로 두면
//   같은 B랭크가 승률 100% → 12%로 뒤집힌다(실측). 적 풀을 올린 만큼 레벨을 도로 내린다.
//   레벨(선형)보다 적 풀 교체(스킬·아키타입까지 바뀜)가 훨씬 크게 작용하므로 상쇄값이 크다.
// ★ Lv80 상한을 넘긴 보정은 버려지지 않는다 — `overflowPower()` 가 초과분을 스탯 배율로
//   환산한다. 그래서 S랭크(권장 55~80)에서도 이 값이 끝까지 유효하다.
const RANK_CREEP = [0, 5, 2, 0, 0, 1, 2];
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
const RANK_POWER = [1.00, 1.04, 1.13, 1.12, 1.09, 1.06, 1.08];

/** 레벨 lv 의 스탯 성장 배율 (SPEC §2.1) */
const growthAt = (lv) => 1 + GROWTH_RATE * (Math.max(1, Math.round(lv)) - 1);
/**
 * 적 레벨이 상한(Lv80)을 넘긴 만큼을 스탯 배율로 환산한다.
 *
 * 예전에는 `clamp(level, 1, 60)` 에서 초과분이 그냥 버려졌다. 그래서 S랭크는 권장 레벨이
 * 상한에 가까워질수록 레벨 보정이 사라져 "레벨만으로는 상위 랭크를 어렵게 만들 수 없다" 는
 * 벽에 부딪혔다. 성장은 레벨에 선형이므로 growth(원하는레벨)/growth(상한) 을 곱해 주면
 * **상한을 넘긴 레벨의 적과 스탯이 정확히 같아진다.** (crit/eva 는 애초에 레벨 무관)
 * 표시 레벨은 80으로 잘리고 초과분만 숨은 배율이 된다.
 */
function overflowPower(wantLevel) {
  const want = Math.round(Number(wantLevel));
  if (!Number.isFinite(want) || want <= MAX_QUEST_LEVEL) return 1;
  return growthAt(want) / growthAt(MAX_QUEST_LEVEL);
}
/** 마지막 웨이브 보스 등장 확률 */
// D 이하를 낮게 잡은 이유: 보스는 같은 tier 일반 적의 약 2배 세기라 저랭크 부대에겐
// 사실상 넘을 수 없는 벽이다(E·D 보스전 승률 0% 실측). 빈도를 낮춰 노출만 줄여 둔다.
// 근본 해결은 보스 배율을 랭크에 맞춰 낮추는 것 — enemies.js 몫이다.
// ※ 7차 세션: B·A·S 를 0.60 으로 두니 고랭크 의뢰의 60%가 보스전이 됐다. 보스전은 승패가
// 이분법적(넘거나 전멸)이라 랭크·서브랭크·정예 어느 노브를 건드려도 승률이 한꺼번에 뒤집혀
// 목표 대역을 맞추는 것 자체가 불안정했다(B·A 가 6% 배율에 ±30%p 씩 흔들림). 노출 빈도를
// 0.35 로 낮춰 보스전을 "가끔 나오는 도전"으로 되돌리고, 세 난이도 축을 안정적으로 튜닝한다.
const BOSS_CHANCE = [0, 0.04, 0.06, 0.12, 0.35, 0.35, 0.35];

/**
 * 도시 등급별 보스 등장 배수.
 *
 * ★★ **만렙 부대를 죽이는 건 보스 공격력뿐이다.** 실측 (HANDOFF §37):
 *   같은 Lv72·같은 배율에서 A랭크(보스 없음)는 적 HP 19만인데도 완주 100%,
 *   S랭크(보스 있음)는 0% 였다. 차이는 HP 가 아니라 **공격 합 6,221 vs 15,779** 이었다.
 *
 *   만렙 풀장비 부대는 HP 풀이 커서 일반 적은 `CITY_POWER` 를 ×2.8 까지 올려도
 *   위협이 안 된다 — HP 를 같이 올리면 전투만 길어지고 위험은 안 오른다.
 *   그래서 배율이 아니라 **보스 등장률**이 상위 도시의 레버다.
 *
 * ★ F랭크는 원래 0 이라 곱해도 0 이다 — 첫 전투에서 보스를 만나는 일은 없다.
 */
const CITY_BOSS_MULT = { 1: 1.0, 2: 1.3, 3: 1.7, 4: 2.2, 5: 2.8 };
const bossChanceAt = (idx, tier) => clamp(
  (BOSS_CHANCE[idx] || 0) * (CITY_BOSS_MULT[clamp(Math.round(tier || 1), 1, 5)] || 1),
  0, 1,
);
/** 도시 tier -> 랭크 가중치 */
// D가 [10,20] → [15,24] 로 올라갔으므로 시작 도시(tier 1)에서 D는 Lv1 부대에게 사실상
// 손댈 수 없는 의뢰다. 목록 자리만 잡아먹지 않도록 비중을 크게 줄이고 F/E 위주로 띄운다.
/**
 * 도시(=지역) 등급별 적 스탯 배율.
 *
 * ★ 왜 필요한가 — 지금까지 난이도는 **랭크에만** 실려 있었다. 랭크는 권장 레벨을 맞춰 주지만
 *   **장비를 전혀 감안하지 않는다** (`balance.mjs` 의 표준 부대는 맨몸이다).
 *   그래서 장비를 갖춘 플레이어에겐 전 구간이 쉬웠다 — 실측에서 각 등급의 «도착 시점
 *   기대 스펙» 이 배율 ×1.0 에서 이미 86~100% 였다 (HANDOFF §29·§31.6).
 *
 * ★ 실측한 55% 지점: 2등급 ~×1.15 / 3등급 ~×1.5 / 4등급 ~×1.4 / 5등급 ~×1.7.
 *   노이즈가 있어 단조롭게 다듬었다. 6·7등급 도시를 나중에 얹으면 ~1.95 / ~2.2 자리다.
 *
 * ★★ **배율은 제곱으로 먹는다.** hp·atk·def·res 에 전부 곱하면 실효 난이도가 배율² 에
 *   가깝다 — `ELITE_MULT` 이 1.30 → 1.035 로 내려간 이유가 이것이다. 눈으로 정하지 말고
 *   반드시 실측해라 (`tools/balance.mjs`, `tools/dangercheck.mjs`).
 */
export const CITY_POWER = { 1: 1.00, 2: 1.18, 3: 1.38, 4: 1.62, 5: 1.90 };
export const cityPowerOf = (tier) => CITY_POWER[clamp(Math.round(Number(tier) || 1), 1, 5)] || 1;

/**
 * 보상이 도시 배율을 따라가는 지수.
 *
 * ★★ **이걸 빼먹으면 개편 전체가 무의미해진다.** 같은 랭크가 모든 도시에 나오는데
 *   보상이 같으면 다들 1등급 도시에서 S랭크만 돈다 — 위로 갈 이유가 사라진다.
 *
 * 난이도가 배율² 로 오르므로 보상도 같은 지수로 맞춘다 (5등급 = 1.70² ≈ 2.89배).
 */
export const CITY_REWARD_POW = 2.0;

/**
 * 도시 등급별 **권장 레벨 하한.**
 *
 * ★ `CITY_POWER` 는 적 «스탯» 만 올린다. 권장 레벨은 랭크가 정하므로 5등급 도시에서도
 *   A랭크는 Lv45~54 짜리다 — 상한을 찍은 부대에겐 스탯을 1.63배 곱해도 한참 아래고,
 *   실제로 **5등급 도시 의뢰가 전부 「식은 죽 먹기」** 였다 (HANDOFF §36).
 *
 * ★★ 판정 잣대가 도시 등급마다 다르다 (제작자 결정, §36.5):
 *     1등급   = `tools/balance.mjs`  — 레벨 맞춘 부대 (진짜 초보)
 *     2등급~  = `tools/endgame.mjs`  — **만렙 부대**
 *   2등급쯤부터는 만렙 파티에 한두 명 끼워 키우는 게 실제 플레이 양상이라,
 *   «레벨 맞춘 부대» 로 재면 존재하지 않는 플레이어를 위해 튜닝하게 된다.
 *
 * ★ 하한이라 랭크 대역을 위로만 민다. 5등급 도시의 F랭크는 Lv55 짜리 잡일이 된다 —
 *   험한 땅에서는 잡일도 만만치 않다는 쪽이 오히려 말이 된다.
 */
export const CITY_LEVEL_FLOOR = { 1: 1, 2: 8, 3: 20, 4: 36, 5: 55 };
export const cityLevelFloorOf = (tier) => CITY_LEVEL_FLOOR[clamp(Math.round(Number(tier) || 1), 1, 5)] || 1;

/**
 * 도시 등급별 랭크 분포.
 *
 * ★ 예전에는 등급마다 **창이 좁았다** (1등급은 F/E/D 만, 5등급은 C/B/A/S 만).
 *   그래서 «높은 랭크를 하려면 위로 가야 한다» 였는데, 이제 난이도 축은 `CITY_POWER` 다.
 *   전 도시가 F~S 를 다 내보내되 **그 등급의 본토 대역이 여전히 압도적**이게 두었다 —
 *   1등급 도시에서 S랭크가 나오긴 하지만 100건에 1건꼴이고, 그마저 배율 ×1.0 이라
 *   «어려운 의뢰» 로서 제 역할을 한다.
 *
 * 꼬리를 얇게 단 이유: 두껍게 달면 초반 목록이 못 하는 의뢰로 덮인다.
 * 지금 목록은 4~16건이라 꼬리 가중치가 0.5 면 대략 20건에 한 번 보인다.
 */
const RANK_WEIGHT = {
  1: { F: 6, E: 3, D: 1.2, C: 0.5, B: 0.25, A: 0.12, S: 0.06 },
  2: { F: 3, E: 4, D: 3, C: 1.2, B: 0.5, A: 0.25, S: 0.12 },
  3: { F: 0.8, E: 3, D: 4, C: 3, B: 1.2, A: 0.5, S: 0.25 },
  4: { F: 0.4, E: 1, D: 2, C: 4, B: 3.5, A: 1.2, S: 0.5 },
  5: { F: 0.2, E: 0.5, D: 1.2, C: 2, B: 3, A: 3, S: 1.5 },
};
/* ── 부상 규칙 (설계 A) ──
 * 전투 중 HP 0 은 "전투불능(다운)"일 뿐이고, 부상은 예외적으로만 발생한다.
 * 예전에는 다운 = 무조건 부상 2~5일 + HP를 1로 떨궜다. 그러면 한 명만 눕어도 부대가
 * 출정 불가가 되고, 복귀해도 HP 1이라 다음 전투에서 즉사해 같은 나선이 반복됐다.
 */
/** 의뢰 실패 시, 다운된 용병이 실제 부상까지 가는 확률 (랭크 인덱스) */
const WOUND_CHANCE = [0.20, 0.20, 0.35, 0.35, 0.50, 0.50, 0.50];
/** 부상 기간 [최소, 최대] 일 */
const WOUND_DAYS = [2, 4];
/** 의뢰 성공 시 다운된 용병이 회복하는 HP 비율 (maxHp 대비) */
const DOWN_HP_WIN = 0.25;
/** 전투 후 HP 하한 (maxHp 대비). 이 밑으로는 절대 떨어뜨리지 않는다. */
const HP_FLOOR = 0.15;

/* ── 도시 평판 (설계 A) ──
 * 의뢰를 수행한 **그 도시**의 평판이 오르내린다. 평판은 주점 해금(10 미만이면 고용 불가)과
 * 등급 롤 보정에 쓰이므로, 처음 간 도시에서는 "의뢰부터 하고 나서 사람을 뽑는" 순서가 된다.
 * 실패 페널티는 성공 보상과 **같다** — 실패 한 번이 성공 한 번을 통째로 날린다.
 * 여기에 자리를 비우면 하루 1씩 깎이는 감쇠(state.js REP_DECAY_PER_DAY)가 겹쳐,
 * 평판은 «올리기만 하면 되는 값» 이 아니라 **유지해야 하는 값** 이 된다.
 */
/* ★ 한때 F2…S26 이었다. 상한을 3배(100→300)로 올리면서 획득량도 2.6배로 같이 올렸더니
 *   체감 시간이 1.15배밖에 안 늘어 «순식간에 찬다» 는 지적을 받았다 — 정반대로 만든 것이다.
 *   지금은 옛 값의 대략 55% 다. 랭크가 오를수록 빨라지는 기울기는 유지했다.
 *
 * ★ F 를 1 까지 내렸다가 되돌렸다 — 실패 페널티가 «획득과 같다» 로 바뀌면서
 *   F 는 +1/−1 이 되어 **실패 한 번이 성공 한 번을 완전히 상쇄**했고,
 *   낯선 도시에서 주점을 못 여는 시드가 생겼다 (`earlygame` 의 «평판잠금» 이 잡았다).
 *   저랭크에는 여유가 있어야 첫 발판이 생긴다. */
export const REP_GAIN = { F: 2, E: 3, D: 4, C: 6, B: 8, A: 11, S: 14 };
/**
 * 실패 시 하락폭 — **성공 보상과 같다** (최소 1).
 *
 * ★ 예전에는 절반이었다. 그런데 예보 색이 정확해진 뒤로(§24) 플레이어가 질 의뢰를
 *   아예 안 받아서, 절반이든 전부든 실제로는 거의 안 걸렸다.
 *   같게 두면 «실패 한 번 = 성공 한 번을 통째로 날림» 이라 무리한 도전에 값이 붙는다.
 */
const repLoss = (gain) => Math.max(1, Math.round(gain));

export const QUEST_TYPES = ['토벌', '호위', '탐색', '섬멸', '수호'];
const TYPE_MULT = { 토벌: 1.0, 호위: 1.05, 탐색: 0.95, 섬멸: 1.15, 수호: 1.1 };

const GROWTH_RATE = 0.085;
const SCALING_KEYS = ['hp', 'atk', 'def', 'res', 'spd'];
const FLAT_KEYS = ['crit', 'critDmg', 'eva'];
const ENEMY_GRADE = ['E', 'D', 'C', 'B', 'A'];
const FALLBACK_SLOTS = [
  { x: 0.10, y: 0.28 }, { x: 0.10, y: 0.72 }, { x: 0.38, y: 0.14 },
  { x: 0.38, y: 0.50 }, { x: 0.38, y: 0.86 }, { x: 0.74, y: 0.30 }, { x: 0.74, y: 0.70 },
];

/* ------------------------------------------------------------------ 이름 소재 */

const PLACE_WORD = {
  plains: ['들녘', '벌판', '옛 관도', '목초지', '바람 언덕'],
  forest: ['숲', '수림', '고목림', '덤불길', '사냥터'],
  mountain: ['산길', '고갯마루', '절벽지대', '채석장', '돌무지 봉우리'],
  desert: ['모래언덕', '마른 강바닥', '폐허 오아시스', '바람골', '소금밭'],
  swamp: ['늪지', '수렁', '안개 습지', '썩은 못', '갈대밭'],
  coast: ['해안', '부둣가', '조수 동굴', '난파선 해변', '등대 곶'],
  tundra: ['설원', '얼음 벌판', '서리 계곡', '빙하 균열', '눈보라 고원'],
  cave: ['동굴', '갱도', '지하 미궁', '수정 광맥', '어둠의 굴'],
};
const PLACE_ADJ = ['잿빛', '안개 낀', '버려진', '오래된', '피에 젖은', '메아리치는', '고요한', '서리 맺힌', '불탄', '굶주린', '뒤틀린', '속삭이는'];
const LAIR_WORD = ['소굴', '둥지', '야영지', '본거지', '땅굴'];
const RUIN_WORD = ['유적', '폐허', '고분', '무너진 제단', '버려진 초소', '봉인된 석실'];
const GUARD_WORD = ['방어전', '수성전', '농성전', '경계 임무'];

/**
 * 장소 낱말 -> 전투 배경.
 *
 * ★ 이건 **배경(scene)만** 바꾼다. 적 편성에 쓰는 `biome` 은 손대지 않는다 —
 *   `enemiesFor(biome, tier)` 가 적 풀을 고르므로 여기서 biome 을 흔들면
 *   난이도표가 통째로 어긋난다.
 *
 * "봉인된 석실 조사"인데 배경이 들판으로 나오던 문제. 지하·실내를 뜻하는 낱말이
 * 이름에 들어가면 배경만 동굴로 바꾼다. 나머지는 도시 지형 그대로가 맞다
 * ('무너진 제단'이나 '야영지'는 바깥이다).
 */
const SCENE_WORD = {
  고분: 'cave',
  '봉인된 석실': 'cave',
  땅굴: 'cave',
  소굴: 'cave',
};
const ESCORT_WORD = ['상단 호위', '순례단 호위', '사절 호위', '보급대 호위', '피난민 호위'];
const FOE_FALLBACK = ['도적단', '들짐승', '언데드', '괴수', '약탈자'];

const regionOf = (id) => (Array.isArray(REGIONS) ? REGIONS.find((r) => r.id === id) : REGIONS?.[id]) || null;

function cityBiome(city) {
  if (!city) return 'plains';
  if (city.biome) return city.biome;
  const reg = regionOf(city.regionId);
  return reg?.biome || 'plains';
}

/** 랭크 -> 적 tier 대역 (1~5) */
// 예전 공식 `1 + floor(idx/1.5)` 은 B와 C를 같은 tier 3 대역에 묶었다.
// 그런데 tier 3 일반 적의 평균 전투력은 tier 4의 약 72% 밖에 안 된다(실측).
// C는 2차 부대(1.30배), B는 3차 부대(1.66배)를 상대하는데 적 풀이 같으니
// B만 헐거워져 승률 100%가 나왔다 — 적 레벨을 60까지 밀어도 뒤집히지 않는다.
// 랭크마다 상대가 한 단계씩 올라가도록 표로 못 박는다.
const RANK_TIER = { F: 1, E: 1, D: 3, C: 3, B: 4, A: 4, S: 5 };
const tierForRank = (rank) => clamp(RANK_TIER[rank] || 1, 1, 5);

/**
 * 의뢰 이름에 쓸 적 무리 이름.
 * '굶주린 늑대'처럼 앞 어절이 관형어일 수 있어 토막내지 않고 뒤쪽 두 어절까지 쓴다.
 */
function foeWord(biome, rank, r) {
  let pool = [];
  try { pool = enemiesFor(biome, tierForRank(rank)) || []; } catch { pool = []; }
  if (!pool.length) {
    try { pool = enemiesFor(biome, 1) || []; } catch { pool = []; }
  }
  const usable = pool.filter((e) => e && e.name && !e.boss);
  if (!usable.length) return r.pick(FOE_FALLBACK);
  const parts = String(r.pick(usable).name).split(/[ ·]+/).filter(Boolean);
  return parts.slice(-2).join(' ');
}

function placeName(biome, r) {
  const words = PLACE_WORD[biome] || PLACE_WORD.plains;
  return `${r.pick(PLACE_ADJ)} ${r.pick(words)}`;
}

/** 이웃 도시 이름 (호위 목적지). 없으면 지역 이름을 쓴다. */
function neighborName(city, r) {
  const links = Array.isArray(city?.links) ? city.links : [];
  if (links.length) {
    const to = r.pick(links);
    const c = getCity(to.to || to.cityId || to.id);
    if (c) return c.name;
  }
  return regionOf(city?.regionId)?.name || city?.name || '변경';
}

function makeName(type, ctx, r) {
  const { city, biome, rank } = ctx;
  const foe = foeWord(biome, rank, r);
  const place = placeName(biome, r);
  switch (type) {
    case '토벌': return { name: `${city.name} 인근의 ${foe} 소탕`, foe, place };
    case '섬멸': {
      const w = r.pick(LAIR_WORD);
      return { name: `${place}의 ${foe} ${w} 섬멸`, foe, place, scene: SCENE_WORD[w] };
    }
    case '호위': return { name: `${r.pick(ESCORT_WORD)}: ${neighborName(city, r)}行`, foe, place };
    case '탐색': {
      const w = r.pick(RUIN_WORD);
      return { name: `${place} ${w} 조사`, foe, place, scene: SCENE_WORD[w] };
    }
    default: return { name: `${place} ${r.pick(GUARD_WORD)}`, foe, place };
  }
}

function makeDesc(type, ctx) {
  const { foe, place, city, rank, level, sub, elite } = ctx;
  const label = `${rank}${SUB_LABEL[normSub(sub)] || ''}`;
  const tail = `권장 레벨 ${level} · ${label}랭크 의뢰.${elite ? ` ${ELITE_WARN}` : ''}`;
  switch (type) {
    case '토벌': return `${city.name} 주변 길목에 ${foe}이(가) 출몰해 행상들이 발이 묶였다. 무리를 흩어놓고 오면 된다. ${tail}`;
    case '섬멸': return `${place}에 자리 잡은 ${foe} 무리가 세를 불리고 있다. 뿌리째 뽑아야 한다. ${tail}`;
    case '호위': return `짐마차 행렬이 습격을 두려워한다. 길 위에서 덤벼드는 것들을 전부 걷어내라. ${tail}`;
    case '탐색': return `${place}에서 기이한 소리가 들린다는 제보가 있었다. 안을 살피고 방해물을 치워라. ${tail}`;
    default: return `${place}이(가) 곧 습격당한다. 자리를 지키고 밀려오는 적을 막아내라. ${tail}`;
  }
}

/* ------------------------------------------------------------------ 의뢰 생성 */

function pickRank(tier, r) {
  const table = RANK_WEIGHT[clamp(tier, 1, 5)] || RANK_WEIGHT[1];
  const entries = Object.entries(table).map(([rank, w]) => ({ rank, w }));
  return r.weighted(entries).rank;
}

/**
 * 권장 레벨을 뽑는다. 랭크 안에서 서브랭크가 나눠 갖는 밴드(RANK_SUB_LEVEL)에서 굴린다.
 * 예: S- 55~63 / S 64~71 / S+ 72~80. 서브랭크가 곧 "이 랭크의 어느 레벨대인가"를 정한다.
 */
function pickLevel(rank, sub, r) {
  const [lo, hi] = subLevelRange(rank, sub);
  let lv = r.int(lo, hi);
  // F랭크는 시작 부대(Lv1 4명)가 유일하게 손댈 수 있는 의뢰다. 서브랭크 밴드 안에서도
  // 낮은 쪽으로 skew 시켜(두 번 더 굴려 최소값) 첫 전투가 확실히 쉽도록 보호한다.
  if (rank === 'F') lv = Math.min(lv, r.int(lo, hi), r.int(lo, hi));
  return clamp(lv, 1, MAX_QUEST_LEVEL);
}
/** 서브랭크 하나를 등장 비중(SUB_WEIGHT)대로 뽑는다. '-'(입문)를 가장 많이 띄운다. */
function pickSub(rank, r) {
  return r.weighted(SUBS.map((s) => ({ s, w: SUB_WEIGHT[s] }))).s;
}
/**
 * 정예 의뢰 여부를 굴린다. D랭크 이상에서만, 서브랭크 보정을 얹어 판정한다.
 * S+ 가 ELITE_CHANCE.S(0.16) + ELITE_SUB_CHANCE[+1](0.04) = 0.20 이 되도록 맞춰 뒀다.
 */
function rollElite(rank, sub, r) {
  if ((RANK_IDX[rank] ?? 0) < (RANK_IDX[ELITE_MIN_RANK] ?? 99)) return false;
  const p = clamp((ELITE_CHANCE[rank] || 0) + (ELITE_SUB_CHANCE[sub] || 0), 0, 1);
  return r.chance(p);
}

/** enemies.js가 돌려준 부대 정의를 안전한 형태로 다듬는다. */
function normalizeWave(sq, fallbackLevel) {
  const raw = sq && Array.isArray(sq.units) ? sq.units : [];
  const units = raw.slice(0, 7).map((u, i) => {
    const out = {
      enemyId: u?.enemyId || u?.id || null,
      level: clamp(Math.round(u?.level ?? fallbackLevel), 1, MAX_QUEST_LEVEL),
      slotIndex: Number.isInteger(u?.slotIndex) ? clamp(u.slotIndex, 0, 6) : i,
    };
    // 정예 표식(설계 E)은 enemies.js 가 유닛에 실어 준다. 있으면 그대로 보존해
    // enemyUnitDefs 가 스탯·이름에 반영하게 한다(없으면 quest.elite 로 폴백).
    if (u && Number.isFinite(u.eliteMult)) out.eliteMult = u.eliteMult;
    if (u && u.champion) out.champion = true;
    if (u && typeof u.nameOverride === 'string') out.nameOverride = u.nameOverride;
    if (u && Array.isArray(u.addSkills) && u.addSkills.length) out.addSkills = u.addSkills.slice();
    return out;
  }).filter((u) => u.enemyId);
  // 슬롯 중복 제거
  const used = new Set();
  for (const u of units) {
    while (used.has(u.slotIndex)) u.slotIndex = (u.slotIndex + 1) % 7;
    used.add(u.slotIndex);
  }
  return { units, formationId: sq?.formationId || 'basic' };
}

function buildWaves(ctx, r) {
  const idx = RANK_IDX[ctx.rank];
  const sub = normSub(ctx.sub);
  const elite = !!ctx.elite;
  // 서브랭크 델타(설계 D) — F 는 초반 보호 구간이라 적 수·적 레벨 델타를 받지 않는다(설계 F).
  // (권장 레벨 밴드만으로 F- 는 저레벨 / F+ 는 고레벨로 갈리므로 델타 없이도 자연히 나뉜다.)
  const subLv = ctx.rank === 'F' ? 0 : (SUB_LEVEL[sub] || 0);
  const subSize = ctx.rank === 'F' ? 0 : (SUB_SIZE[sub] || 0);
  const subPow = ctx.rank === 'F' ? 1 : (SUB_POWER[sub] || 1);
  const [wLo, wHi] = RANK_WAVES[ctx.rank] || [1, 1];
  const waveCount = r.int(wLo, wHi);
  const waves = [];
  for (let w = 0; w < waveCount; w++) {
    const isLast = w === waveCount - 1;
    // 적 수는 랭크에 따라 3기(F) → 7기(A·S)로 늘어난다.
    // 오토배틀러에서 인원수는 곧 화력이다. 신규 플레이어는 용병 4명으로 시작하므로
    // F랭크를 5~7기로 세우면 개별 스탯이 아무리 우세해도 수적 열세로 반드시 진다.
    // 부대를 7인까지 채워가는 성장 자체가 난이도 곡선이 되도록 랭크에 비례시킨다.
    // F는 3기 고정, E는 3~4기로 못 박는다. 초반은 "확실히 이긴다"가 기본값이어야 한다.
    const baseSize = idx === 0 ? 3
      : idx === 1 ? 3 + r.int(0, 1)
      : clamp(3 + Math.round(idx * 0.7) + r.int(0, 1) + (isLast && idx >= 4 ? 1 : 0), 3, 7);
    const bossP = bossChanceAt(idx, ctx.cityTier);
    const boss = isLast && r.chance(bossP);
    // 보스는 한 기가 아니라 여러 기 몫이다. 낮은 랭크에서는 호위까지 정원대로 세우면
    // 적 총 HP가 아군의 2.2배가 되어(실측) 이길 방법이 없다. F~C에서만 호위를 줄인다.
    // B 이상은 원래 보스전 승률이 60~80%로 정상이었으므로 건드리지 않는다
    // (여기서 -1만 해줘도 B가 74%→84%로 튀어 목표 구간을 벗어난다).
    // 서브랭크 '+' 는 적을 한 기 더 세운다(상한 7). '-'·기본은 그대로.
    const size = clamp(baseSize + subSize - (boss && idx <= 3 ? 2 : 0), 2, 7);
    // 용병은 차수(최대 1.66배)·등급(최대 1.55배) 배율을 받지만 적은 레벨 성장만 한다.
    // 그 격차를 PROMO_STEP(랭크 기준 차수 보정)으로 메운다. RANK_LEVEL이 차수 경계에
    // 맞춰 잘려 있으므로 랭크 하나 = 보정 하나로 대응되고, 예전처럼 레벨로 분기할 필요가 없다.
    // 랭크가 오를수록 적 레벨을 권장 레벨보다 조금 더 올려 등급·장비 격차도 함께 흡수한다.
    // F는 예외다. 시작 부대가 첫 전투로 받는 구간이라 적 레벨을 권장 레벨 이하로 묶는다.
    const jitter = idx === 0 ? r.int(-1, 0) : r.int(-1, 1);
    // 상한(Lv80)을 넘긴 레벨은 표시 레벨로 잘리고, 초과분은 overflowPower 로 스탯 배율이 된다.
    // 그래서 S랭크(권장 55~80)에서도 레벨 보정이 끝까지 살아 있다.
    const wantLevel = ctx.level + w + RANK_CREEP[idx] + PROMO_STEP[idx] + subLv + jitter;
    const level = clamp(wantLevel, 1, MAX_QUEST_LEVEL);
    // 이 웨이브 적 전원에 곱해질 스탯 배율(설계 F): 랭크 난이도(RANK_POWER) × 레벨 초과분.
    // enemyUnitDefs 가 wave.power 를 읽어 전투 스탯에 적용한다.
    const power = RANK_POWER[idx] * overflowPower(wantLevel) * subPow * (ctx.cityPower || 1);
    const hint = {
      id: ctx.id, name: ctx.name, type: ctx.type, cityId: ctx.cityId,
      biome: ctx.biome, rank: ctx.rank, rankIndex: idx, sub, elite, level,
      tier: tierForRank(ctx.rank),
      waveIndex: w, waveCount, isLast, size, count: size, boss, bossChance: bossP,
    };
    let sq = null;
    try { sq = buildEnemySquad(hint, r); } catch (e) { console.warn('[quest] buildEnemySquad 실패', e); }
    const wave = normalizeWave(sq, level);
    // 웨이브에 스탯 배율·정예 플래그를 실어 enemyUnitDefs 로 넘긴다(둘 다 직렬화 안전).
    wave.power = power;
    if (elite) wave.elite = true;
    if (wave.units.length) waves.push(wave);
  }
  return waves;
}

/* ── 경험치 배율 (파견 시스템 도입 후 재조정) ──
 * 파견 모델로 바뀌면서 "의뢰 1건 = 하루" 가 아니게 됐다. 부대가 여럿이면 하루에 여러 건을 돌고,
 * 부대가 하나면 F랭크라도 1일, S랭크면 7일씩 묶인다. 즉 **날짜당 전투 수가 늘었지만
 * 한 부대가 도는 의뢰 수 자체는 크게 늘지 않았다.**
 *
 * 랭크 승률은 레벨 대비로 맞춰져 있으므로 이 배율은 **전투 밸런스를 건드리지 않고**
 * 성장 속도만 옮긴다.
 * ※ 7차 세션(검증): Lv80 상한·4차 전직이 생기면서 성장 목표가 Lv15 30~45 / Lv35 80~120 /
 * Lv55 160~220 / Lv80 300일+ 로 바뀌었다. merc.js 지수(1.72→1.55)와 함께 이 값을 1.8→2.45 로
 * 올려 **도시 이동을 넣은** 실측 성장 시뮬(earlygame.mjs ★E2)이 전 구간 목표 대역에 들게 맞췄다.
 */
const EXP_SCALE = 2.45;

function buildReward(rank, level, type, waveCount, r, opts = {}) {
  const idx = RANK_IDX[rank];
  const sub = normSub(opts.sub);
  const elite = !!opts.elite;
  const mult = RANK_MULT[idx] * (TYPE_MULT[type] || 1);
  // 서브랭크 보상 배율(설계 D)과 정예 보상 배율(설계 E)을 함께 곱한다.
  //   골드·경험치: ×SUB_REWARD × (정예면 ×2.2) / 명성: ×SUB_REWARD × (정예면 ×1.5)
  const gxMult = (SUB_REWARD[sub] || 1) * (elite ? ELITE_REWARD : 1);
  const rnMult = (SUB_REWARD[sub] || 1) * (elite ? ELITE_RENOWN : 1);
  // ★ GOLD_MULT — 후반 경제가 적자여서 넣은 전역 보상 계수.
  //   임금은 레벨에 따라 초선형으로 느는데 보상 기울기가 못 따라가 정원 50 이상에서 일수지가
  //   음수가 됐다(실측). 경험치·명성은 건드리지 않는다 — 성장 속도는 그대로 둬야 랭크 밸런스가 산다.
  const gold = Math.max(1, Math.round((60 + level * 13) * mult * gxMult * GOLD_MULT * r.float(0.92, 1.12)));
  const exp = Math.max(1, Math.round(24 * EXP_SCALE * Math.pow(level, 1.5) * (1 + idx * 0.1) * (0.85 + waveCount * 0.12) * gxMult));
  const renown = Math.max(1, Math.round((1 + idx * 2 + Math.floor(level / 12)) * rnMult));
  const rolls = clamp(1 + Math.floor(idx / 2) + (r.chance(0.25 + idx * 0.05) ? 1 : 0), 1, 4);
  // 정예는 전리품 희귀도 보너스 +1단계(설계 E).
  const eliteRarity = elite ? ELITE_RARITY_BONUS : 0;
  const itemRolls = [];
  for (let i = 0; i < rolls; i++) {
    itemRolls.push({
      ilvl: clamp(level + r.int(-2, 3), 1, MAX_QUEST_LEVEL),
      rarityBonus: Math.round((idx * 0.07 + (waveCount >= 3 ? 0.08 : 0) + eliteRarity) * 100) / 100,
    });
  }
  return { gold, exp, renown, itemRolls };
}

/* ── 의뢰 공급량 (설계 F) ──
 * 파견 모델에서 부대 수의 실질 상한은 "의뢰가 몇 건 뜨는가" 다. 도시당 4~7건 고정이던 시절
 * 2부대는 40 일 중 4.3 부대-일(80 부대-일의 5%)을 의뢰가 없어서 놀았다(실측). 부대를 3개,
 * 5개까지 늘릴 수 있게 되면 이 유휴가 그대로 커져 부대 구입비가 헛돈이 된다.
 * 그래서 목록 길이를 부대 수에 비례시킨다. 부대 1개면 5~6건으로 지금과 거의 같고,
 * 5부대면 13~14건이 떠서 하루에 전 부대를 굴릴 수 있다.
 *   count = clamp(3 + 부대수 * 2 + r.int(0,1), 4, 16)
 * ※ 랭크 분포는 건드리지 않는다. pickRank 는 건마다 독립적으로 RANK_WEIGHT[tier] 를 굴리므로
 *   개수가 늘어도 tier별 랭크 비율은 그대로 유지된다.
 *
 * ★ 상한 12 → 16 (검증 세션 실측). 상한 12 로는 5부대 유휴율이 15.6% 로 목표(15% 미만)를
 *   넘겼다. 원인은 "다른 부대가 먼저 채간 것"(유휴 31.2 부대-일 중 0.4건)이 아니라
 *   **그 부대가 받을 수 있는 랭크의 의뢰가 목록에 남지 않은 것**(30.8건)이었다 —
 *   목록 자체를 늘려야 저랭크 물량이 따라온다. 상한을 16 으로 올려 12.8% 로 내렸다.
 *   부대 1~3개는 생성 개수가 5~10건이라 상한에 닿지 않는다 = 기존 밸런스 불변(실측 동일).
 */
/* ★ 목록 길이를 늘렸다 (부대당 2 → 3 · 상한 16 → 20).
 *   §34 에서 **전 도시가 F~S 를 다 내보내게** 되면서 목록에 «그 부대가 못 받는 랭크» 가
 *   섞이기 시작했다. 길이는 그대로인데 쓸 수 있는 칸만 줄어든 셈이라
 *   5부대 유휴율이 20.8% 로 튀었다 (`earlygame` 의 «의뢰공급» 이 잡았다).
 *
 *   ★ 유휴의 원인은 «다른 부대가 먼저 채감» 이 아니라 «받을 수 있는 랭크가 목록에 없음» 이다.
 *     그래서 리롤 주기가 아니라 **길이**를 손댄다. 실측: 20.8% → 8.8%. */
export const QUEST_COUNT_MIN = 4;
export const QUEST_COUNT_MAX = 20;

/**
 * 의뢰 목록 길이를 정할 부대 수를 구한다.
 * 인자로 받으면 그것을 쓰고, 없으면 전역 상태를 본다. 상태가 없으면 1부대로 본다
 * (genQuests 를 node 툴에서 state 없이 부르는 경로가 있다 — balance.mjs / smoke.mjs).
 */
function resolveSquadCount(n) {
  const given = Math.round(Number(n));
  if (Number.isFinite(given) && given > 0) return clamp(given, 1, 8);
  let live = 0;
  try { live = (State.state?.squads || []).length; } catch { live = 0; }
  return clamp(live > 0 ? live : 1, 1, 8);
}

/**
 * 같은 목록 안에서 이름이 겹치지 않는 의뢰 이름을 만든다.
 *
 * 목록이 최대 12건까지 길어지면서 중복이 눈에 띄게 됐다. 이름 조합의 폭은 종류마다 다른데,
 * '토벌'은 `${도시} 인근의 ${적} 소탕` 이라 사실상 **적 이름 하나에만** 의존한다.
 * 한 도시의 적 풀은 3~5종뿐이라 12건을 뽑으면 거의 반드시 겹친다.
 * 그래서 몇 번 실패하면 의뢰 종류까지 다시 굴려 조합 공간 자체를 넓힌다
 * (종류는 어차피 균등 랜덤이라 바꿔도 분포가 틀어지지 않는다).
 * @returns {{type:string, named:object}|null} 끝내 겹치면 null (그 의뢰는 버린다)
 */
function uniqueName(type0, ctx, r, seen) {
  let type = type0;
  let named = makeName(type, ctx, r);
  for (let t = 0; t < 10 && seen.has(named.name); t++) {
    if (t >= 4) type = r.pick(QUEST_TYPES);
    named = makeName(type, ctx, r);
  }
  if (seen.has(named.name)) {
    // 최후의 수단: 장소를 덧붙여 구분한다. `(2)` 같은 번호보다 읽기 낫다.
    const place = placeName(ctx.biome, r);
    named = { ...named, name: `${named.name} — ${place}`, place };
  }
  return seen.has(named.name) ? null : { type, named };
}

/**
 * 도시의 의뢰 목록을 생성한다. 랭크 분포는 도시 tier 기준.
 * 개수는 부대 수에 비례한다 (설계 F): `clamp(3 + 부대수*2 + r.int(0,1), 4, 12)`.
 * @param {string} cityId
 * @param {number} day
 * @param {object} r RNG 인스턴스
 * @param {number} [squadCount] 부대 수. 생략하면 전역 상태에서 읽고, 없으면 1로 본다.
 * @returns {Array} Quest[]
 */
export function genQuests(cityId, day = 1, r = rng, squadCount = null) {
  const city = getCity(cityId);
  if (!city) return [];
  const biome = cityBiome(city);
  const tier = clamp(city.tier || 1, 1, 5);
  // 도시 등급이 곧 난이도 축이다 (설계: HANDOFF §30·§34)
  const cityPower = cityPowerOf(tier);
  const rewardMult = cityPower ** CITY_REWARD_POW;
  const squads = resolveSquadCount(squadCount);
  const count = clamp(3 + squads * 3 + r.int(0, 1), QUEST_COUNT_MIN, QUEST_COUNT_MAX);
  const out = [];
  const seen = new Set();

  for (let i = 0; i < count; i++) {
    const rank = pickRank(tier, r);
    const sub = pickSub(rank, r);            // 서브랭크 -1|0|1 (설계 D)
    const elite = rollElite(rank, sub, r);   // 정예 여부 (설계 E)
    const level = clamp(Math.max(pickLevel(rank, sub, r), cityLevelFloorOf(tier)), 1, MAX_QUEST_LEVEL);
    const id = `q_${cityId}_${day}_${i}`;

    const picked = uniqueName(r.pick(QUEST_TYPES), { city, biome, rank }, r, seen);
    if (!picked) continue;
    const { type, named } = picked;
    seen.add(named.name);

    const ctx = { id, name: named.name, type, cityId, biome, rank, sub, elite, level, cityPower, cityTier: tier };
    const waves = buildWaves(ctx, r);
    if (!waves.length) continue;

    // 소요 일수는 오직 랭크로 정한다 (웨이브 수와 무관).
    // 목록에서 "F는 하루, S는 일주일" 이 한눈에 읽혀야 부대 운용 계획을 세울 수 있다.
    const [dLo, dHi] = RANK_DAYS[rank] || [1, 1];
    const days = clamp(r.int(dLo, dHi), 1, 14);
    out.push({
      id,
      name: named.name,
      type,
      cityId,
      biome,
      scene: named.scene || biome,           // 전투 배경 (적 편성은 biome 이 정한다)
      rank,                                  // F~S 문자 그대로 유지 (기존 분기 코드 호환)
      sub,                                   // -1|0|1
      rankLabel: `${rank}${SUB_LABEL[sub] || ''}`, // 표시용 'E+' 등
      elite,                                 // 정예 의뢰 플래그
      level,
      days,
      waves,
      cityPower,                             // 화면·도구가 «이 도시가 얼마나 험한가» 를 읽는다
      reward: scaleReward(buildReward(rank, level, type, waves.length, r, { sub, elite }), rewardMult),
      desc: makeDesc(type, { foe: named.foe, place: named.place, city, rank, level, sub, elite }),
      expiresDay: day + 3 + r.int(0, 3),
    });
  }

  // 쉬운 의뢰가 위로 오도록 정렬
  out.sort((a, b) => (RANK_IDX[a.rank] - RANK_IDX[b.rank]) || (a.level - b.level));
  return out;
}

/* ------------------------------------------------------------------ 전투 정의 */

function hashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function slotsOf(formationId) {
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
 * `squad.js` 의 squadUnitDefs 는 적용하고 있었지만, 의뢰 전투는 이 파일의
 * allyUnitDefs/enemyUnitDefs 경로를 타기 때문에 그동안 통째로 누락돼 있었다.
 *
 * 반드시 **아군과 적 양쪽 모두** 적용해야 한다. 한쪽만 적용하면 일방적인 버프가 되어
 * 랭크별 난이도 튜닝이 전부 어긋난다.
 */
function withFormation(stats, formationId, slotIndex, unit) {
  try {
    const mods = formationMods(formationId || 'basic', slotIndex, unit);
    return mods ? scaleStats(stats, mods) : stats;
  } catch (e) {
    console.warn('[quest] 진형 효과 계산 실패', e);
    return stats;
  }
}

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
export function allyUnitDefs(st, squad) {
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
    if (m && !isBenched(m, day) && getClass(m.classId)) filled.push({ merc: m, slotIndex: i });
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

/**
 * 보상에 도시 배율을 태운다. 전리품은 **개수가 아니라 ilvl** 을 올린다 —
 * 개수를 늘리면 가방이 터지고, 등급 곡선(gear.js)이 흔들린다.
 */
function scaleReward(rew, mult) {
  if (!rew || !(mult > 0) || Math.abs(mult - 1) < 1e-9) return rew;
  const out = {
    ...rew,
    gold: Math.round((rew.gold || 0) * mult),
    exp: Math.round((rew.exp || 0) * mult),
    renown: rew.renown || 0,               // 명성은 랭크가 정한다 — 도시로 부풀리지 않는다
  };
  if (Array.isArray(rew.itemRolls)) {
    // ilvl 은 레벨 상한을 넘지 않는다. 배율의 √ 만큼만 올린다 (ilvl 은 이미 지수적이다).
    const k = Math.sqrt(mult);
    out.itemRolls = rew.itemRolls.map((roll) => ({
      ...roll,
      ilvl: Math.min(MAX_QUEST_LEVEL, Math.round((roll.ilvl || 1) * k)),
    }));
  }
  return out;
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
