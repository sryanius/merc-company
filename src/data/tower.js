/**
 * 무한의 탑 — 상수와 곡선
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1~500층. **매달 1일에만** 입장하고, 그날 안에 끝까지 오른다(날짜는 안 넘어간다).
 * 층마다 골드를 내고, 골드가 떨어지면 거기서 멈춘다 — 골드 소모 컨텐츠다.
 * 보상은 펫. 각 층의 적으로 펫이 섞여 나오고, 이기면 아주 낮은 확률로 그 펫을 얻는다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★ 왜 층마다 HP 를 이월하는가 (이 설계의 핵심)
 *
 * 이 게임의 난이도 축은 스칼라 `power` **하나뿐**이다. 실측(2,224판)으로 그 축의 해상도는
 *   power 4.70 → 승률 100% / 5.10 → 60% / 5.20 → 36% / 5.90 → 0%
 * 즉 100%→0% 전 구간이 Δ1.2 이고, 의미 있는 밴드(80~20%)는 Δ0.35 밖에 안 된다.
 * 이 축만으로 500층을 펼치면 **440층이 자동승 아니면 자동패**가 되어 층수가 장식이 된다.
 * (게다가 적 레벨은 80에서 하드 클램프되고 적 종류도 tier5 가 상한이라
 *  500층 전부가 같은 적 풀에서 나온다.)
 *
 * 그래서 두 번째 축을 만들었다 — **HP 이월**. 층을 넘어도 체력이 안 채워진다.
 * 한 층의 승률이 90% 여도 50층을 연속으로 버티는 건 다른 문제가 된다.
 * 회복 펫이 가치를 갖는 이유도 여기서 생긴다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★ 왜 전투 화면을 안 쓰는가
 *
 * `ui/battle.js` 에는 자동 진행 경로가 **의도적으로 없다**(5차 세션에 플레이어가 요청한 계약).
 * 500층을 전투 화면으로 돌리면 최소 500회 클릭이고, `fastForward()` 에는 12웨이브 하드 캡이
 * 있어 13층에서 런 전체가 조용히 패배 처리된다.
 * 그래서 탑은 헤드리스 `simulate()` 루프로 돌리고, 플레이어가 고른 층만 전투 화면으로 보여 준다.
 *
 * @module data/tower
 */

/* ─────────────────────────── 규모 ─────────────────────────── */

/** 최고 층 */
export const TOWER_FLOORS = 500;

/**
 * 층당 입장 비용 계수. 비용 = 층수 × 이 값.
 * 1층 2G / 100층 200G / 500층 1,000G, 1~500층 누적 **250,500G**.
 */
export const GOLD_PER_FLOOR = 2;

/** n층 1회 통과 비용 */
export function floorCost(floor) {
  const f = Math.max(1, Math.min(TOWER_FLOORS, Math.round(floor)));
  return f * GOLD_PER_FLOOR;
}

/** a층부터 b층까지 전부 통과하는 비용 (양끝 포함) */
export function costRange(a, b) {
  const lo = Math.max(1, Math.round(a));
  const hi = Math.min(TOWER_FLOORS, Math.round(b));
  if (hi < lo) return 0;
  // 등차수열 합 — 500층까지 루프를 돌 이유가 없다
  return GOLD_PER_FLOOR * ((lo + hi) * (hi - lo + 1)) / 2;
}

/**
 * 소탕 가능 상한. 한 번 오른 곳은 다음 달에 **최고 기록 −100층**까지 그냥 지나간다.
 * 최고 100층 이하면 소탕 구간이 없다(0 반환).
 */
export const SWEEP_BACKOFF = 100;
export function sweepLimit(bestFloor) {
  return Math.max(0, Math.min(TOWER_FLOORS, Math.round(bestFloor || 0)) - SWEEP_BACKOFF);
}

/* ─────────────────────────── 난이도 곡선 ───────────────────────────
 * `power` 는 quest.js 의 적 스탯 배율과 같은 축이다(applyMult 로 hp/atk/def/res/spd 전부에 곱함).
 *
 * 기준점 (실측 기반):
 *   power 2.70 = 던전 1웨이브 수준 — Lv80 7인이 장비 없이도 쉽게 이긴다  → 1층
 *   power 4.70 = 풀세트 Lv80 7인 승률 100%                              → 약 250층
 *   power 5.36 = 던전 10웨이브(풀세트 완주 33%)                          → 약 430층
 *   power 5.90 = 풀세트만으로는 승률 0%                                  → 500층
 *
 * 500층을 5.90 에 두는 건 "한 판만 보면 못 이긴다"는 뜻이 아니다 —
 * 펫 3마리(수호+회복+지휘)가 들어가야 넘어가도록 잡은 값이다.
 * 곡선은 앞이 완만하고 뒤가 가파른 지수형: 초반 100층은 소탕 대상이므로 촘촘할 이유가 없다.
 */

export const POWER_MIN = 2.70;
/**
 * ★ 이 값은 **한 판 승률이 아니라 등반 도달 층으로** 정했다.
 *   층 사이 체력 이월 때문에 "만피로 한 판 이기나"와 "연속으로 몇 층 버티나"가 크게 다르다.
 *   (실측: 풀세트가 400층을 만피로는 100% 이기는데, 실제 등반은 378층에서 멈춘다.)
 *
 *   POWER_MAX 별 등반 도달 층 / 500층 완주율 (Lv80 7인, 6회):
 *     5.8 → 풀세트 485(17%) / 저급펫 493(50%) / 중급 500(100%)
 *     6.2 → 풀세트 464( 0%) / 저급펫 482(17%) / 중급 499(67%) / 고급 500(100%)   ← 채택
 *     6.4 → 풀세트 445( 0%) / 저급펫 472( 0%) / 중급 484(17%)
 *
 *   ★ 6.20 → 7.20 으로 올렸다. 세트 예산 버그를 고치면서(sets.js) 풀세트가 세져
 *     6.20 에서는 풀세트만으로 500층 완주 100% 가 됐다.
 *     재측정(POWER_MAX 7.20): 풀세트 469층·완주 0% / 저급펫 483층·완주 25% /
 *     중급펫 500층·완주 75%. 요구사항이 다시 숫자 그대로 읽힌다.
 *     **sets.js 를 만지면 여기와 dungeon.js WAVE_POWER 를 반드시 같이 재라 — 셋은 한 몸이다.**
 *
 *   참고로 던전의 5.36 과 직접 비교하면 안 된다. 저쪽은 보스 1 + 호위 6 편성이고
 *   탑은 일반 동굴 적 7기라 같은 배율이라도 체감이 다르다.
 */
export const POWER_MAX = 7.20;
/** 곡선 지수. 1이면 선형, 클수록 후반이 가파르다. */
export const POWER_CURVE = 1.85;

/** n층 적 배율 */
export function floorPower(floor) {
  const f = Math.max(1, Math.min(TOWER_FLOORS, Math.round(floor)));
  const t = (f - 1) / (TOWER_FLOORS - 1);          // 0..1
  return POWER_MIN + (POWER_MAX - POWER_MIN) * Math.pow(t, POWER_CURVE);
}

/**
 * n층에서 적으로 세울 수. 층이 오를수록 머릿수도 는다(1~7).
 * power 만으로는 해상도가 모자라서 두는 보조 축이다.
 */
export function floorEnemyCount(floor) {
  const f = Math.max(1, Math.min(TOWER_FLOORS, Math.round(floor)));
  if (f < 20) return 3;
  if (f < 60) return 4;
  if (f < 140) return 5;
  if (f < 260) return 6;
  return 7;
}

/**
 * 층 사이 회복 지점. 이 층을 **클리어한 직후** 부대가 전원 만피로 돌아온다.
 * 이월만 있으면 400층대에서 재도전이 불가능해지므로 숨통을 둔다.
 */
export const REST_EVERY = 25;
export function isRestFloor(floor) {
  return floor > 0 && floor % REST_EVERY === 0;
}

/* ─────────────────────────── 펫 등장/드랍 ───────────────────────────
 * ★ 적 등급 표기(ENEMY_GRADE)는 적 tier 에서만 나오고 층수와 무관하다.
 *   그래서 "층이 오를수록 높은 등급 펫"은 기존 등급 체계를 못 쓰고 이 표가 따로 필요하다.
 */

/**
 * 층 → 펫 종 tier 가중치 [t1,t2,t3,t4,t5].
 * 경계에서 뚝 끊기지 않도록 구간을 겹쳐 뒀다.
 */
const TIER_BANDS = [
  { upTo: 60, w: [100, 0, 0, 0, 0] },
  { upTo: 100, w: [70, 30, 0, 0, 0] },
  { upTo: 160, w: [30, 70, 0, 0, 0] },
  { upTo: 200, w: [10, 60, 30, 0, 0] },
  { upTo: 260, w: [0, 40, 60, 0, 0] },
  { upTo: 320, w: [0, 15, 70, 15, 0] },
  { upTo: 380, w: [0, 0, 45, 55, 0] },
  { upTo: 430, w: [0, 0, 15, 70, 15] },
  { upTo: 470, w: [0, 0, 0, 55, 45] },
  { upTo: 500, w: [0, 0, 0, 25, 75] },
];

/** n층에서 나올 펫 종 tier 가중치 */
export function tierWeights(floor) {
  const f = Math.max(1, Math.min(TOWER_FLOORS, Math.round(floor)));
  for (const b of TIER_BANDS) if (f <= b.upTo) return b.w;
  return TIER_BANDS[TIER_BANDS.length - 1].w;
}

/**
 * 층 → 펫 **등급** 가중치 [F,E,D,C,B,A,S].
 * 낮은 층에서는 S 가 아예 안 나온다 — 1층 반복으로 S 를 캐는 걸 막는다.
 */
const GRADE_BANDS = [
  { upTo: 100, w: [45, 33, 17, 5, 0, 0, 0] },
  { upTo: 200, w: [25, 30, 26, 14, 5, 0, 0] },
  { upTo: 300, w: [10, 22, 28, 24, 13, 3, 0] },
  { upTo: 400, w: [3, 12, 23, 27, 22, 11, 2] },
  { upTo: 460, w: [0, 5, 15, 25, 27, 20, 8] },
  { upTo: 500, w: [0, 0, 8, 18, 27, 30, 17] },
];

/** n층에서 나올 펫 등급 가중치 */
export function gradeWeights(floor) {
  const f = Math.max(1, Math.min(TOWER_FLOORS, Math.round(floor)));
  for (const b of GRADE_BANDS) if (f <= b.upTo) return b.w;
  return GRADE_BANDS[GRADE_BANDS.length - 1].w;
}

/**
 * 펫 획득 확률. "매우 낮은 확률" 요구를 숫자로 옮긴 값.
 * 층이 오를수록 조금 오르지만 상한이 낮다 — 500층을 완주해도 한 런에 몇 마리 수준이다.
 *
 * 실효 기대치: 1~500층 완주 1회에 약 (0.020+0.055)/2 × 500 ≈ **18마리**.
 * 소탕 구간은 전투가 없으므로 드랍도 없다 — 매달 새로 오른 구간만 벌이가 된다.
 */
export const DROP_MIN = 0.020;
export const DROP_MAX = 0.055;
export function dropChance(floor) {
  const f = Math.max(1, Math.min(TOWER_FLOORS, Math.round(floor)));
  const t = (f - 1) / (TOWER_FLOORS - 1);
  return DROP_MIN + (DROP_MAX - DROP_MIN) * t;
}

/** 층 이름표 — 100층 단위로 구역 이름을 붙인다 */
export const ZONES = [
  { upTo: 100, name: '먼지 쌓인 아래층' },
  { upTo: 200, name: '메아리 치는 회랑' },
  { upTo: 300, name: '잿빛 계단참' },
  { upTo: 400, name: '별이 새는 상층' },
  { upTo: 500, name: '탑주의 자리' },
];

export function zoneOf(floor) {
  const f = Math.max(1, Math.min(TOWER_FLOORS, Math.round(floor)));
  for (const z of ZONES) if (f <= z.upTo) return z.name;
  return ZONES[ZONES.length - 1].name;
}
