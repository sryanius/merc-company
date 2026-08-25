/**
 * PvP 전투 — 서버가 엔진을 돌린다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 서버가 돌리나
 *   클라이언트가 «내가 이겼다» 를 올리게 하면 누구든 무한히 점수를 올린다.
 *   PvP 점수는 조작 유인이 순위표보다 훨씬 크다 (HANDOFF §55 진궐단).
 *   엔진(`src/battle/engine.js`)은 DOM 을 안 쓰고 시드만으로 결정적이라
 *   **서버에서 그대로 돌릴 수 있다** — 실측으로 확인했다 (§68.2).
 *
 * ★ 지금 단계(2단계)는 **자가검사만** 있다. 도전 처리는 4단계에서 붙인다.
 *   먼저 «배포된 서버에서 엔진이 개발 PC 와 같은 결과를 내는가» 를 확인할 수단을 둔다 —
 *   개발 PC 의 Node·Deno 일치는 이미 쟀지만 **실제 서버는 리눅스**라 거기서 재야 안다.
 *
 *   GET /pvp-battle?selftest=1  →  { ok, total, bad[], engineHash, ms }
 *
 * ★ `_engine/` 은 `tools/syncshared.mjs` 가 복사한다. 손으로 고치지 마라 —
 *   원본과 어긋나면 스모크가 먼저 터진다.
 */
import { selftest } from './selftest.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = new URL(req.url);

  /* ── 자가검사 — 배포된 엔진이 골든 픽스처와 일치하는가 ──
   *    ★ 인증을 요구하지 않는다. 비밀이 아니고, 오히려 **누구나 확인할 수 있어야** 한다.
   *      다만 40판을 돌리므로 답이 느리다 — 자동 호출에 걸어 두지 마라. */
  if (req.method === 'GET' && url.searchParams.get('selftest') === '1') {
    try {
      const r = await selftest();
      return json(r, r.ok ? 200 : 500);
    } catch (e) {
      return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
    }
  }

  if (req.method !== 'POST') return json({ error: 'POST 만 받는다 (자가검사는 ?selftest=1)' }, 405);

  /* ── 도전 처리는 4단계에서 붙인다.
   *    ★ 지금 «임시로» 클라이언트 결과를 받아 두면 그 임시가 그대로 남는다.
   *      받을 수 있는 길을 아예 열지 않는다. */
  return json({ error: '아직 도전을 받지 않는다 (4단계)' }, 501);
});
