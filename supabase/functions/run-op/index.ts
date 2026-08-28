/**
 * `run-op` — 서버가 진행도를 **직접 고치는** 첫 함수 (§104 1단계 3번)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★ 지금까지 서버는 «클라가 신고한 것을 판정» 하기만 했다. 여기서부터 서버가
 *   `run_*` 을 **쓴다.** 그래서 지켜야 할 것이 늘어난다.
 *
 * ★ 규칙 표를 SQL 로 베끼지 않는다. `promoteOptions` 는 `src/data/classes.js` 에 있고,
 *   그것을 plpgsql 로 옮기면 저장소에 넷째 사본이 생긴다 (§94·§98·§107).
 *   `_rules` 묶음(2개 61KB)을 그대로 import 한다 — `tools/syncshared.mjs` 가 동기화한다.
 *
 * ★★ **멱등성.** 네트워크가 끊기면 클라는 «실패했다» 고 보지만 서버는 이미 썼을 수 있다.
 *   그래서 모든 op 은 `op_id` 를 갖고, 같은 `op_id` 로 다시 오면 **다시 하지 않고
 *   지난 결과를 그대로 돌려준다.** `run_ops` 가 그 원장이다 (db/015).
 *   ★ `promote` 자체는 같은 대상으로 두 번 부르면 두 번째가 막힌다(실측) — 그래도
 *     멱등성 키가 필요한 이유는 «막혔다» 와 «이미 됐다» 를 클라가 구별해야 하기 때문이다.
 *
 * ★ 응답에 사유를 실을 때도 «서버가 무엇을 아는지» 를 흘리지 않는다 (§55).
 *   전직은 판정이 아니라 **행동**이라 사유를 주는 게 맞다 — 사람이 고쳐서 다시 눌러야 한다.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CLASSES, getClass, promoteOptions } from './_rules/classes.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 차수. `classes.js` 의 `tier` 를 그대로 믿는다 (표가 곧 규칙이다). */
const tierOf = (id: string) => Math.max(1, Math.round(Number(getClass(id)?.tier) || 1));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST 만 받는다' }, 405);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const auth = req.headers.get('Authorization') || '';
  if (!url || !service) return json({ error: '서버 설정이 없다' }, 500);
  if (!auth) return json({ error: '로그인이 필요하다' }, 401);

  /* ★ 사용자 JWT 로 신원만 확인한다 — 쓰기는 admin 으로 하되 **user_id 를 못 속이게** */
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asUser.auth.getUser();
  const userId = who?.user?.id || '';
  if (!userId) return json({ error: '로그인이 필요하다' }, 401);

  let body: Record<string, unknown> | null = null;
  try { body = await req.json(); } catch { return json({ error: '본문을 읽지 못했다' }, 400); }
  const op = String(body?.op || '');
  const opId = String(body?.opId || '').slice(0, 64);
  if (!opId) return json({ error: 'opId 가 필요하다' }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  /* ── 멱등성: 같은 op_id 면 지난 결과를 그대로 돌려준다 ─────────────────── */
  {
    const { data: prev } = await admin.from('run_ops')
      .select('result').eq('user_id', userId).eq('op_id', opId).maybeSingle();
    if (prev) return json({ ok: true, replayed: true, result: prev.result });
  }

  if (op !== 'promote') return json({ error: '모르는 op 이다' }, 400);

  const mercUid = String(body?.mercUid || '');
  const toClass = String(body?.toClass || '');
  if (!mercUid || !toClass) return json({ error: 'mercUid 와 toClass 가 필요하다' }, 400);
  if (!CLASSES[toClass]) return json({ error: '없는 클래스다' }, 400);

  /* ── 지금 상태를 서버에서 읽는다. 클라가 보낸 «현재 클래스» 를 믿지 않는다 ── */
  const { data: merc, error: readErr } = await admin.from('run_mercs')
    .select('uid, class_id, level, grade').eq('user_id', userId).eq('uid', mercUid).maybeSingle();
  if (readErr) { console.error('[run-op] run_mercs 읽기 실패', readErr); return json({ error: '읽지 못했다' }, 500); }
  if (!merc) return json({ error: '그 단원이 서버에 없다 (이관 전이거나 uid 가 다르다)' }, 404);

  /* ── 규칙: 표가 곧 규칙이다 ──────────────────────────────────────────── */
  const from = String(merc.class_id || '');
  const allowed = promoteOptions(from).map((c: { id: string }) => c.id);
  if (!allowed.includes(toClass)) {
    return json({ error: '그 클래스로는 전직할 수 없다', from, allowed }, 409);
  }
  if (tierOf(toClass) <= tierOf(from)) {
    return json({ error: '이미 그 차수 이상이다', from }, 409);
  }

  /* ── 쓴다. ★ 원장을 **먼저** 남긴다 — 쓰고 나서 원장이 실패하면 재시도가 두 번 한다. ── */
  const result = { op: 'promote', mercUid, from, to: toClass };
  const { error: opErr } = await admin.from('run_ops')
    .insert({ user_id: userId, op_id: opId, kind: 'promote', result });
  if (opErr) {
    /* 경쟁 조건에서 같은 op_id 가 동시에 들어오면 여기서 걸린다 — 그게 맞는 동작이다. */
    console.error('[run-op] run_ops insert 실패', opErr);
    return json({ error: '같은 요청이 이미 처리 중이다' }, 409);
  }

  const { error: upErr } = await admin.from('run_mercs')
    .update({ class_id: toClass }).eq('user_id', userId).eq('uid', mercUid);
  if (upErr) {
    /* ★ 원장은 남았는데 쓰기가 실패했다 — 원장을 지워 재시도가 되게 한다.
     *   지우기가 또 실패하면 그 op 은 «했다» 고 굳는다. 그건 로그로 남긴다. */
    console.error('[run-op] run_mercs update 실패 — 원장을 되돌린다', upErr);
    const { error: rbErr } = await admin.from('run_ops')
      .delete().eq('user_id', userId).eq('op_id', opId);
    if (rbErr) console.error('[run-op] ★ 원장 되돌리기도 실패했다 — 이 op 은 굳는다', rbErr);
    return json({ error: '적용하지 못했다' }, 500);
  }

  return json({ ok: true, replayed: false, result });
});
