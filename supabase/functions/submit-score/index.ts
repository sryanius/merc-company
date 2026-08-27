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
import { extractScore, judge, sameRun, POWER_CAP, probePolicy, PROBE_WINDOW_H } from '../_shared/rules.js';

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
      /* 고용 계량기 — «S 가 나올 수 있는 횟수였나» 를 증가분으로 묻는다 (rules.js checkGrowth).
       * ★ 이 칸이 없던 시절의 원장은 0 이라, 다음 제출 한 번은 «0 에서 늘어난 것» 으로 보인다.
       *   그래도 상한이 넉넉해 정상 플레이어가 걸리지는 않는다 (S 2명까지는 항상 통과). */
      sMercs: Number(prevRow.s_mercs) || 0,
      specHires: Number(prevRow.spec_hires) || 0,
      hires: Number(prevRow.hires) || 0,
    }
    : null;

  /* ── 3-0) **이 계정이 전에 보인 최대 전력** — 기록↔전력 교차 검증의 바닥값 (§111)
   * ══════════════════════════════════════════════════════════════════════════
   *
   * ★★ 왜 필요한가: `rules.js` 의 교차 검증 가드가 「걸어라」 가 아니라 「건너뛰라」 라서,
   *   **전력을 정확히 0 으로 적어 내면 검사가 통째로 꺼졌다.** 실측으로 확인했다 —
   *   지금 flagged 인 계정도 0 만 적으면 ok 로 풀린다.
   *
   * ★ 부대를 해산하든 장비를 다 팔든 **이미 세운 알리바이는 못 지운다.**
   * ★ 바닥값은 판정을 느슨하게만 만든다(전력이 크면 덜 걸린다) — 정상 플레이어를
   *   새로 거절할 위험이 없다. 그래서 seed 와 무관하게 쓴다.
   * ★ 조회가 실패하면 **막지 않는다** — 아래 탐침 세기와 같은 원칙. 0 이면 오늘 동작 그대로다.
   * ★★ 사유는 클라이언트에 안 나간다 (§55). 이 값도 응답에 안 싣는다. */
  let seenPower = 0;
  let prevStatus = '';
  let prevSeed: number | null = null;
  try {
    const { data: seenRow } = await admin
      .from('scores').select('top_power, status, seed').eq('user_id', userId).maybeSingle();
    seenPower = Math.max(0, Math.round(Number(seenRow?.top_power) || 0));
    prevStatus = String(seenRow?.status || '');
    prevSeed = seenRow?.seed == null ? null : Number(seenRow.seed);
  } catch (e) {
    console.error('[submit-score] 이전 전력 조회 실패 — 막지 않고 넘어간다', e);
  }
  /* ★ 제자리에 넣는다 — extractScore 결과 하나만 돌아다니게 둔다 (§110 과 같은 이유). */
  score.seenPower = seenPower;

  /* ★ seed 가 다르면 **다른 플레이스루**다. 비교 자체가 무의미하므로 첫 제출로 본다.
   *   여기서 옛 판과 비교하면 새로 시작한 사람이 전부 "기록이 줄었다"로 거절당한다. */
  const compareTo = prev && sameRun(prev, score) ? prev : null;
  const verdict = judge(compareTo, score);

  /* ── 3-a) 탐침 차단 — 「거절을 여러 번 반복하는 것」 자체를 막는다
   * ══════════════════════════════════════════════════════════════════════════
   *
   * ★★ 제작자: 「해킹하려면 차단되는거 여러번 반복할껀데 이거 체크해서도 막을수있나?」
   *
   *   실제로 그 공격이 이 게임에서 일어났다. `rejections` 를 시간순으로 읽으면 그대로 보인다:
   *
   *     02:44:15  전력 5285956      02:45:02  전력 5535173
   *     02:44:38  전력 5296011      02:45:41  전력 5720690      06:06:57  전력 5763505
   *
   *   값을 바꿔 가며 다섯 번 찔렀다. 그리고 **오늘 03:57 에 「S 용병 4명 · 1일차 상한 2」로
   *   걸린 뒤 8분 만에 통과한 등재가 순위 1위에 올라왔다** (`숨단`, §96).
   *
   * ★★ 사유는 이미 안 알려 준다 (§55). 그런데 **`ok:false` 그 자체가 1비트 신탁**이다 —
   *   「지금 값은 걸린다」 를 알려 주므로 이분 탐색이 된다. 그걸 닫는다.
   *
   * ★ 왜 «세는 것» 만으로 충분한가: **거절당한 사람은 이미 순위표에 없다.**
   *   그러니 조용해져도 잃을 게 없다. 반면 조작자는 유일한 신호를 잃는다.
   *   ⇒ 정상 플레이어에게 드는 비용이 0 에 가까운 방어다.
   *
   * ★ 그래도 처음 몇 번은 알려 준다. 오탐이면 그 메시지가 **유일한 단서**이고,
   *   지금 클라이언트는 거절당해도 다시 안 보내므로(`cloud.js submitScore`)
   *   정상 플레이어가 이 횟수를 넘을 일이 드물다.
   *   (실측: 탐침 계정은 한 시간에 12건 · 서로 다른 사유 5개였다.)
   */
  let recentRejects = 0;
  try {
    const since = new Date(Date.now() - PROBE_WINDOW_H * 3600_000).toISOString();
    const { count } = await admin
      .from('rejections')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('tier', 'A')
      .gte('created_at', since);
    recentRejects = Number(count) || 0;
  } catch {
    /* ★ 세는 데 실패하면 **막지 않는다.** 방어 하나를 잃는 쪽이
     *   정상 제출을 통째로 깨는 쪽보다 낫다. */
    recentRejects = 0;
  }
  /* ★ 판단은 `rules.js` 의 순수 함수가 한다 — 여기 if 로 흩어 놓으면 검사가 굴려 볼 수 없다 */
  const probe = probePolicy(recentRejects);

  /* ── 4) A등급: 물리적으로 불가능 — 기록하고 거절한다.
   *
   * ★★ **사유를 본인에게 알려 주지 않는다** (제작자 결정).
   *   예전에는 `reasons` 를 그대로 돌려줬는데, 그게 그대로 공격 도구가 됐다:
   *   조작자가 값을 바꿔 가며 찔러 보면 서버가 «부대 전력 5,285,956 (상한 5,000,000)» 이라고
   *   상한을 알려 줬다. 실제로 거절 19건을 그렇게 훑은 뒤 상한 밑으로 낮춰 통과한 기록이 있다
   *   (HANDOFF §55). 사유는 `rejections` 에만 남긴다 — 보는 사람은 운영자뿐이면 된다.
   *
   * ★ 오탐 대응은 «제보» 로 한다: 플레이어 수가 적어 서로 아는 사이라,
   *   순위표에 안 올라가면 사람이 직접 알려 온다는 제작자 판단이다.
   *   그래서 메시지도 «알려 달라» 로 끝낸다.
   *
   * ★ payload 를 같이 남긴다. 예전에는 flag 에만 남겨서, 정작 거절 19건은
   *   `payload: null` 이라 나중에 무엇을 보냈는지 되짚을 수 없었다 —
   *   제보가 들어와도 판단할 재료가 없다는 뜻이다. */
  if (verdict.verdict === 'reject') {
    await admin.from('rejections').insert({
      user_id: userId, tier: verdict.tier, reasons: verdict.reasons,
      payload: JSON.stringify(score),
    });
    /* ★★ 반복해서 걸리는 사람에게는 **성공과 똑같이** 답한다 (위 3-a).
     *   클라이언트는 이 응답의 `abyssBest`/`towerBest` 를 쓰지 않고
     *   자기 값으로 «올렸다» 를 적을 뿐이라(`cloud.js`), 흉내를 내도 상태가 안 망가진다. */
    if (probe.quiet) {
      return json({ ok: true, abyssBest: prev?.abyssBest ?? 0, towerBest: prev?.towerBest ?? 0 });
    }
    return json({ ok: false }, 200);
  }

  /* ── 5) B등급: 총량 초과 — **게임은 그대로 두고 랭킹에서만 숨긴다**(제작자 결정).
   *    오탐이 가능한 등급이라 본인에게 알리지 않는다:
   *    정상 플레이어를 불안하게 만들 이유가 없고, 진짜 조작자에게는 힌트가 된다.
   *    원본을 남겨 두면 나중에 사람이 보고 되돌릴 수 있다. */
  /* ★ 거절이 계속 쌓인 계정은 **받아들인 기록도 잡아 둔다** — 순위에는 안 올리고
   *   행은 남겨 사람이 본다 (`held` 는 001_init.sql 이 「수동 전용」 으로 정의해 둔 칸이다).
   *   §96 의 `숨단` 이 정확히 이 경로였다: 여러 번 걸린 뒤 통과한 값이 1위로 올라갔다. */
  let status = verdict.verdict === 'flag' ? 'flagged' : 'ok';
  if (probe.hold) status = 'held';

  /* ══════════════════════════════════════════════════════════════════════════
   * ★★★ **시드를 갈아타서 표식을 씻는 길을 막는다** (§117)
   *
   *   `scores_monotonic` 트리거는 `when (old.seed = new.seed)` 라 시드가 바뀌면
   *   아예 안 돈다. `rules.js` 도 `sameRun` 이 거짓이면 `compareTo = null` 로 두어
   *   케이던스·단조성·증가분 검사를 **전부** 건너뛴다 (그건 옳다 — 새 판을 옛 판과
   *   견주면 새로 시작한 사람이 전원 거절된다).
   *
   *   그 둘이 겹치면서 **«새 판으로 갈아타면 표식이 씻긴다»** 가 됐다.
   *   실제로 일어났다: 표시돼 있던 계정이 08-27 13:50 에 다른 시드로 제출하며
   *   `ok` 로 돌아갔다. 일차가 274 → 260 으로 **줄어** 있었는데도 트리거가 안 돌았다.
   *
   * ★ 그래서 **그 경우에만** 표식을 유지한다:
   *     이미 표시된 계정 + 시드가 바뀜  →  표식 유지
   *
   *   · 표시된 적 없는 사람은 **아무 영향이 없다** (새로 시작해도 그대로 ok).
   *   · 오탐으로 표시됐던 사람은 유지되지만, 그건 `db/README.md` 가 이미 정해 둔
   *     운영 경로다 — 사람이 `scores.status` 를 `'ok'` 로 되돌린다.
   *   · 같은 시드로 고쳐서 다시 올리는 정상 경로는 **그대로 풀린다.**
   * ══════════════════════════════════════════════════════════════════════════ */
  const seedChanged = prevSeed != null && Number(score.seed) !== prevSeed;
  if (status === 'ok' && seedChanged && (prevStatus === 'flagged' || prevStatus === 'held')) {
    status = prevStatus;
    console.error('[submit-score] 시드가 바뀌었지만 표식을 유지한다', { userId, prevSeed, seed: score.seed });
  }
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
       * ★★ 상한을 **손으로 옮겨 적지 않는다.** 예전엔 여기에 5_000_000 을 박아 두고
       *   주석에만 «POWER_CAP 과 같은 값» 이라 적었다 — rules.js 쪽을 고쳐도 여기는 안 따라온다.
       *   실제로 그 둘이 갈라진 채로 치트 등재가 들어왔다 (§96). 상수를 그대로 쓴다. */
      p: Number.isFinite(Number(x.p)) ? Math.max(0, Math.min(POWER_CAP, Math.round(Number(x.p)))) : undefined,
      m: mems.slice(0, 7).map((m) => {
        const y = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
        const sets = Array.isArray(y.s) ? y.s.slice(0, 3).map((v) => cut(v, 28)) : undefined;
        return {
          c: cut(y.c, 24),
          /* ★ 단원 이름 (rules.js 의 nm). 여기 안 적으면 **조용히 버려진다** — §58 의 그 함정이다. */
          nm: cut(y.nm, 16) || undefined,
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
        nm: cut(x.nm, 16),     // 단원 이름 — rules.js topSquadOf 와 쌍이다
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
    top_power: Math.max(0, Math.min(POWER_CAP, Math.round(Number(score.topPower) || 0))),
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
  if (upErr) {
    /* ★★ **DB 오류 메시지를 그대로 돌려주지 않는다.**
     *   `scores_monotonic` 트리거가 물면 그 문구에 «나락 %→%, 탑 %→%, 의뢰 %→%, 일차 %→%» 로
     *   **서버가 가진 이전 기록 네 개가 통째로** 들어 있다. §55 가 막은 것과 같은 누출이
     *   이 경로에만 남아 있었다. 사유는 서버 로그로만 본다. */
    console.error('[submit-score] scores upsert 실패', upErr);
    return json({ ok: false }, 500);
  }

  // 다음 비교의 기준점을 갱신한다. flagged 여도 갱신한다 — 안 하면 다음 제출이
  // 더 큰 증가폭으로 보여 연쇄로 걸린다.
  await admin.from('ledger').upsert({
    user_id: userId,
    seed: score.seed, day: score.day, gold: score.gold, renown: score.renown,
    quests_done: score.questsDone, battles_won: score.battlesWon, battles_lost: score.battlesLost,
    abyss_best: row.abyss_best, abyss_last_run_day: score.abyssLastRunDay,
    tower_best: row.tower_best, tower_last_run_day: score.towerLastRunDay,
    exp_total: 0, items_n: score.itemsN, pets_n: score.petsN,
    s_mercs: Math.max(0, Math.round(Number(score.sMercs) || 0)),
    spec_hires: Math.max(0, Math.round(Number(score.specHires) || 0)),
    hires: Math.max(0, Math.round(Number(score.hires) || 0)),
    accepted_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  /* ★ flagged 여도 클라이언트에는 ok 로 답한다 (5번 주석 참고). */
  return json({ ok: true, abyssBest: row.abyss_best, towerBest: row.tower_best });
});
