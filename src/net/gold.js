/**
 * 유저간 골드 송금 — 「순위표 보고 부탁하고, 승낙하면 보낸다」
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 이건 **은행 이체가 아니다.** 이 게임에서 골드는 클라이언트가 신고하는 값이고,
 *   서버는 `ledger.gold` 에 «마지막으로 받아들인 값» 만 들고 있다.
 *   서버가 하는 일은 «가능한 범위인가» 를 보고 **장부를 맞춰 주는 것**이다.
 *   서로 아는 사이의 도와주기로는 충분하고, 경제의 근간으로 삼을 것은 아니다.
 *   (자세한 한계는 `db/012_gold_gift.sql` 머리말에 적어 뒀다.)
 *
 * ★★ **지목은 «부탁» 한 번뿐이다.** 순위표는 user_id 도 handle 도 안 준다(일부러 그렇다).
 *   그래서 «순위 + 내가 본 이름» 으로 짚고, 서버가 이름을 대조해 다르면 거절한다.
 *   빗나가도 «엉뚱한 사람에게 부탁이 갔다» 로 끝난다 — 그 사람이 거절하면 그만이다.
 *   **골드가 실제로 오가는 것은 그 부탁 행의 id 로만** 이루어지므로 잘못 갈 수가 없다.
 *
 * @module net/gold
 */
import { EP } from './config.js';
import { authed } from './rest.js';
import * as Auth from './auth.js';

/** 부탁한다 (구걸). @param {string} kind 순위 축 @param {number} rank @param {string} seenName 내가 본 이름 */
export async function beg(kind, rank, seenName) {
  return authed(EP.rpc('gold_beg'), {
    method: 'POST',
    body: { p_kind: kind, p_rank: Math.max(1, Math.round(rank)), p_seen_name: seenName },
  }, Auth);
}

/** 내 부탁함 — 내가 받은 부탁('in')과 내가 건 부탁('out') */
export async function inbox() {
  return authed(EP.rpc('gold_inbox'), { method: 'POST', body: {} }, Auth);
}

/** 승낙하고 보낸다 (1만 / 10만 / 50만) */
export async function send(id, amount) {
  return authed(EP.rpc('gold_send'), { method: 'POST', body: { p_id: id, p_amount: amount } }, Auth);
}

/** 거절한다 */
export async function decline(id) {
  return authed(EP.rpc('gold_decline'), { method: 'POST', body: { p_id: id } }, Auth);
}

/**
 * 아직 세이브에 안 넣은 몫을 **한 번에** 받아 온다.
 *
 * ★★ 두 번 불러도 두 번째는 0 이다 (서버가 «반영했다» 를 찍는다).
 *   그러니 **받은 delta 를 세이브에 더하고 바로 저장**해야 한다 —
 *   중간에 죽으면 그 몫은 사라진다. 복사되는 것보다는 낫다.
 */
export async function applyPending() {
  return authed(EP.rpc('gold_apply'), { method: 'POST', body: {} }, Auth);
}

/** 보낼 수 있는 금액 (서버의 check 제약과 **같아야 한다**) */
export const AMOUNTS = [10_000, 100_000, 500_000];
