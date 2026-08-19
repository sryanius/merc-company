/**
 * Supabase 설정 점검기
 * ────────────────────────────────────────────────────────────────
 * 설정이 어디까지 됐는지 **읽기만 해서** 알려 준다.
 * 계정을 만들거나 데이터를 쓰지 않는다 — 아무 때나 돌려도 안전하다.
 *
 * 실행: node tools/supacheck.mjs
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, EP } from '../src/net/config.js';

const OK = '  ✓';
const NO = '  ✗';
const WARN = '  !';
let fails = 0;
const fail = (s) => { fails++; console.log(`${NO} ${s}`); };
const pass = (s) => console.log(`${OK} ${s}`);
const warn = (s) => console.log(`${WARN} ${s}`);

const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

async function get(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: H, signal: ctl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
    return { status: r.status, text, json };
  } catch (e) {
    return { status: 0, text: String(e.message || e), json: null };
  } finally {
    clearTimeout(t);
  }
}

console.log(`Supabase 설정 점검 — ${SUPABASE_URL}`);
console.log('='.repeat(72));

/* ── 1. 키가 공개해도 되는 것인지 ───────────────────────────────
 * ★ 이걸 가장 먼저 본다. service_role 키를 실수로 넣으면 이 파일이 공개 저장소에
 *   올라가는 순간 디비 전체가 열린다. 나머지 검사가 다 통과해도 소용없다. */
console.log('\n── 1. 키 정체');
try {
  const payload = JSON.parse(
    Buffer.from(SUPABASE_ANON_KEY.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
  );
  if (payload.role === 'anon') pass(`role=anon — 공개해도 되는 키 (만료 ${new Date(payload.exp * 1000).toISOString().slice(0, 10)})`);
  else fail(`role=${payload.role} — 이 키를 공개 저장소에 두면 안 된다!`);
  if (!SUPABASE_URL.includes(payload.ref)) fail(`키의 ref(${payload.ref})가 URL 과 다르다`);
} catch (e) {
  // 신형 키(sb_publishable_...)는 JWT 가 아니다 — 형식만 본다
  if (/^sb_publishable_/.test(SUPABASE_ANON_KEY)) pass('publishable 키 (공개 OK)');
  else if (/^sb_secret_/.test(SUPABASE_ANON_KEY)) fail('secret 키다! 공개 저장소에 두면 안 된다');
  else fail(`키 형식을 알 수 없다: ${e.message}`);
}

/* ── 2. 프로젝트가 살아 있는가 ─────────────────────────────────
 * 무료 티어는 유휴 시 일시정지된다. 그때 순위표가 조용히 죽으므로 여기서 잡는다. */
console.log('\n── 2. 프로젝트 도달');
const settings = await get(EP.settings);
if (settings.status === 0) fail(`접속 실패 — ${settings.text}`);
else if (settings.status >= 500) fail(`서버 오류 ${settings.status} — 프로젝트가 일시정지됐을 수 있다`);
else pass(`응답 ${settings.status}`);

/* ── 3. 익명 로그인 ───────────────────────────────────────────
 * 이게 꺼져 있으면 로그인 화면 없이 랭킹에 참여시킬 수 없다. */
console.log('\n── 3. 익명 로그인');
const anonOn = settings.json?.external?.anonymous_users ?? settings.json?.external_anonymous_users;
if (anonOn === true) pass('켜져 있다');
else if (anonOn === false) fail('꺼져 있다 → Authentication → Providers → Anonymous Sign-ins 활성화');
else warn(`상태를 못 읽었다 (${JSON.stringify(anonOn)})`);

/* ── 4. 스키마 ────────────────────────────────────────────────
 * PGRST205 = 테이블 없음. 401/403 = 테이블은 있는데 RLS 가 막았다(정상). */
console.log('\n── 4. 스키마 (db/001_init.sql)');
const TABLES = ['saves', 'saves_archive', 'scores', 'ledger', 'rejections'];
let missing = 0;
for (const t of TABLES) {
  const r = await get(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`);
  if (r.json?.code === 'PGRST205') { fail(`${t} — 테이블이 없다`); missing++; }
  else if (r.status === 200) pass(`${t} — 있다 (익명이 읽을 수 있다: 정책 확인 필요)`);
  else if (r.status === 401 || r.status === 403) pass(`${t} — 있다 (RLS 가 막는다: 정상)`);
  else warn(`${t} — HTTP ${r.status} ${r.text.slice(0, 80)}`);
}
if (missing) console.log(`\n     → SQL Editor 에 db/001_init.sql 을 붙여넣고 실행해라.`);

/* ── 5. 순위표 RPC ───────────────────────────────────────────── */
console.log('\n── 5. 순위표 RPC');
const lb = await get(`${SUPABASE_URL}/rest/v1/rpc/leaderboard?p_kind=abyss&p_limit=1`);
if (lb.json?.code === 'PGRST202') fail('leaderboard() 함수가 없다 — 스키마 미적용');
else if (lb.status === 401 || lb.status === 403) pass('있다 (로그인 필요: 정상)');
else if (lb.status === 200) pass(`있다 — 현재 등재 ${Array.isArray(lb.json) ? lb.json.length : '?'}건`);
else warn(`HTTP ${lb.status} ${lb.text.slice(0, 100)}`);

/* ── 결과 ──────────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(72));
if (fails) {
  console.log(`남은 설정 ${fails}건 — 위의 ✗ 를 처리하면 클라우드를 켤 수 있다.`);
  process.exit(1);
}
console.log('✅ 설정 완료 — 클라우드 계층을 붙일 수 있다.');
