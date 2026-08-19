/**
 * 익명 로그인 · 세션 관리
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 익명 로그인인가
 *   랭킹에 참여하려면 "이 세이브가 누구 것인가"를 서버가 알아야 한다. 그런데 이메일
 *   가입을 강제하면 대부분 그냥 나간다 — 게임을 켜는 데 계정이 필요한 순간
 *   이건 다른 물건이 된다. 익명 계정은 화면 한 번 안 띄우고 그 문제를 푼다.
 *
 * ★ 대가: **브라우저 저장소가 지워지면 계정이 사라진다.**
 *   iOS PWA 는 며칠 안 쓰면 실제로 저장소를 정리한다. 그래서 나중에 복구 코드를 붙인다.
 *   그때까지는 "랭킹 기록은 날아갈 수 있다"고 화면에 적어야 한다.
 *
 * ★ 가입을 **미룬다.** 게임을 켜자마자 부르지 않는다 — 플레이어가 클라우드를 켤 때만
 *   부른다. 익명 가입에는 IP 기준 요청 제한이 있어서, 통신사 NAT 뒤에서 첫 접속이
 *   몰리면 무더기로 실패한다. 그때도 게임은 아무 일 없이 돌아가야 한다.
 *
 * ★ 로그아웃 버튼을 만들지 않는다. 새 UUID = 새 계정이고, 그 순간 이전 기록과의
 *   연결이 끊긴다. 되돌릴 방법이 없는 버튼은 두지 않는다.
 *
 * @module net/auth
 */

import { EP, SESSION_KEY, ENABLED } from './config.js';
import { call } from './rest.js';

/** @typedef {{userId:string, access:string, refresh:string, expAt:number}} Session */

/** @type {Session|null} */
let session = null;
let loaded = false;

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/** 저장해 둔 세션을 읽어 온다 (첫 호출 때 한 번) */
function load() {
  if (loaded) return session;
  loaded = true;
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.userId && s.access && s.refresh) session = s;
  } catch (e) {
    console.warn('[auth] 세션을 읽지 못했다', e);
  }
  return session;
}

function persist() {
  const ls = storage();
  if (!ls) return;
  try {
    if (session) ls.setItem(SESSION_KEY, JSON.stringify(session));
    else ls.removeItem(SESSION_KEY);
  } catch (e) {
    console.warn('[auth] 세션을 저장하지 못했다', e);
  }
}

/** GoTrue 응답을 세션으로 정규화한다 */
function toSession(d) {
  if (!d || !d.access_token || !d.refresh_token) return null;
  const expIn = Number(d.expires_in) || 3600;
  return {
    userId: (d.user && d.user.id) || '',
    access: d.access_token,
    refresh: d.refresh_token,
    // 60초 미리 만료로 본다 — 경계에서 401 을 맞고 재시도하는 것보다 낫다
    expAt: Date.now() + (expIn - 60) * 1000,
  };
}

/* ─────────────────────────── 공개 API ─────────────────────────── */

/** 지금 로그인되어 있는가 */
export function signedIn() { return !!load(); }

/** 사용자 id (없으면 빈 문자열) */
export function userId() { return load()?.userId || ''; }

/** 액세스 토큰. 만료가 임박했으면 빈 문자열을 돌려준다(호출부가 refresh 한다) */
export function accessToken() {
  const s = load();
  if (!s) return '';
  return s.access;
}

/** 토큰이 곧 만료되는가 */
export function expiring() {
  const s = load();
  return !!s && Date.now() >= s.expAt;
}

/**
 * 익명 계정을 만든다. **이미 세션이 있으면 아무것도 하지 않는다** —
 * 두 번 부르면 UUID 가 새로 생겨 이전 기록과의 연결이 끊긴다.
 * @returns {Promise<{ok:boolean, error:string}>}
 */
export async function signInAnonymously() {
  if (!ENABLED) return { ok: false, error: '클라우드가 꺼져 있다' };
  if (load()) return { ok: true, error: '' };

  const res = await call(EP.signupAnon, { method: 'POST', body: {} });
  if (!res.ok) {
    // 익명 가입이 대시보드에서 꺼져 있으면 여기서 걸린다 — 사유를 그대로 전한다
    return { ok: false, error: res.error || '익명 로그인에 실패했다' };
  }
  const s = toSession(res.data);
  if (!s) return { ok: false, error: '응답에 토큰이 없다' };
  session = s;
  persist();
  return { ok: true, error: '' };
}

/**
 * 액세스 토큰을 갱신한다.
 * 실패하면 **세션을 지운다** — 갱신 토큰까지 죽었으면 그 세션으로 할 수 있는 게 없다.
 */
export async function refresh() {
  const s = load();
  if (!s) return { ok: false, status: 401, data: null, error: '세션이 없다' };

  const res = await call(EP.refresh, { method: 'POST', body: { refresh_token: s.refresh } });
  if (!res.ok) {
    session = null;
    persist();
    return { ...res, error: `세션이 만료됐다 (${res.error})` };
  }
  const next = toSession(res.data);
  if (!next) {
    session = null;
    persist();
    return { ok: false, status: 0, data: null, error: '갱신 응답에 토큰이 없다' };
  }
  // userId 는 갱신 응답에 없을 수 있다 — 기존 값을 지키지 않으면 소유자가 바뀐 것처럼 된다
  session = { ...next, userId: next.userId || s.userId };
  persist();
  return { ok: true, status: 200, data: null, error: '' };
}

/** 만료가 임박했으면 미리 갱신한다. 호출부가 매번 신경 쓰지 않게 하는 편의 함수. */
export async function ensureFresh() {
  if (!load()) return { ok: false, error: '세션이 없다' };
  if (!expiring()) return { ok: true, error: '' };
  const r = await refresh();
  return { ok: r.ok, error: r.error };
}

/**
 * 이 기기의 세션을 버린다.
 * ★ UI 에 버튼으로 걸지 마라. 새 UUID = 새 계정 = 이전 랭킹 기록과 단절이고,
 *   복구 코드가 없으면 되돌릴 수 없다. 개발·디버그용으로만 둔다.
 */
export function forgetSession() {
  session = null;
  persist();
}
