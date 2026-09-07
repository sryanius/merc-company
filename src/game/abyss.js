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
 * ── 소탕 (§173)
 * 처음엔 소탕을 안 뒀다 — 여기는 층마다 **버는** 구조라 건너뛰면 그만큼 못 벌었다.
 * 제작자가 「이미 등반한 층은 소탕, 아직 못 간 곳은 전투를 보며」 를 요구해 **골드를 주는 소탕**으로 넣었다:
 * 최고 기록까지는 전투 없이 지나되 골드는 그대로 캔다. 그 다음 심층부터 만피로 싸운다.
 * (매주 «기록 + 1» 에서 만피로 서므로 기록이 조금씩 기어오른다 — 벽은 만피 단판 승률이 0 이 되는 심층이다.)
 *
 * ── 두 가지 잠수
 *   · `dive()` — 헤드리스 전체 잠수. 소탕 뒤 남은 심층을 계산으로 끝낸다. 도구·서버 검증이 쓴다.
 *   · 관전 잠수 (`beginLiveRun` → `liveBattleDefs` → `settleLiveDepth` … → `finishLiveRun`) —
 *     소탕 뒤 심층을 **전투 화면에서 한 판씩** 본다. 진행 상태는 `state.abyss.run` 에 남아
 *     화면을 나갔다 와도, 새로고침해도 이어진다. 남은 심층은 `autoFinishLiveRun` 으로 계산 마무리할 수 있다.
 *
 * ── 왜 전투 화면을 «전체 잠수» 에는 안 쓰나
 * `ui/battle.js` 에는 자동 진행 경로가 **의도적으로 없고**(플레이어와의 계약),
 * `fastForward()` 의 12웨이브 하드 캡 때문에 13층째에 런 전체가 조용히 패배 처리된다.
 * 그래서 관전 잠수도 던전처럼 **한 심층 = 전투 한 판** 으로 보내고 돌아와서 정산한다.
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
  ABYSS_NAME, DEPTH_CAP, depthGold, goldRange, depthPower, sweepLimit,
  isRestDepth, isVaultDepth, zoneOf, weekIndex, REST_EVERY, VAULT_EVERY, VAULT_MULT,
  HERO_GATE_DEPTH, HERO_GATE_NEED, heroGateOpen, countAwakenedHeroes,
} from '../data/abyss.js';
import * as State from './state.js';
import * as Quest from './quest.js';
import * as RV from './runverify.js';

export {
  ABYSS_NAME, DEPTH_CAP, depthGold, goldRange, depthPower, zoneOf, sweepLimit,
  isRestDepth, isVaultDepth, REST_EVERY, VAULT_EVERY, VAULT_MULT,
  HERO_GATE_DEPTH, HERO_GATE_NEED, heroGateOpen,
};

/** 이 부대의 각성 영웅 수 (§177 관문 판정 — 편성 경로 그대로 센다) */
export function squadHeroCount(st, squadId) {
  const squad = (st.squads || []).find((s) => s.id === squadId);
  if (!squad) return 0;
  try { return countAwakenedHeroes(Quest.allyUnitDefs(st, squad)); } catch { return 0; }
}

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

  /* ★ §173 소탕 — 최고 기록까지는 전투 없이 지난다. **골드는 그대로 캔다.** 그 다음 심층부터 만피로 싸운다.
   *   `noSweep` 은 계측 도구용 (1심층부터 이월 잠수를 재고 싶을 때). */
  const to = opts.noSweep ? 0 : sweepLimit(st.abyss?.best || 0);
  if (to >= 1) {
    gold += goldRange(to);
    log.push({ type: 'sweep', from: 1, to, gold: goldRange(to) });
  }

  /* ★ 심층 루프 자체는 `runverify.js` 한 벌뿐이다 (서버가 그대로 다시 돌린다).
   *   여기서는 **상태를 만지는 것**만 훅으로 얹는다. */
  const { reached: fought } = RV.runAbyss({
    allies: Quest.allyUnitDefs(st, sq),
    ctx: st,
    squadId,
    startDepth: to + 1,
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
  const reached = Math.max(to, fought);

  // ★ 골드는 여기서 **한 번에** 준다. 심층마다 st.gold 를 건드리면
  //   중간에 예외가 나올 때 절반만 지급된 상태가 남는다.
  st.gold = (st.gold || 0) + gold;

  if (!st.abyss) st.abyss = { best: 0, bestDay: 0, lastRunDay: 0, lastRunDepth: 0, lastGold: 0, run: null };
  // ★ bestDay = 기록을 세운 날 (lastRunDay = 마지막 입장일과 다르다). 랭킹 동점 판정용.
  if (reached > (st.abyss.best || 0)) st.abyss.bestDay = st.day || 0;
  st.abyss.best = Math.max(st.abyss.best || 0, reached);
  st.abyss.lastRunDay = st.day || 0;
  st.abyss.lastRunDepth = reached;
  st.abyss.lastGold = gold;

  return { ok: true, reason: '', reached, gold, log, sweepTo: to };
}

/* ─────────────────────────── 관전 잠수 (§173) ───────────────────────────
 * 소탕 뒤 심층을 **전투 화면에서 한 판씩** 본다. 상태 기계는 `st.abyss.run` 하나다:
 *   { squadId, day, startDepth, depth, reached, carry, gold, log }
 *   · depth   = 다음에 싸울 심층        · reached = 이번 잠수에서 이긴 마지막 심층
 *   · carry   = 이월 체력 (null = 만피)  · gold    = 이번 잠수에서 캔 골드 (소탕 포함, 이미 지급됨)
 * 골드는 심층을 이길 때마다 **바로** 준다 — 화면을 오가며 저장되는 흐름이라 «한 번에» 가 불가능하다.
 * 기록(best)도 이길 때마다 올린다 — 도중에 그만둬도 이긴 만큼은 기록이다.
 */

/** 이번 잠수에서 소탕할 마지막 심층 (= 최고 기록) */
export function sweepDepth(st = State.state) {
  return sweepLimit(st.abyss?.best || 0);
}

/** 진행 중인 관전 잠수 (없으면 null) */
export function liveRun(st = State.state) {
  const r = st.abyss && st.abyss.run;
  return r && typeof r === 'object' && r.squadId ? r : null;
}

/** 주가 바뀌었는데 안 끝난 잠수는 그 자리에서 닫는다 (기록·골드는 이미 반영돼 있다) */
export function closeStaleRun(st = State.state) {
  const run = liveRun(st);
  if (!run) return null;
  if (weekIndex(run.day || 1) === weekIndex(st.day || 1)) return null;
  return finishLiveRun(st, 'stale');
}

/**
 * 관전 잠수 시작 — 소탕(골드 지급)까지 하고 «기록 + 1» 심층 앞에 선다. 이번 주 몫을 여기서 쓴다.
 * @returns {{ok:boolean, reason:string, run?:object, sweepTo?:number, gold?:number, done?:boolean, result?:object}}
 *   기록이 이미 상한이면 `done:true` 와 결과 요약을 돌려주고 런은 열지 않는다.
 */
export function beginLiveRun(st, squadId) {
  const fail = (reason) => ({ ok: false, reason });
  closeStaleRun(st);
  if (liveRun(st)) return fail('진행 중인 잠수가 있다. 먼저 그 잠수를 끝내라.');
  const chk = canEnter(st);
  if (!chk.ok) return fail(chk.reason);
  const sq = (st.squads || []).find((s) => s.id === squadId);
  if (!sq) return fail('부대를 찾을 수 없습니다.');
  if (!(sq.memberUids || []).filter(Boolean).length) return fail('부대에 단원이 없다.');

  const to = sweepDepth(st);
  const log = [];
  let gold = 0;
  if (to >= 1) {
    gold = goldRange(to);
    log.push({ type: 'sweep', from: 1, to, gold });
  }
  st.gold = (st.gold || 0) + gold;

  if (!st.abyss) st.abyss = { best: 0, bestDay: 0, lastRunDay: 0, lastRunDepth: 0, lastGold: 0, run: null };
  st.abyss.lastRunDay = st.day || 0;         // 이번 주 몫을 쓴다
  st.abyss.lastRunDepth = to;
  st.abyss.lastGold = gold;
  st.abyss.run = {
    squadId, day: st.day || 0,
    startDepth: to + 1, depth: to + 1, reached: to,
    carry: null, gold, log,
  };
  if (to >= DEPTH_CAP) {
    // 이미 바닥이다 — 싸울 심층이 없다. 소탕 골드만 받고 끝.
    const result = finishLiveRun(st, 'cap');
    return { ok: true, reason: '', done: true, sweepTo: to, gold, result };
  }
  /* §177 영웅 관문 — 첫 전투 심층부터 문 아래면 각성 영웅이 있어야 한다 */
  if (!heroGateOpen(squadHeroCount(st, squadId), to + 1)) {
    const result = finishLiveRun(st, 'gate');
    return { ok: true, reason: '', done: true, gate: true, sweepTo: to, gold, result };
  }
  return { ok: true, reason: '', run: st.abyss.run, sweepTo: to, gold };
}

/** 지금 싸울 심층의 전투 설정 (이월 체력 반영). 런이 없으면 null. */
export function liveBattleDefs(st = State.state) {
  const run = liveRun(st);
  if (!run) return null;
  return abyssBattleDefs(st, run.depth, run.squadId, { carry: run.carry });
}

/**
 * 전투 화면이 끝낸 한 심층을 정산한다.
 * @param {object} res `{win, finalHp}` — finalHp 는 아군 uid → 남은 체력 (0 = 쓰러짐)
 * @returns {{win:boolean, depth:number, next:number, finished:boolean, gold:number, result?:object}|null}
 */
export function settleLiveDepth(st, res = {}) {
  const run = liveRun(st);
  if (!run) return null;
  const d = run.depth;
  if (!res.win) {
    run.log.push({ type: 'lose', depth: d });
    const result = finishLiveRun(st, 'lose');
    return { win: false, depth: d, next: 0, finished: true, gold: 0, result };
  }

  const g = depthGold(d);
  st.gold = (st.gold || 0) + g;
  run.gold += g;
  if (isVaultDepth(d)) run.log.push({ type: 'vault', depth: d, gold: g });

  /* 이월 체력 — 쓰러진 사람은 0 을 **명시적으로** 남긴다 (runverify.nextCarry 와 같은 규칙:
   * 키가 없으면 다음 심층에 만피로 서고, 0 은 다음 쉼터까지 편성에서 빠진다). */
  const carry = {};
  if (run.carry) for (const [uid, hp] of Object.entries(run.carry)) if (hp === 0) carry[uid] = 0;
  const fell = [];
  for (const [uid, hp] of Object.entries(res.finalHp || {})) {
    const v = Math.max(0, Math.round(Number(hp) || 0));
    carry[uid] = v;
    if (v === 0 && !(run.carry && run.carry[uid] === 0)) {
      const m = (st.roster || []).find((x) => x && x.uid === uid);
      if (m) fell.push(m.name);
    }
  }
  if (fell.length) run.log.push({ type: 'fall', depth: d, names: fell });

  run.reached = d;
  if (d > (st.abyss.best || 0)) { st.abyss.best = d; st.abyss.bestDay = st.day || 0; }
  st.abyss.lastRunDepth = d;
  st.abyss.lastGold = run.gold;

  if (isRestDepth(d)) {
    run.carry = null;
    run.log.push({ type: 'rest', depth: d });
  } else {
    run.carry = carry;
  }
  run.depth = d + 1;
  if (run.depth > DEPTH_CAP) {
    const result = finishLiveRun(st, 'cap');
    return { win: true, depth: d, next: 0, finished: true, gold: g, result };
  }
  /* §177 영웅 관문 — 다음 심층이 문 아래인데 각성 영웅이 없으면 여기서 끝난다 (이긴 만큼은 기록) */
  if (!heroGateOpen(squadHeroCount(st, run.squadId), run.depth)) {
    const result = finishLiveRun(st, 'gate');
    return { win: true, depth: d, next: 0, finished: true, gold: g, gate: true, result };
  }
  return { win: true, depth: d, next: run.depth, finished: false, gold: g };
}

/**
 * 남은 심층을 계산으로 끝낸다 (이월 체력을 이어 받는다). 실력 차가 커서 눈으로 볼 이유가 없을 때.
 * @returns {object|null} 결과 요약 (finishLiveRun 과 같은 꼴)
 */
export function autoFinishLiveRun(st = State.state) {
  const run = liveRun(st);
  if (!run) return null;
  const sq = (st.squads || []).find((s) => s.id === run.squadId);
  if (!sq) return finishLiveRun(st, 'stop');

  let gold = 0;
  const { reached } = RV.runAbyss({
    allies: Quest.allyUnitDefs(st, sq),
    ctx: st,
    squadId: run.squadId,
    startDepth: run.depth,
    carry: run.carry,
    allyFormationId: sq.formationId,
    log: run.log,
    onWin: (d, r, carry) => {
      const g = depthGold(d);
      gold += g;
      if (isVaultDepth(d)) run.log.push({ type: 'vault', depth: d, gold: g });
      const fell = [];
      for (const [uid, hp] of Object.entries(r.carry)) {
        if (hp !== 0) continue;
        if (carry && carry[uid] === 0) continue;
        const m = (st.roster || []).find((x) => x && x.uid === uid);
        if (m) fell.push(m.name);
      }
      if (fell.length) run.log.push({ type: 'fall', depth: d, names: fell });
    },
  });
  st.gold = (st.gold || 0) + gold;
  run.gold += gold;
  if (reached >= run.depth) {
    run.reached = reached;
    if (reached > (st.abyss.best || 0)) { st.abyss.best = reached; st.abyss.bestDay = st.day || 0; }
  }
  run.depth = Math.max(run.depth, reached + 1);
  return finishLiveRun(st, 'auto');
}

/**
 * 관전 잠수를 닫는다. 기록·골드는 이미 반영돼 있으므로 마지막 잠수 값만 적고 run 을 지운다.
 * @param {'lose'|'cap'|'auto'|'stop'|'stale'} reason
 * @returns {{ok:true, reason:'', reached:number, gold:number, log:Array, startDepth:number, squadId:string, live:true, why:string}|null}
 */
export function finishLiveRun(st, reason = 'stop') {
  const run = liveRun(st);
  if (!run) return null;
  if (reason === 'stop' || reason === 'stale') run.log.push({ type: 'stop', depth: run.depth, why: reason });
  if (reason === 'gate') run.log.push({ type: 'gate', depth: run.depth, heroN: squadHeroCount(st, run.squadId) });
  const out = {
    ok: true, reason: '', reached: run.reached, gold: run.gold, log: run.log.slice(),
    startDepth: run.startDepth, squadId: run.squadId, live: true, why: reason,
  };
  st.abyss.lastRunDepth = run.reached;
  st.abyss.lastGold = run.gold;
  st.abyss.run = null;
  return out;
}
