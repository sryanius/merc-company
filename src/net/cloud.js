/**
 * 클라우드 저장 — 켜기/끄기 · 업로드 큐
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ **기본은 꺼짐이다.** 게임을 켜자마자 계정을 만들지 않는다.
 *   · 익명 가입에는 IP 기준 요청 제한이 있다. 통신사 NAT 뒤에서 여러 명이 동시에
 *     처음 켜면 무더기로 실패한다 — 그게 게임 부팅을 막으면 안 된다.
 *   · 계정은 되돌리기 어려운 물건이다. 플레이어가 원할 때 만드는 게 맞다.
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
import { authed } from './rest.js';
import { SAVE_KEY, onSaved } from '../game/state.js';

const ON_KEY = 'merc_cloud_on_v1';

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

/** 플레이어가 클라우드를 켰는가 (기기별 설정) */
export function isOn() {
  if (!ENABLED) return false;
  return readLS(ON_KEY) === '1';
}

/** 이 기기에서 클라우드를 쓸 수 있는 상태인가 */
export function ready() { return isOn() && Auth.signedIn(); }

/**
 * 켠다. 필요하면 익명 계정을 만든다.
 * @returns {Promise<{ok:boolean, error:string}>}
 */
export async function enable() {
  if (!ENABLED) return { ok: false, error: '클라우드 기능이 꺼져 있다' };
  const r = await Auth.signInAnonymously();
  // ★ 로그인에 실패하면 켜지 않는다. "켜졌는데 안 되는" 상태가 가장 나쁘다.
  if (!r.ok) return r;
  writeLS(ON_KEY, '1');
  queuePush({ now: true });          // 켠 직후 한 번은 바로 올린다
  return { ok: true, error: '' };
}

/**
 * 끈다. **계정도 세션도 지우지 않는다** — 다시 켜면 같은 계정으로 이어진다.
 */
export function disable() {
  writeLS(ON_KEY, null);
  cancelTimers();
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
let last = { at: 0, ok: false, error: '', rev: 0 };

function readOutbox() {
  try {
    const o = JSON.parse(readLS(OUTBOX_KEY) || 'null');
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}
const writeOutbox = (o) => writeLS(OUTBOX_KEY, o ? JSON.stringify(o) : null);

function cancelTimers() {
  clearTimeout(debounceT); debounceT = 0;
  clearTimeout(maxWaitT); maxWaitT = 0;
  clearTimeout(retryT); retryT = 0;
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
  if (opt.now) { cancelTimers(); flush(); return; }

  clearTimeout(debounceT);
  debounceT = setTimeout(flush, PUSH_DEBOUNCE_MS);
  // 계속 바쁘면 디바운스가 영원히 밀린다 — 상한을 하나 더 건다
  if (!maxWaitT) maxWaitT = setTimeout(flush, PUSH_MAX_WAIT_MS);
}

/** 실제 업로드. 겹쳐 불려도 한 번만 돈다. */
async function flush() {
  cancelTimers();
  if (inFlight || !ready()) return;

  const cur = currentSave();
  if (!cur || !cur.rev) return;              // 저장된 게 없다

  const box = readOutbox();
  // 이미 올린 것과 같은 rev 면 보낼 이유가 없다
  if (box && box.stalled && box.rev >= cur.rev) return;
  if (last.ok && last.rev >= cur.rev) return;

  inFlight = true;
  try {
    const res = await authed(EP.saves, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: {
        user_id: Auth.userId(),
        seed: cur.seed,
        rev: cur.rev,
        saved_at: new Date(cur.savedAt).toISOString(),
        day: cur.day,
        payload: cur.raw,
      },
    }, Auth);

    if (res.ok) {
      last = { at: Date.now(), ok: true, error: '', rev: cur.rev };
      writeOutbox(null);
      return;
    }

    /* ★ 되감기 거절은 **재시도하면 안 된다.**
     *   서버에 더 최신 세이브가 있다는 뜻이라, 몇 번을 보내도 같은 답이 온다.
     *   이건 네트워크 문제가 아니라 "다른 기기에서 더 진행했다" 는 신호다 —
     *   S7(복원)이 처리할 일이므로 표시만 남기고 큐를 멈춘다. */
    if (/오래된 세이브/.test(res.error) || res.data?.code === 'P0001') {
      last = { at: Date.now(), ok: false, error: '서버에 더 최신 세이브가 있다', rev: cur.rev };
      writeOutbox({ rev: cur.rev, tries: 0, nextAt: 0, stalled: 'newer-on-server' });
      return;
    }

    // 그 밖의 실패 — 조용히 백오프 재시도. 화면에는 아무것도 안 띄운다.
    const tries = (box?.tries || 0) + 1;
    const wait = RETRY_MS[Math.min(tries - 1, RETRY_MS.length - 1)];
    last = { at: Date.now(), ok: false, error: res.error, rev: cur.rev };
    writeOutbox({ rev: cur.rev, tries, nextAt: Date.now() + wait, stalled: '' });
    clearTimeout(retryT);
    retryT = setTimeout(flush, wait);
  } finally {
    inFlight = false;
  }
}

/** 지금 당장 올린다 (화면의 "지금 올리기" 버튼용) */
export async function pushNow() {
  if (!ready()) return { ok: false, error: '클라우드가 꺼져 있다' };
  writeOutbox(null);                         // 백오프·정체 표시를 지우고 새로 시도
  last = { at: 0, ok: false, error: '', rev: 0 };
  await flush();
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
  onSaved(() => { try { queuePush(); } catch (e) { console.warn('[cloud] 예약 실패', e); } });

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
  if (box && box.stalled) return;            // 되감기 정체는 S7 이 풀어야 한다
  // 앱을 다시 켠 직후라 아직 아무것도 안 올렸을 수 있다 — 조건 없이 한 번 본다
  clearTimeout(retryT);
  retryT = setTimeout(flush, 1500);
}

/* ─────────────────────────── 상태 표시 ─────────────────────────── */

/** 화면에 띄울 상태 요약 */
export function status() {
  if (!ENABLED) return { on: false, label: '사용 불가', detail: '이 빌드에서는 클라우드가 꺼져 있다.', sync: '' };
  if (!isOn()) return { on: false, label: '꺼짐', detail: '세이브가 이 기기에만 저장된다.', sync: '' };
  if (!Auth.signedIn()) return { on: false, label: '연결 끊김', detail: '다시 켜면 연결된다.', sync: '' };

  const box = readOutbox();
  let sync = '아직 올린 적 없음';
  if (box && box.stalled === 'newer-on-server') sync = '서버에 더 최신 세이브가 있다';
  else if (box) sync = '올리는 중 — 연결되면 자동으로 재시도한다';
  else if (last.ok) sync = `마지막 업로드 ${new Date(last.at).toLocaleTimeString()}`;
  else if (last.error) sync = '올리는 중 — 연결되면 자동으로 재시도한다';

  return { on: true, label: '켜짐', detail: `계정 ${Auth.userId().slice(0, 8)}…`, sync };
}
