-- ════════════════════════════════════════════════════════════════════════════
-- 012. 유저간 골드 송금 — 「순위표 보고 구걸하고, 승낙하면 보낸다」
--
-- 적용: npx supabase db query --linked -f db/012_gold_gift.sql
-- 두 번 실행해도 안전하다 (전부 if not exists / or replace).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 먼저 이 기능의 **한계**를 적어 둔다. 안 적으면 나중에 과신하게 된다.
--
--   이 게임에서 골드는 **클라이언트가 신고하는 값**이다. 서버는 `ledger.gold` 에
--   «마지막으로 받아들인 값» 만 들고 있다. 그래서 이 송금은 **은행 이체가 아니다** —
--   서버가 «가능한 범위인가» 를 보고 장부를 맞춰 주는 것에 가깝다.
--
--   막을 수 있는 것: 없는 돈 보내기 · 하루 한도 초과 · 같은 부탁 두 번 받기 ·
--                   두 번 적용해서 골드 복사하기
--   못 막는 것:     보낸 사람이 세이브를 되돌려 차감을 무르는 것
--                   (그건 세이브 조작이고, 이 게임의 다른 모든 값과 같은 처지다)
--
--   ⇒ 서로 아는 사이의 «도와주기» 로는 충분하고, 경제의 근간으로 삼을 것은 아니다.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 왜 «장부 맞추기» 가 반드시 필요한가 (이게 이 파일의 핵심이다)
--
--   `rules.js checkGrowth` 는 골드 증가를 이렇게 묶는다:
--       상한 = 나락보상 + 의뢰수 × 120,000 + (일수+1) × 50,000
--
--   실측: 의뢰를 안 한 사람이 하루 만에 **50만을 받으면**
--       → flag(B) 「골드 500,000 증가 (상한 100,000)」 로 **치트 표시가 찍힌다.**
--       (1만·10만은 통과한다. 50만만 걸린다.)
--
--   ⇒ 그래서 클라이언트가 골드를 반영하는 **바로 그 순간** 서버도 `ledger.gold` 를
--     같은 만큼 움직인다 (`gold_apply`). 그러면 다음 제출에서 증가분이 0 에 가까워
--     검사가 아무 일 없이 지나간다. **rules.js 는 한 줄도 안 고쳐도 된다.**
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 1. 순위표에서 사람을 **어떻게 지목하나**
--
--   `leaderboard()` 는 이름과 수치만 준다 — user_id 도 handle 도 안 준다 (일부러 그렇다).
--   그렇다고 반환형을 바꾸면 `drop function` 후 재생성이라, 순위표 전체가 걸린
--   함수를 건드리게 된다. 위험 대비 얻는 게 적다.
--
--   ⇒ 이 저장소가 이미 쓰는 방식을 따른다: **순위 번호로 지목한다**
--     (`squads_at(p_kind, p_rank)` 이 그렇게 한다, §007).
--
--   ★★ 다만 순위는 **목록을 본 뒤 부탁하는 사이에 밀릴 수 있다.**
--     그래서 «내가 본 이름» 을 같이 보내게 하고, 서버가 대조해서 다르면 거절한다.
--     엉뚱한 사람에게 부탁이 가는 일이 없다.
--
--   ★ 이름은 유일하지 않지만(중복 제약이 없다) «순위 + 이름» 이 같이 맞아야 하므로
--     실수로 다른 사람을 짚을 확률이 사실상 사라진다.
-- ════════════════════════════════════════════════════════════════════════════

/** 순위표와 **똑같은 정렬**로 그 순위에 있는 사람을 찾는다 (leaderboard 와 어긋나면 안 된다) */
create or replace function public.gold_user_at(p_kind text, p_rank integer)
returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from (
    select s.user_id,
           row_number() over (
             order by
               case p_kind when 'abyss' then s.abyss_best
                           when 'tower' then s.tower_best
                           when 'smercs' then s.s_mercs
                           when 'power' then s.top_power
                           else s.quests_done end desc,
               case p_kind when 'abyss' then s.abyss_best_day
                           when 'tower' then s.tower_best_day
                           else s.day end asc,
               s.submitted_at asc
           ) as rn
      from public.scores s
     where s.status = 'ok'
       and case p_kind when 'abyss' then s.abyss_best
                       when 'tower' then s.tower_best
                       when 'smercs' then s.s_mercs
                       when 'power' then s.top_power
                       else s.quests_done end > 0
  ) t
  where t.rn = greatest(1, p_rank);
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. 부탁과 송금
--
--   한 행이 «부탁 → 승낙 → 양쪽이 반영» 까지를 끝까지 들고 간다.
--   따로 쪼개면 중간 상태가 어긋났을 때 골드가 새거나 복사된다.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.gold_gifts (
  id          bigserial   primary key,

  -- ★ 방향에 주의: **부탁을 받는 쪽이 보내는 사람**이다.
  from_user   uuid        not null references auth.users(id) on delete cascade,  -- 보내는 사람
  to_user     uuid        not null references auth.users(id) on delete cascade,  -- 부탁한 사람

  -- 승낙할 때 정해진다. 그전에는 null 이다.
  amount      integer     check (amount is null or amount in (10000, 100000, 500000)),

  status      text        not null default 'pending'
                          check (status in ('pending', 'sent', 'declined')),

  created_at  timestamptz not null default now(),
  sent_at     timestamptz,

  -- ★★ 멱등성의 핵심. 각 쪽이 «세이브에 반영했다» 를 여기 찍는다.
  --   두 번 반영하면 골드가 복사되므로, 반영은 **이 칸을 비교해서 한 번만** 한다.
  from_applied_at timestamptz,   -- 보낸 사람이 차감을 반영했나
  to_applied_at   timestamptz,   -- 받은 사람이 가산을 반영했나

  constraint gold_gifts_not_self check (from_user <> to_user)
);

alter table public.gold_gifts enable row level security;
-- 정책 없음 — 읽기·쓰기 모두 아래 security definer 함수로만 연다 (§010 과 같은 규칙).

create index if not exists gold_gifts_to_idx   on public.gold_gifts (to_user, status, created_at desc);
create index if not exists gold_gifts_from_idx on public.gold_gifts (from_user, status, created_at desc);
-- 하루 한도를 셀 때 쓴다
create index if not exists gold_gifts_sent_idx on public.gold_gifts (from_user, sent_at)
  where status = 'sent';


-- ════════════════════════════════════════════════════════════════════════════
-- 3. 한도
-- ════════════════════════════════════════════════════════════════════════════

/** 보내는 사람 기준 하루 한도 (제작자 결정: 50만) */
create or replace function public.gold_daily_cap()
returns integer language sql immutable as $$ select 500000 $$;

/** 한 사람이 동시에 걸어 둘 수 있는 부탁 수 — 스팸 방지 */
create or replace function public.gold_pending_cap()
returns integer language sql immutable as $$ select 5 $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. 통로 (security definer — RLS 를 우회하는 유일한 길)
--
--   ★★ 전부 `auth.uid()` 로 **본인 것인지 함수 안에서 확인**한다.
--     넘어온 id 는 «어느 행인가» 로만 쓰고, «누구인가» 로는 절대 안 쓴다.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * 부탁한다 (구걸).
 * ★ 순위 + 내가 본 이름을 같이 준다 — 그 사이 순위가 밀렸으면 거절한다.
 */
create or replace function public.gold_beg(p_kind text, p_rank integer, p_seen_name text)
returns table (ok boolean, reason text)
language plpgsql volatile security definer set search_path = '' as $fn$
declare
  me     uuid := (select auth.uid());
  target uuid;
  nm     text;
  n      integer;
begin
  if me is null then return query select false, '로그인이 필요하다'::text; return; end if;

  target := public.gold_user_at(p_kind, p_rank);
  if target is null then return query select false, '그 순위에 아무도 없다'::text; return; end if;
  if target = me then return query select false, '자기 자신에게는 못 한다'::text; return; end if;

  select s.company_name into nm from public.scores s where s.user_id = target;
  if nm is distinct from p_seen_name then
    return query select false, '순위가 바뀌었다 — 새로고침하고 다시 해라'::text; return;
  end if;

  select count(*) into n from public.gold_gifts g
   where g.to_user = me and g.status = 'pending';
  if n >= public.gold_pending_cap() then
    return query select false, '걸어 둔 부탁이 너무 많다'::text; return;
  end if;

  if exists (select 1 from public.gold_gifts g
              where g.to_user = me and g.from_user = target and g.status = 'pending') then
    return query select false, '이미 부탁해 두었다'::text; return;
  end if;

  insert into public.gold_gifts (from_user, to_user) values (target, me);
  return query select true, ''::text;
end $fn$;


/** 내 부탁함 — 내가 받은 부탁('in')과 내가 건 부탁('out') */
create or replace function public.gold_inbox()
returns table (id bigint, dir text, other text, amount integer, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $fn$
  select g.id,
         case when g.from_user = (select auth.uid()) then 'in' else 'out' end,
         coalesce(o.company_name, '(사라진 단)'),
         g.amount, g.status, g.created_at
    from public.gold_gifts g
    left join public.scores o
      on o.user_id = case when g.from_user = (select auth.uid()) then g.to_user else g.from_user end
   where (g.from_user = (select auth.uid()) or g.to_user = (select auth.uid()))
     and g.created_at > now() - interval '14 days'
   order by g.created_at desc
   limit 50;
$fn$;


/**
 * 승낙하고 보낸다.
 *
 * ★★ 「읽고 확인하고 쓰기」로 짜면 동시에 들어온 요청 둘이 **둘 다 통과한다.**
 *   그 행을 `for update` 로 잠그고 처리한다 (§010 `pvp_claim` 과 같은 이유).
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

  /* ★★ 여기 예전에 이렇게 적혀 있었고, 그래서 **이 함수는 부를 때마다 죽었다:**
   *
   *     select count(*) into cnt from public.gold_gifts … for update;
   *     → ERR 0A000 : FOR UPDATE is not allowed with aggregate functions
   *
   *   PostgreSQL 은 집계와 잠금절을 같이 못 쓴다. plpgsql 은 문장을 «처음 실행할 때»
   *   계획하므로 `create function` 은 멀쩡히 통과하고 **부를 때만** 터진다 —
   *   승낙이 한 번도 성공한 적이 없었다 (프로덕션: 부탁 4건 전부 pending, 보내진 적 0건).
   *
   *   집계를 빼고 **행을 직접 잠근다.** 잠그려던 의도는 그대로 살고, 오히려 이쪽이
   *   진짜로 그 행을 잠근다. 어법은 아래 `gold_decline` 과 같다.
   *   (db/014_gold_send_fix.sql 로 프로덕션에 반영했다. 여기도 같이 고쳐 둔다 —
   *    안 그러면 설치 순서대로 다시 돌릴 때 012 가 014 를 덮어 버그가 되살아난다.)
   *   ★ `tools/lib/sqllock.mjs` 가 이 형태를 이제 글자로 잡는다. */
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


/** 거절한다 */
create or replace function public.gold_decline(p_id bigint)
returns table (ok boolean, reason text)
language plpgsql volatile security definer set search_path = '' as $fn$
declare me uuid := (select auth.uid()); cnt integer;
begin
  if me is null then return query select false, '로그인이 필요하다'::text; return; end if;
  update public.gold_gifts set status = 'declined'
   where id = p_id and from_user = me and status = 'pending';
  get diagnostics cnt = row_count;
  if cnt = 0 then return query select false, '이미 처리된 부탁이다'::text; return; end if;
  return query select true, ''::text;
end $fn$;


/**
 * 아직 세이브에 안 넣은 몫을 **한 번에** 받아 간다.
 *
 * ★★ 여기가 멱등성의 자리다. `*_applied_at` 을 찍으면서 금액을 돌려주므로
 *   두 번 불러도 두 번째는 0 이다 — 골드가 복사되지 않는다.
 *
 * ★★ 그리고 **같은 트랜잭션에서 `ledger.gold` 를 같은 만큼 움직인다.**
 *   이게 없으면 50만을 받은 사람이 `checkGrowth` 에 걸려 치트로 표시된다 (파일 머리말).
 *
 * ★ 클라이언트는 돌려받은 delta 를 세이브에 더하고 **바로 저장**해야 한다.
 *   중간에 죽으면 그 몫은 사라진다 — 복사되는 것보다는 낫다.
 */
create or replace function public.gold_apply()
returns table (delta bigint, credited bigint, debited bigint)
language plpgsql volatile security definer set search_path = '' as $fn$
declare
  me uuid := (select auth.uid());
  cr bigint := 0;
  db bigint := 0;
begin
  if me is null then return query select 0::bigint, 0::bigint, 0::bigint; return; end if;

  with x as (
    update public.gold_gifts set to_applied_at = now()
     where to_user = me and status = 'sent' and to_applied_at is null
     returning amount
  ) select coalesce(sum(amount), 0)::bigint into cr from x;

  with y as (
    update public.gold_gifts set from_applied_at = now()
     where from_user = me and status = 'sent' and from_applied_at is null
     returning amount
  ) select coalesce(sum(amount), 0)::bigint into db from y;

  if cr <> 0 or db <> 0 then
    update public.ledger set gold = greatest(0, gold + cr - db) where user_id = me;
  end if;

  return query select (cr - db)::bigint, cr, db;
end $fn$;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. 권한
--
--   ★★ `revoke from public` 만으로는 **안 잠긴다.** Supabase 는 public 스키마 함수에
--     anon·authenticated 의 EXECUTE 를 default privileges 로 따로 준다 (§77).
--     두 역할을 이름으로 지목해 회수한 뒤 필요한 것만 준다.
--
--   ★ 전부 **로그인한 사람만** 이다. 골드는 계정에 딸린 것이라 anon 에게 열 이유가 없다.
-- ════════════════════════════════════════════════════════════════════════════

revoke all on function public.gold_user_at(text, integer)     from anon, authenticated, public;
revoke all on function public.gold_beg(text, integer, text)   from anon, authenticated, public;
revoke all on function public.gold_inbox()                    from anon, authenticated, public;
revoke all on function public.gold_send(bigint, integer)      from anon, authenticated, public;
revoke all on function public.gold_decline(bigint)            from anon, authenticated, public;
revoke all on function public.gold_apply()                    from anon, authenticated, public;
revoke all on function public.gold_daily_cap()                from anon, authenticated, public;
revoke all on function public.gold_pending_cap()              from anon, authenticated, public;

-- ★ gold_user_at 은 내부용이다 — 아무에게도 안 준다 (gold_beg 안에서만 쓴다).
grant execute on function public.gold_beg(text, integer, text) to authenticated;
grant execute on function public.gold_inbox()                  to authenticated;
grant execute on function public.gold_send(bigint, integer)    to authenticated;
grant execute on function public.gold_decline(bigint)          to authenticated;
grant execute on function public.gold_apply()                  to authenticated;
grant execute on function public.gold_daily_cap()              to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 확인 (적용 후)
--
--   ① RLS·정책이 규칙대로인가 —  node tools/rlscheck.mjs
--   ② 권한이 실제로 어떤가 (§77: 적어 놓은 게 아니라 ACL 을 읽어야 한다)
--        select p.proname, array_to_string(p.proacl, ' | ')
--          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname = 'public' and p.proname like 'gold_%';
--      → gold_user_at 에 authenticated 가 있으면 안 된다.
-- ════════════════════════════════════════════════════════════════════════════
