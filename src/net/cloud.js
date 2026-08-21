/**
 * 클라우드 저장 — 켜기/끄기 · 업로드 큐
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ **기본은 꺼짐이다.** 게임을 켜자마자 계정을 만들지 않는다.
 *   · 켜는 순간 **구글 로그인 화면으로 넘어간다.** 게임을 켜자마자 그러면 안 된다.
 *   · 로그인은 플레이어가 원할 때 하는 것이다. 랭킹에 관심 없는 사람은 끝까지 안 해도 된다.
 *
 * ★ 이 값은 **세이브가 아니라 기기 설정이다.** localStorage 에 따로 둔다 —
 *   세이브에 넣으면 파일을 주고받을 때 남의 기기 설정까지 따라간다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★ 업로드 설계에서 지키는 것 셋
 *
 * 1. **`save()` 를 절대 막지 않는다.** 훅은 타이머만 걸고 즉시 돌아온다.
 *    실측상 `save()` 는 시간당 수백 번 불린다 — 매번 네트워크를 타면 안 되고,
 *    네트워크가 죽었다고 로컬 저장이 실패해서도 안 된다.
 *
 * 2. **항상 마지막 상태 하나만 보낸다.** 디바운스 동안 백 번 저장돼도 올라가는 건
 *    한 번이다. 본문은 큐에 담지 않고 **올릴 때 localStorage 에서 다시 읽는다** —
 *    큐에 담아 두면 그 사이 진행된 내용이 낡은 채로 올라간다.
 *
 * 3. **실패해도 조용히 재시도한다.** 화면에 오류를 띄우지 않는다.
 *    비행기 모드로 한 시간 놀다 와도 플레이어는 아무것도 몰라야 하고,
 *    돌아오면 알아서 올라가 있어야 한다.
 *
 * @module net/cloud
 */

import {
  ENABLED, EP, OUTBOX_KEY, PUSH_DEBOUNCE_MS, PUSH_MAX_WAIT_MS, RETRY_MS,
} from './config.js';
import * as Auth from './auth.js';
import { authed, call } from './rest.js';
import { SAVE_KEY, onSaved, state } from '../game/state.js';
import { extractScore } from '../game/rules.js';
import { stampSquadPower } from '../game/squad.js';

/* ★ 예전의 켜기/끄기 스위치(`merc_cloud_on_v1`)는 없앴다.
 *   로그인했으면 켜진 것이고 아니면 안 켜진 것이다 — 상태를 두 군데서 관리하면
 *   "켜졌는데 로그인은 안 된" 같은 조합이 생긴다. */
/** 서버 세이브를 적용하기 직전의 로컬 원본. 되돌릴 유일한 수단이라 반드시 남긴다. */
const ROLLBACK_KEY = 'merc_cloud_rollback_v1';
/**
 * 마지막으로 **서버가 받아 준** {seed, rev}.
 *
 * ★ 메모리(`last`)만으로는 안 된다. 새로고침하면 초기화되어 콜드 스타트마다
 *   서버와 같은 rev 를 다시 올리고 P0001 을 맞는다 — 그러면 "서버에 더 최신 세이브가
 *   있다"는 **거짓 정체**가 눌러붙는다.
 * ★ seed 를 함께 보는 것이 핵심이다. 새 게임은 rev 가 1로 리셋되므로 rev 만 보면
 *   새 플레이스루가 영영 안 올라간다.
 */
const SYNCED_KEY = 'merc_cloud_synced_v1';
/**
 * 마지막으로 **서버가 받아 준** 랭킹 값 `{seed, abyss, tower, quests}`.
 * ★ 기록이 실제로 올랐을 때만 제출하려고 둔다. 저장할 때마다 부르면
 *   함수 호출이 시간당 수백 번이 되는데, 탑은 월 1회·나락은 주 1회라
 *   기록이 오르는 일 자체가 드물다.
 */
const SUBMITTED_KEY = 'merc_cloud_submitted_v1';
/** 로그인하러 떠난 상태 — 돌아왔을 때 자동으로 켤지 판단한다 */
const PENDING_LOGIN_KEY = 'merc_cloud_pending_login_v1';

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
const readLS = (k) => { try { return storage()?.getItem(k) ?? null; } catch { return null; } };
const writeLS = (k, v) => {
  try {
    if (v == null) storage()?.removeItem(k);
    else storage()?.setItem(k, v);
  } catch (e) { console.warn('[cloud] 저장 실패', e); }
};

/* ─────────────────────────── 켜기/끄기 ─────────────────────────── */

/**
 * 클라우드가 켜져 있는가.
 *
 * ★ 이제 **끄는 스위치가 없다.** 로그인만 하면 항상 켜진 것으로 본다 (제작자 결정).
 *   그렇다고 로그인을 강제하지는 않는다 — 강제하면 오프라인에서 게임이 아예 안 뜨고,
 *   TWA 앱·iOS PWA 의 오프라인 동작이 이 게임의 장점이라 그걸 버릴 수 없다.
 *   로그인 안 한 사람은 예전처럼 localStorage 로 돌아간다.
 */
export function isOn() {
  if (!ENABLED) return false;
  return Auth.signedIn();
}

/** 이 기기에서 클라우드를 쓸 수 있는 상태인가 */
export function ready() { return isOn() && Auth.signedIn(); }

/**
 * 켠다.
 *
 * ★ 이미 로그인돼 있으면 바로 켜진다. 아니면 **구글 로그인으로 넘어간다** —
 *   이 경우 페이지를 떠나므로 이 함수는 돌아오지 않는다.
 *   돌아온 뒤 `finishLogin()` 이 이어받는다.
 */
export async function enable(opt = {}) {
  if (!ENABLED) return { ok: false, error: '클라우드 기능이 꺼져 있다' };
  if (Auth.signedIn() && !opt.switchAccount) {
    queuePush({ now: true });
    return { ok: true, error: '' };
  }
  /* 계정 전환이면 지금 세션을 먼저 버린다 — 안 그러면 돌아왔을 때 옛 세션이 남아
   * 어느 쪽이 진짜인지 헷갈린다. 구글 쪽에서도 계정 고르는 화면을 띄우게 한다. */
  if (opt.switchAccount) Auth.signOut();
  writeLS(PENDING_LOGIN_KEY, '1');
  return Auth.signInWithGoogle({ selectAccount: !!opt.switchAccount });
}

/** 로그아웃. 세이브는 이 기기에 그대로 남는다. */
export function signOut() {
  Auth.signOut();
  cancelTimers();
  writeOutbox(null);
  writeLS(SYNCED_KEY, null);
  writeLS(SUBMITTED_KEY, null);
  last = { at: 0, ok: false, error: '', rev: 0, seed: 0 };
}

/**
 * 로그인에서 돌아왔을 때 부팅이 부른다.
 * @returns {Promise<{handled:boolean, ok:boolean, error:string}>}
 */
export async function finishLogin() {
  const r = await Auth.completeOAuth();
  if (!r.handled) return { handled: false, ok: false, error: '' };
  writeLS(PENDING_LOGIN_KEY, null);
  if (!r.ok) return { handled: true, ok: false, error: r.error };
  /* 계정이 바뀌었을 수 있다 — 앞 계정의 동기화 지점을 그대로 두면
   * 새 계정에 "이미 올렸다"고 착각해 첫 업로드를 건너뛴다. */
  writeLS(SYNCED_KEY, null);
  writeLS(SUBMITTED_KEY, null);
  writeOutbox(null);
  last = { at: 0, ok: false, error: '', rev: 0, seed: 0 };
  queuePush({ now: true });
  return { handled: true, ok: true, error: '' };
}



/* ─────────────────────────── 업로드 큐 ───────────────────────────
 * 아웃박스에는 **본문을 안 담는다.** `{rev, tries, nextAt, stalled}` 만 담고
 * 올릴 때 localStorage 의 세이브를 다시 읽는다. 본문을 담으면
 * (1) 세이브가 두 벌이 되어 용량이 두 배고 (2) 그 사이 진행분이 낡은 채로 올라간다.
 */

/** @typedef {{rev:number, tries:number, nextAt:number, stalled:string}} Outbox */

let debounceT = 0;
let maxWaitT = 0;
let retryT = 0;
let inFlight = false;
/** 마지막 결과 — 화면 표시용 */
let last = { at: 0, ok: false, error: '', rev: 0, seed: 0 };

function readOutbox() {
  try {
    const o = JSON.parse(readLS(OUTBOX_KEY) || 'null');
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}
const writeOutbox = (o) => writeLS(OUTBOX_KEY, o ? JSON.stringify(o) : null);

function readSynced() {
  try {
    const o = JSON.parse(readLS(SYNCED_KEY) || 'null');
    return o && typeof o === 'object' ? { seed: Number(o.seed) || 0, rev: Number(o.rev) || 0 } : null;
  } catch { return null; }
}
const writeSynced = (v) => writeLS(SYNCED_KEY, v ? JSON.stringify(v) : null);

/**
 * 실패한 업로드의 재시도를 예약한다.
 * ★ 예약은 **여기서만** 한다. 흩어 놓으면 `nextAt: 0` 같은 구멍이 생기고
 *   (실제로 seed 확인 실패 경로에 그런 구멍을 냈다) 백오프가 통째로 무력해진다.
 */
function scheduleRetry(prevTries, rev, error) {
  const tries = (prevTries || 0) + 1;
  const wait = RETRY_MS[Math.min(tries - 1, RETRY_MS.length - 1)];
  writeOutbox({ rev, tries, nextAt: Date.now() + wait, stalled: '' });
  last = { at: Date.now(), ok: false, error, rev, seed: 0 };
  clearTimeout(retryT);
  retryT = setTimeout(flush, wait);
}

function cancelTimers() {
  clearTimeout(debounceT); debounceT = 0;
  clearTimeout(maxWaitT); maxWaitT = 0;
  clearTimeout(retryT); retryT = 0;
}

/** 시각을 ISO 로. 범위를 벗어난 값이면 지금 시각으로 대체한다 (예외를 던지지 않는다) */
function safeIso(ms) {
  const n = Number(ms);
  const d = new Date(Number.isFinite(n) && n > 0 ? n : Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** 지금 로컬에 있는 세이브를 그대로 읽는다 (파싱은 메타만 쓰려고 한 번) */
function currentSave() {
  const raw = readLS(SAVE_KEY);
  if (!raw) return null;
  let meta = null;
  try { meta = JSON.parse(raw); } catch { return null; }
  if (!meta || typeof meta !== 'object') return null;
  return {
    raw,
    seed: Number(meta.seed) || 0,
    rev: Number(meta.rev) || 0,
    day: Number(meta.day) || 1,
    savedAt: Number(meta.savedAt) || Date.now(),
  };
}

/**
 * 업로드를 예약한다. `save()` 훅이 부르므로 **즉시 돌아와야 한다.**
 * @param {{now?:boolean}} [opt] now 면 디바운스를 건너뛴다
 */
export function queuePush(opt = {}) {
  if (!ready()) return;
  if (opt.now) { cancelTimers(); flush({ force: true }); return; }

  clearTimeout(debounceT);
  debounceT = setTimeout(flush, PUSH_DEBOUNCE_MS);
  // 계속 바쁘면 디바운스가 영원히 밀린다 — 상한을 하나 더 건다
  if (!maxWaitT) maxWaitT = setTimeout(flush, PUSH_MAX_WAIT_MS);
}

/**
 * 실제 업로드. 겹쳐 불려도 한 번만 돈다.
 * @param {{force?:boolean}} [opt] force 면 백오프 대기를 무시한다 (사람이 직접 누른 경우)
 */
async function flush(opt = {}) {
  cancelTimers();
  if (inFlight || !ready()) return;

  const cur = currentSave();
  if (!cur || !cur.rev) return;              // 저장된 게 없다

  const box = readOutbox();

  /* ★ 백오프를 **여기서** 지킨다.
   *   예전에는 `nextAt` 을 쓰기만 하고 아무도 안 읽어서 지수 백오프가 장식이었다:
   *   · `flush()` 첫 줄의 cancelTimers() 가 예약된 재시도 타이머를 지운다
   *   · 그 뒤 아무 저장이나 한 번 일어나면 20초 뒤 flush 가 돌아 30분 백오프를 건너뛴다
   *   · `retryPending()` 은 아예 1.5초로 덮어썼다
   *   호출 경로가 셋이라 각각 고치면 또 새는 곳이 생긴다 — 관문을 하나로 모은다.
   *   실패가 반복될 때 후반 세이브(수백 KB)를 20초마다 올리면 대역폭만 태운다. */
  if (!opt.force && box && box.nextAt > Date.now()) {
    clearTimeout(retryT);
    retryT = setTimeout(flush, box.nextAt - Date.now());
    return;
  }

  if (box && box.stalled && box.rev >= cur.rev) return;
  /* 이미 서버가 받아 준 것과 같은 판·같은 rev 면 보낼 이유가 없다.
   * ★ seed 를 반드시 함께 본다 — 새 게임은 rev 가 1로 리셋되므로 rev 만 보면
   *   새 플레이스루의 첫 업로드가 조용히 막힌다. */
  const done = readSynced();
  if (done && done.seed === cur.seed && done.rev >= cur.rev) return;

  inFlight = true;
  try {
    /* ★ 다른 플레이스루를 조용히 덮지 않는다.
     *   서버 트리거(saves_guard)는 seed 가 다르면 rev 검사를 **건너뛴다** —
     *   그래서 새 게임(rev 1, 1일차)이 120일차 세이브를 그냥 덮어 버린다.
     *   실제로 재현된 경로다. 서버는 어느 판을 원하는지 모르니 여기서 막는 수밖에 없다. */
    if (!done || done.seed !== cur.seed) {
      const chk = await remoteMeta();
      if (!chk.ok) {                       // 확인을 못 했으면 올리지 않는다 (안전 우선)
        scheduleRetry(box?.tries, cur.rev, chk.error);
        return;
      }
      if (chk.meta && chk.meta.seed !== cur.seed) {
        last = { at: Date.now(), ok: false, error: '서버에 다른 용병단이 있다', rev: cur.rev, seed: cur.seed };
        // ★ tries 를 0 으로 되돌리지 않는다 — 정체가 풀린 뒤 다시 실패하면
        //   백오프가 처음부터 다시 시작해 짧은 간격으로 재시도한다.
        writeOutbox({ rev: cur.rev, tries: box?.tries || 0, nextAt: 0, stalled: 'other-run' });
        return;                            // 사람이 고를 때까지 멈춘다
      }
    }
    const res = await authed(EP.saves, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: {
        user_id: Auth.userId(),
        seed: cur.seed,
        rev: cur.rev,
        // ★ 기기 시계가 이상하면 new Date(...).toISOString() 이 **예외를 던진다**
        //   (RangeError). 그러면 업로드가 아니라 flush 자체가 터져 큐가 멎는다.
        saved_at: safeIso(cur.savedAt),
        day: cur.day,
        payload: cur.raw,
      },
    }, Auth);

    if (res.ok) {
      last = { at: Date.now(), ok: true, error: '', rev: cur.rev, seed: cur.seed };
      writeOutbox(null);
      writeSynced({ seed: cur.seed, rev: cur.rev });
      return;
    }

    /* ★ 되감기 거절은 **재시도하면 안 된다.**
     *   서버에 더 최신 세이브가 있다는 뜻이라, 몇 번을 보내도 같은 답이 온다.
     *   이건 네트워크 문제가 아니라 "다른 기기에서 더 진행했다" 는 신호다 —
     *   S7(복원)이 처리할 일이므로 표시만 남기고 큐를 멈춘다. */
    if (/오래된 세이브/.test(res.error) || res.data?.code === 'P0001') {
      last = { at: Date.now(), ok: false, error: '서버에 더 최신 세이브가 있다', rev: cur.rev, seed: cur.seed };
      writeOutbox({ rev: cur.rev, tries: box?.tries || 0, nextAt: 0, stalled: 'newer-on-server' });
      return;
    }

    // 그 밖의 실패 — 조용히 백오프 재시도. 화면에는 아무것도 안 띄운다.
    scheduleRetry(box?.tries, cur.rev, res.error);
  } finally {
    inFlight = false;
  }
}

/** 지금 당장 올린다 (화면의 "지금 올리기" 버튼용) */
export async function pushNow() {
  if (!ready()) return { ok: false, error: '클라우드가 꺼져 있다' };
  writeOutbox(null);                         // 백오프·정체 표시를 지우고 새로 시도
  last = { at: 0, ok: false, error: '', rev: 0, seed: 0 };
  await flush({ force: true });              // 사람이 직접 눌렀다 — 기다리게 하지 않는다
  return { ok: last.ok, error: last.error };
}

/* ─────────────────────────── 수명주기 ─────────────────────────── */

let inited = false;

/**
 * 앱 부팅 때 한 번 부른다.
 * 저장 훅을 꽂고, 밀려 있던 업로드가 있으면 이어서 시도한다.
 */
export function init() {
  if (inited || !ENABLED) return;
  inited = true;

  // ★ 훅은 항상 꽂는다. 안에서 ready() 를 보므로 꺼져 있으면 아무 일도 안 한다.
  //   켤 때마다 훅을 꽂았다 빼면 "켰는데 첫 저장이 안 올라가는" 구멍이 생긴다.
  onSaved(() => {
    try { queuePush(); } catch (e) { console.warn('[cloud] 예약 실패', e); }
    /* 기록이 올랐을 때만 랭킹을 제출한다. worthSubmitting 이 아니면 즉시 돌아온다 —
     * 저장은 시간당 수백 번인데 기록이 오르는 건 주에 한 번 수준이다. */
    try { submitScore().catch(() => {}); } catch (e) { /* 게임을 방해하지 않는다 */ }
  });

  if (typeof document !== 'undefined') {
    /* 앱이 뒤로 갔다 돌아왔을 때 밀린 걸 올린다.
     * ★ 나갈 때(hidden) 올리려 하지 않는다 — `sendBeacon`/`keepalive` 는 본문 64KB 상한이라
     *   후반 세이브가 안 들어가고, 모바일에서 스와이프로 종료하면 이벤트가 아예 안 온다.
     *   로컬 저장은 이미 동기로 끝나 있으니 잃는 건 없다. */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retryPending();
    });
    window.addEventListener('online', retryPending);
  }
  retryPending();
}

/** 밀려 있던 업로드가 있으면 지금 시도한다 */
function retryPending() {
  if (!ready()) return;
  const box = readOutbox();
  if (box && box.stalled) return;            // 사람이 골라야 풀리는 정체다

  /* ★ 백오프를 덮지 않는다. 여기서 무조건 1.5초로 잡으면 앱을 앞뒤로 옮길 때마다
   *   30분 백오프가 1.5초로 리셋된다 (실제로 그랬다). */
  const wait = box && box.nextAt > Date.now() ? box.nextAt - Date.now() : 1500;
  clearTimeout(retryT);
  retryT = setTimeout(flush, wait);
}

/* ─────────────────────────── 랭킹 제출 ───────────────────────────
 * ★ 세이브 업로드와 **완전히 다른 물건이다.**
 *   세이브는 본인 백업이라 검증하지 않고 자주 올린다.
 *   랭킹은 남과 비교되는 숫자라 서버가 검증하고, **기록이 오를 때만** 올린다.
 *
 * ★ 실패는 전부 조용하다. 랭킹이 안 올라갔다고 게임을 방해할 이유가 없다.
 *   함수가 아직 배포 안 됐으면 404 가 오는데 그것도 그냥 넘어간다.
 */

function readSubmitted() {
  try {
    const o = JSON.parse(readLS(SUBMITTED_KEY) || 'null');
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}

/** 지금 값이 마지막으로 제출한 것보다 나은가 */
function worthSubmitting(score) {
  if (!score) return false;
  const done = readSubmitted();
  if (!done || done.seed !== score.seed) return true;      // 새 판이면 무조건 한 번

  /* ★★ **세이브 버전이 바뀌었으면 기억을 버린다.**
   *   서버 기록을 리셋해도 이 «이미 올렸다» 기억은 로컬에 남는다. 그래서 리셋 뒤
   *   옛 기록보다 낮게 다시 오르면 **제출 자체를 건너뛰어** 순위표에 영영 안 뜬다
   *   (제작자가 나락을 다시 올랐는데 안 뜬다고 알려 줬다 — HANDOFF §42).
   *   마이그레이션이 기록을 0 으로 내렸다면 버전도 같이 올라가므로, 여기서 잡힌다. */
  if ((Number(done.dataVersion) || 0) !== (Number(score.dataVersion) || 0)) return true;

  return score.abyssBest > (done.abyss || 0)
    || score.towerBest > (done.tower || 0)
    || score.questsDone > (done.quests || 0);
}

/** 지금 날고 있는 제출 (없으면 null). 겹친 호출은 이걸 기다린다. */
let inflightSubmit = null;

/**
 * 랭킹에 제출한다. 기록이 안 올랐으면 아무것도 안 한다.
 * @param {{force?:boolean}} [opt]
 * @returns {Promise<{ok:boolean, skipped?:boolean, error:string}>}
 */
export async function submitScore(opt = {}) {
  if (!ready()) return { ok: false, error: '클라우드가 꺼져 있다' };

  /* ★ 겹친 호출을 **버리지 않고 기다린다.**
   *   저장 훅이 save() 마다 제출을 쏘는데, 그게 날고 있는 동안 "지금 올리기" 를 누르면
   *   예전에는 그냥 skipped 로 돌아왔다 — 눌러도 아무 일이 안 일어나는 것처럼 보였다
   *   (실제로 실측에서 제출 시도가 전부 skipped 로 삼켜졌다).
   *   앞선 요청을 기다린 뒤 이어서 판단하면, 그 사이 이미 올라갔으면
   *   worthSubmitting 이 거르고 아니면 정상적으로 보낸다. */
  if (inflightSubmit) {
    try { await inflightSubmit; } catch { /* 앞 요청의 실패는 여기서 다루지 않는다 */ }
  }

  let score = null;
  /* ★ 전력을 먼저 찍는다 — rules.js 는 sq.power 를 **읽기만** 하고 계산하지 못한다
   *   (의존성 0 제약). 안 찍으면 순위표의 부대 전력이 늘 빈다. */
  try { stampSquadPower(state); } catch (e) { console.warn('[cloud] 전력 계산 실패', e); }
  try { score = extractScore(state); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  if (!score) return { ok: false, error: '점수를 읽지 못했다' };
  if (!opt.force && !worthSubmitting(score)) return { ok: true, skipped: true, error: '' };

  const run = (async () => {
    const res = await authed(EP.fn('submit-score'), { method: 'POST', body: { state } }, Auth);
    if (!res.ok) {
      // 함수가 아직 배포 안 됐으면 404 다. 조용히 넘어간다 — 다음 기록 때 다시 시도한다.
      return { ok: false, error: res.error };
    }
    if (res.data && res.data.ok === false) {
      /* 서버가 거절했다(A등급). 되풀이해 봐야 같은 답이라 **다시 안 보낸다** —
       * 지금 값을 제출한 것으로 기록해 둔다. 게임은 아무 영향 없이 계속된다. */
      writeLS(SUBMITTED_KEY, JSON.stringify({
        seed: score.seed, abyss: score.abyssBest, tower: score.towerBest, quests: score.questsDone,
        dataVersion: score.dataVersion || 0,
      }));
      return { ok: false, error: (res.data.reasons || []).join(' / ') || '서버가 거절했다' };
    }
    writeLS(SUBMITTED_KEY, JSON.stringify({
      seed: score.seed, abyss: score.abyssBest, tower: score.towerBest, quests: score.questsDone,
      dataVersion: score.dataVersion || 0,
    }));
    return { ok: true, error: '' };
  })();

  inflightSubmit = run;
  try { return await run; } finally { if (inflightSubmit === run) inflightSubmit = null; }
}

/** 순위표를 읽는다. 로그인 없이도 읽힌다 (누구나 보라고 만든 것이다). */
export async function leaderboard(kind = 'abyss', limit = 100) {
  const res = await call(`${EP.rpc('leaderboard')}?p_kind=${encodeURIComponent(kind)}&p_limit=${limit}`, {});
  if (!res.ok) return { ok: false, rows: [], error: res.error };
  return { ok: true, rows: Array.isArray(res.data) ? res.data : [], error: '' };
}

/**
 * 순위 N 번인 사람의 **모든 부대** 상세.
 *
 * ★★ 목록(`leaderboard`)에 안 싣고 **누를 때만** 받는다. 전 부대 상세는 1인당 ~2KB 라
 *   200행에 실으면 400KB 가 된다 (요약은 150B → 30KB).
 * ★ `user_id` 가 아니라 **순위**로 찾는다 — 순위표와 같은 정렬을 그대로 쓰므로
 *   «3위의 부대» 가 되고, 남의 계정은 여전히 알 수 없다.
 */
export async function squadsAt(kind = 'abyss', rank = 1) {
  const res = await call(
    `${EP.rpc('squads_at')}?p_kind=${encodeURIComponent(kind)}&p_rank=${Math.max(1, Math.round(rank))}`, {});
  if (!res.ok) return { ok: false, squads: null, error: res.error };
  const row = Array.isArray(res.data) ? res.data[0] : null;
  return { ok: true, name: row?.company_name || '', squads: row?.squads_full || null, error: '' };
}

/**
 * 이 값이면 지금 몇 위인가.
 *
 * ★ 순위표를 받아 세지 않는다. `leaderboard()` 는 상위 200명까지만 주는데,
 *   순위를 가장 궁금해하는 건 아직 위에 못 올라간 사람이다.
 * ★ 로그인 없이도 읽힌다 — 값만 보내고 누구인지는 안 보낸다.
 *   덕분에 기록을 세운 직후(가장 반응이 좋은 순간)에 바로 보여 줄 수 있다.
 *
 * @returns {Promise<{ok:boolean, rank:number, total:number}>}
 */
export async function rankOf(kind, value) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  if (!v) return { ok: false, rank: 0, total: 0 };
  const [r, t] = await Promise.all([
    call(EP.rpc('rank_of'), { method: 'POST', body: { p_kind: kind, p_value: v } }),
    call(EP.rpc('rank_total'), { method: 'POST', body: { p_kind: kind } }),
  ]);
  if (!r.ok) return { ok: false, rank: 0, total: 0 };
  return { ok: true, rank: Number(r.data) || 0, total: t.ok ? (Number(t.data) || 0) : 0 };
}

/** 내 최고 기록 (제출된 값 기준) */
export function mySubmitted() { return readSubmitted(); }

/* ─────────────────────────── 복원 (pull) ───────────────────────────
 * ★ 이 구간이 이 기능 전체에서 **가장 위험하다.** 잘못 고르면 플레이어의 진행이 사라진다.
 *   그래서 규칙을 셋으로 못 박는다:
 *
 *   1. **자동으로 덮어쓰지 않는다.** 무엇을 할지는 여기서 정하지 않고
 *      `{status, local, remote}` 로 알려만 준다 — 결정은 사람이 한다.
 *   2. **로컬을 먼저 지킨다.** 서버가 최신이어도 물어보고, 거절하면 로컬이 이긴다.
 *   3. **적용은 도시 화면에서만.** `replaceState` 는 state 의 키를 전부 지웠다 다시 채운다.
 *      전투나 월드맵이 잡고 있던 배열 참조가 그 순간 유령이 된다.
 */

/** @typedef {{seed:number, rev:number, day:number, at:string}} Meta */

/** 서버에 있는 세이브의 메타만 읽는다 (본문은 안 받는다 — 수백 KB다) */
async function remoteMeta() {
  const res = await authed(`${EP.saves}?select=seed,rev,day,updated_at`, {}, Auth);
  if (!res.ok) return { ok: false, error: res.error, meta: null };
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) return { ok: true, error: '', meta: null };          // 아직 올린 적 없다
  return {
    ok: true,
    error: '',
    meta: { seed: Number(row.seed) || 0, rev: Number(row.rev) || 0, day: Number(row.day) || 1, at: row.updated_at },
  };
}

/**
 * 서버와 로컬을 비교한다. **아무것도 바꾸지 않는다.**
 * @returns {Promise<{ok:boolean, error:string, status:string, local:Meta|null, remote:Meta|null}>}
 *   status:
 *     `none`         서버에 세이브가 없다
 *     `local-newer`  로컬 rev 가 높다 (올리면 된다)
 *     `same`         같다
 *     `remote-newer` 서버 rev 가 높다 — 물어봐야 한다
 *     `other-run`    seed 가 다르다 = 다른 플레이스루 — 반드시 물어봐야 한다
 *
 * ★ `divergent` 가 참이면 **rev 순서와 진행 일수가 어긋난다.**
 *   `rev` 는 "몇 번 저장했나"지 "얼마나 진행했나"가 아니다. 두 기기가 각각 오프라인으로
 *   진행하면 5일차에서 천 번 저장한 쪽이 200일차에서 쉰 번 저장한 쪽을 이긴다 —
 *   실제로 재현했다. 이때 rev 만 보고 판단하면 **200일차 세이브를 5일차로 덮으라고 권하게 된다.**
 *   그래서 어긋남을 따로 알리고, 화면은 rev 가 아니라 **일수**를 기준으로 말한다.
 */
export async function compare() {
  if (!ready()) return { ok: false, error: '클라우드가 꺼져 있다', status: 'off', local: null, remote: null };

  const cur = currentSave();
  const local = cur ? { seed: cur.seed, rev: cur.rev, day: cur.day, at: new Date(cur.savedAt).toISOString() } : null;

  const r = await remoteMeta();
  if (!r.ok) return { ok: false, error: r.error, status: 'error', local, remote: null };
  if (!r.meta) return { ok: true, error: '', status: 'none', local, remote: null };

  const remote = r.meta;
  if (!local) return { ok: true, error: '', status: 'remote-newer', divergent: false, local, remote };
  if (local.seed !== remote.seed) return { ok: true, error: '', status: 'other-run', divergent: false, local, remote };

  const status = remote.rev > local.rev ? 'remote-newer'
    : remote.rev < local.rev ? 'local-newer' : 'same';

  /* rev 순서와 일수 순서가 반대면 두 기기가 갈라진 것이다.
   * 어느 쪽도 자동으로 이기면 안 된다 — 반드시 사람이 고른다. */
  const divergent = (status === 'remote-newer' && local.day > remote.day)
    || (status === 'local-newer' && remote.day > local.day);

  return { ok: true, error: '', status, divergent, local, remote };
}

/**
 * 서버 세이브를 내려받아 **현재 상태로 올린다.**
 *
 * ★ 부르기 전에 화면이 안전한지 호출부가 확인해야 한다 (도시 화면 등).
 *   여기서 화면을 검사하지 않는 이유는 net/ 이 ui/ 를 알면 안 되기 때문이다.
 *
 * @param {(data:object)=>boolean} apply 상태에 적용하는 함수 (state.importState)
 */
export async function adoptRemote(apply) {
  if (!ready()) return { ok: false, error: '클라우드가 꺼져 있다' };

  const res = await authed(`${EP.saves}?select=payload`, {}, Auth);
  if (!res.ok) return { ok: false, error: res.error };
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row || !row.payload) return { ok: false, error: '서버에 세이브가 없다' };

  let data = null;
  try { data = JSON.parse(row.payload); } catch { return { ok: false, error: '서버 세이브를 읽지 못했다' }; }
  if (!data || typeof data !== 'object') return { ok: false, error: '서버 세이브가 비어 있다' };

  /* ★ 적용 **전에** 로컬 원본을 한 벌 남긴다.
   *   여기서 뭔가 잘못되면 플레이어는 되돌릴 방법이 전혀 없다. 파일로 내보내기를
   *   해 두라고 안내하는 것으로는 부족하다 — 코드가 알아서 남겨야 한다. */
  /* ★ 이미 백업이 있으면 덮지 않는다. 두 번 연속 가져오면 원본이 '직전에 가져온
   *   서버 세이브'로 바뀌어 되돌릴 대상이 사라진다. */
  const before = readLS(SAVE_KEY);
  if (before && !readLS(ROLLBACK_KEY)) writeLS(ROLLBACK_KEY, before);

  if (!apply(data)) {
    return { ok: false, error: '세이브를 적용하지 못했다' };
  }
  /* 적용된 내용이 곧 서버의 것이다 — 정체를 풀고 동기화 지점을 여기로 옮긴다.
   * ★ seed 를 빼먹으면 안 된다. 방금 받아 온 것과 같은 rev 를 도로 올려 보내
   *   P0001 을 맞고 "서버에 더 최신 세이브가 있다"는 거짓 정체가 걸린다. */
  writeOutbox(null);
  const gotSeed = Number(data.seed) || 0;
  const gotRev = Number(data.rev) || 0;
  last = { at: Date.now(), ok: true, error: '', rev: gotRev, seed: gotSeed };
  writeSynced({ seed: gotSeed, rev: gotRev });
  return { ok: true, error: '', backedUp: !!before };
}

/**
 * "이 기기 것을 쓴다" 를 골랐을 때 부른다.
 *
 * ★ 이게 없으면 위의 `other-run` 정체에서 **영원히 못 빠져나온다.**
 *   사람이 이미 골랐는데도 flush 가 매번 "서버에 다른 용병단이 있다"로 막는다.
 */
export function acceptLocalRun() {
  const cur = currentSave();
  if (!cur) return;
  writeSynced({ seed: cur.seed, rev: 0 });   // 이 판은 올려도 된다고 표시 (rev 0 = 아직 안 올림)
  writeOutbox(null);
  last = { at: 0, ok: false, error: '', rev: 0, seed: 0 };
}

/** 모달이 보여 준 그 로컬 세이브 원본 (compare 가 읽은 것과 같은 출처) */
export function localSave() { return currentSave(); }

/** 직전 `adoptRemote` 로 덮이기 전의 로컬 세이브 (없으면 null) */
export function rollbackSave() { return readLS(ROLLBACK_KEY); }
/** 되돌리기 백업을 버린다 */
export function clearRollback() { writeLS(ROLLBACK_KEY, null); }

/* ─────────────────────────── 상태 표시 ─────────────────────────── */

/** 화면에 띄울 상태 요약 */
export function status() {
  if (!ENABLED) return { on: false, label: '사용 불가', detail: '이 빌드에서는 클라우드가 꺼져 있다.', sync: '' };
  if (!Auth.signedIn()) {
    return {
      on: false, label: '로그인 안 됨',
      detail: '세이브가 이 기기에만 저장된다. 로그인하면 서버에 보관되고 랭킹에 참여한다.',
      sync: '',
    };
  }

  const box = readOutbox();
  const done = readSynced();
  const cur = currentSave();
  let sync = '아직 올린 적 없음';
  if (box && box.stalled === 'newer-on-server') sync = '서버에 더 최신 세이브가 있다';
  else if (box && box.stalled === 'other-run') sync = '서버에 다른 용병단이 있다 — 서버와 맞추기를 눌러라';
  else if (box) sync = '올리는 중 — 연결되면 자동으로 재시도한다';
  else if (last.ok) sync = `마지막 업로드 ${new Date(last.at).toLocaleTimeString()}`;
  else if (last.error) sync = '올리는 중 — 연결되면 자동으로 재시도한다';
  /* ★ `last` 는 메모리라 새로고침하면 사라진다. 그때 "아직 올린 적 없음" 이라고 하면
   *   멀쩡히 올라가 있는데도 안 올라간 것처럼 보인다 — 저장된 동기화 지점으로 답한다. */
  else if (done && cur && done.seed === cur.seed && done.rev >= cur.rev) sync = '서버와 같다';
  else if (done) sync = '올릴 것이 남아 있다';

  return { on: true, label: '켜짐', detail: Auth.email() || Auth.displayName() || '로그인됨', sync };
}
