-- ════════════════════════════════════════════════════════════════════════════
-- 014. `gold_send` 가 **부를 때마다 죽고 있었다** — 잠금 문장이 틀렸다
--
-- 적용: npx supabase db query --linked -f db/014_gold_send_fix.sql
-- 두 번 실행해도 안전하다 (create or replace).
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 무엇이 틀렸나
--
--   db/012_gold_gift.sql:223 이 이렇게 돼 있었다:
--
--     select count(*) into cnt from public.gold_gifts
--      where id = p_id and from_user = me and status = 'pending'
--      for update;
--
--   PostgreSQL 은 **집계와 `for update` 를 같이 못 쓴다.** 실제로 쳐 봤다:
--
--     ERR 0A000 : FOR UPDATE is not allowed with aggregate functions
--
--   plpgsql 은 문장을 **처음 실행할 때** 계획한다. 그래서 이 오류는
--   함수를 만들 때가 아니라 **부를 때마다** 난다 — 승낙 경로가 통째로 죽어 있었다.
--
-- ★★ 실제로 죽어 있었다 (프로덕션 조회):
--
--     gold_gifts  총 4건 · 전부 status='pending' · sent_at 이 있는 행 0건
--
--   즉 골드 송금이 **한 번도 끝까지 돈 적이 없다.** 부탁은 쌓였는데
--   승낙 버튼을 누르면 매번 실패 토스트가 떴다 (src/ui/rank.js:428).
--
-- ★ 왜 못 잡았나: SQL 함수를 **한 번도 실행해 본 적이 없다.**
--   스모크는 SQL 을 글자로만 본다 (§102 에서 그렇게 만들었다). 로컬에 Postgres 가
--   없어서(§102.5 — 도커 데몬이 안 뜬다) 실행 검사가 없었다.
--   → 이 형태만이라도 글자로 잡게 스모크에 넣었다. 실행 검사는 여전히 숙제다.
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 고치는 방향: **집계를 빼고 행을 직접 잠근다.**
--
--   `perform … for update` + `get diagnostics row_count` 로 바꾼다.
--   잠그려던 의도(§010 `pvp_claim` 과 같은 이유 — 동시에 들어온 요청 둘이
--   둘 다 통과하면 안 된다)는 **그대로 산다.** 오히려 이쪽이 진짜로 그 행을 잠근다.
--
--   둘 다 실제로 쳐서 확인했다:
--     집계 + for update   → ERR 0A000
--     perform + for update → OK (row_count=0)
--
--   `get diagnostics … = row_count` 는 이 파일이 이미 쓰는 어법이다
--   (`gold_decline`, db/012_gold_gift.sql:266).
-- ════════════════════════════════════════════════════════════════════════════


/**
 * 부탁을 승낙하고 금액을 정해 보낸다.
 *
 * ★ 012 와 달라진 곳은 **잠금 문장 하나뿐**이다. 나머지는 그대로 옮겼다
 *   (한도·잔액·금액 검사의 순서와 문구를 바꾸지 않는다).
 */
create or replace function public.gold_send(p_id bigint, p_amount integer)
returns table (ok boolean, reason text)
language plpgsql volatile security definer set search_path = '' as $fn$
declare
  me   uuid := (select auth.uid());
  cnt  integer;
  used bigint;
  bal  bigint;
begin
  if me is null then return query select false, '로그인이 필요하다'::text; return; end if;
  if p_amount is null or p_amount not in (10000, 100000, 500000) then
    return query select false, '보낼 수 없는 금액이다'::text; return;
  end if;

  /* ★★ 여기가 고친 자리다. 예전엔 `select count(*) … for update` 였고
   *   PostgreSQL 이 0A000 으로 거절해서 함수가 통째로 죽었다.
   *   행을 직접 잠그고 몇 행이 잠겼는지는 row_count 로 본다. */
  perform 1 from public.gold_gifts
   where id = p_id and from_user = me and status = 'pending'
   for update;
  get diagnostics cnt = row_count;
  if cnt = 0 then return query select false, '이미 처리된 부탁이다'::text; return; end if;

  /* 하루 한도 — UTC 자정 기준 (서버 시계만 믿는다) */
  select coalesce(sum(amount), 0) into used from public.gold_gifts
   where from_user = me and status = 'sent'
     and sent_at >= date_trunc('day', (now() at time zone 'utc'));
  if used + p_amount > public.gold_daily_cap() then
    return query select false,
      ('오늘 보낼 수 있는 한도를 넘는다 (남은 한도 '
        || (public.gold_daily_cap() - used)::text || ')')::text;
    return;
  end if;

  /* ★ 서버가 아는 잔액으로 본다. 클라 신고값이지만 checkGrowth 로 묶여 있는 값이다. */
  /* ★★ `select ... into` 는 **행이 없으면 변수를 안 건드린다** — bal 이 NULL 로 남고
   *   `NULL < p_amount` 는 참이 아니라 **NULL** 이라 if 를 통과한다.
   *   즉 원장이 없는 새 계정이 없는 골드를 보낼 수 있었다. coalesce 를 밖에 씌운다. */
  bal := coalesce((select l.gold from public.ledger l where l.user_id = me), 0);
  if bal < p_amount then return query select false, '골드가 모자란다'::text; return; end if;

  update public.gold_gifts
     set status = 'sent', amount = p_amount, sent_at = now()
   where id = p_id;

  return query select true, ''::text;
end $fn$;


-- ════════════════════════════════════════════════════════════════════════════
-- 권한 — `create or replace` 는 ACL 을 지키지만, 이 파일만 돌려도 맞도록 다시 적는다.
--   ★★ `revoke from public` 만으로는 안 잠긴다 (§77). 두 역할을 이름으로 지목한다.
-- ════════════════════════════════════════════════════════════════════════════

revoke all on function public.gold_send(bigint, integer) from anon, authenticated, public;
grant execute on function public.gold_send(bigint, integer) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 확인 (적용 후)
--
--   ① 함수가 실제로 도는가 — **롤백 트랜잭션 안에서 진짜로 불러 본다.**
--      («만들어졌다» 는 아무 증거가 안 된다. 012 도 만들어지긴 했다.)
--   ② node tools/rlscheck.mjs
--   ③ 권한 (§77: 적어 놓은 게 아니라 ACL 을 읽는다)
--        select p.proname, array_to_string(p.proacl, ' | ')
--          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname = 'public' and p.proname = 'gold_send';
-- ════════════════════════════════════════════════════════════════════════════
