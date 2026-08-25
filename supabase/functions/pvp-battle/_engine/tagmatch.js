/**
 * 태그매치 — 부대가 순서대로 이어 싸운다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 제작자 규칙: 「모든 부대가 태그매치로. 다음 웨이브 버튼 이런 거 없어.
 *   서로 1부대 전투하고 **이긴 쪽이 그 전투에서 이어서** 2부대랑 바로 이어서 전투」
 *
 *   A1 vs B1 → A1 이 이기면 **A1 의 생존자가 그대로** B2 와 싸운다.
 *   진 쪽만 다음 부대를 꺼낸다. 한쪽이 부대를 다 쓰면 끝.
 *
 * ★★ 생존자는 **회복하지 않는다.** 이긴 쪽이 다음 판을 반피로 시작하는 것이 이 규칙의 맛이다.
 *   엔진이 이미 받아 준다 — `makeUnit` 이 `def.hp` 가 있으면 그 값으로 시작한다
 *   (`hp: def.hp != null ? clamp(...) : maxHp`). 엔진을 고칠 필요가 없었다.
 *
 * ★★ 시드 — 판마다 다르되 **전체가 하나의 시드에서 결정적으로 갈라져야** 한다.
 *   그래야 서버가 정한 결과를 클라가 같은 시드 하나로 그대로 재생한다.
 *   `seed + round * 0x9E3779B1`(황금비 상수)로 갈라 쓴다. 같은 seed → 항상 같은 전개.
 *
 * ★ 이 모듈은 엔진만 쓴다 — DOM 도, 시각(Date.now)도, 난수(Math.random)도 안 쓴다.
 *   그래야 서버와 클라가 같은 답을 낸다.
 *
 * ★★ **서버와 클라이 이 파일을 같이 쓴다.**
 *   예전엔 서버에만 있었는데, 그러면 클라가 전투를 **재생할 수 없다** —
 *   합마다의 입력(누가 남았고 HP 가 얼마인가)을 여기서만 알 수 있기 때문이다.
 *   `tools/syncshared.mjs` 가 `_engine/` 로 복사하고 어깸리면 smoke 가 막는다.
 *   ★ `./engine.js` 는 **양쪽 모두에서 같은 상대 경로**다 (src/battle/ 와 _engine/).
 *   ★ ENGINE_HASH 에는 **안 넣는다.** 넣으면 지문이 바뀌어
 *     **모든 사람의 등록이 한꺼번에 무효**가 되고, 방어자는 내가 다시 등록해 줄 수도 없다.
 *     지문은 «유닛을 접은 엔진» 을 가리키는 것이지 순서 규칙을 가리키는 게 아니다.
 */
import { createBattle } from './engine.js';

/** 한 판 끝까지 돌린다 (엔진의 고정 스텝) */
function runOne(cfg, getSkill) {
  const b = createBattle({ ...cfg, getSkill, record: false });
  let guard = 0;
  while (!b.finished && guard++ < 20000) b.step(1 / 60);
  return b;
}

/** 살아남은 유닛을 «다음 판의 입력» 으로 접는다 — HP 를 그대로 들고 간다 */
function survivorsOf(b, side, defs) {
  const byUid = new Map((b.units || b.all || []).map((u) => [u.uid, u]));
  const out = [];
  for (const d of defs) {
    const u = byUid.get(d.uid);
    if (!u || u.hp <= 0) continue;
    out.push({ ...d, hp: Math.max(1, Math.round(u.hp)) });
  }
  return out;
}

/**
 * 태그매치를 끝까지 돌린다.
 *
 * @param {object} p
 * @param {Array<Array<object>>} p.attacker  도전자의 부대들 (순서대로)
 * @param {Array<Array<object>>} p.defender  방어자의 부대들 (순서대로)
 * @param {Array<string>} p.attackerFormations 부대별 진형 id
 * @param {Array<string>} p.defenderFormations
 * @param {number} p.seed   서버가 뽑은 시드 하나
 * @param {Function} p.getSkill
 * @returns {{winner:'attacker'|'defender'|'draw', rounds:Array, roundCount:number}}
 */
export function tagMatch({ attacker, defender, attackerFormations = [], defenderFormations = [], seed, getSkill }) {
  let ai = 0;                       // 도전자가 지금 내보낸 부대 번호
  let di = 0;                       // 방어자 쪽
  let aCur = (attacker[0] || []).map((u) => ({ ...u, side: 'ally' }));
  let dCur = (defender[0] || []).map((u) => ({ ...u, side: 'enemy' }));

  const rounds = [];
  let guard = 0;

  while (ai < attacker.length && di < defender.length) {
    if (guard++ > 32) break;        // 부대는 최대 5개씩이다 — 여기 걸리면 논리가 샌 것이다
    if (!aCur.length) { ai++; aCur = (attacker[ai] || []).map((u) => ({ ...u, side: 'ally' })); continue; }
    if (!dCur.length) { di++; dCur = (defender[di] || []).map((u) => ({ ...u, side: 'enemy' })); continue; }

    /* ★ 판마다 시드를 갈라 쓴다 — 하나의 seed 에서 결정적으로 파생된다 */
    const roundSeed = (seed + rounds.length * 0x9E3779B1) >>> 0 || 1;

    const b = runOne({
      allies: aCur,
      enemies: dCur,
      allyFormationId: attackerFormations[ai] || 'basic',
      enemyFormationId: defenderFormations[di] || 'basic',
      seed: roundSeed,
    }, getSkill);

    const aLeft = survivorsOf(b, 'ally', aCur);
    const dLeft = survivorsOf(b, 'enemy', dCur);

    rounds.push({
      seed: roundSeed,
      attackerSquad: ai,
      defenderSquad: di,
      /* ★★ 이 합의 **입력 그대로**. 클라가 이걸 `createBattle` 에 그대로 넣어
       *   화면으로 다시 돌린다 — 생존자 HP 까지 들어 있어야 같은 전개가 나온다.
       * ★ 서버는 응답에 실을 때 이 칸을 **떼고 보낸다** (부대가 cfg 에 이미 있어
       *   그대로 실으면 응답이 합 수만큼 불어난다). 클라는 같은 tagMatch 를 돌려 다시 얻는다. */
      input: {
        allies: aCur,
        enemies: dCur,
        allyFormationId: attackerFormations[ai] || 'basic',
        enemyFormationId: defenderFormations[di] || 'basic',
        seed: roundSeed,
      },
      winner: b.winner === 'ally' ? 'attacker' : b.winner === 'enemy' ? 'defender' : 'draw',
      time: Number((b.time ?? 0).toFixed(3)),
      attackerLeft: aLeft.length,
      defenderLeft: dLeft.length,
    });

    /* ★ 진 쪽만 다음 부대를 꺼낸다. 이긴 쪽은 **생존자 그대로** 이어 싸운다.
     *   무승부(둘 다 전멸)면 양쪽 다 다음 부대로 넘어간다. */
    if (!aLeft.length && !dLeft.length) {
      ai++; di++;
      aCur = (attacker[ai] || []).map((u) => ({ ...u, side: 'ally' }));
      dCur = (defender[di] || []).map((u) => ({ ...u, side: 'enemy' }));
    } else if (!dLeft.length) {
      di++;
      aCur = aLeft;
      dCur = (defender[di] || []).map((u) => ({ ...u, side: 'enemy' }));
    } else if (!aLeft.length) {
      ai++;
      dCur = dLeft;
      aCur = (attacker[ai] || []).map((u) => ({ ...u, side: 'ally' }));
    } else {
      /* 둘 다 살아 있다 = 시간 초과. 엔진이 HP 비율로 이미 우세승을 정했다.
       * ★ 진 쪽을 «전멸한 것으로 친다» — 안 그러면 같은 두 부대가 영원히 다시 붙는다. */
      if (b.winner === 'ally') { di++; aCur = aLeft; dCur = (defender[di] || []).map((u) => ({ ...u, side: 'enemy' })); }
      else if (b.winner === 'enemy') { ai++; dCur = dLeft; aCur = (attacker[ai] || []).map((u) => ({ ...u, side: 'ally' })); }
      else { ai++; di++; aCur = (attacker[ai] || []).map((u) => ({ ...u, side: 'ally' })); dCur = (defender[di] || []).map((u) => ({ ...u, side: 'enemy' })); }
    }
  }

  const aOut = ai >= attacker.length;
  const dOut = di >= defender.length;
  const winner = aOut && dOut ? 'draw' : aOut ? 'defender' : 'attacker';
  return { winner, rounds, roundCount: rounds.length };
}
