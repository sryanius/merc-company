/**
 * 클라우드(Supabase) 접속 설정
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 여기 있는 두 값은 **공개되는 것이 정상이다.** 브라우저 코드에 그대로 실리므로
 *   누구나 볼 수 있고, 그걸 전제로 설계돼 있다. 방어는 오직 **RLS**(행 단위 권한)다:
 *   · `saves`  — 본인 행만 읽고 쓴다
 *   · `scores` — INSERT/UPDATE 정책이 **아예 없다.** Edge Function 만 쓴다
 *
 *   그래서 `db/001_init.sql` 을 적용한 뒤 **RLS 를 안 켠 public 테이블이 0개인지**
 *   반드시 확인해야 한다. 하나라도 빠지면 그 테이블은 전부 유출된다.
 *   (확인 쿼리는 `db/001_init.sql` 맨 아래 주석에 있다.)
 *
 * ★ service_role / secret 키는 **여기 넣지 않는다.** 넣으면 안 되는 게 아니라
 *   넣을 이유가 없다 — 서버(Edge Function)는 런타임이 환경변수로 알아서 주입한다.
 *
 * ★ 클라우드는 **선택 기능이다.** `ENABLED` 가 false 거나 네트워크가 없어도
 *   게임은 지금까지처럼 localStorage 만으로 완전히 돌아가야 한다.
 *   이 계약이 깨지면 오프라인(TWA·iOS PWA)에서 게임이 안 뜬다.
 *
 * @module net/config
 */

/** Supabase 프로젝트 URL */
export const SUPABASE_URL = 'https://peilvwrqgauwlaqojttq.supabase.co';

/** 공개 키 (anon / publishable). JWT 의 role 이 'anon' 인지 확인하고 넣을 것. */
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlaWx2d3JxZ2F1d2xhcW9qdHRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNTU0MTEsImV4cCI6MjEwMjczMTQxMX0.ks353ZYcf79woaMNBCRLo4W5tRJgGiYyJKjMT3PS0pM';

/**
 * 클라우드 기능 전체 스위치.
 * 설정이 덜 끝났거나 문제가 생기면 여기 하나만 false 로 두면 게임이 옛날처럼 돈다.
 */
export const ENABLED = true;

/** 세션 보관 키 (localStorage) */
export const SESSION_KEY = 'merc_cloud_session_v1';
/** 밀린 업로드 보관 키 */
export const OUTBOX_KEY = 'merc_cloud_outbox_v1';

/**
 * 저장 디바운스.
 * `save()` 는 실측 시간당 수백 번 불린다 — 그대로 올리면 대역폭만 먹는다.
 * 마지막 상태 하나만 모아서 보낸다.
 */
export const PUSH_DEBOUNCE_MS = 20_000;
/** 계속 바쁘더라도 이 시간이 지나면 한 번은 올린다 */
export const PUSH_MAX_WAIT_MS = 120_000;

/** 재시도 간격 (지수 백오프). 마지막 값에서 더 늘리지 않는다. */
export const RETRY_MS = [30_000, 300_000, 1_800_000, 21_600_000];

/** 네트워크 요청 제한 시간 */
export const TIMEOUT_MS = 15_000;

/** REST 엔드포인트 (supabase-js 를 쓰지 않으므로 직접 조립한다) */
/**
 * 클라이언트 판번호 — **관측용**이다. 판정에 안 쓴다.
 *
 * ★★ 왜 필요한가. 그림자 관측에 「서버가 센 값 vs 클라가 신고한 값」 이 들어오는데,
 *   **그 클라가 몇 판인지 알 길이 없었다.** 실제로 물렸다: 정산 신고가 0건이라
 *   「신고 코드가 고장났나 / 브라우저가 옛 셸인가」 를 구별할 수 없었다.
 *   서비스워커 때문에 「배포했으니 다 넘어갔다」 가 참이 아니다 (§41).
 *
 * ★ `sw.js` 의 `CACHE` 와 **따로** 둔다. 그건 워커 안에 있어서 페이지가 못 읽는다.
 * ★ 클라 코드를 의미 있게 고치면 여기를 올려라. 스모크가 `sw.js` 와 짝이 맞는지 본다.
 */
export const CLIENT_REV = 171;

export const EP = {
  signupAnon: `${SUPABASE_URL}/auth/v1/signup`,
  refresh: `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
  settings: `${SUPABASE_URL}/auth/v1/settings`,
  saves: `${SUPABASE_URL}/rest/v1/saves`,
  rpc: (fn) => `${SUPABASE_URL}/rest/v1/rpc/${fn}`,
  fn: (name) => `${SUPABASE_URL}/functions/v1/${name}`,
};
