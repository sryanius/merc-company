/**
 * 랭킹 제출 — 서버 검증
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ 이 함수가 **랭킹 신뢰의 전부**다.
 *   `scores` 테이블에는 INSERT/UPDATE 정책이 아예 없다. 클라이언트는 못 쓴다.
 *   오직 여기서 service_role 로 쓴다.
 *
 * ★ 규칙은 `_shared/rules.js` 한 벌뿐이다 (`tools/syncshared.mjs` 가 복사한다).
 *   SQL 로 옮겨 적으면 손으로 베낀 두 번째 사본이 생기고, 밸런스를 고치는 날
 *   정상 플레이어가 전원 거절당한다. 어긋나면 `tools/smoke.mjs` 가 먼저 실패한다.
 *
 * ★ 검증 대상은 **랭킹에 올라가는 숫자뿐**이다. 세이브 전체가 아니다.
 *   세이브는 본인 백업이라 검증할 이유가 없다(조작해도 본인만 손해).
 *
 * ★ 정직하게: 이건 "조작 방지"가 아니라 "개연성 검사"다.
 *   전투 승패나 아이템 스탯 위조는 못 잡는다.
 *
 * 배포: supabase functions deploy submit-score
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { extractScore, judge, sameRun } from '../_shared/rules.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 만 받는다' }, 405);

  /* ── 1) 누구인가.
   *    ★ 본문의 user_id 를 **절대 믿지 않는다.** 토큰에서 꺼낸 것만 쓴다. */
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: '로그인이 필요하다' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: who, error: whoErr } = await asUser.auth.getUser();
  if (whoErr || !who?.user) return json({ error: '토큰이 유효하지 않다' }, 401);
  const userId = who.user.id;

  // ── 2) 세이브를 받는다
  let payload: Record<string, unknown> | null = null;
  try {
    const body = await req.json();
    payload = body && typeof body === 'object' ? (body.state ?? body) : null;
  } catch {
    return json({ error: '본문을 읽지 못했다' }, 400);
  }

  const score = extractScore(payload);
  if (!score) return json({ error: '세이브를 읽지 못했다' }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  /* ── 3) 지난번에 받아들인 값과 비교한다.
   *    ledger 는 RLS 정책이 하나도 없어서 클라이언트가 존재조차 못 건드린다. */
  const { data: prevRow } = await admin
    .from('ledger').select('*').eq('user_id', userId).maybeSingle();

  const prev = prevRow
    ? {
      seed: Number(prevRow.seed), day: Number(prevRow.day),
      abyssBest: Number(prevRow.abyss_best), abyssBestDay: 0,
      abyssLastRunDay: Number(prevRow.abyss_last_run_day),
      towerBest: Number(prevRow.tower_best), towerBestDay: 0,
      towerLastRunDay: Number(prevRow.tower_last_run_day),
      questsDone: Number(prevRow.quests_done), battlesWon: Number(prevRow.battles_won),
      gold: Number(prevRow.gold), renown: Number(prevRow.renown),
    }
    : null;

  /* ★ seed 가 다르면 **다른 플레이스루**다. 비교 자체가 무의미하므로 첫 제출로 본다.
   *   여기서 옛 판과 비교하면 새로 시작한 사람이 전부 "기록이 줄었다"로 거절당한다. */
  const compareTo = prev && sameRun(prev, score) ? prev : null;
  const verdict = judge(compareTo, score);

  // ── 4) A등급: 물리적으로 불가능 — 기록하고 거절한다
  if (verdict.verdict === 'reject') {
    await admin.from('rejections').insert({
      user_id: userId, tier: verdict.tier, reasons: verdict.reasons,
    });
    return json({ ok: false, tier: verdict.tier, reasons: verdict.reasons }, 200);
  }

  /* ── 5) B등급: 총량 초과 — **게임은 그대로 두고 랭킹에서만 숨긴다**(제작자 결정).
   *    오탐이 가능한 등급이라 본인에게 알리지 않는다:
   *    정상 플레이어를 불안하게 만들 이유가 없고, 진짜 조작자에게는 힌트가 된다.
   *    원본을 남겨 두면 나중에 사람이 보고 되돌릴 수 있다. */
  const status = verdict.verdict === 'flag' ? 'flagged' : 'ok';
  if (verdict.verdict === 'flag') {
    await admin.from('rejections').insert({
      user_id: userId, tier: verdict.tier, reasons: verdict.reasons,
      payload: JSON.stringify(score),
    });
  }

  // ── 6) 기록. 같은 판이면 최고치만 올린다 (greatest)
/**
 * 랭킹 기록을 리셋한 클라이언트 버전.
 *
 * ★★ **이 값보다 낮은 세이브가 올린 탑·나락 기록은 0 으로 본다.**
 *   리셋을 했는데 서비스워커에 캐시된 옛 클라이언트가 그대로 돌면서 옛 기록을
 *   다시 올려 리셋을 통째로 되돌린 일이 있었다 (HANDOFF §41).
 *   배포와 리셋 사이의 시차는 **없앨 수 없다** — 열려 있는 탭까지 강제로 갱신할 방법이 없다.
 *   그래서 서버가 막는다.
 *
 * ★ 거절이 아니라 **0 처리**다. 거절하면 옛 클라이언트가 아무것도 못 올리는데,
 *   그 사람은 잘못한 게 없다. 새로고침하면 저절로 정상값이 올라간다.
 *
 * ★ `src/game/state.js RANK_RESET_VERSION` 과 같은 값이어야 한다.
 */
const RANK_RESET_VERSION = 8;

/**
 * 전 부대 상세를 «모양만» 거른다.
 * ★ DB 에도 pg_column_size < 8192 제약이 있다. 여기서 부대 5 · 인원 7 · 세트 3 으로 자른다.
 */
function sanitizeSquadsFull(raw: unknown) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const cut = (v: unknown, n: number) => Array.from(String(v ?? '')).slice(0, n).join('');
  const out = raw.slice(0, 5).map((sq) => {
    const x = (sq && typeof sq === 'object' ? sq : {}) as Record<string, unknown>;
    const mems = Array.isArray(x.m) ? x.m : [];
    return {
      n: cut(x.n, 16),
      f: cut(x.f, 24),
      /* ★★ 부대 전력. **여기에 안 적으면 통째로 버려진다** — 이 함수는 «아는 필드만 남기는»
       *   화이트리스트라, rules.js 에 필드를 더해도 여기를 같이 안 고치면 DB 에 안 들어간다.
       *   실제로 그래서 «부대 전력이 여전히 안 보인다» 는 지적을 받았다 (HANDOFF §58).
       *   상한은 rules.js 의 POWER_CAP 과 같은 값이다. */
      p: Number.isFinite(Number(x.p)) ? Math.max(0, Math.min(5_000_000, Math.round(Number(x.p)))) : undefined,
      m: mems.slice(0, 7).map((m) => {
        const y = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
        const sets = Array.isArray(y.s) ? y.s.slice(0, 3).map((v) => cut(v, 28)) : undefined;
        return {
          c: cut(y.c, 24),
          l: Math.max(1, Math.min(80, Math.round(Number(y.l) || 1))),
          g: cut(y.g, 1),
          e: Math.max(0, Math.min(10, Math.round(Number(y.e) || 0))),
          s: sets && sets.length ? sets : undefined,
        };
      }).filter((m) => m.c),
    };
  }).filter((sq) => sq.m.length);
  return out.length ? out : null;
}

/** 부대 스냅샷을 «모양만» 거른다. 내용은 못 믿으므로 크기와 타입만 본다. */
function sanitizeSquad(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const mems = Array.isArray(s.members) ? s.members : [];
  if (!mems.length) return null;
  const cut = (v: unknown, n: number) => Array.from(String(v ?? '')).slice(0, n).join('');
  const out = {
    name: cut(s.name, 16),
    power: Number.isFinite(Number(s.power)) ? Math.max(0, Math.round(Number(s.power))) : undefined,
    members: mems.slice(0, 7).map((m) => {
      const x = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
      return {
        c: cut(x.c, 24),
        l: Math.max(1, Math.min(80, Math.round(Number(x.l) || 1))),
        g: cut(x.g, 1),
      };
    }).filter((m) => m.c),
  };
  return out.members.length ? out : null;
}

  const keepMax = (a: number, b: number) => (a > b ? a : b);
  const same = compareTo !== null;

  /* 리셋 이전 버전의 세이브가 올린 기록은 0 으로 본다 (위 상수 주석 참고). */
  const stale = (Number(score.dataVersion) || 0) < RANK_RESET_VERSION;
  if (stale) {
    score.abyssBest = 0;
    score.abyssBestDay = 0;
    score.towerBest = 0;
    score.towerBestDay = 0;
    if (compareTo) { compareTo.abyssBest = 0; compareTo.towerBest = 0; }
  }

  const row = {
    user_id: userId,
    company_name: score.companyName,
    seed: score.seed,
    abyss_best: same ? keepMax(score.abyssBest, compareTo!.abyssBest) : score.abyssBest,
    abyss_best_day: score.abyssBestDay,
    tower_best: same ? keepMax(score.towerBest, compareTo!.towerBest) : score.towerBest,
    tower_best_day: score.towerBestDay,
    quests_done: score.questsDone,
    day: score.day,
    city_id: score.cityId,
    roster_n: score.rosterN,
    roster_cap: score.rosterCap,
    top_level: score.topLevel,
    squads_n: score.squadsN,
    pets_n: score.petsN,
    /* 순위 축 (플레이어 요청): S 용병 수 · 최고 부대 전력.
     * ★ 둘 다 본인 신고값이고 rules.js checkStatic 이 상한을 건다.
     *   ★ 여기서 한 번 더 클램프한다 — DB 제약에 걸려 **제출 전체가 실패하는** 것보다
     *     상한으로 잘리는 편이 낫다. 값이 이상하면 어차피 status 가 flagged 다. */
    s_mercs: Math.max(0, Math.min(200, Math.round(Number(score.sMercs) || 0))),
    top_power: Math.max(0, Math.min(5_000_000, Math.round(Number(score.topPower) || 0))),
    /* 순위표에 보여 줄 대표 부대 스냅샷 (rules.js topSquadOf).
     * ★ 클라이언트가 스스로 신고하는 값이다 — 점수와 마찬가지로 «검증된 편성» 이 아니다.
     *   여기서는 **모양만** 거른다: 배열이고, 7명 이하고, 필드가 예상한 것뿐인가.
     *   DB 에도 pg_column_size < 2048 제약이 걸려 있다. */
    squad: sanitizeSquad(score.squad),
    /* 전 부대 상세 — 순위표 «목록» 이 아니라 눌렀을 때만 읽는다 (squads_at RPC). */
    squads_full: sanitizeSquadsFull(score.squadsFull),
    status,
    submitted_at: new Date().toISOString(),
  };

  const { error: upErr } = await admin.from('scores').upsert(row, { onConflict: 'user_id' });
  if (upErr) return json({ ok: false, error: upErr.message }, 500);

  // 다음 비교의 기준점을 갱신한다. flagged 여도 갱신한다 — 안 하면 다음 제출이
  // 더 큰 증가폭으로 보여 연쇄로 걸린다.
  await admin.from('ledger').upsert({
    user_id: userId,
    seed: score.seed, day: score.day, gold: score.gold, renown: score.renown,
    quests_done: score.questsDone, battles_won: score.battlesWon, battles_lost: score.battlesLost,
    abyss_best: row.abyss_best, abyss_last_run_day: score.abyssLastRunDay,
    tower_best: row.tower_best, tower_last_run_day: score.towerLastRunDay,
    exp_total: 0, items_n: score.itemsN, pets_n: score.petsN,
    accepted_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  /* ★ flagged 여도 클라이언트에는 ok 로 답한다 (5번 주석 참고). */
  return json({ ok: true, abyssBest: row.abyss_best, towerBest: row.tower_best });
});
