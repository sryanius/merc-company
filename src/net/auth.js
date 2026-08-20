/**
 * 구글 로그인 · 세션 관리
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 왜 구글인가 (익명 로그인을 걷어낸 이유)
 *   익명 계정은 화면 한 번 안 띄우고 랭킹에 참여시킬 수 있어서 좋았지만,
 *   **브라우저 저장소가 지워지면 계정이 사라진다.** iOS PWA 는 며칠 안 쓰면
 *   실제로 저장소를 정리하고, 그때 랭킹 기록을 되찾을 방법이 전혀 없다.
 *   복구 코드를 발급하는 방법도 있지만 그건 "코드를 잃으면 끝"이라 문제를 미룰 뿐이다.
 *
 *   이메일+비밀번호는 설정이 제일 쉬운 대신, Supabase 내장 메일 발송이
 *   시간당 몇 통 수준이고 공식적으로 테스트용이다 — 비밀번호 찾기가 사실상 안 된다.
 *   구글은 **메일 발송이 아예 필요 없고** 복구를 구글이 책임진다.
 *
 * ★ PKCE 를 쓴다 (implicit 아님).
 *   implicit 흐름은 토큰이 URL 조각(`#access_token=…`)으로 돌아와 방문 기록에 남는다.
 *   PKCE 는 일회용 코드만 URL 에 오고, 그걸 토큰으로 바꾸려면 이 기기가 만든
 *   `code_verifier` 가 있어야 한다. 브라우저 crypto 로 20줄이면 되고,
 *   supabase-js 없이도 충분히 구현된다.
 *
 * @module net/auth
 */

import { EP, SESSION_KEY, ENABLED, SUPABASE_URL } from './config.js';
import { call } from './rest.js';

/** @typedef {{userId:string, email:string, name:string, access:string, refresh:string, expAt:number}} Session */

/** PKCE 검증자 보관 키 — 리다이렉트를 건너가야 하므로 저장소에 둔다 */
const VERIFIER_KEY = 'merc_cloud_pkce_v1';

/** @type {Session|null} */
let session = null;
let loaded = false;

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
const readLS = (k) => { try { return storage()?.getItem(k) ?? null; } catch { return null; } };
const writeLS = (k, v) => {
  try {
    if (v == null) storage()?.removeItem(k);
    else storage()?.setItem(k, v);
  } catch (e) { console.warn('[auth] 저장 실패', e); }
};

function load() {
  if (loaded) return session;
  loaded = true;
  try {
    const raw = readLS(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.userId || !s.access || !s.refresh) return null;

    /* ★ 익명 시절 세션은 버린다.
     *   익명 로그인을 걷어내기 전에 클라우드를 켠 사람은 저장소에 그 세션이 남아 있다.
     *   그러면 `signedIn()` 이 참이라 "이미 로그인됨"으로 보고 **구글 로그인 화면이
     *   영영 안 뜬다** — 실제로 그 상태에 걸렸다.
     *   구글 계정에는 항상 이메일이 있으므로(대시보드에서 '이메일 없는 사용자 허용'을
     *   꺼 두었다) 이메일 유무로 정확히 가른다. */
    if (!s.email) {
      console.warn('[auth] 익명 시절 세션을 버린다 — 구글 로그인이 필요하다');
      writeLS(SESSION_KEY, null);
      return null;
    }
    session = s;
  } catch (e) {
    console.warn('[auth] 세션을 읽지 못했다', e);
  }
  return session;
}

const persist = () => writeLS(SESSION_KEY, session ? JSON.stringify(session) : null);

/** GoTrue 응답을 세션으로 정규화한다 */
function toSession(d) {
  if (!d || !d.access_token || !d.refresh_token) return null;
  const expIn = Number(d.expires_in) || 3600;
  const u = d.user || {};
  const meta = u.user_metadata || {};
  return {
    userId: u.id || '',
    email: u.email || '',
    // 순위표에 쓸 기본 이름. 없으면 이메일 앞부분.
    name: meta.full_name || meta.name || (u.email ? String(u.email).split('@')[0] : ''),
    access: d.access_token,
    refresh: d.refresh_token,
    // 60초 미리 만료로 본다 — 경계에서 401 을 맞고 재시도하는 것보다 낫다
    expAt: Date.now() + (expIn - 60) * 1000,
  };
}

/* ─────────────────────────── PKCE ─────────────────────────── */

const B64URL = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function makeVerifier() {
  const a = new Uint8Array(48);
  crypto.getRandomValues(a);
  return B64URL(a);
}

async function challengeOf(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return B64URL(new Uint8Array(digest));
}

/* ─────────────────────────── 공개 API ─────────────────────────── */

export function signedIn() { return !!load(); }
export function userId() { return load()?.userId || ''; }
export function email() { return load()?.email || ''; }
export function displayName() { return load()?.name || ''; }
export function accessToken() { return load()?.access || ''; }

/** 토큰이 곧 만료되는가 */
export function expiring() {
  const s = load();
  return !!s && Date.now() >= s.expAt;
}

/** 로그인 후 돌아올 주소 (쿼리·해시를 뗀 현재 페이지) */
function redirectTarget() {
  const u = new URL(globalThis.location.href);
  u.search = '';
  u.hash = '';
  return u.toString();
}

/**
 * 구글 로그인을 시작한다. **이 함수는 페이지를 떠난다** (리다이렉트).
 * 돌아오면 `completeOAuth()` 가 이어받는다.
 */
export async function signInWithGoogle() {
  if (!ENABLED) return { ok: false, error: '클라우드가 꺼져 있다' };
  try {
    const verifier = makeVerifier();
    writeLS(VERIFIER_KEY, verifier);
    const challenge = await challengeOf(verifier);
    const u = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
    u.searchParams.set('provider', 'google');
    u.searchParams.set('redirect_to', redirectTarget());
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 's256');
    globalThis.location.assign(u.toString());
    return { ok: true, error: '' };            // 여기까지 오면 곧 페이지가 바뀐다
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * 로그인에서 돌아왔는지 보고, 그렇다면 코드를 토큰으로 바꾼다.
 * 부팅 때 한 번 부른다. 로그인 흔적이 없으면 아무것도 안 한다.
 *
 * ★ URL 을 반드시 청소한다. 코드가 주소창에 남으면 새로고침 때 재사용을 시도해
 *   "이미 쓴 코드" 오류가 뜨고, 방문 기록에도 남는다.
 */
export async function completeOAuth() {
  if (typeof globalThis.location === 'undefined') return { ok: false, handled: false, error: '' };
  const url = new URL(globalThis.location.href);
  const code = url.searchParams.get('code');
  const errDesc = url.searchParams.get('error_description') || url.searchParams.get('error');

  const clean = () => {
    try {
      const u = new URL(globalThis.location.href);
      u.search = '';
      u.hash = '';
      globalThis.history.replaceState(null, '', u.toString());
    } catch (e) { /* 히스토리를 못 고쳐도 로그인 자체는 끝났다 */ }
  };

  if (errDesc) { clean(); return { ok: false, handled: true, error: errDesc }; }
  if (!code) return { ok: false, handled: false, error: '' };

  const verifier = readLS(VERIFIER_KEY);
  clean();
  if (!verifier) return { ok: false, handled: true, error: '로그인 정보를 잃었다. 다시 시도해 주세요.' };

  const res = await call(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    body: { auth_code: code, code_verifier: verifier },
  });
  writeLS(VERIFIER_KEY, null);
  if (!res.ok) {
    /* `flow_state_not_found` 는 서버가 이 로그인 시도를 모른다는 뜻이다 —
     * 코드를 이미 썼거나(새로고침) 너무 오래 걸렸다. 원문을 그대로 보여 주면
     * 플레이어가 할 수 있는 게 없으므로 무엇을 하면 되는지로 바꿔 말한다. */
    const stale = res.code === 'flow_state_not_found' || res.status === 404;
    return {
      ok: false,
      handled: true,
      error: stale ? '로그인이 만료됐습니다. 다시 시도해 주세요.' : res.error,
    };
  }

  const s = toSession(res.data);
  if (!s) return { ok: false, handled: true, error: '응답에 토큰이 없다' };
  session = s;
  persist();
  return { ok: true, handled: true, error: '' };
}

/**
 * 액세스 토큰을 갱신한다.
 *
 * ★ 서버가 "이 갱신 토큰은 죽었다"고 **말한 경우에만** 세션을 버린다.
 *   타임아웃(status 0)이나 5xx·429 로 버리면 살아 있는 토큰을 버리는 것이고,
 *   그 뒤 조용히 아무것도 안 하는데 화면은 "켜짐"으로 남는다.
 *   구글 로그인이라 다시 들어올 수는 있지만, 그래도 멀쩡한 세션을 버릴 이유가 없다.
 */
export async function refresh() {
  const s = load();
  if (!s) return { ok: false, status: 401, data: null, error: '세션이 없다' };

  const res = await call(EP.refresh, { method: 'POST', body: { refresh_token: s.refresh } });
  if (!res.ok) {
    const dead = res.status === 400 || res.status === 401 || res.status === 403;
    if (!dead) return { ...res, error: `갱신하지 못했다 (${res.error})` };
    session = null;
    persist();
    return { ...res, error: `로그인이 만료됐다 (${res.error})` };
  }
  const next = toSession(res.data);
  if (!next) {
    session = null;
    persist();
    return { ok: false, status: 0, data: null, error: '갱신 응답에 토큰이 없다' };
  }
  // 갱신 응답에는 user 가 없을 수 있다 — 기존 신원을 지키지 않으면 소유자가 바뀐 것처럼 된다
  session = {
    ...next,
    userId: next.userId || s.userId,
    email: next.email || s.email,
    name: next.name || s.name,
  };
  persist();
  return { ok: true, status: 200, data: null, error: '' };
}

/** 만료가 임박했으면 미리 갱신한다 */
export async function ensureFresh() {
  if (!load()) return { ok: false, error: '세션이 없다' };
  if (!expiring()) return { ok: true, error: '' };
  const r = await refresh();
  return { ok: r.ok, error: r.error };
}

/**
 * 로그아웃.
 * ★ 익명 시절과 달리 **이제는 안전하다.** 구글로 다시 들어오면 같은 계정이고
 *   랭킹 기록도 그대로다. 그래서 화면에 버튼으로 걸어도 된다.
 */
export function signOut() {
  session = null;
  persist();
  writeLS(VERIFIER_KEY, null);
}
