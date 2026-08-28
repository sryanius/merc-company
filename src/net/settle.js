/**
 * 의뢰 정산을 **서버에 신고만** 한다 — §104 17단계 1번 조각
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 이 모듈은 **아무것도 바꾸지 않는다.** 판정도 안 하고, 응답도 안 본다.
 *   서버가 의뢰 정산을 **한 번도 본 적이 없어서** 먼저 채널부터 판다.
 *
 * ★★★ **부르는 자리가 이 모듈의 전부다.** `autoSellLoot()` **앞**에서 불러야 한다.
 *   그 함수가 `applyQuestResult` 뒤·`save()` 앞에서 도는데(ui/battle.js),
 *   자동판매 수익이 골드에 섞이면 서버가 보는 델타가 오염된다.
 *   그리고 그 항은 **아이템 스탯이 정하므로 §113 때문에 원리적으로 못 뺀다.**
 *   ⇒ 뒤에서 부르면 어떤 밴드도 정상 플레이어를 거절하게 된다.
 *
 * ★ 게임 흐름을 **절대** 막지 않는다:
 *   · `await` 하지 않는다 (fire-and-forget)
 *   · 전체가 try/catch — 신고를 만들다 던져도 `save()` 가 돌아야 한다
 *   · 응답을 안 본다. 실패해도 아무 일도 안 한다
 *
 * ★ 서버는 `run_ops` 에 **안 적는다** (그림자의 계약). 적으면 나중에 진짜 정산이
 *   재생으로 막힌다 — 15단계 하루 넘기기와 같은 이유다.
 *
 * @module net/settle
 */
import { EP, CLIENT_REV } from './config.js';
import { authed } from './rest.js';
import * as Auth from './auth.js';

/** 신고에 실을 수 있는 최대 웨이브 수 — 본문이 커지면 안 된다 */
const MAX_WAVES = 12;

/**
 * 의뢰 정산 한 건을 신고한다. **기다리지 않는다.**
 *
 * @param {object} o
 * @param {object} o.state   살아 있는 게임 state (읽기만)
 * @param {object} o.quest   정산한 의뢰
 * @param {object} o.applied `applyQuestResult` 가 돌려준 것
 * @param {object[]} o.results 웨이브 결과 배열
 * @param {string} o.squadId
 */
export function reportSettle(o) {
  try {
    const st = o && o.state;
    const q = o && o.quest;
    const a = o && o.applied;
    if (!st || !q || !a) return;
    if (!Auth || typeof Auth.accessToken !== 'function' || !Auth.accessToken()) return;

    const cityId = String(q.cityId || st.cityId || '');
    const book = (st.quests || {})[cityId];
    const results = Array.isArray(o.results) ? o.results : [];

    const body = {
      op: 'questSettle',
      rev: CLIENT_REV,
      /* ★ `op_id` 는 «이 정산 한 건» 이다. 같은 의뢰를 다시 이기면 다른 id 다
       *   (id 에 day 가 박혀 있고 승리하면 목록에서 지워진다). */
      opId: `qs_${q.id}_${st.day}_${o.squadId || ''}`.slice(0, 64),
      questId: String(q.id || ''),
      cityId,
      listDay: book ? Number(book.day) || 0 : 0,
      day: Number(st.day) || 0,
      squadId: String(o.squadId || ''),
      win: !!a.win,
      progress: Number(a.progress),
      /* 클라가 «주었다» 고 신고하는 값 — 자동판매 **전** 이다 */
      신고: {
        gold: Math.round(Number(a.gold) || 0),
        exp: Math.round(Number(a.exp) || 0),
        renown: Math.round(Number(a.renown) || 0),
        itemsN: Array.isArray(a.items) ? a.items.length : 0,
      },
      /* ★ 저장본의 보상을 같이 보낸다 — 서버가 아직 재생성을 못 하니
       *   「클라가 주장하는 G」 와 「저장본의 G」 가 같은지부터 본다. */
      reward: q.reward || null,
      waves: results.slice(0, MAX_WAVES).map((r) => ({
        winner: r && r.winner ? String(r.winner) : null,
        time: Math.round((Number(r && r.time) || 0) * 100) / 100,
        /* ★ `margin` 이 없으면 **후퇴**다 — `finish()` 를 안 지났다는 뜻이다.
         *   값은 안 보낸다 (크고, 여기서는 «있나» 만 쓴다). */
        margin: !!(r && r.margin),
      })),
      waveN: results.length,
      questWaveN: Array.isArray(q.waves) ? q.waves.length : 0,
      autoSellRarity: Number(st.autoSellRarity),
    };

    /* ★★ 여기서 `await` 하지 않는다. 실패해도 아무 일도 안 한다.
     *
     * ★ 다만 **조용히 삼키지는 않는다.** 신고가 0건인데 「고장인가 옛 셸인가 안 했나」 를
     *   구별 못 해 헤맨 적이 있다 (§137). 콘솔에 한 줄 남긴다 —
     *   게임에는 영향이 없고, 사람이 F12 를 열면 바로 보인다. */
    Promise.resolve(authed(EP.fn('run-op'), { method: 'POST', body }, Auth))
      .then((r) => {
        if (r && r.ok) console.info('[정산신고] 보냈다', body.questId, r.status);
        else console.warn('[정산신고] 서버가 안 받았다', r && r.status, r && r.error);
      })
      .catch((e) => { console.warn('[정산신고] 못 보냈다 (게임에는 영향 없다)', e); });
  } catch (e) {
    /* ★ 신고를 만들다 던져도 게임은 그대로 간다 — 이게 이 모듈의 계약이다. */
    console.warn('[settle] 신고를 만들지 못했다 (게임에는 영향 없다)', e);
  }
}
