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

/* ── 3. 로그인 제공자 ─────────────────────────────────────────
 *
 * ★★ 예전엔 여기서 「익명 로그인이 꺼져 있다」 를 **실패로** 띄웠다.
 *   그런데 익명은 **일부러 끈 것**이다 (§19.3): 브라우저 저장소가 지워지면 계정이
 *   통째로 사라지고 — iOS PWA 는 며칠 안 쓰면 실제로 정리한다 — 복구 코드는
 *   「코드를 잃으면 끝」이라 문제를 미룰 뿐이었다. 그래서 구글 로그인으로 갈아탔다.
 *
 * ★ 그 사이 이 검사는 **매번 빨간불**이었다. 늘 빨간 검사는 아무도 안 믿게 되고,
 *   실제로 나도 이 줄을 두 번이나 «오탐이겠지» 하고 넘겼다.
 *   ⇒ 검사는 «지금 무엇이 맞는가» 를 봐야 한다. 지금 맞는 것은 **익명 꺼짐 + 구글 켜짐**이다. */
console.log('\n── 3. 로그인 제공자');
const ext = settings.json?.external || {};
const anonOn = ext.anonymous_users ?? settings.json?.external_anonymous_users;
const googleOn = ext.google;

if (anonOn === false) pass('익명 로그인 꺼짐 — 의도한 것이다 (§19.3: 저장소가 지워지면 계정이 사라진다)');
else if (anonOn === true) fail('익명 로그인이 켜져 있다 — §19.3 에서 끄기로 했다 (계정이 조용히 사라진다)');
else warn(`익명 로그인 상태를 못 읽었다 (${JSON.stringify(anonOn)})`);

if (googleOn === true) pass('구글 로그인 켜짐');
else fail('구글 로그인이 꺼져 있다 → 아무도 클라우드에 못 올린다 (지금 유일한 로그인 수단이다)');

/* ★ 이메일 제공자는 Supabase 기본값이라 켜져 있다. 클라이언트는 안 쓴다.
 *   ★★ 그래도 **가입은 된다** — 이 프로젝트는 자료실(침묵의 기록자)과 auth 를 공유하므로
 *   여기서 가입한 사람은 그쪽 Storage 에서도 `authenticated` 다 (§98.6).
 *   막고 싶으면 대시보드에서 Email 제공자를 끈다. 지금은 사실만 적어 둔다. */
if (ext.email === true) {
  warn('이메일 가입이 열려 있다 (Supabase 기본값) — 클라이언트는 구글만 쓴다. auth 는 자료실과 공유된다');
}

/* ── 4. 스키마 ────────────────────────────────────────────────
 * PGRST205 = 테이블 없음. 401/403 = 테이블은 있는데 RLS 가 막았다(정상). */
console.log('\n── 4. 스키마 (db/001_init.sql)');
const TABLES = ['saves', 'saves_archive', 'scores', 'ledger', 'rejections'];
let missing = 0;
for (const t of TABLES) {
  const r = await get(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`);
  if (r.json?.code === 'PGRST205') { fail(`${t} — 테이블이 없다`); missing++; }
  else if (r.status === 200 || r.status === 401 || r.status === 403) pass(`${t} — 있다`);
  else warn(`${t} — HTTP ${r.status} ${r.text.slice(0, 80)}`);
}
if (missing) console.log(`\n     → SQL Editor 에 db/001_init.sql 을 붙여넣고 실행해라.`);

/* ── 4b. RLS 가 **실제로** 막는가 ──────────────────────────────
 * ★ 읽기만으로는 판별이 안 된다. 테이블이 비어 있으면
 *   "RLS 가 0행으로 걸렀다" 와 "권한이 열렸는데 마침 데이터가 없다" 가
 *   똑같이 `200 []` 로 보인다. 그래서 **쓰기**를 시도한다.
 *
 *   42501 = RLS 가 거절 (정상). 그 밖의 응답 = 정책 구멍이다.
 *   보내는 본문은 NOT NULL 컬럼을 일부러 빼 뒀다 — 만에 하나 RLS 가 통과시켜도
 *   제약에 걸려 **아무것도 안 써진다.** 남의 디비에 쓰레기를 남기지 않는다. */
console.log('\n── 4b. RLS 가 실제로 막는가 (쓰기 시도)');
if (missing) {
  warn('테이블이 없어 건너뛴다');
} else {
  for (const t of TABLES) {
    let res;
    try {
      const raw = await fetch(`${SUPABASE_URL}/rest/v1/${t}`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: '00000000-0000-0000-0000-000000000000' }),
      });
      res = { status: raw.status, json: await raw.json().catch(() => null) };
    } catch (e) { warn(`${t} — 요청 실패 ${e.message}`); continue; }

    if (res.json?.code === '42501') pass(`${t} — RLS 가 쓰기를 막는다`);
    else if (res.status < 300) fail(`${t} — ★ 익명이 쓸 수 있다! 정책 구멍이다`);
    else fail(`${t} — RLS 를 통과했다 (${res.json?.code || res.status}: ${res.json?.message || ''})`);
  }
}

/* ── 5. 순위표 RPC ───────────────────────────────────────────── */
console.log('\n── 5. 순위표 RPC');
const lb = await get(`${SUPABASE_URL}/rest/v1/rpc/leaderboard?p_kind=abyss&p_limit=1`);
if (lb.json?.code === 'PGRST202') fail('leaderboard() 함수가 없다 — 스키마 미적용');
else if (lb.status === 200) pass(`있다 — 등재 ${Array.isArray(lb.json) ? lb.json.length : '?'}건 (로그인 없이 읽힌다: 의도한 것)`);
else if (lb.status === 401 || lb.status === 403) warn('로그인해야 읽힌다 — 순위표는 누구나 보는 편이 낫다');
else warn(`HTTP ${lb.status} ${lb.text.slice(0, 100)}`);

/* ── 6. PvP RPC ──────────────────────────────────────────────
 *
 * ★★ 여기는 원래 통째로 비어 있었다 — `supacheck` 가 `leaderboard` 하나만 쳤다.
 *   그래서 PvP 스키마를 안 올려도 «✅ 설정 완료» 가 떴다. **안 재는 검사는 검사가 아니다.**
 *
 * ★ 방향이 둘로 갈린다. 순위표와 편성은 **열려 있어야** 맞고 (로그인 없이 본다),
 *   재생은 **닫혀 있어야** 맞다 (내가 낀 판만). 둘을 같은 잣대로 보면 안 된다.
 */
console.log('\n── 6. PvP RPC');
{
  const rpc = (name, body) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
    .catch((e) => ({ status: 0, json: { message: String(e.message || e) } }));

  const b = await rpc('pvp_board', { p_limit: 5 });
  if (b.json?.code === 'PGRST202') fail('pvp_board() 가 없다 — db/010_pvp.sql 미적용');
  else if (b.status !== 200) fail(`pvp_board — HTTP ${b.status} ${b.json?.message || ''}`);
  else {
    const rows = Array.isArray(b.json) ? b.json : [];
    pass(`pvp_board — 로그인 없이 읽힌다 (${rows.length}단)`);

    /* 편성은 **순위표와 같은 범위**로 열려 있어야 한다.
     * ★ 손잡이가 있어야 물어볼 수 있다 — 등록된 단이 없으면 건너뛴다 (실패가 아니다). */
    const handle = rows[0]?.handle;
    if (!handle) warn('pvp_lineup — 등록된 단이 없어 못 쟀다');
    else {
      const l = await rpc('pvp_lineup', { p_handle: handle });
      if (l.json?.code === 'PGRST202') fail('pvp_lineup() 이 없다 — db/011_pvp_lineup.sql 미적용');
      else if (l.status === 401 || l.status === 403) {
        fail('pvp_lineup — 로그인해야 열린다. 순위표는 로그인 없이 보이므로 버튼만 뜨고 눌리면 실패한다');
      } else if (l.status !== 200) fail(`pvp_lineup — HTTP ${l.status} ${l.json?.message || ''}`);
      else {
        const row = Array.isArray(l.json) ? l.json[0] : null;
        const squads = Array.isArray(row?.units) ? row.units : null;
        if (!squads) fail('pvp_lineup — units 를 안 준다');
        else if ('raw' in (row || {})) fail('pvp_lineup — ★ raw(장비 원본)가 새 나간다');
        else if ('user_id' in (row || {})) fail('pvp_lineup — ★ user_id 가 새 나간다');
        else pass(`pvp_lineup — 로그인 없이 읽힌다 (부대 ${squads.length} · raw/user_id 없음)`);
      }
    }
  }

  /* 재생은 반대다 — 익명에게 남의 판이 보이면 안 된다 */
  const rp = await rpc('pvp_replay', { p_id: 1 });
  if (rp.json?.code === 'PGRST202') fail('pvp_replay() 가 없다 — db/010_pvp.sql 미적용');
  else if (rp.status === 200 && Array.isArray(rp.json) && rp.json.length) {
    fail('pvp_replay — ★ 익명에게 남의 판이 보인다');
  } else pass('pvp_replay — 익명에게는 안 보인다 (의도한 것)');
}

/* ── 결과 ──────────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(72));
if (fails) {
  console.log(`남은 설정 ${fails}건 — 위의 ✗ 를 처리하면 클라우드를 켤 수 있다.`);
  process.exit(1);
}
console.log('✅ 설정 완료 — 클라우드 계층을 붙일 수 있다.');
