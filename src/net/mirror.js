/**
 * 서버의 진행도 사본을 **따라오게 한다** — §104 9·10·11단계의 배선
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ 왜 «거울» 인가 (권위가 아니라)
 *   9·10·11단계는 전직·판매·착용을 **서버가 결정하게** 만드는 것이었다. 그런데 그
 *   RPC 들은 서버에만 있고 화면에 안 이어져 있었다 — 실측 `run_ops` **0건**이다.
 *   («배선이 안 됐다» 고 짚었는데, 사실은 배선했어도 안 됐다: `run-op` 에 CORS 가
 *    통째로 없어서 브라우저가 그 함수를 한 번도 못 불렀다, §139.)
 *
 *   그래서 **두 걸음으로 나눈다:**
 *     ① 거울 — 클라가 하던 대로 하고, 서버에 «나 이거 했다» 고 알린다 (여기)
 *     ② 권위 — 서버가 결정하고 클라는 그 결과를 받는다 (그림자가 «항상 같다» 를
 *        보여 준 뒤에 넘어간다)
 *
 *   ①이 먼저인 이유: **지금 막고 있는 것은 «누가 결정하나» 가 아니라 «서버 사본이
 *   낡는다» 다.** 관측이 그 값을 그대로 보여 준다 — 이관 스냅숏이 사흘 만에
 *   `dayLag 56` 이 됐고, 전력 차 −137 은 치트가 아니라 **시차**였다.
 *   낡은 사본으로는 18단계(순위 축 전환)를 못 켠다.
 *
 * ★★ **게임 흐름을 절대 막지 않는다.** `settle.js` 와 같은 계약이다:
 *   · `await` 하지 않는다 · 전체 try/catch · 응답을 안 본다 · 실패해도 아무 일도 안 한다
 *   ⇒ 서버가 죽어도 게임은 그대로 돌아간다. 이 파일이 통째로 던져도 마찬가지다.
 *
 * ★ 서버가 «아직 이관 전» 이면 404 를 준다. 그것도 **정상**이다 — 7계정 중 6이 그렇다.
 *   조용히 넘어가고, 이관하면 저절로 붙는다.
 *
 * ★ `op_id` 는 **그 행동 하나**를 가리켜야 한다. 같은 것을 두 번 보내도 서버가
 *   `run_ops` 로 걸러 준다 (db/015). 그래서 재시도가 안전하다.
 *
 * @module net/mirror
 */
import { EP, CLIENT_REV } from './config.js';
import { authed } from './rest.js';
import * as Auth from './auth.js';

/** 콘솔에 남길 때 쓰는 이름 */
const LABEL = { promote: '전직', sell: '판매', equip: '착용' };

/**
 * op 하나를 서버에 알린다. **기다리지 않는다.**
 *
 * ★ 이 함수는 **절대 던지지 않는다.** 부르는 쪽이 try 로 감쌀 필요가 없어야
 *   「거울 때문에 게임이 멈췄다」 가 원리적으로 불가능해진다.
 *
 * @param {string} op 'promote' | 'sell' | 'equip'
 * @param {string} opId 이 행동 하나를 가리키는 열쇠 (같으면 서버가 재생으로 본다)
 * @param {object} body 나머지 인자
 */
function send(op, opId, body) {
  try {
    if (!Auth || typeof Auth.accessToken !== 'function' || !Auth.accessToken()) return;
    const payload = { op, opId: String(opId || '').slice(0, 64), rev: CLIENT_REV, ...body };
    if (!payload.opId) return;

    Promise.resolve(authed(EP.fn('run-op'), { method: 'POST', body: payload }, Auth))
      .then((r) => {
        const name = LABEL[op] || op;
        if (r && r.ok) return;                       // 조용히 성공한다 (평소가 이쪽이다)
        /* ★ 404 = 아직 이관 전. 사고가 아니라 «아직» 이다 — 경고로 안 띄운다. */
        if (r && r.status === 404) { console.info(`[거울] ${name} — 아직 서버에 진행도가 없다`); return; }
        console.warn(`[거울] ${name} 을(를) 서버가 안 받았다`, r && r.status, r && r.error);
      })
      .catch((e) => { console.warn('[거울] 못 보냈다 (게임에는 영향 없다)', e); });
  } catch (e) {
    console.warn('[거울] 신고를 만들지 못했다 (게임에는 영향 없다)', e);
  }
}

/**
 * 전직을 **서버에 묻는다** — 여기서부터 서버가 «권위» 를 갖는다 (§104 9단계)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ 거울(`mirrorPromote`)과 무엇이 다른가:
 *   · 거울 — 클라가 하고 **알린다.** 서버가 뭐라 하든 클라가 한 대로 간다
 *   · 권위 — **먼저 묻고**, 서버가 «안 된다» 하면 **안 한다**  ← 여기
 *
 * ★★ 그래서 «안 된다» 를 **아주 좁게** 잡는다. 서버가 «그 전직은 규칙 위반이다» 라고
 *   분명히 말할 때(409)만 막는다. 그 밖에는 전부 **지금까지대로 클라가 한다**:
 *
 *     · 404 — 아직 이관 안 한 계정. 실측 8명 중 2명이 그렇다. **막으면 안 된다.**
 *     · 0/500/시간초과 — 네트워크·서버 문제. 게임을 못 하게 만들 이유가 없다
 *     · 400 — 내가 잘못 보낸 것. 그것 때문에 사람 게임을 막지 않는다
 *
 *   ⇒ **최악이라도 «오늘 동작»** 이다. 새로 막히는 사람이 생기지 않는다.
 *
 * ★ 기다린다. 다만 **6초까지만** — 버튼이 15초 멈춰 있으면 그게 곧 고장이다.
 *
 * @param {string} mercUid
 * @param {string} toClass
 * @returns {Promise<{ok:boolean, blocked:boolean, reason:string, why:string}>}
 *   `blocked` 가 참일 때만 부르는 쪽이 전직을 **하지 않는다**.
 */
export async function askPromote(mercUid, toClass) {
  const fall = (why) => ({ ok: false, blocked: false, reason: '', why });
  try {
    if (!Auth || typeof Auth.accessToken !== 'function' || !Auth.accessToken()) return fall('로그인안됨');
    const uid = String(mercUid || '');
    const to = String(toClass || '');
    if (!uid || !to) return fall('인자없음');

    const r = await authed(EP.fn('run-op'), {
      method: 'POST',
      timeout: 6000,
      body: { op: 'promote', opId: `pr_${uid}_${to}`.slice(0, 64), rev: CLIENT_REV, mercUid: uid, toClass: to },
    }, Auth);

    if (r && r.ok) return { ok: true, blocked: false, reason: '', why: '서버승인' };
    /* ★★ **409 만 막는다.** 서버가 규칙으로 거절한 경우다.
     *   ★ 「같은 요청이 이미 처리 중이다」 도 409 인데, 그건 **막을 일이 아니다** —
     *     같은 op_id 라 곧 재생으로 ok 가 된다. 사유 글자로 가른다. */
    if (r && r.status === 409) {
      const why = String((r.error || ''));
      if (/처리 중/.test(why)) return fall('재시도중');
      return { ok: false, blocked: true, reason: why, why: '서버거절' };
    }
    if (r && r.status === 404) return fall('이관전');
    return fall(`상태${r && r.status}`);
  } catch (e) {
    return fall('예외');
  }
}

/**
 * 전직 한 건.
 * ★ `op_id` 에 **어느 클래스로** 갔는지를 넣는다 — 같은 단원이 2차→3차→4차로 가므로
 *   uid 만으로는 두 번째 전직이 «재생» 으로 막힌다.
 */
export function mirrorPromote(mercUid, toClass) {
  send('promote', `pr_${mercUid}_${toClass}`, { mercUid: String(mercUid || ''), toClass: String(toClass || '') });
}

/**
 * 판매 (여러 점 가능).
 * ★ 서버는 **못 파는 것을 조용히 건너뛰고** 판 것만 정산한다 — 부분 성공이 답이다.
 *   여기서도 그 결과를 안 본다. 거울의 일은 «서버 사본을 따라오게» 하는 것뿐이다.
 * @param {string[]} uids
 * @param {number} day 세이브의 오늘 — 같은 장비를 다른 날 또 팔 수는 없지만,
 *   `op_id` 를 날짜로 갈라 두면 서버 원장을 사람이 읽기 쉬워진다.
 */
export function mirrorSell(uids, day) {
  const list = (Array.isArray(uids) ? uids : []).map(String).filter(Boolean).slice(0, 500);
  if (!list.length) return;
  /* ★ 목록 전체를 열쇠에 담을 수는 없다 (64자). 첫 uid + 개수 + 날로 가른다 —
   *   같은 묶음을 두 번 보내면 같은 열쇠가 되어 서버가 재생으로 막는다. */
  send('sell', `sl_${list[0]}_${list.length}_${day || 0}`, { uids: list });
}

/**
 * 착용 / 해제. `itemUid` 는 그대로, 벗기려면 `slot` 을 null 로 둔다.
 * ★ 판정은 서버의 `equipIssue`(gear.js) 가 한다 — 여기서 다시 묻지 않는다.
 */
export function mirrorEquip(mercUid, itemUid, slot, day) {
  if (!mercUid || !itemUid) return;
  send('equip', `eq_${itemUid}_${day || 0}_${slot == null ? 'off' : slot}`,
    { mercUid: String(mercUid), itemUid: String(itemUid), slot: slot == null ? null : String(slot) });
}
