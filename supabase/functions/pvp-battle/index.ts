/**
 * PvP 전투 — 서버가 엔진을 돌려 승패를 정한다
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 왜 서버가 돌리나
 *   클라이언트가 «내가 이겼다» 를 올리게 하면 누구든 무한히 점수를 올린다.
 *   PvP 점수는 조작 유인이 순위표보다 훨씬 크다 (HANDOFF §55 진궐단).
 *   엔진은 DOM 을 안 쓰고 시드만으로 결정적이라 서버에서 그대로 돌릴 수 있다 —
 *   실측으로 확인했다 (§68.2: Node·Deno 200판 지문 일치, §71: 태그매치 지문 일치).
 *
 * ★★ 이 함수가 지키는 것 네 가지
 *   ① **본문의 user_id 를 절대 안 믿는다.** 토큰에서 꺼낸 것만 쓴다 (submit-score 규약).
 *   ② **challenge_id 가 unique.** 같은 id 로 다시 오면 저장된 결과를 그대로 돌려준다 —
 *      «결과가 나쁘면 응답 버리고 재도전» · 재전송 중복 · 시드 굴리기가 한꺼번에 닫힌다.
 *   ③ **도전권은 pvp_claim() 한 문장으로** 원자적으로 청구한다.
 *      읽고-확인하고-쓰면 동시 요청 둘이 둘 다 통과한다.
 *   ④ **시드는 서버가 뽑는다.** 클라가 보낸 시드는 어떤 경우에도 안 쓴다 —
 *      이 게임엔 승률 예보가 있어서 시드를 미리 알면 무패가 된다.
 *
 * ★ 못 막는 것도 적어 둔다: **골드 30만은 서버가 강제할 수 없다** (골드는 클라 세이브에만 있다).
 *   서버가 셀 수 있는 건 횟수뿐이라 일일 상한으로 대신한다.
 *   방어 편성의 장비 위조도 여기서는 못 막는다 — 6단계의 «가능한 최대치» 검사가 할 일이다.
 *
 * 라우트
 *   GET  ?selftest=1   배포된 엔진이 골든 픽스처와 맞는가 (§69.2)
 *   POST               도전
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { selftest } from './selftest.js';
import { tagMatch } from './tagmatch.js';
import { applyRating, BASE_RATING } from './rating.js';
import { getSkill } from './_engine/skills.js';
import { ENGINE_HASH } from './_engine/enginever.js';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── 도전 제한 ──────────────────────────────────────────────────
 * ★ 제작자 결정: 「쿨다운 6시간은 너무 빡세. **10초**. 계속 도전해도 상관없다」.
 *   그래서 이 둘은 «게임 설계상의 제동» 이 아니라 **폭주 방지**다.
 *   진짜 제동은 골드 30만이다 (다만 골드는 클라 세이브라 서버가 강제 못 한다 — §70.2).
 *
 * ★ 제작자 결정: **일일 상한도 없앤다.** 0 은 «상한 없음» 이다.
 *   남는 제동은 같은 상대 10초 쿨다운뿐이다.
 *
 *   정직하게 적어 둔다 — 쿨다운은 **(도전자, 상대) 짝마다** 걸린다. 상대를 바꿔 가며
 *   때리면 초당 여러 판이 가능하고, 골드는 클라 세이브라 서버가 못 막는다.
 *   지금은 아는 사람들끼리 쓰는 판이라 이대로 둔다. 남용이 보이면 여기 상수만 되살리면 된다. */
const DAILY_CAP = 0;              // 0 = 상한 없음
const COOLDOWN = '10 seconds';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = new URL(req.url);

  /* ── 자가검사 — 배포된 엔진이 골든 픽스처와 일치하는가 ──
   *    ★ 인증을 요구하지 않는다. 비밀이 아니고, 오히려 누구나 확인할 수 있어야 한다.
   *      40판을 돌리므로 느리다 — 자동 호출에 걸어 두지 마라. */
  if (req.method === 'GET' && url.searchParams.get('selftest') === '1') {
    try {
      const r = await selftest();
      return json({ ...r, engineHashConst: ENGINE_HASH }, r.ok ? 200 : 500);
    } catch (e) {
      return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
    }
  }

  if (req.method !== 'POST') return json({ error: 'POST 만 받는다 (자가검사는 ?selftest=1)' }, 405);

  /* ── 1) 누구인가. 본문의 user_id 는 절대 안 믿는다 ── */
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: '로그인이 필요하다' }, 401);

  const SB_URL = Deno.env.get('SUPABASE_URL')!;
  const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SB_SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: auth } } });
  const { data: who, error: whoErr } = await asUser.auth.getUser();
  if (whoErr || !who?.user?.id) return json({ error: '로그인이 필요하다' }, 401);
  const attackerId = who.user.id;

  /* service_role — RLS 를 우회한다. 이 키는 절대 클라이언트로 나가지 않는다 */
  const db = createClient(SB_URL, SB_SVC);

  /* ── 2) 본문 ── */
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: '본문이 JSON 이 아니다' }, 400); }

  /* ══ 방어 편성 등록 ══════════════════════════════════════════════════
   *  POST { register: true, companyName, squads: [[UnitDef,...], ...], power }
   *
   *  ★ 여기서 오는 UnitDef 는 **클라이언트가 계산한 값**이다. 이 단계에서는 그대로 받는다 —
   *    그리고 그 사실을 숨기지 않는다. 위조를 잡는 것은 6단계의 «가능한 최대치» 검사다
   *    (base 스탯은 rng 를 안 쓰고 접사 개수가 희귀도에 고정이라 상한을 정확히 계산할 수 있다).
   *
   *  ★ 등록한 편성이 **곧 내 공격 편성**이다 (아래 도전 처리). «약한 방어 + 강한 공격» 이
   *    구조적으로 불가능해진다.
   */
  if (body.register === true) {
    const squads = Array.isArray(body.squads) ? body.squads : null;
    const companyName = String(body.companyName || '').slice(0, 24);
    if (!squads || !squads.length) return json({ error: '부대가 비었다' }, 400);
    if (squads.length > 5) return json({ error: '부대는 최대 5개다' }, 400);
    if (!companyName) return json({ error: '용병단 이름이 없다' }, 400);

    for (const sq of squads) {
      if (!Array.isArray(sq) || !sq.length) return json({ error: '빈 부대가 있다' }, 400);
      if (sq.length > 12) return json({ error: '한 부대가 너무 크다' }, 400);   // 7 + 펫
      for (const u of sq) {
        const st = (u as Record<string, unknown>)?.stats as Record<string, number> | undefined;
        if (!st || typeof st.hp !== 'number' || st.hp <= 0) return json({ error: '유닛 스탯이 이상하다' }, 400);
      }
    }

    const power = Math.max(0, Math.min(50_000_000, Math.round(Number(body.power) || 0)));
    const { data: saved, error: regErr } = await db.from('pvp_defense').upsert({
      user_id: attackerId,
      company_name: companyName,
      units: squads,
      raw: (body.raw ?? null) as unknown,
      engine_hash: ENGINE_HASH,
      save_rev: Number(body.saveRev) || null,
      power,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).select('handle').single();

    if (regErr) return json({ error: '등록 실패' }, 500);
    /* 처음 등록하는 사람에게 레이팅 행을 만들어 준다 (기본 1000) */
    await db.from('pvp_ratings').insert({ user_id: attackerId }).select().maybeSingle();
    return json({ ok: true, handle: saved.handle, engineHash: ENGINE_HASH });
  }

  const challengeId = String(body.challengeId || '');
  const opponent = String(body.opponent || '');
  if (!UUID_RE.test(challengeId)) return json({ error: 'challengeId 가 uuid 가 아니다' }, 400);
  if (!UUID_RE.test(opponent)) return json({ error: 'opponent 가 uuid 가 아니다' }, 400);

  /* ── 3) 같은 도전이 이미 처리됐나 — **재실행하지 않는다** ──
   *    ★ 이 한 줄이 «불리하면 응답 버리고 다시» 와 재전송 중복을 동시에 닫는다. */
  {
    const { data: prev } = await db.from('pvp_matches')
      .select('id, seed, engine_hash, cfg, winner, rounds, attacker_delta, attacker_after')
      .eq('challenge_id', challengeId).maybeSingle();
    if (prev) {
      return json({
        replayed: true, matchId: prev.id, seed: prev.seed, engineHash: prev.engine_hash,
        cfg: prev.cfg, winner: prev.winner, rounds: prev.rounds,
        delta: prev.attacker_delta, rating: prev.attacker_after,
      });
    }
  }

  /* ── 4) 상대 찾기 (handle 로. 순위 번호로 지목하면 그 사이 순위가 바뀐다) ── */
  const { data: def } = await db.from('pvp_defense')
    .select('user_id, company_name, units, engine_hash, power')
    .eq('handle', opponent).maybeSingle();
  if (!def) return json({ error: '상대를 찾을 수 없다' }, 404);
  if (def.user_id === attackerId) return json({ error: '자기 자신에게는 도전할 수 없다' }, 400);

  /* ── 5) 내 방어 편성 = 내 공격 편성. 없으면 도전할 수 없다 ──
   *    ★ 이렇게 묶으면 «약한 편성을 올려 두고 강한 편성으로 때리기» 가 불가능해진다. */
  const { data: mine } = await db.from('pvp_defense')
    .select('units, engine_hash').eq('user_id', attackerId).maybeSingle();
  if (!mine) return json({ error: '먼저 내 부대를 등록해야 한다' }, 409);

  if (mine.engine_hash !== ENGINE_HASH || def.engine_hash !== ENGINE_HASH) {
    /* ★ 옛 지문으로 접힌 편성은 지금 엔진에서 다른 결과를 낼 수 있다.
     *   거절하지 않고 «다시 등록해라» 를 알린다 — 막아 버리면 옛 클라를 든 사람이 영영 못 한다. */
    return json({ error: '부대 등록이 오래됐다. 다시 등록해라', needRebuild: true }, 409);
  }

  /* ── 6) 도전권 청구 — 한 문장. 동시 요청 둘이 다 통과하면 안 된다 ── */
  const { data: claim, error: claimErr } = await db.rpc('pvp_claim', {
    p_attacker: attackerId, p_defender: def.user_id,
    p_daily_cap: DAILY_CAP, p_cooldown: COOLDOWN,
  });
  if (claimErr) return json({ error: '도전권 확인 실패' }, 500);
  const claimRow = Array.isArray(claim) ? claim[0] : claim;
  if (!claimRow?.ok) {
    const why = claimRow?.reason || 'unknown';
    const msg = why === 'daily' ? `오늘 도전을 다 썼다 (하루 ${DAILY_CAP}회)`
      : why === 'cooldown' ? '이 상대에게는 아직 다시 도전할 수 없다'
        : why === 'self' ? '자기 자신에게는 도전할 수 없다' : '지금은 도전할 수 없다';
    return json({ error: msg, reason: why }, 429);
  }

  /* ── 7) 전투 — **시드는 서버가 뽑는다** ── */
  const seed = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
  const cfg = {
    attacker: mine.units,
    defender: def.units,
    seed,
    engineHash: ENGINE_HASH,
  };

  let result;
  try {
    result = tagMatch({
      attacker: mine.units as unknown as Array<Array<Record<string, unknown>>>,
      defender: def.units as unknown as Array<Array<Record<string, unknown>>>,
      seed,
      getSkill,
    });
  } catch (e) {
    return json({ error: '전투 계산 실패: ' + String((e as Error)?.message || e) }, 500);
  }

  /* ── 8) 레이팅 ── */
  const ratingOf = async (uid: string) => {
    const { data } = await db.from('pvp_ratings').select('rating').eq('user_id', uid).maybeSingle();
    if (data) return data.rating as number;
    await db.from('pvp_ratings').insert({ user_id: uid }).select().maybeSingle();
    return BASE_RATING;
  };
  const aBefore = await ratingOf(attackerId);
  const dBefore = await ratingOf(def.user_id);
  const R = applyRating(result.winner, aBefore, dBefore);

  /* ── 9) 기록 — challenge_id 가 unique 라 중복 삽입은 여기서 막힌다 ── */
  const { data: row, error: insErr } = await db.from('pvp_matches').insert({
    challenge_id: challengeId,
    attacker_id: attackerId,
    defender_id: def.user_id,
    seed,
    engine_hash: ENGINE_HASH,
    cfg,
    winner: result.winner,
    rounds: result.roundCount,
    attacker_delta: R.attackerDelta,
    defender_delta: R.defenderDelta,
    attacker_after: R.attackerAfter,
    defender_after: R.defenderAfter,
  }).select('id').single();

  if (insErr) {
    /* 경합으로 같은 challenge_id 가 먼저 들어갔다 — 그 결과를 돌려준다 (재실행하지 않는다) */
    const { data: again } = await db.from('pvp_matches')
      .select('id, seed, cfg, winner, rounds, attacker_delta, attacker_after')
      .eq('challenge_id', challengeId).maybeSingle();
    if (again) {
      return json({
        replayed: true, matchId: again.id, seed: again.seed, engineHash: ENGINE_HASH,
        cfg: again.cfg, winner: again.winner, rounds: again.rounds,
        delta: again.attacker_delta, rating: again.attacker_after,
      });
    }
    return json({ error: '기록 실패' }, 500);
  }

  /* ★ 레이팅과 승패 카운트를 **한 문장으로** 올린다.
   *   따로 update 하면 트리거의 «판수는 한 번에 하나만» 규칙에 걸리거나,
   *   두 갱신 사이에 다른 판이 끼어들어 한쪽만 반영된다. */
  const { error: bumpErr } = await db.rpc('pvp_bump', {
    p_attacker: attackerId,
    p_defender: def.user_id,
    p_attacker_rating: R.attackerAfter,
    p_defender_rating: R.defenderAfter,
    p_winner: result.winner,
  });
  if (bumpErr) {
    /* 판은 이미 기록됐다 — 레이팅만 못 올린 상태다. 결과는 그대로 돌려주되 알린다. */
    console.error('pvp_bump 실패', bumpErr);
  }

  return json({
    matchId: row.id,
    seed,
    engineHash: ENGINE_HASH,
    cfg,
    winner: result.winner,
    rounds: result.roundCount,
    roundLog: result.rounds,
    delta: R.attackerDelta,
    rating: R.attackerAfter,
    opponentName: def.company_name,
  });
});
