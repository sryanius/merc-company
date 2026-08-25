/**
 * PvP 승점 계산
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 제작자 결정: 기본 1000 에서 시작. 도전자 승 +10 / 패 -5, 방어자 승 +5 / 패 -5.
 *
 * ★★ 이 표의 성질을 정직하게 적어 둔다 (제작자가 「이러면 좀 더 괜찮으려나」 라고 물었다):
 *   · 도전자 기댓값 = p×10 − (1−p)×5 → **손익분기 승률 33%.**
 *     세 판에 한 판만 이겨도 점수가 오른다. 즉 계속 도전하는 것이 항상 이득이고,
 *     순위가 실력보다 **도전 횟수**를 반영한다. 제동은 골드 30만과 일일 상한뿐이다.
 *   · 도전자가 이기면 판 전체 합이 +5 — 오래 하면 점수가 인플레한다.
 *
 *   이것이 «골드 소모처» 라는 목적에는 맞다. 순위의 의미를 실력 쪽으로 옮기고 싶으면
 *   아래 상수만 바꾸면 된다 (합 0 안: 도전 승 +10/방어 패 -10, 도전 패 -7/방어 승 +7 → 손익분기 41%).
 *
 * ★ 상수를 여기 한 곳에만 둔다 — 서버와 클라가 같은 파일을 본다.
 */

export const BASE_RATING = 1000;
export const RATING_FLOOR = 100;         // db 의 check (rating >= 100) 과 같은 값

/** [도전자, 방어자] 증감 */
export const DELTA = {
  attackerWin: [+10, -5],
  defenderWin: [-5, +5],
  draw: [0, 0],
};

/** db 트리거가 «한 판에 64 초과 이동» 을 막는다 — 여기서 그 한계를 넘지 않는지 스스로 본다 */
export const MAX_STEP = 64;

/**
 * 한 판의 결과로 두 사람의 새 레이팅을 낸다.
 * @param {'attacker'|'defender'|'draw'} winner
 * @param {number} attackerRating
 * @param {number} defenderRating
 */
export function applyRating(winner, attackerRating, defenderRating) {
  const [da, dd] = winner === 'attacker' ? DELTA.attackerWin
    : winner === 'defender' ? DELTA.defenderWin
      : DELTA.draw;

  const clampStep = (d) => Math.max(-MAX_STEP, Math.min(MAX_STEP, d));
  const next = (cur, d) => Math.max(RATING_FLOOR, cur + clampStep(d));

  const aAfter = next(attackerRating, da);
  const dAfter = next(defenderRating, dd);
  return {
    attackerDelta: aAfter - attackerRating,   // 바닥에 걸리면 실제 이동폭이 작아진다
    defenderDelta: dAfter - defenderRating,
    attackerAfter: aAfter,
    defenderAfter: dAfter,
  };
}
