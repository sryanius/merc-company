/**
 * 황금 나락 — 잠수 · 채굴
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 규칙 요약
 *   · 도시 아래 갱도. **주당 1회** 내려간다 (요일은 안 가린다).
 *   · 심층 n 을 지날 때마다 n × 40G 를 캔다. 10심층마다 금고가 있어 3배.
 *   · 입장료도 통행료도 없다 — 여기는 **버는 곳**이다.
 *   · 층 사이에 **체력이 이월된다.** 20심층마다 회복 지점이 있다.
 *   · 장비도 펫도 경험치도 안 나온다. 오직 골드다.
 *
 * ── 왜 소탕이 없나
 * 탑에는 "최고 기록 −100층까지 건너뛰기"가 있다. 저기는 층마다 **골드를 내는** 구조라
 * 건너뛰기가 곧 시간 절약이었다. 여기는 층마다 **버는** 구조라, 건너뛰면 그만큼 못 번다.
 * 매주 1심층부터 다시 내려가는 게 곧 보상이다.
 *
 * ── 왜 전투 화면을 안 쓰나
 * 탑과 같은 이유다. `ui/battle.js` 에는 자동 진행 경로가 **의도적으로 없고**(플레이어와의 계약),
 * `fastForward()` 의 12웨이브 하드 캡 때문에 13층째에 런 전체가 조용히 패배 처리된다.
 * 그래서 헤드리스 시뮬로 돌리고, 보고 싶은 심층만 전투 화면으로 띄운다.
 *
 * ── 아군 편성은 반드시 allyUnitDefs 를 지난다
 * 이 프로젝트는 아군 UnitDef 조립 경로가 갈려서 진형과 세트 효과가 각각 한 번씩
 * 조용히 안 먹은 전례가 있다. 여기서는 **직접 조립하지 않고** `quest.js` 의
 * `allyUnitDefs` 하나만 부른다 (`questBattleDefs` 도, PvP 등록도 같은 함수를 쓴다).
 *
 * ── 심층을 실제로 굴리는 부분은 `game/runverify.js` 에 있다
 * 시드·합성 의뢰·이월 체력·심층 루프는 **서버도 그대로 다시 돌려야** 하므로
 * state 를 안 무는 모듈로 옮겼다. 여기 남은 것은 **상태를 만지는 부분뿐**이다 —
 * 입장 판정 · 골드 지급 · 기록 갱신 · 로그의 사람 이름. (사본을 만들지 않는다: §94)
 *
 * @module game/abyss
 */

import {
  ABYSS_NAME, DEPTH_CAP, depthGold, goldRange, depthPower,
  isRestDepth, isVaultDepth, zoneOf, weekIndex, REST_EVERY, VAULT_EVERY, VAULT_MULT,
} from '../data/abyss.js';
import * as State from './state.js';
import * as Quest from './quest.js';
import * as RV from './runverify.js';

export {
  ABYSS_NAME, DEPTH_CAP, depthGold, goldRange, depthPower, zoneOf,
  isRestDepth, isVaultDepth, REST_EVERY, VAULT_EVERY, VAULT_MULT,
};

/** 심층 시드와 합성 의뢰는 `runverify.js` 한 벌뿐이다 — 여기서는 이름만 다시 내보낸다.
 *  (`st` 는 `.seed`·`.day` 만 읽히므로 서명이 그대로다.) */
export { depthSeed, abyssQuest } from './runverify.js';

/* ─────────────────────────── 입장 판정 ─────────────────────────── */

/** 이번 주에 이미 내려갔는가.
 *  ★ 요일이 아니라 **주 번호**로 센다 — 고정 요일로 하면 그날 부대가 원정 중일 때
 *     한 주치 임금 재원이 통째로 날아간다. */
export function alreadyRanThisWeek(st = State.state) {
  const a = st.abyss;
  if (!a || !a.lastRunDay) return false;
  return weekIndex(a.lastRunDay) === weekIndex(st.day || 1);
}

/**
 * 지금 내려갈 수 있는가.
 * @returns {{ok:boolean, reason:string}}
 */
export function canEnter(st = State.state) {
  if (alreadyRanThisWeek(st)) {
    return { ok: false, reason: `이번 주에는 이미 내려갔다. ${daysUntilEntry(st)}일 뒤 다시 열린다.` };
  }
  return { ok: true, reason: '' };
}

/** 다음 잠수까지 며칠 남았나 (지금 가능하면 0) */
export function daysUntilEntry(st = State.state) {
  if (!alreadyRanThisWeek(st)) return 0;
  const day = st.day || 1;
  const w = weekIndex(day);
  for (let d = 1; d <= 7; d++) if (weekIndex(day + d) !== w) return d;
  return 0;
}

/* ─────────────────────────── 부대 · 편성 ─────────────────────────── */

/** `questBattleDefs` 와 같은 규칙으로 부대를 고른다 (없으면 첫 부대). */
function squadOf(st, squadId) {
  const squad = (squadId ? (st.squads || []).find((s) => s.id === squadId) : null) || (st.squads || [])[0];
  if (!squad) throw new Error('출정할 부대가 없습니다.');
  return squad;
}

/**
 * 심층 전투 설정. 아군은 `allyUnitDefs` 를 그대로 지나므로
 * 진형·장비·세트 고유효과·펫이 전부 실린다.
 *
 * @param {object} opts `{carry: {uid: hp}}` 이월 체력
 */
export function abyssBattleDefs(st, depth, squadId, opts = {}) {
  const squad = squadOf(st, squadId);
  return RV.abyssBattleDefs({
    allies: Quest.allyUnitDefs(st, squad),
    ctx: st,
    squadId,
    depth,
    carry: opts.carry,
    allyFormationId: squad.formationId,
  });
}

/**
 * 한 심층을 치른다. **상태를 바꾸지 않는다** — 골드 지급·기록은 호출자(dive)가 한다.
 * @returns {{win:boolean, depth:number, carry:object, time:number}}
 */
export function runDepth(st, squadId, depth, carry = null) {
  const squad = squadOf(st, squadId);
  return RV.runOneDepth({
    allies: Quest.allyUnitDefs(st, squad),
    ctx: st,
    squadId,
    depth,
    carry,
    allyFormationId: squad.formationId,
  });
}

/* ─────────────────────────── 잠수 ─────────────────────────── */

/**
 * 자동 잠수. 패배할 때까지 한 심층씩 내려간다.
 *
 * @param {object} st
 * @param {string} squadId
 * @param {object} opts `{maxDepth, force, onDepth}`
 * @returns {{ok:boolean, reason:string, reached:number, gold:number, log:Array}}
 */
export function dive(st, squadId, opts = {}) {
  const fail = (reason) => ({ ok: false, reason, reached: 0, gold: 0, log: [] });

  const chk = canEnter(st);
  if (!chk.ok && !opts.force) return fail(chk.reason);

  const sq = (st.squads || []).find((s) => s.id === squadId);
  if (!sq) return fail('부대를 찾을 수 없습니다.');
  if (!(sq.memberUids || []).filter(Boolean).length) return fail('부대에 단원이 없다.');

  const log = [];
  let gold = 0;

  /* ★ 심층 루프 자체는 `runverify.js` 한 벌뿐이다 (서버가 그대로 다시 돌린다).
   *   여기서는 **상태를 만지는 것**만 훅으로 얹는다. */
  const { reached } = RV.runAbyss({
    allies: Quest.allyUnitDefs(st, sq),
    ctx: st,
    squadId,
    maxDepth: opts.maxDepth,
    allyFormationId: sq.formationId,
    log,
    onWin: (d, r, carry) => {
      const g = depthGold(d);
      gold += g;
      if (isVaultDepth(d)) log.push({ type: 'vault', depth: d, gold: g });

      /* 이번 심층에서 쓰러진 단원을 로그에 남긴다.
       * 쓰러진 단원은 다음 회복 지점까지 편성에서 빠지는데, 알려 주지 않으면
       * "사람이 조용히 사라진다"로 읽힌다. */
      const fell = [];
      for (const [uid, hp] of Object.entries(r.carry)) {
        if (hp !== 0) continue;
        if (carry && carry[uid] === 0) continue;          // 앞 심층에서 이미 빠진 사람
        const m = (st.roster || []).find((x) => x && x.uid === uid);
        if (m) fell.push(m.name);
      }
      if (fell.length) log.push({ type: 'fall', depth: d, names: fell });
    },
    after: (d, r) => { if (typeof opts.onDepth === 'function') opts.onDepth(d, r); },
  });

  // ★ 골드는 여기서 **한 번에** 준다. 심층마다 st.gold 를 건드리면
  //   중간에 예외가 나올 때 절반만 지급된 상태가 남는다.
  st.gold = (st.gold || 0) + gold;

  if (!st.abyss) st.abyss = { best: 0, bestDay: 0, lastRunDay: 0, lastRunDepth: 0, lastGold: 0 };
  // ★ bestDay = 기록을 세운 날 (lastRunDay = 마지막 입장일과 다르다). 랭킹 동점 판정용.
  if (reached > (st.abyss.best || 0)) st.abyss.bestDay = st.day || 0;
  st.abyss.best = Math.max(st.abyss.best || 0, reached);
  st.abyss.lastRunDay = st.day || 0;
  st.abyss.lastRunDepth = reached;
  st.abyss.lastGold = gold;

  return { ok: true, reason: '', reached, gold, log };
}
