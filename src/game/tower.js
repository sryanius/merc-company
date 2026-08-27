/**
 * 무한의 탑 — 등반 · 소탕 · 펫 드랍
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 규칙 요약
 *   · 1~500층. **매달 1일에만** 입장하고, 그날 안에 끝까지 오른다(날짜는 안 넘어간다).
 *   · 층당 비용 = 층수 × 2 골드. 골드가 떨어지면 거기서 멈춘다.
 *   · 한 번 오른 곳은 다음 달에 **최고 기록 −100층**까지 전투 없이 소탕한다(골드는 낸다).
 *   · 층 사이에 **체력이 이월된다.** 25층마다 회복 지점이 있다.
 *   · 각 층 적에 펫이 하나 섞이고, 이기면 아주 낮은 확률로 그 펫을 얻는다.
 *
 * ── 왜 전투 화면을 안 쓰나
 * `ui/battle.js` 에는 자동 진행 경로가 **의도적으로 없다**(플레이어가 요청한 계약).
 * 500층을 그쪽으로 돌리면 최소 500회 클릭이고, `fastForward()` 의 12웨이브 하드 캡 때문에
 * 13층에서 런 전체가 조용히 패배 처리된다.
 * 그래서 여기서 헤드리스 `simulate()` 로 돌리고, 플레이어가 고른 층만 UI 가 전투 화면으로 띄운다.
 *
 * ── 아군 편성은 반드시 allyUnitDefs 를 지난다
 * 이 프로젝트는 아군 UnitDef 조립 경로가 갈려서 진형과 세트 효과가 각각 한 번씩
 * 조용히 안 먹은 전례가 있다. 여기서는 **직접 조립하지 않고** `quest.js` 의
 * `allyUnitDefs` 하나만 부른다 (`questBattleDefs` 도, PvP 등록도 같은 함수를 쓴다).
 * 그래야 진형·장비·세트 고유효과·펫이 전부 한 경로로 들어온다.
 *
 * ── 층을 실제로 굴리는 부분은 `game/runverify.js` 에 있다
 * 시드·합성 의뢰·층의 주인(펫)·이월 체력·등반 루프는 **서버도 그대로 다시 돌려야** 하므로
 * state 를 안 무는 모듈로 옮겼다. 여기 남은 것은 **상태를 만지는 부분뿐**이다 —
 * 입장 판정 · 골드 차감 · 펫 드랍 · 기록 갱신 · 로그의 사람 이름. (사본 금지: §94)
 *
 * @module game/tower
 */

import { RNG } from '../core/rng.js';
import {
  TOWER_FLOORS, floorCost, costRange, sweepLimit, floorPower,
  isRestFloor, dropChance, zoneOf,
} from '../data/tower.js';
import * as State from './state.js';
import * as Quest from './quest.js';
import * as Pet from './pet.js';
import * as RV from './runverify.js';

export { TOWER_FLOORS, floorCost, costRange, sweepLimit, floorPower, zoneOf, isRestFloor };

/** 층 시드·합성 의뢰·층의 주인은 `runverify.js` 한 벌뿐이다 — 이름만 다시 내보낸다.
 *  (`st` 는 `.seed`·`.day` 만 읽히므로 서명이 그대로다.) */
export { floorSeed, towerQuest, floorPet } from './runverify.js';

/* ─────────────────────────── 입장 판정 ─────────────────────────── */

/**
 * 그날이 매달 1일인가.
 *
 * ★ 달력에 `dayOfMonth` 같은 함수가 **없다.** `calendar().dayOfWeek === 1` 로 검사하면
 *   한 달에 4번(1·8·15·22일) 참이 된다 — 실제로 확인한 함정이다.
 *   주(week)까지 같이 봐야 한 달에 한 번이 된다.
 */
export function isEntryDay(st = State.state) {
  const c = State.calendar(st.day || 1);
  return c.week === 1 && c.dayOfWeek === 1;
}

/** 이번 달에 이미 다녀왔는가.
 *  ★ `advanceDays` 에는 월 경계 훅이 없다 — 플래그를 저장하면 영원히 리셋되지 않는다.
 *     그래서 "마지막으로 들어간 날"을 저장하고 날짜로 판정한다. */
export function alreadyRanThisMonth(st = State.state) {
  const last = st.tower?.lastRunDay || 0;
  return last > 0 && last === (st.day || 0);
}

/**
 * 지금 탑에 들어갈 수 있는가.
 * @returns {{ok:boolean, reason:string}}
 */
export function canEnter(st = State.state) {
  if (!isEntryDay(st)) {
    const c = State.calendar(st.day || 1);
    return { ok: false, reason: `탑은 매달 1일에만 열린다. (지금 ${c.month}월 ${c.week}주 ${c.dayOfWeek}일차)` };
  }
  if (alreadyRanThisMonth(st)) return { ok: false, reason: '이번 달에는 이미 다녀왔다. 다음 달 1일에 다시 열린다.' };
  return { ok: true, reason: '' };
}

/** 다음 입장일까지 며칠 남았나 */
export function daysUntilEntry(st = State.state) {
  const day = st.day || 1;
  for (let d = 0; d <= State.DAYS_PER_MONTH; d++) {
    const c = State.calendar(day + d);
    if (c.week === 1 && c.dayOfWeek === 1 && (d > 0 || !alreadyRanThisMonth(st))) return d;
  }
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
 * 층 전투 설정. 아군은 `allyUnitDefs` 를 그대로 지나므로
 * 진형·장비·세트 고유효과·펫이 전부 실린다. 적 쪽에는 «층의 주인»(펫)이 하나 더 선다.
 *
 * @param {object} opts `{carry: {uid: hp}}` 층 이월 체력
 */
export function towerBattleDefs(st, floor, squadId, opts = {}) {
  const squad = squadOf(st, squadId);
  return RV.towerBattleDefs({
    allies: Quest.allyUnitDefs(st, squad),
    ctx: st,
    squadId,
    floor,
    carry: opts.carry,
    allyFormationId: squad.formationId,
  });
}

/**
 * 한 층을 치른다. **상태를 바꾸지 않는다** — 골드 차감·기록은 호출자(climb)가 한다.
 * @returns {{win:boolean, floor:number, carry:object, time:number}}
 */
export function runFloor(st, squadId, floor, carry = null) {
  const squad = squadOf(st, squadId);
  return RV.runOneFloor({
    allies: Quest.allyUnitDefs(st, squad),
    ctx: st,
    squadId,
    floor,
    carry,
    allyFormationId: squad.formationId,
  });
}

/* ─────────────────────────── 등반 ─────────────────────────── */

/**
 * 자동 등반. 골드가 떨어지거나 패배할 때까지 한 층씩 올라간다.
 *
 * @param {object} st
 * @param {string} squadId
 * @param {object} opts `{maxFloors, onFloor}` — onFloor 는 층마다 호출되는 콜백(UI 진행 표시용)
 * @returns {{ok:boolean, reason:string, from:number, reached:number, spent:number, pets:Array, log:Array}}
 */
export function climb(st, squadId, opts = {}) {
  const chk = canEnter(st);
  if (!chk.ok && !opts.force) return { ok: false, reason: chk.reason, from: 0, reached: 0, spent: 0, pets: [], log: [] };

  const sq = (st.squads || []).find((s) => s.id === squadId);
  if (!sq) return { ok: false, reason: '부대를 찾을 수 없습니다.', from: 0, reached: 0, spent: 0, pets: [], log: [] };

  const best = st.tower?.best || 0;
  const sweepTo = sweepLimit(best);
  const maxFloors = opts.maxFloors || TOWER_FLOORS;

  let spent = 0;
  const gotPets = [];
  const log = [];

  /* ── 1) 소탕 구간 — 전투 없이 골드만 낸다.
   *    ★ 전투가 없으므로 **드랍도 없다.** 매달 새로 오른 구간만 벌이가 된다. */
  let floor = 1;
  if (sweepTo >= 1) {
    const cost = costRange(1, sweepTo);
    if (st.gold < cost) {
      return {
        ok: false, reason: `소탕에만 ${cost.toLocaleString()}G 가 필요하다. (보유 ${st.gold.toLocaleString()}G)`,
        from: 1, reached: 0, spent: 0, pets: [], log: [],
      };
    }
    st.gold -= cost;
    spent += cost;
    floor = sweepTo + 1;
    log.push({ type: 'sweep', from: 1, to: sweepTo, cost });
  }

  /* ── 2) 등반 구간 — 여기서부터 실제로 싸운다. 체력은 층을 넘어 이월된다.
   *    ★ 등반 루프 자체는 `runverify.js` 한 벌뿐이다 (서버가 그대로 다시 돌린다).
   *      여기서는 **상태를 만지는 것**만 훅으로 얹는다: 통행료·펫 드랍·쓰러진 사람 이름. */
  const from = floor;

  const { reached } = RV.runTower({
    allies: Quest.allyUnitDefs(st, sq),
    ctx: st,
    squadId,
    startFloor: from,
    maxFloors,
    allyFormationId: sq.formationId,
    log,
    before: (f) => {
      const cost = floorCost(f);
      if (st.gold < cost) {
        log.push({ type: 'broke', floor: f, cost, gold: st.gold });
        return false;
      }
      st.gold -= cost;
      spent += cost;
      return true;
    },
    onWin: (f, r, carry) => {
      /* 이번 층에서 쓰러진 단원을 로그에 남긴다.
       * 쓰러진 단원은 다음 회복 지점까지 편성에서 빠지는데(= 설계), 알려 주지 않으면
       * "사람이 조용히 사라진다"로 읽힌다. 누가 언제 빠졌는지 이름으로 적는다. */
      const fell = [];
      for (const [uid, hp] of Object.entries(r.carry)) {
        if (hp !== 0) continue;
        if (carry && carry[uid] === 0) continue;          // 앞 층에서 이미 빠진 사람
        const m = (st.roster || []).find((x) => x && x.uid === uid);
        fell.push(m ? m.name : (Pet.getPet(st, uid) ? Pet.petLabel(Pet.getPet(st, uid)) : uid));
      }
      if (fell.length) log.push({ type: 'fall', floor: f, names: fell });

      // 펫 드랍 — 층 전용 RNG (globalRng 금지: load() 가 시드를 되감아 리롤이 가능해진다)
      const pp = RV.floorPet(st, f, squadId);
      if (!pp) return;
      const dr = new RNG(RV.floorSeed(st, f, squadId) ^ 0x5bf03635);
      if (!dr.chance(dropChance(f))) return;
      const pet = Pet.makePet(st, pp.sid, pp.grade);
      if (!pet) return;
      if (!Array.isArray(st.pets)) st.pets = [];
      st.pets.push(pet);
      gotPets.push(pet);
      log.push({ type: 'drop', floor: f, pet });
    },
    after: (f, r) => { if (typeof opts.onFloor === 'function') opts.onFloor(f, r); },
  });

  // 기록 갱신
  if (!st.tower) st.tower = { best: 0, bestDay: 0, lastRunDay: 0, lastRunFloor: 0 };
  // ★ bestDay 는 '기록을 세운 날'이다. lastRunDay('마지막 입장일')와 다르다 —
  //   랭킹 동점자를 가를 때 "누가 더 적은 일수로 도달했나"를 이걸로 본다.
  if (reached > (st.tower.best || 0)) st.tower.bestDay = st.day || 0;
  st.tower.best = Math.max(st.tower.best || 0, reached);
  st.tower.lastRunDay = st.day || 0;
  st.tower.lastRunFloor = reached;

  return { ok: true, reason: '', from, reached, spent, pets: gotPets, log };
}

/**
 * 이번 달 등반에 드는 골드를 미리 계산한다 (UI 표시용).
 * @returns {{sweep:number, sweepTo:number, nextFloor:number, nextCost:number}}
 */
export function costPreview(st = State.state) {
  const best = st.tower?.best || 0;
  const sweepTo = sweepLimit(best);
  const sweep = sweepTo >= 1 ? costRange(1, sweepTo) : 0;
  const nextFloor = Math.min(TOWER_FLOORS, sweepTo + 1);
  return { sweep, sweepTo, nextFloor, nextCost: floorCost(nextFloor) };
}
