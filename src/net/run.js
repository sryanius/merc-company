/**
 * 진행도를 서버로 옮긴다 / 서버 것을 받아 온다 — §104 1단계
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ **이관은 계정당 한 번이다.** 서버의 `run_state.imported_at` 이 자물쇠고,
 *   두 번째 호출은 `{ok:false, reason:'already'}` 로 조용히 돌아온다.
 *   그래서 «잘못된 세이브로 이관» 이 되돌릴 수 없는 실수가 된다 — 부르는 쪽이
 *   **무엇을 올리는지 사람에게 보여 주고** 확인을 받아야 한다.
 *
 * ★★ 행 모양은 `game/runrows.js` 의 `toRows()` 가 만든다 — 서버도 같은 파일을 쓴다
 *   (`supabase/functions/submit-score/_power/runrows.js`). **사상은 한 벌이다.**
 *   여기서 모양을 손으로 만들면 그 순간 두 벌이 되고 반드시 갈라진다 (§94·§107·§112).
 *
 * ★ Edge Function 이 없다. `run_import` 이 `authenticated` 에게 열려 있어서
 *   RPC 로 바로 부른다 (§115). 서버는 `auth.uid()` 로 **자기 계정에만** 쓴다.
 *
 * ★ 이 모듈은 `rest.js` 의 규칙을 따른다 — **절대 throw 하지 않는다.**
 *   결과를 `{ok, status, data, error}` 로 돌려준다.
 *
 * @module net/run
 */
import { EP } from './config.js';
import { authed } from './rest.js';
import * as Auth from './auth.js';
import { toRows, fromRows } from '../game/runrows.js';

/**
 * 세이브를 서버로 옮긴다. **계정당 한 번.**
 *
 * @param {object} state 게임 state (살아 있는 객체 그대로 넘겨도 된다)
 * @returns {Promise<{ok:boolean, status:number, data:*, error:string}>}
 *   성공하면 `data` 가 `{ok:true, mercs, items, squads, pets}` 다.
 *   이미 이관했으면 `data` 가 `{ok:false, reason:'already'}` — **HTTP 는 200 이다.**
 */
export async function importRun(state) {
  let rows = null;
  try {
    rows = toRows(state);
  } catch (e) {
    /* ★ `toRows` 는 «한 아이템이 두 곳에 착용» 같은 모순에서 던진다.
     *   그건 서버 잘못이 아니라 세이브가 이상한 것이다 — 사람이 볼 수 있게 그대로 알린다. */
    return { ok: false, status: 0, data: null, error: `세이브를 옮길 모양으로 못 바꿨다: ${(e && e.message) || e}` };
  }
  return authed(EP.rpc('run_import'), { method: 'POST', body: { p_rows: rows } }, Auth);
}

/**
 * 「내 진행도가 서버 표에 있나」 — **싸게** 묻는다 (db/023).
 *
 * ★★ 접속할 때마다 물어야 하는데 `snapshot()` 은 명부·장비를 **통째로** 돌려준다.
 *   실계정은 아이템이 1372개다 — 예/아니오 하나 물자고 그걸 매번 내려받으면
 *   느린 기기에서 첫 화면이 늦는다.
 *
 * @returns {Promise<{ok:boolean, status:number, data:*, error:string}>}
 *   `data` 는 `{ok:true, day, importedAt, updatedAt}` 또는 `{ok:false, reason:'none'|'auth'}`.
 *   ★ `reason` 은 `snapshot()` 과 **같은 말**을 쓴다 — 부르는 쪽이 둘을 같은 식으로 읽는다.
 */
export async function stateInfo() {
  return authed(EP.rpc('run_state_info'), { method: 'POST', body: {} }, Auth);
}

/**
 * 서버가 가진 진행도를 통째로 받아 온다.
 *
 * ★ 아직 이관 안 했으면 `data` 가 `{ok:false, reason:'none'}` 이다 (오류가 아니다).
 */
export async function snapshot() {
  return authed(EP.rpc('run_snapshot'), { method: 'POST', body: {} }, Auth);
}

/**
 * 「이 세이브를 옮기면 무엇이 올라가나」 — **누르기 전에 보여 줄 요약.**
 *
 * ★★ 이관이 되돌릴 수 없으므로, 사람이 «내 것이 맞나» 를 확인할 수 있어야 한다.
 *   서버를 부르지 않는다 — 순수 계산이다.
 */
export function preview(state) {
  try {
    const r = toRows(state);
    const s = r.state || {};
    return {
      ok: true,
      companyName: s.company_name || '(이름 없음)',
      day: s.day || 0,
      gold: s.gold || 0,
      mercs: (r.mercs || []).length,
      sMercs: (r.mercs || []).filter((m) => m && m.grade === 'S').length,
      items: (r.items || []).length,
      worn: (r.items || []).filter((i) => i && i.equipped_by).length,
      squads: (r.squads || []).length,
      pets: (r.pets || []).length,
      abyss: s.abyss_best || 0,
      tower: s.tower_best || 0,
      /* ★★ **이건 바이트가 아니다.** `String.length` 는 UTF-16 코드유닛 수이고,
       *   게임 데이터가 한글이라 실바이트보다 **약 9.5% 적게** 잰다.
       *   게다가 서버 상한은 또 다른 양이다 — `db/016:57` 의 `pg_column_size` 는
       *   **jsonb 이진 크기**(텍스트의 약 1.45배)지 JSON 텍스트 길이가 아니다.
       *
       *   ⇒ **`kb` × 약 1.6 ≈ 서버가 보는 크기.** 4MB(4,096KB)에 닿는 `kb` 는
       *     4,096 이 아니라 **약 2,550** 이다. 그렇게 읽어라 (§122.4). */
      kb: Math.round(JSON.stringify(r).length / 1024),
      /* ★ 그래서 서버가 볼 크기의 어림값을 같이 준다 — 사람이 곱셈을 안 하게. */
      serverKb: Math.round((JSON.stringify(r).length * 1.10 * 1.45) / 1024),
      serverCapKb: 4096,
      /* ★★ **상한이 둘이다.** `run_state.data` 에 256KB CHECK 가 따로 있고
       *   (`db/015_run_state_gaps.sql`), 이건 얌전히 `{ok:false}` 를 주지 않고
       *   **HTTP 500 으로 터진다** — `db/016` 이 `data` 를 자르지도 검사하지도 않고
       *   그대로 넣기 때문이다. 4MB 만 보고 「넉넉하다」 고 하면 이 쪽에서 걸린다.
       *
       *   실측 참고: 도시 목록이 1곳 살아 있으면 ≈26KB · 3곳 ≈60KB · 16곳 ≈305KB(넘는다).
       *   목록은 `REFRESH_DAYS`(3) 가 지나야 만료되므로 여러 도시 것이 동시에 살 수 있다.
       *
       * ★★ 이 `dataKb` 는 **보수적으로 크게** 잡은 값이다 — `run_state.data` 는 **저장된
       *   열**이라 TOAST 로 압축된다. 실측: 텍스트 50,880 B 가 저장 **13,344 B** 였다
       *   (약 1/4). 반면 4MB 쪽(`p_rows`)은 **매개변수** jsonb 라 압축이 안 되고
       *   실측 비율이 **1.36** 이었다. ⇒ `serverKb` 의 ×1.45 는 맞고, `dataKb` 는
       *   여유를 실제보다 **좁게** 보고한다. 틀리는 방향이 안전한 쪽이라 그대로 둔다. */
      dataKb: Math.round((JSON.stringify((r.state || {}).data || {}).length * 1.10 * 1.45) / 1024),
      dataCapKb: 256,
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * 서버가 가진 진행도를 받아 **이 기기에 적용한다.**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ **이 함수의 존재 이유는 첫 세 줄이다.**
 *
 *   `run_snapshot` 은 이관 전이면 `{ok:false, reason:'none'}` 을 준다 — 그리고
 *   **오늘 모든 계정이 정확히 그 응답을 받는다** (이관 실적 0건).
 *   그런데 `fromRows({ok:false, reason:'none'})` 는 **던지지 않는다.**
 *   `state`·`mercs` 가 없으니 빈 값으로 채운 **15칸짜리 객체**를 돌려주고,
 *   `importState()` 는 그걸 받아 **`true` 를 돌려준다.**
 *
 *   실측 (120일차 판에 그대로 태워 봤다):
 *     적용 전 `{day:121, roster:4, companyName:'진행중인판'}`
 *     적용 후 `{roster:0, companyName:''}` — `day`·`gold` 는 **undefined**
 *     그리고 `importState` 의 반환값은 **`true`** 였다. 성공으로 보인다.
 *
 *   ⇒ 가드가 없으면 **오늘 이 버튼을 누른 사람은 전부 판이 지워진다.**
 *     그래서 «데이터가 왔나» 를 `data.ok === true` 로 **명시적으로** 묻는다.
 *     `res.ok`(HTTP 200)만 보면 안 된다 — 저 응답도 HTTP 200 이다.
 *
 * ★ 적용 전에 로컬 원본을 `cloud.js` 의 롤백 자리와 **같은 칸**에 남긴다.
 *   두 벌로 만들면 갈라진다 — 그래서 키를 여기서 새로 만들지 않고 주입받는다.
 *
 * @param {object} opts
 * @param {(state:object)=>boolean} opts.applyState 적용 함수 (`State.importState`)
 * @param {()=>Promise<object>} [opts.fetchSnapshot] 스냅샷을 가져오는 함수.
 *   기본값은 이 모듈의 `snapshot` 이다. ★ 시험용 뒷문이 아니라 **나머지 셋과 같은
 *   모양의 의존성 주입**이다 — 이 함수의 값어치가 「응답을 어떻게 거르나」 에 있으므로
 *   그 거름망을 굴려 보려면 응답을 손에 쥘 수 있어야 한다.
 * @param {()=>string|null} [opts.readRaw] 지금 로컬 세이브 원문 (백업용)
 * @param {(raw:string)=>void} [opts.backup] 원본을 남기는 곳 (`cloud.js` 의 롤백 칸)
 * @returns {Promise<{ok:boolean, reason:string, applied:boolean, error:string}>}
 */
export async function pull(opts) {
  const o = opts || {};
  const res = await (typeof o.fetchSnapshot === 'function' ? o.fetchSnapshot() : snapshot());

  /* ★★★ 여기가 이 함수의 전부다. 순서를 바꾸지 마라. */
  if (!res.ok) return { ok: false, reason: 'net', applied: false, error: res.error || '' };
  if (!res.data || res.data.ok !== true) {
    return { ok: false, reason: String(res.data?.reason || 'none'), applied: false, error: '' };
  }

  /* ★ 여기서부터만 «서버에 진짜 데이터가 있다» 가 참이다. */
  let st = null;
  try {
    st = fromRows(res.data);
  } catch (e) {
    return { ok: false, reason: 'shape', applied: false, error: String((e && e.message) || e) };
  }
  /* ★ 그래도 한 번 더 본다 — 사상이 바뀌어도 판이 안 지워지게. */
  if (!st || !Array.isArray(st.roster) || !st.roster.length || !(Number(st.day) > 0)) {
    return { ok: false, reason: 'empty', applied: false, error: '' };
  }

  /* ★★ 적용 **전에** 원본을 남긴다. 실패하면 적용하지 않는다. */
  try {
    if (typeof o.readRaw === 'function' && typeof o.backup === 'function') {
      const raw = o.readRaw();
      if (raw) o.backup(raw);
    }
  } catch (e) {
    return { ok: false, reason: 'backup', applied: false, error: String((e && e.message) || e) };
  }

  let applied = false;
  try {
    applied = o.applyState(st) === true;
  } catch (e) {
    return { ok: false, reason: 'apply', applied: false, error: String((e && e.message) || e) };
  }
  return { ok: applied, reason: applied ? '' : 'apply', applied, error: '' };
}
