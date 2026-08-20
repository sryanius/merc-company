/**
 * Supabase REST 호출 — `fetch` 만 쓴다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ supabase-js 를 안 쓰는 이유 (셋 다 실제 위험이다)
 *   1. 이 프로젝트는 **의존성 0 · 빌드 없음**이 불변식이다. CDN 에서 라이브러리를
 *      물면 그게 깨진다.
 *   2. `sw.js` 는 교차 출처를 캐시하지 않는다. CDN 이 안 뜨면 **오프라인에서 게임이
 *      아예 부팅되지 않는다** — TWA 앱과 iOS PWA 에서 그건 곧 앱 장애다.
 *   3. 필요한 엔드포인트가 4개뿐이다. 250줄이면 되는 걸 120KB 로 바꿀 이유가 없다.
 *
 * ★ 이 모듈은 **절대 throw 하지 않는다.** 결과를 `{ok, status, data, error}` 로 돌려준다.
 *   클라우드는 있으면 좋은 기능이지 게임의 전제가 아니다. 네트워크 하나 때문에
 *   저장이 실패하거나 화면이 죽으면 안 된다.
 *
 * @module net/rest
 */

import { SUPABASE_ANON_KEY, TIMEOUT_MS } from './config.js';

/** @typedef {{ok:boolean, status:number, data:*, error:string}} Res */

const fail = (status, error) => ({ ok: false, status, data: null, error });

/**
 * 한 번 호출한다. 재시도·토큰 갱신은 하지 않는다 (그건 `authed` 가 한다).
 *
 * @param {string} url
 * @param {object} [opt]
 * @param {string} [opt.method]
 * @param {object} [opt.body]      JSON 으로 직렬화한다
 * @param {string} [opt.token]     사용자 액세스 토큰. 없으면 익명 키로 부른다
 * @param {object} [opt.headers]   추가 헤더 (Prefer 등)
 * @returns {Promise<Res>}
 */
export async function call(url, opt = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opt.timeout || TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opt.method || 'GET',
      signal: ctl.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        // 토큰이 없으면 익명 키를 그대로 쓴다 — RLS 가 anon 역할로 판단한다
        Authorization: `Bearer ${opt.token || SUPABASE_ANON_KEY}`,
        ...(opt.body !== undefined ? { 'Content-Type': 'application/json' } : null),
        ...(opt.headers || null),
      },
      body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
    });

    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }

    if (!res.ok) {
      /* 사유가 담기는 필드가 서비스마다 다르다:
       *   PostgREST → message (트리거가 raise 한 문구도 여기로 온다)
       *   GoTrue(인증) → **msg** · error_description · error_code
       * msg 를 빼먹으면 인증 오류가 전부 "HTTP 404" 같은 숫자로만 보인다. */
      const msg = (data && (data.message || data.msg || data.error_description
        || (typeof data.error === 'string' ? data.error : null)))
        || `HTTP ${res.status}`;
      return { ok: false, status: res.status, data, error: String(msg), code: data?.error_code || '' };
    }
    return { ok: true, status: res.status, data, error: '' };
  } catch (e) {
    // AbortError 도 여기로 온다 — 호출부에서 구분할 필요가 없어 같이 묶는다
    return fail(0, e && e.name === 'AbortError' ? '응답이 없다 (시간 초과)' : String((e && e.message) || e));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 로그인 상태로 호출한다. **401 이면 토큰을 한 번 갱신하고 한 번만 재시도한다.**
 *
 * ★ 재시도를 한 번으로 못 박는 이유: 갱신 토큰까지 만료된 계정은 무한 루프가 된다.
 *   그때는 실패로 돌려주고 호출부가 "다시 연결" 을 띄우게 한다.
 *
 * @param {string} url
 * @param {object} opt      `call` 과 같다. token 은 여기서 채운다
 * @param {object} auth     `net/auth.js` 모듈 (순환 import 를 피하려고 인자로 받는다)
 * @returns {Promise<Res>}
 */
export async function authed(url, opt, auth) {
  const token = auth.accessToken();
  if (!token) return fail(401, '로그인되어 있지 않다');

  const first = await call(url, { ...opt, token });
  if (first.status !== 401) return first;

  const renewed = await auth.refresh();
  if (!renewed.ok) return renewed;

  return call(url, { ...opt, token: auth.accessToken() });
}
