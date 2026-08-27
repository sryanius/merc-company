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
import { toRows } from '../game/runrows.js';

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
      /* 대략적인 크기 — 1MB 를 넘는 세이브가 실재한다 (실측 최대 1,046KB) */
      kb: Math.round(JSON.stringify(r).length / 1024),
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
