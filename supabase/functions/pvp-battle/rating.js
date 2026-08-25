/**
 * PvP 승점 계산 — 상대와의 점수차를 반영한다 (Elo)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 고정 점수(+10/-5)를 버렸나 — **실측 때문이다.**
 *
 *   이 게임의 PvP 는 전력 차이에 극단적으로 민감하다 (측정: HANDOFF §73):
 *
 *     전력배율   단판   태그매치
 *      ×0.95      1%       0%
 *      ×0.98     11%       4%
 *      ×1.00     45%      48%
 *      ×1.02     81%      91%
 *      ×1.05    100%     100%
 *
 *   **5% 만 세면 확정 승리다.** 승부가 갈리는 구간이 ±3% 뿐이고, 태그매치는 그걸 더
 *   날카롭게 만든다. 즉 승패는 «누가 더 센가» 로 거의 결정된다.
 *
 *   그 위에 고정 점수를 얹으면 **나보다 조금 약한 상대를 고르는 것이 확정 이득**이 된다.
 *   순위가 실력이 아니라 도전 횟수를 재게 된다. 제작자가 「간과한 게 하나 있다」 며
 *   짚은 것이 정확히 이 지점이다.
 *
 * ★ Elo 는 이 문제를 정확히 겨눈다 — 약한 상대를 이겨도 거의 안 오르고, 지면 크게 잃는다.
 *
 *     점수차        이기면    지면
 *     같음           +16      -16
 *     내가 200 높음   +7.7    -24.3
 *     내가 400 높음   +2.9    -29.1
 *     내가 400 낮음  +29.1     -2.9
 *
 * ★ 도전 프리미엄 — 도전자가 이기면 ×1.25, 지면 ×0.75.
 *   «가만히 있는 것보다 도전하는 게 유리하다» 는 유지하되, 약자 사냥은 여전히 무가치하다
 *   (400 낮은 상대를 이겨도 2.9 × 1.25 ≈ 3.6 뿐이다).
 *
 * ★ 상수를 여기 한 곳에만 둔다 — 서버와 클라가 같은 파일을 본다.
 */

export const BASE_RATING = 1000;
export const RATING_FLOOR = 100;         // db 의 check (rating >= 100) 과 같은 값

/** 한 판의 최대 이동폭. db 트리거가 «한 판에 64 초과 금지» 를 본다 */
export const MAX_STEP = 64;

/** Elo 계수 — 한 판이 움직이는 크기 */
export const K_FACTOR = 32;
/** 기대승률 곡선의 폭. 400 이면 «400 점 차 = 약 91% 기대» */
export const ELO_SCALE = 400;

/** 도전 프리미엄 — 도전자만. 방어자는 그냥 Elo 다 */
export const ATTACK_WIN_MUL = 1.25;
export const ATTACK_LOSS_MUL = 0.75;

/** 내가 이길 기대치 (0~1) */
export function expectedScore(mine, theirs) {
  return 1 / (1 + 10 ** ((theirs - mine) / ELO_SCALE));
}

/**
 * 한 판의 결과로 두 사람의 새 레이팅을 낸다.
 *
 * @param {'attacker'|'defender'|'draw'} winner
 * @param {number} attackerRating
 * @param {number} defenderRating
 */
export function applyRating(winner, attackerRating, defenderRating) {
  const ea = expectedScore(attackerRating, defenderRating);
  const ed = 1 - ea;

  /* 무승부는 0.5 로 친다 — 태그매치에서 양쪽이 동시에 전멸하면 나온다 */
  const sa = winner === 'attacker' ? 1 : winner === 'draw' ? 0.5 : 0;
  const sd = 1 - sa;

  let da = K_FACTOR * (sa - ea);
  const dd = K_FACTOR * (sd - ed);

  /* 도전 프리미엄 — 이겼을 때 더 받고 졌을 때 덜 잃는다 (도전자만) */
  if (da > 0) da *= ATTACK_WIN_MUL;
  else if (da < 0) da *= ATTACK_LOSS_MUL;

  const clampStep = (d) => Math.max(-MAX_STEP, Math.min(MAX_STEP, Math.round(d)));
  const next = (cur, d) => Math.max(RATING_FLOOR, cur + clampStep(d));

  const aAfter = next(attackerRating, da);
  const dAfter = next(defenderRating, dd);
  return {
    /* 바닥(100)에 걸리면 실제 이동폭이 계산값보다 작아진다 — 기록에는 «실제로 움직인 값» 을 남긴다 */
    attackerDelta: aAfter - attackerRating,
    defenderDelta: dAfter - defenderRating,
    attackerAfter: aAfter,
    defenderAfter: dAfter,
  };
}
