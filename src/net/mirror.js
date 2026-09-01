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

/* ★ 권위 경로(`askSell`·`askEquip`)가 **이미 서버에 적용한** uid 들.
 *   거울이 같은 것을 또 보내면 왕복만 낭비다 (서버는 op_id 로 걸러 주지만). */
const handled = new Set();
const eqHandled = new Set();

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
 * 판매를 **서버에 먼저 묻는다** — §104 10단계 (권위)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 서버의 `sell` 은 **부분 성공**이다: 못 파는 것은 조용히 건너뛰고 판 것만 정산한다.
 *   그래서 「막힌다/안 막힌다」 가 아니라 **「어느 것이 거절됐나」** 를 돌려준다.
 *
 * ★★★ 거절 사유 중 **«없다» 는 막지 않는다.** 그건 신품 전리품이다 —
 *   서버 사본에 아이템 «생김» 은 안 따라온다 (§149: 전리품의 정체를 못 확인한다).
 *   실측으로 그 비율이 크다 (31점 중 16점). 막으면 정상 판매가 절반쯤 막힌다.
 *
 * ★ 그리고 서버는 물어보는 순간 **이미 판다.** 그래서 이 함수를 쓴 uid 는
 *   거울을 또 보내지 않는다 (`handled` 에 담아 둔다).
 *
 * @returns {Promise<{ok:boolean, blocked:Set<string>, why:string}>}
 *   `blocked` 에 든 uid 만 **팔지 않는다.** 못 물었으면 빈 집합이다 (= 오늘 동작).
 */
export async function askSell(uids, day) {
  const none = (why) => ({ ok: false, blocked: new Set(), why });
  try {
    if (!Auth || typeof Auth.accessToken !== 'function' || !Auth.accessToken()) return none('로그인안됨');
    const list = (Array.isArray(uids) ? uids : []).map(String).filter(Boolean).slice(0, 400);
    if (!list.length) return none('빈목록');

    const r = await authed(EP.fn('run-op'), {
      method: 'POST',
      timeout: 6000,
      body: { op: 'sell', opId: `sl_${list[0]}_${list.length}_${day || 0}`.slice(0, 64), rev: CLIENT_REV, uids: list },
    }, Auth);

    if (!r || !r.ok) return none(`상태${r && r.status}`);
    for (const u of list) handled.add(u);          // 서버가 이미 팔았다 — 거울을 또 보내지 않는다

    const blocked = new Set();
    const skipped = (r.data && r.data.skipped) || [];
    for (const s of skipped) {
      const why = String((s && s.why) || '');
      /* ★★ «없다» 는 **막지 않는다** — 신품 전리품이다 (실측 31점 중 16점) */
      if (/없다/.test(why)) { handled.delete(String(s.uid)); continue; }
      blocked.add(String(s && s.uid));
    }
    return { ok: true, blocked, why: '서버판정' };
  } catch (e) {
    return none('예외');
  }
}

/**
 * 착용을 **서버에 먼저 묻는다** — §104 11단계 (권위)
 *
 * ★ 전직과 같은 모양이다: **409 만** 막고 나머지는 오늘 동작.
 *   ★★ 서버는 **낡지 않는 것**만 문다 (부위·무기 타입·세트 계열). 레벨은 안 본다 (§150.2).
 */
export async function askEquip(mercUid, itemUid, slot, day) {
  const fall = (why) => ({ ok: false, blocked: false, reason: '', why });
  try {
    if (!Auth || typeof Auth.accessToken !== 'function' || !Auth.accessToken()) return fall('로그인안됨');
    const m = String(mercUid || '');
    const i = String(itemUid || '');
    if (!m || !i) return fall('인자없음');

    const r = await authed(EP.fn('run-op'), {
      method: 'POST',
      timeout: 6000,
      body: {
        op: 'equip', rev: CLIENT_REV, mercUid: m, itemUid: i, slot: slot == null ? null : String(slot),
        opId: `eq_${i}_${day || 0}_${slot == null ? 'off' : slot}`.slice(0, 64),
      },
    }, Auth);

    if (r && r.ok) { eqHandled.add(i); return { ok: true, blocked: false, reason: '', why: '서버승인' }; }
    if (r && r.status === 409) {
      const why = String(r.error || '');
      if (/처리 중/.test(why)) return fall('재시도중');
      return { ok: false, blocked: true, reason: why, why: '서버거절' };
    }
    if (r && r.status === 404) return fall('사본에없음');
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

/* ══════════════════════════════════════════════════════════════════════════
 * **모아서 한 번에 보낸다** — 이게 판매 거울을 가능하게 만드는 전부다
 *
 * ★★★ 전에 나는 「자동판매는 요청이 수백 개 나가니 판매는 거울을 못 건다」 고 적었다.
 *   **그건 op 을 낱개로 걸 때만 참이다.** 서버의 `sell` 은 `uids` 를 **배열로** 받고
 *   부분 성공을 돌려준다 (최대 500). 그러니 한 번에 모으면 **의뢰 한 건에 요청 1회**다.
 *
 * ★ 그래서 갈고리는 «한 점 팔았다» 만 알리고, 여기서 조용해질 때까지 기다렸다 보낸다.
 *   `autoSellLoot` 이 50점을 팔아도 요청은 하나다.
 *
 * ★★ 그래도 **게임을 막지 않는다** — 타이머로 미루고, 보낸 뒤엔 안 본다.
 * ★ 500개를 넘기면 그 자리에서 한 묶음 내보낸다 (서버 상한이 500이다).
 * ══════════════════════════════════════════════════════════════════════════ */
const SELL_MAX = 400;          // 서버 상한 500 아래로 여유를 둔다
const QUIET_MS = 400;          // 이만큼 조용하면 한 묶음으로 본다
let sellBuf = [];
let sellTimer = null;
let sellDay = 0;

function flushSell() {
  if (sellTimer) { clearTimeout(sellTimer); sellTimer = null; }
  const uids = sellBuf;
  sellBuf = [];
  if (!uids.length) return;
  /* ★ 한 줄 남긴다 — 「모아서 한 번에」 가 실제로 도는지 사람이 볼 수 있어야 한다.
   *   50점을 팔았는데 이 줄이 50번 찍히면 모으기가 깨진 것이다. */
  console.info('[거울] 판매', uids.length, '점을 한 번에 보낸다');
  mirrorSell(uids, sellDay);
}

/**
 * 「한 점 팔았다」 를 모은다. **부르는 쪽은 이것만 부르면 된다.**
 * @param {string} uid
 * @param {number} day
 */
export function noteSold(uid, day) {
  try {
    const u = String(uid || '');
    if (!u) return;
    /* ★ 권위 경로가 이미 서버에 적용했다 — 또 보내지 않는다 */
    if (handled.has(u)) { handled.delete(u); return; }
    sellDay = Math.round(Number(day) || 0) || sellDay;
    sellBuf.push(u);
    if (sellBuf.length >= SELL_MAX) { flushSell(); return; }
    if (sellTimer) clearTimeout(sellTimer);
    sellTimer = setTimeout(flushSell, QUIET_MS);
  } catch (e) { console.warn('[거울] 판매를 모으지 못했다 (게임에는 영향 없다)', e); }
}

/**
 * 「끼거나 벗었다」 를 알린다.
 *
 * ★ 착용은 한 번에 한 점이라 모을 필요가 없다 — 다만 `autoEquipAll` 이 여러 번 부를 수
 *   있어서 **같은 장비의 마지막 상태만** 보낸다 (연속 호출을 접는다).
 */
const eqBuf = new Map();
let eqTimer = null;

function flushEquip() {
  if (eqTimer) { clearTimeout(eqTimer); eqTimer = null; }
  const list = [...eqBuf.values()];
  eqBuf.clear();
  for (const e of list) mirrorEquip(e.mercUid, e.itemUid, e.slot, e.day);
}

export function noteEquip(mercUid, itemUid, slot, day) {
  try {
    if (!itemUid) return;
    /* ★ 권위 경로가 이미 서버에 적용했다 — 또 보내지 않는다 */
    if (eqHandled.has(String(itemUid))) { eqHandled.delete(String(itemUid)); return; }
    /* 같은 장비를 여러 번 옮기면 **마지막 것만** 뜻이 있다 */
    eqBuf.set(String(itemUid), { mercUid: String(mercUid || ''), itemUid: String(itemUid), slot, day });
    if (eqTimer) clearTimeout(eqTimer);
    eqTimer = setTimeout(flushEquip, QUIET_MS);
  } catch (e) { console.warn('[거울] 착용을 모으지 못했다 (게임에는 영향 없다)', e); }
}
