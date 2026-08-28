/**
 * 하루가 지나간다 — 임금 · 회복 · 원정 복귀 · 평판 감쇠
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 `state.js` 에서 떼어 냈나. §104 3단계에서 **서버가 날짜를 소유**하려면
 *   이 계산이 «전역 state 를 되묻지 않고» 돌아야 한다. `state.js` 는 quest·world·
 *   enemies 까지 게임 전체를 물어서 서버 묶음에 못 들어간다 (§108 이 gear·merc·squad
 *   에서 끊어 낸 그 되물기와 같은 문제다).
 *
 * ★ 그래서 이 모듈은 **`state.js` 를 import 하지 않는다.** 규칙 셋:
 *   ① 상태는 **인자로 받는다** (`advanceDays(st, n)`).
 *   ② 부수효과(`addLog` · `touch` · `expireCityLists`)는 **주입받는다** — `bindDay()`.
 *   ③ 여기서 `src/core/util.js` 에 새 헬퍼를 더하지 마라 — **ENGINE_HASH 의 재료**다.
 *
 * ★ `state.js` 가 이 셋을 다시 export 하므로 부르는 쪽(UI 44곳)은 한 줄도 안 바뀐다.
 *
 * @module game/day
 */
import { clamp, num } from './util.js';
/* ★ `merc.js` 는 §108 이후 `state.js` 를 되묻지 않는다 — 그래서 여기서 물어도 안전하다. */
import * as Merc from './merc.js';

/* ── 상수 ────────────────────────────────────────────────────────────────
 * ★ `state.js` 가 그대로 다시 export 한다 — `ui/city.js`·`ui/tavern.js` 가 그 이름으로 읽는다. */

/** 정상 단원 하루 자연 회복 (maxHp 비율) */
export const RECOVER_READY = 0.30;
/** 부상 단원 하루 자연 회복 */
export const RECOVER_WOUNDED = 0.20;
/** 대기(부대 미배치) 단원의 임금 할인 배율 */
export const BENCH_UPKEEP_MULT = 0.25;
/** 평판 감쇠 — 하루 몇씩 */
export const REP_DECAY_PER_DAY = 1;
/** 평판 감쇠 바닥 */
export const REP_DECAY_FLOOR = 50;
/** 이 날짜 안에 그 도시 일을 했으면 봐준다 */
export const REP_DECAY_GRACE = 7;

/* ── 순수 헬퍼 ───────────────────────────────────────────────────────────
 * ★ 둘 다 **상태를 안 본다** — 인자만 본다. 그래서 여기 둔다.
 *   `state.js` 는 `itemsById` 를 다시 export 한다 (quest.js 등이 그 이름으로 읽는다). */

/** 아이템 목록 → uid 색인. 배열처럼도 쓸 수 있게 헬퍼를 달아 둔다. */
export function itemsById(list) {
  const idx = {};
  for (const it of list || []) if (it && it.uid) idx[it.uid] = it;
  const vals = () => Object.values(idx);
  const def = (name, value) => Object.defineProperty(idx, name, { value, enumerable: false });
  def('get', (u) => idx[u] || null);
  def('has', (u) => !!idx[u]);
  def('find', (fn) => vals().find(fn) || null);
  def('filter', (fn) => vals().filter(fn));
  def('map', (fn) => vals().map(fn));
  def('forEach', (fn) => vals().forEach(fn));
  def('values', () => vals());
  def(Symbol.iterator, function* () { yield* vals(); });
  Object.defineProperty(idx, 'size', { get: () => vals().length, enumerable: false });
  return idx;
}

/** 단원의 최대 체력. `mercStats` 가 실패해도 게임이 멈추면 안 된다. */
function maxHpOf(merc, idx) {
  try {
    const st = Merc.mercStats(merc, { items: idx });
    if (st && st.hp > 0) return Math.round(st.hp);
  } catch (e) {
    console.warn('[day] mercStats 실패', e);
  }
  return Math.max(1, Math.round(merc.maxHp || merc.hp || 1));
}

/* ── 주입 ────────────────────────────────────────────────────────────────
 * ★★ §108 의 `ambient.js` 와 **같은 모양**이다. 안 묶으면 조용히 아무 일도 안 하는
 *   대신, 여기서는 **던진다** — 하루가 지나가는데 로그가 안 남고 저장이 안 되면
 *   그건 «조용한 실패» 중에서도 최악이다. */
let _addLog = null;
let _touch = null;
let _expire = null;

/** `state.js` 가 부팅 때 한 번 부른다. */
export function bindDay({ addLog, touch, expireCityLists }) {
  _addLog = typeof addLog === 'function' ? addLog : null;
  _touch = typeof touch === 'function' ? touch : null;
  _expire = typeof expireCityLists === 'function' ? expireCityLists : null;
}

const addLog = (t) => { if (!_addLog) throw new Error('day.js 가 안 묶였다 — bindDay 를 부르지 않았다'); return _addLog(t); };
const touch = () => { if (_touch) _touch(); };
const expireCityLists = () => { if (_expire) _expire(); };

/**
 * ★★★ **반올림은 «합계 1회» 다** — 제작자 결정 (2026-08-28).
 *
 *   두 벌이 있었다:
 *     ① 합계 1회 — `round(Σ (배치 ? base : base×0.25))`   ← **이것이 정답이다**
 *     ② 인당     — `Σ round(base × mult)`                 (개별 표시가 쓰던 것)
 *   차이 실측: 대기 10명 2G · 35명 9G · 70명 17G/일.
 *   랴니(명부 42 · 배치 35)에서 **13,805 vs 13,807**.
 *
 *   ①을 고른 이유: **지금 실제로 차감되는 값**이라 아무도 손해를 안 본다.
 *   ②로 바꿨으면 대기 인원이 많은 계정이 하루 최대 17G 를 더 냈을 것이다.
 *   개별 표시(`upkeepOfMerc`)는 «참고» 라 그 오차를 감수한다.
 *
 * ★ 서버가 이 값을 소유해도 안전하다 — `class_id·grade·level` 만 보고 다시 계산해도
 *   **차이 0** 이다 (랴니 42명 실측, 캐시와 공식이 어긋난 단원 **0명**).
 */
/**
 * 하루 총임금. **이 함수가 유일한 출처다** — 실제 차감(advanceDays)과 화면 표시가
 * 서로 다른 식을 쓰면 "표시는 1만인데 2만이 빠지는" 버그가 된다.
 * 합산 지점이 6곳이나 흩어져 있었으므로 전부 여기를 부르게 했다.
 */
export function dailyUpkeep(st) {
  const assigned = new Set();
  for (const sq of st.squads || []) {
    for (const u of sq.memberUids || []) if (u) assigned.add(u);
  }
  let total = 0;
  for (const m of st.roster || []) {
    if (!m) continue;
    const base = m.upkeep || 0;
    total += assigned.has(m.uid) ? base : base * BENCH_UPKEEP_MULT;
  }
  return Math.round(total);
}

/** 한 단원이 실제로 내는 하루 임금 (대기면 할인 적용). 개별 표시용. */
export function upkeepOfMerc(m, st) {
  if (!m) return 0;
  const base = m.upkeep || 0;
  for (const sq of st.squads || []) {
    if ((sq.memberUids || []).includes(m.uid)) return base;
  }
  return Math.round(base * BENCH_UPKEEP_MULT);
}

/**
 * n일 진행. 매일 임금 지출 / 부상 회복 / **원정 부대 복귀** / 도시 목록 만료를 처리한다.
 *
 * ※ 의뢰를 끝냈다고 여기가 자동으로 불리지는 않는다. 날짜는 플레이어가 직접 넘긴다
 *   (도시 화면의 "하루 넘기기" 등). 의뢰는 부대를 `away` 로 잠글 뿐이다.
 *
 * @returns {{days:number, upkeep:number, unpaid:number, recovered:string[], returned:string[]}}
 *  - `returned` 이번 진행에서 원정을 마치고 복귀한 부대 이름들
 */
export function advanceDays(st, n = 1) {
  const days = Math.max(1, Math.round(n || 1));
  const out = { days: 0, upkeep: 0, unpaid: 0, recovered: [], returned: [] };

  for (let d = 0; d < days; d++) {
    st.day++;
    out.days++;

    // 원정 복귀 — 임금/회복보다 먼저 처리해 복귀 당일부터 다시 출정할 수 있게 한다.
    for (const sq of st.squads) {
      if (!sq || sq.status !== 'away') continue;
      if (st.day < (sq.returnDay || 0)) continue;
      sq.status = 'idle';
      sq.returnDay = 0;
      out.returned.push(sq.name);
      addLog(`${sq.name}이(가) 원정에서 복귀했다.`);
    }

    /* 평판 감쇠 — 하루 1씩, 바닥(REP_DECAY_FLOOR)까지.
     * ★ 도시가 16곳이라 전부 만점으로 유지하는 건 불가능하다 — 그게 목적이다.
     *   «어느 도시를 거점으로 삼을까» 라는 선택이 생긴다.
     *
     * ★★ 옛 주석은 「**지금 있는 도시만** 빼고」 였다 — **거짓이다.**
     *   이 코드는 `st.cityId` 를 **안 본다.** 봐주는 기준은 `repTouch`,
     *   즉 «최근에 그 도시 **일을 했나**» 다 (아래 `REP_DECAY_GRACE`).
     *   서 있기만 해서는 안 봐준다. 주석을 따라 옮기면 잘못 구현한다. */
    if (REP_DECAY_PER_DAY > 0 && st.reputation) {
      const touch = st.repTouch && typeof st.repTouch === 'object' ? st.repTouch : {};
      for (const cid of Object.keys(st.reputation)) {
        const v = Number(st.reputation[cid]);
        if (!Number.isFinite(v) || v <= REP_DECAY_FLOOR) continue;
        // 최근에 그 도시 일을 했으면 봐준다 — «서 있는 것» 이 아니라 «일한 것» 이 기준이다
        const last = Number(touch[cid]) || 0;
        if (last > 0 && st.day - last < REP_DECAY_GRACE) continue;
        st.reputation[cid] = Math.max(REP_DECAY_FLOOR, v - REP_DECAY_PER_DAY);
      }
    }

    // 임금
    const due = dailyUpkeep(st);
    if (due > 0) {
      if (st.gold >= due) {
        st.gold -= due;
        out.upkeep += due;
      } else {
        const short = due - st.gold;
        out.upkeep += st.gold;
        out.unpaid += short;
        st.gold = 0;
        const loss = Math.max(1, Math.ceil(short / 60));
        st.renown = Math.max(0, st.renown - loss);
        addLog(`임금 ${num(short)}G가 밀렸다. 단원들의 불만이 커진다. (명성 -${loss})`);
      }
    }

    // 부상 회복 / 자연 회복
    const idx = itemsById(st.items);
    for (const m of st.roster) {
      const maxHp = maxHpOf(m, idx);
      m.maxHp = maxHp;
      if (m.status === 'wounded') {
        if (st.day >= (m.woundUntil || 0)) {
          m.status = 'ready';
          m.woundUntil = 0;
          m.hp = maxHp;
          out.recovered.push(m.name);
          addLog(`${m.name}이(가) 부상에서 회복했다.`);
        } else {
          m.hp = clamp(Math.round((m.hp || 1) + maxHp * RECOVER_WOUNDED), 1, maxHp);
        }
      } else {
        m.hp = clamp(Math.round((m.hp || maxHp) + maxHp * RECOVER_READY), 1, maxHp);
      }
    }

    expireCityLists();
  }

  if (out.upkeep > 0) addLog(`${out.days}일이 지났다. 임금으로 ${num(out.upkeep)}G를 지출했다.`);
  touch();
  return out;
}
