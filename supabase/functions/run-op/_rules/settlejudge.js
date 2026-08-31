/**
 * 의뢰 정산 판정 — **한 벌만 둔다** (§104 17단계 4번 조각)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ 왜 파일로 떼나. 밴드 계산이 `run-op/index.ts` 안에 **인라인으로** 있었다.
 *   그러면 ① 오프라인으로 굴려 볼 수가 없고 ② 도구가 재려면 사본을 만들게 된다.
 *   이 저장소가 반복해서 겪은 사고가 그것이다 — **사본이 둘이면 반드시 갈라진다**
 *   (§94·§98·§107, 그리고 §124 에서 손으로 옮기다 세 번 틀렸다).
 *   ⇒ 서버도 도구도 **이 파일 하나**를 부른다.
 *
 * ★★ 의존성 0 이다 (import 없음). 그래서 `_rules` 묶음에 넣어도 닫힘이 안 는다.
 *
 * ★★★ **여기서 «거절» 을 만들지 않는다.** 최대가 `flag` 다.
 *   §104 가 못 박았다: 17단계는 «거절 위험 최대» 이고, A등급(거절)을 새로 만들면
 *   정상 플레이어가 통째로 막힌다. 켜는 순서는 «관측 → flag → (한참 뒤) 판정» 이다.
 *
 * ★ 그리고 «못 잰다» 와 «틀렸다» 를 **절대 섞지 않는다.**
 *   시드를 모르거나(이관 전) 목록을 재현 못 하면 `cantJudge` 다 — 그건 흠이 아니다.
 *   실측으로 겪었다: 이관 안 한 계정의 정직한 의뢰가 시드 0 탓에 «보상 불일치» 로
 *   찍혔다 (재생성 82G vs 실제 2,288G). **판정이었으면 그 자리에서 거절했다.**
 *
 * @module game/settlejudge
 */

/** 승리 보상의 실제 폭 — `quest.js questRewards` 가 굴리는 그 값이다.
 *  ★ 여기 숫자를 바꾸지 마라. 저기가 바뀌면 **여기도 같이** 바꿔야 한다
 *    (스모크가 두 곳이 같은지 직접 묻는다). */
export const GOLD_LO = 0.94;
export const GOLD_HI = 1.14;
export const EXP_LO = 0.96;
export const EXP_HI = 1.08;

/** 패배 경험치 = base * (FLOOR + SPAN * progress) — `quest.js` 와 같은 상수다 */
export const LOSS_EXP_FLOOR = 0.17;
export const LOSS_EXP_SPAN = 0.55;
/** progress 가 없던 옛 경로의 몫 */
export const LOSS_EXP_LEGACY = 0.25;

const R2 = (x) => Math.round(Number(x) || 0);
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/**
 * ★★ 밴드는 **정수**로 잰다. 실수 밴드(`G*0.94 <= g`)는 정상 지급을 거절한다 —
 *   실측 0.21~4.6% 가 걸렸다. 지급이 `Math.round` 를 지나기 때문이다.
 *   정수 밴드는 40만 굴림에서 위반 0 이었다.
 * ★ SQL `numeric` 으로 재지 마라 (정확 십진 vs IEEE754 — G 233개가 갈렸다).
 */
const inBand = (paid, base, lo, hi) => paid >= R2(base * lo) && paid <= R2(base * hi);

/**
 * 정산 한 건을 본다.
 *
 * @param {object} o
 * @param {object} o.report 클라가 신고한 것 — `net/settle.js` 가 만드는 모양
 *   (`win`·`progress`·`신고:{gold,exp,renown,itemsN}`·`reward`·`waves`·`waveN`·`questWaveN`)
 * @param {object|null} o.gen 서버가 **재생성한** 그 의뢰 (없으면 «못 잰다»)
 * @returns {{verdict:'ok'|'flag', cantJudge:boolean, reasons:string[], axes:object}}
 */
export function judgeSettle({ report, gen } = {}) {
  const reasons = [];
  const rep = (report && report['신고']) || {};
  const paidGold = R2(rep.gold);
  const paidExp = R2(rep.exp);
  const paidRenown = R2(rep.renown);
  const win = !!(report && report.win);

  /* ── ① 재현이 됐나 ─────────────────────────────────────────────────────
   * ★ 안 됐으면 **아무것도 안 묻는다.** 이관 전 계정이 여기 걸리면 안 된다. */
  if (!gen || !gen.reward) {
    return {
      verdict: 'ok',
      cantJudge: true,
      reasons: ['재현불가'],
      axes: { win, paidGold, paidExp, paidRenown },
    };
  }

  const G = R2(gen.reward.gold);
  const E = R2(gen.reward.exp);
  const R = R2(gen.reward.renown);

  /* ── ② 클라가 «주장한 보상» 이 재생성과 같나 ────────────────────────────
   * ★★ 이것이 이 조각의 본체다. `quest.reward` 는 `run_state.data` — **클라가 쓴
   *   것을 무검증으로 넣는 통** — 에 있다. 저장본과 대조하면 「내가 쓴 값이 내가 쓴
   *   값과 같다」 일 뿐이라, **재생성**과 맞춰야 비로소 «G 가 정직한가» 를 묻는다. */
  const claim = (report && report.reward) || null;
  const claimG = claim ? R2(claim.gold) : null;
  const claimE = claim ? R2(claim.exp) : null;
  const claimR = claim ? R2(claim.renown) : null;
  if (claim) {
    if (claimG !== G) reasons.push('보상G위조');
    if (claimE !== E) reasons.push('보상E위조');
    if (claimR !== R) reasons.push('보상R위조');
  }

  /* ── ③ 실제 지급이 밴드 안인가 — **재생성한 값**을 바닥으로 쓴다 ──────── */
  let goldIn = null;
  let expIn = null;
  let renownEq = null;
  if (win) {
    goldIn = inBand(paidGold, G, GOLD_LO, GOLD_HI);
    expIn = inBand(paidExp, E, EXP_LO, EXP_HI);
    renownEq = paidRenown === R;
    if (!goldIn) reasons.push('골드밴드');
    if (!expIn) reasons.push('경험밴드');
    if (!renownEq) reasons.push('명성불일치');
  } else {
    /* ★ 패배는 **경험치만** 준다 (제작자 결정, §27). 골드·명성·전리품은 0 이다. */
    if (paidGold !== 0) reasons.push('패배골드');
    if (paidRenown !== 0) reasons.push('패배명성');
    if (R2(rep.itemsN) !== 0) reasons.push('패배전리품');
    /* ★★ 경험치는 진행도가 정한다. 그런데 진행도는 **클라가 신고한 값**이라
     *   그것으로 상한을 재면 순환이다 — 그래서 **가능한 최댓값**만 본다.
     *   (progress = 1 일 때가 최대. 옛 경로의 0.25 도 그 아래다.) */
    const maxShare = LOSS_EXP_FLOOR + LOSS_EXP_SPAN;
    if (paidExp > R2(E * maxShare)) reasons.push('패배경험초과');
  }

  /* ── ④ 웨이브 — 신고한 수가 의뢰보다 많을 수는 없다 ──────────────────── */
  const waveN = R2(report && report.waveN);
  const questWaveN = R2(report && report.questWaveN);
  const genWaveN = Array.isArray(gen.waves) ? gen.waves.length : null;
  if (genWaveN != null && questWaveN !== genWaveN) reasons.push('웨이브수위조');
  if (questWaveN > 0 && waveN > questWaveN) reasons.push('웨이브초과');
  /* ★ 이긴 판은 마지막 웨이브까지 갔어야 한다. **후퇴는 이 검사에 안 걸린다** —
   *   후퇴는 `win:false` 이기 때문이다 (ui/battle.js 가 winner 를 enemy 로 합성한다). */
  if (win && questWaveN > 0 && waveN < questWaveN) reasons.push('승리인데중도끝');

  /* ── ⑤ 전리품 개수 — 굴림 수보다 많을 수 없다 ────────────────────────── */
  const rolls = Array.isArray(gen.reward.itemRolls) ? gen.reward.itemRolls.length : null;
  if (win && rolls != null && R2(rep.itemsN) > rolls) reasons.push('전리품초과');

  return {
    /* ★★★ 최대가 flag 다. 여기서 'reject' 를 만들지 마라 — §104 의 계약이다. */
    verdict: reasons.length ? 'flag' : 'ok',
    cantJudge: false,
    reasons,
    axes: {
      win, G, E, R, claimG, claimE, claimR,
      paidGold, paidExp, paidRenown,
      goldIn, expIn, renownEq,
      waveN, questWaveN, genWaveN, rolls, itemsN: R2(rep.itemsN),
      progress: num(report && report.progress),
    },
  };
}
