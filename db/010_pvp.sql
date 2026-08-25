-- ════════════════════════════════════════════════════════════════════════════
-- 용병단 — PvP (3단계: 테이블과 RLS만. 도전 처리는 4단계 Edge Function 에서)
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
-- 두 번 실행해도 안전하다 (전부 if not exists / or replace).
--
-- ─────────────────────────────────────────────────────────────────────────
-- ★★ 설계의 뿌리 — **승패는 서버가 정한다.**
--   클라이언트가 «내가 이겼다» 를 올리게 하면 누구든 무한히 점수를 올린다.
--   PvP 점수는 조작 유인이 순위표보다 훨씬 크다 (§55 진궐단).
--   엔진은 DOM 을 안 쓰고 시드만으로 결정적이라 서버에서 그대로 돌릴 수 있다 —
--   실측으로 확인했다 (§68.2: Node 22 와 Deno 2.9 가 200판 지문까지 일치).
--
-- ★★ 그래서 이 파일의 다섯 테이블은 **전부 RLS 를 켜고 정책을 하나도 안 만든다.**
--   정책이 없으면 anon·authenticated 는 아무것도 못 한다. 읽기는 아래
--   `security definer` 함수로만 열고, 쓰기는 service_role(Edge Function) 만 한다.
--   scores 와 같은 모양이고, 그게 이 게임 랭킹 신뢰의 뿌리다.
--
-- ★ 정직하게: 이것도 "조작 방지"의 완성이 아니다.
--   서버가 전투를 돌려도 **입력(방어 편성)은 결국 클라이언트가 신고한 값**이다.
--   장비 위조는 6단계의 «가능한 최대치» 검사로 막는다 (§68.1). 여기서는 못 막는다.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 1. 레이팅
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.pvp_ratings (
  user_id     uuid    primary key references auth.users(id) on delete cascade,

  -- ★ 기본 승점 1000 (제작자 결정)
  rating      integer not null default 1000 check (rating >= 100),

  wins        integer not null default 0 check (wins   >= 0),
  losses      integer not null default 0 check (losses >= 0),
  -- 도전한 횟수(방어는 제외). 하루 상한을 이걸로 센다
  challenges  integer not null default 0 check (challenges >= 0),

  /* ★ 하루 도전 예산 — 날짜가 바뀌면 Edge Function 이 0 으로 되돌린다.
   *   DB 에 두는 이유: 클라 시계를 믿을 수 없고, 여러 기기에서 동시에 도전할 수 있다. */
  day_key     date    not null default (now() at time zone 'utc')::date,
  day_used    smallint not null default 0 check (day_used >= 0),

  /* ok / flagged — scores 와 같은 어휘. flagged 는 순위에서만 숨긴다.
   * ★ 본인에게 알리지 않는다 (§55 의 결정을 그대로 따른다). */
  status      text    not null default 'ok' check (status in ('ok','flagged','held')),

  updated_at  timestamptz not null default now()
);

alter table public.pvp_ratings enable row level security;
-- 정책 없음 — 읽기는 pvp_board()/pvp_me(), 쓰기는 Edge Function(service_role) 만.


-- ════════════════════════════════════════════════════════════════════════════
-- 2. 방어 편성 스냅샷
-- ════════════════════════════════════════════════════════════════════════════

/* ★★ 왜 «서버가 접은 UnitDef» 를 저장하나
 *   엔진의 rng 는 단일 스트림이라, 유닛을 만드는 단계에서 한 번만 갈려도
 *   이후 치명타·회피가 통째로 밀린다. 서버와 클라가 UnitDef 를 **각자** 만들면 반드시 어긋난다.
 *   그래서 **서버가 한 번 접어 저장하고**, 도전 응답에 그 배열을 그대로 실어 내리고,
 *   클라는 재계산 없이 그것으로만 재생한다.
 *
 * ★ raw 는 그 UnitDef 를 만든 재료(장비 원본)다. 6단계의 위조 검사기가 이걸 본다 —
 *   접힌 결과만 두면 «이 스탯이 물리적으로 가능한가» 를 나중에 되물을 수 없다. */
create table if not exists public.pvp_defense (
  user_id     uuid        primary key references auth.users(id) on delete cascade,

  /* ★ 도전 대상을 가리키는 공개 손잡이. user_id 를 노출하지 않으려고 따로 둔다
   *   (순위 번호로 지목하면 목록을 본 뒤 도전하는 사이 순위가 바뀌어 엉뚱한 사람을 때린다). */
  handle      uuid        not null unique default gen_random_uuid(),

  company_name text       not null check (char_length(company_name) between 1 and 24),

  -- 태그매치 순서대로의 부대들. [[UnitDef,...], [UnitDef,...], ...]
  units       jsonb       not null,
  -- 그 UnitDef 를 만든 재료 (장비 원본 포함). 위조 검사용
  raw         jsonb,
  -- units 를 접을 때 쓴 엔진 지문 — 다르면 다시 접어야 한다
  engine_hash text        not null,
  -- 어느 세이브에서 왔나 (saves.rev). 같은 rev 면 다시 접지 않는다
  save_rev    bigint,

  power       integer     not null default 0 check (power >= 0),
  updated_at  timestamptz not null default now(),

  constraint pvp_defense_units_size check (pg_column_size(units) <= 262144)   -- 256KB
);

alter table public.pvp_defense enable row level security;
-- 정책 없음.

create index if not exists pvp_defense_handle_idx on public.pvp_defense (handle);


-- ════════════════════════════════════════════════════════════════════════════
-- 3. 전적
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.pvp_matches (
  id            bigserial primary key,

  /* ★★ 클라이언트가 만든 도전 id. **unique 다.**
   *   이 하나로 세 가지가 동시에 닫힌다:
   *     · 결과가 나쁘면 응답을 버리고 다시 도전하기
   *     · 네트워크 재전송으로 같은 도전이 두 번 처리되기
   *     · 시드가 마음에 들 때까지 굴리기
   *   같은 id 로 다시 오면 **저장된 결과를 그대로 돌려준다.** */
  challenge_id  uuid        not null unique,

  attacker_id   uuid        not null references auth.users(id) on delete cascade,
  defender_id   uuid        not null references auth.users(id) on delete cascade,

  -- ★ 시드는 서버가 뽑는다. 클라가 보낸 시드는 어떤 경우에도 쓰지 않는다
  --   (이 게임엔 승률 예보가 있어서, 시드를 미리 알면 무패가 된다).
  seed          bigint      not null,
  engine_hash   text        not null,

  -- 재생에 필요한 입력 전부 (양쪽 UnitDef·진형). 클라는 이걸로만 재생한다
  cfg           jsonb       not null,

  winner        text        not null check (winner in ('attacker','defender','draw')),
  rounds        smallint    not null default 0,      -- 태그매치가 몇 합까지 갔나
  attacker_delta integer    not null,
  defender_delta integer    not null,
  attacker_after integer    not null,
  defender_after integer    not null,

  created_at    timestamptz not null default now(),

  constraint pvp_matches_cfg_size check (pg_column_size(cfg) <= 524288)      -- 512KB
);

alter table public.pvp_matches enable row level security;
-- 정책 없음.

create index if not exists pvp_matches_attacker_idx on public.pvp_matches (attacker_id, created_at desc);
create index if not exists pvp_matches_defender_idx on public.pvp_matches (defender_id, created_at desc);


-- ════════════════════════════════════════════════════════════════════════════
-- 4. 쿨다운 (같은 상대 반복 사냥 방지)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.pvp_cooldowns (
  attacker_id uuid not null references auth.users(id) on delete cascade,
  defender_id uuid not null references auth.users(id) on delete cascade,
  until       timestamptz not null,
  primary key (attacker_id, defender_id)
);

alter table public.pvp_cooldowns enable row level security;
-- 정책 없음.


-- ════════════════════════════════════════════════════════════════════════════
-- 5. 재생 불일치 기록
-- ════════════════════════════════════════════════════════════════════════════

/* ★ 서버가 정한 승패와 클라가 재생한 결과가 다르면 여기에 한 줄 남긴다.
 *   «크로스 런타임 발산» 을 **수치로 갖는 유일한 통로**다.
 *   골든 픽스처(§68)는 고정 편성만 보므로, 실제 편성에서 갈리는 것은 이걸로만 안다. */
create table if not exists public.pvp_desync (
  id           bigserial primary key,
  match_id     bigint      references public.pvp_matches(id) on delete cascade,
  user_id      uuid        references auth.users(id) on delete set null,
  engine_hash  text,
  client_ua    text,
  server_winner text,
  client_winner text,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

alter table public.pvp_desync enable row level security;
-- 정책 없음.


-- ════════════════════════════════════════════════════════════════════════════
-- 6. 최후 방어선 — 트리거
-- ════════════════════════════════════════════════════════════════════════════

/* ★ scores 의 monotonic 트리거를 **베끼지 않는다.** 레이팅은 줄어야 정상이다.
 *   대신 «한 판에 이만큼 넘게 움직일 수 없다» 를 건다.
 *   Edge Function 이 뚫려도 레이팅이 한 번에 폭주하지는 못한다. */
create or replace function public.pvp_ratings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();

  if abs(new.rating - old.rating) > 64 then
    raise exception '레이팅이 한 번에 % 만큼 움직였다 (최대 64)', new.rating - old.rating;
  end if;

  -- 판수는 한 번에 하나씩만 는다 (감소도 금지)
  if (new.wins + new.losses) not in (old.wins + old.losses, old.wins + old.losses + 1) then
    raise exception '판수가 한 번에 % 만큼 늘었다', (new.wins + new.losses) - (old.wins + old.losses);
  end if;

  return new;
end $$;

drop trigger if exists pvp_ratings_guard_trg on public.pvp_ratings;
create trigger pvp_ratings_guard_trg
  before update on public.pvp_ratings
  for each row execute function public.pvp_ratings_guard();


-- ════════════════════════════════════════════════════════════════════════════
-- 7. 읽기 함수 (RLS 를 우회하는 유일한 통로)
-- ════════════════════════════════════════════════════════════════════════════

/* PvP 순위표. ★ 기존 leaderboard() 는 손대지 않는다 — 성격이 다른 목록이다.
 *   user_id 를 절대 내보내지 않는다. 지목은 handle 로 한다. */
create or replace function public.pvp_board(p_limit integer default 100)
returns table (
  rank         bigint,
  handle       uuid,
  company_name text,
  rating       integer,
  wins         integer,
  losses       integer,
  power        integer
)
language sql stable security definer set search_path = '' as $$
  select
    row_number() over (order by r.rating desc, r.wins desc, d.updated_at asc) as rank,
    d.handle,
    d.company_name,
    r.rating,
    r.wins,
    r.losses,
    d.power
  from public.pvp_ratings r
  join public.pvp_defense d on d.user_id = r.user_id
  where r.status = 'ok'
  order by r.rating desc, r.wins desc, d.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

/* 내 정보 — 로그인한 본인 것만. */
create or replace function public.pvp_me()
returns table (
  rating     integer,
  wins       integer,
  losses     integer,
  day_used   smallint,
  handle     uuid,
  power      integer,
  rank       bigint
)
language sql stable security definer set search_path = '' as $$
  select
    r.rating, r.wins, r.losses, r.day_used, d.handle, d.power,
    (select count(*) + 1 from public.pvp_ratings r2
      where r2.status = 'ok' and r2.rating > r.rating) as rank
  from public.pvp_ratings r
  left join public.pvp_defense d on d.user_id = r.user_id
  where r.user_id = (select auth.uid());
$$;

/* 내 전적. ★ 상대의 user_id 는 안 내보낸다 — 회사 이름만. */
create or replace function public.pvp_history(p_limit integer default 20)
returns table (
  id            bigint,
  role          text,
  opponent      text,
  winner        text,
  delta         integer,
  rating_after  integer,
  created_at    timestamptz
)
language sql stable security definer set search_path = '' as $$
  select
    m.id,
    case when m.attacker_id = (select auth.uid()) then 'attacker' else 'defender' end as role,
    coalesce(od.company_name, '(사라진 단)') as opponent,
    m.winner,
    case when m.attacker_id = (select auth.uid()) then m.attacker_delta else m.defender_delta end as delta,
    case when m.attacker_id = (select auth.uid()) then m.attacker_after else m.defender_after end as rating_after,
    m.created_at
  from public.pvp_matches m
  left join public.pvp_defense od
    on od.user_id = case when m.attacker_id = (select auth.uid()) then m.defender_id else m.attacker_id end
  where m.attacker_id = (select auth.uid()) or m.defender_id = (select auth.uid())
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

/* 재생용 — 내가 낀 판만 준다. cfg 가 커서 목록에는 안 싣는다 (§007 의 400KB 교훈). */
create or replace function public.pvp_replay(p_id bigint)
returns table (seed bigint, engine_hash text, cfg jsonb, winner text)
language sql stable security definer set search_path = '' as $$
  select m.seed, m.engine_hash, m.cfg, m.winner
  from public.pvp_matches m
  where m.id = p_id
    and (m.attacker_id = (select auth.uid()) or m.defender_id = (select auth.uid()));
$$;

revoke all on function public.pvp_board(integer)   from public;
revoke all on function public.pvp_me()             from public;
revoke all on function public.pvp_history(integer) from public;
revoke all on function public.pvp_replay(bigint)   from public;
grant execute on function public.pvp_board(integer)   to anon, authenticated;
grant execute on function public.pvp_me()             to authenticated;
grant execute on function public.pvp_history(integer) to authenticated;
grant execute on function public.pvp_replay(bigint)   to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 8. 도전권 청구 — **한 방의 SQL**
-- ════════════════════════════════════════════════════════════════════════════

/* ★★ 왜 함수인가
 *   «읽어서 확인하고 → 쓴다» 로 짜면 동시에 들어온 요청 둘이 **둘 다 통과한다.**
 *   쿨다운·일일 상한·자기 자신 금지를 한 문장 안에서 원자적으로 청구한다.
 *   청구에 실패하면 0행을 돌려주고, Edge Function 은 그때 429 를 낸다.
 *
 * ★ 골드 30만은 여기서 못 막는다 — 골드는 클라이언트 세이브에만 있다.
 *   서버가 강제할 수 있는 것은 «횟수» 뿐이라 일일 상한으로 대신한다 (4단계에서 정한다). */
create or replace function public.pvp_claim(
  p_attacker uuid,
  p_defender uuid,
  p_daily_cap integer default 0,          -- 0 = 상한 없음
  p_cooldown interval default interval '10 seconds'
)
returns table (ok boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_used  smallint;
begin
  if p_attacker = p_defender then
    return query select false, 'self'; return;
  end if;

  -- 하루가 바뀌었으면 예산을 되돌린다 (같은 문장 안에서)
  update public.pvp_ratings
     set day_key = v_today, day_used = 0
   where user_id = p_attacker and day_key <> v_today;

  select day_used into v_used from public.pvp_ratings where user_id = p_attacker for update;
  if v_used is null then
    insert into public.pvp_ratings (user_id, day_key, day_used) values (p_attacker, v_today, 0)
      on conflict (user_id) do nothing;
    v_used := 0;
  end if;

  /* ★ p_daily_cap = 0 이면 «상한 없음» 이다 (제작자 결정: 계속 도전해도 된다).
   *   0 을 «즉시 거부» 로 읽으면 아무도 도전을 못 하게 된다 — 그 실수를 여기서 막는다. */
  if p_daily_cap > 0 and v_used >= p_daily_cap then
    return query select false, 'daily'; return;
  end if;

  if exists (select 1 from public.pvp_cooldowns
              where attacker_id = p_attacker and defender_id = p_defender and until > now()) then
    return query select false, 'cooldown'; return;
  end if;

  update public.pvp_ratings
     set day_used = day_used + 1, challenges = challenges + 1
   where user_id = p_attacker;

  insert into public.pvp_cooldowns (attacker_id, defender_id, until)
       values (p_attacker, p_defender, now() + p_cooldown)
  on conflict (attacker_id, defender_id) do update set until = excluded.until;

  return query select true, 'ok';
end $$;

revoke all on function public.pvp_claim(uuid, uuid, integer, interval) from public;
-- 실행은 service_role(Edge Function) 만. anon·authenticated 에게는 주지 않는다.


-- ════════════════════════════════════════════════════════════════════════════
-- 9. 확인용 쿼리 (실행 후 눈으로 보라)
-- ════════════════════════════════════════════════════════════════════════════

-- ① RLS 를 안 켠 public 테이블이 있나 — 0행이어야 한다
--   select tablename from pg_tables t
--     where schemaname='public' and tablename like 'pvp_%'
--       and not exists (select 1 from pg_class c
--                        where c.relname=t.tablename and c.relrowsecurity);
--
-- ② pvp_* 에 정책이 있나 — **0행이어야 한다**
--   select tablename, policyname from pg_policies where tablename like 'pvp_%';


-- ════════════════════════════════════════════════════════════════════════════
-- 10. 결과 반영 — **한 문장** (레이팅 + 승패 카운트)
-- ════════════════════════════════════════════════════════════════════════════

/* ★★ 왜 한 문장인가
 *   레이팅과 승패를 따로 update 하면 두 가지가 깨진다:
 *   ① 6번 트리거가 «판수는 한 번에 하나만 는다» 를 보는데, 레이팅만 먼저 올리면
 *      그 update 는 판수가 안 늘어난 상태라 통과하고, 다음 update 에서 또 검사받는다.
 *      두 갱신 사이에 다른 판이 끼어들면 한쪽만 반영된 채로 남는다.
 *   ② 도전자와 방어자를 따로 올리면 «한쪽만 반영» 이 가능해진다.
 *
 *   행이 없으면 만들어 준다 (첫 도전·첫 방어).
 *
 * ★ service_role 전용이다. 클라가 부를 수 있으면 자기 레이팅을 마음대로 올린다. */
create or replace function public.pvp_bump(
  p_attacker uuid,
  p_defender uuid,
  p_attacker_rating integer,
  p_defender_rating integer,
  p_winner text
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_a_win boolean := (p_winner = 'attacker');
  v_d_win boolean := (p_winner = 'defender');
  v_draw  boolean := (p_winner = 'draw');
begin
  if p_winner not in ('attacker', 'defender', 'draw') then
    raise exception 'winner 값이 이상하다: %', p_winner;
  end if;

  insert into public.pvp_ratings (user_id) values (p_attacker) on conflict (user_id) do nothing;
  insert into public.pvp_ratings (user_id) values (p_defender) on conflict (user_id) do nothing;

  update public.pvp_ratings
     set rating = p_attacker_rating,
         wins   = wins   + (case when v_a_win then 1 else 0 end),
         losses = losses + (case when v_d_win then 1 else 0 end)
   where user_id = p_attacker;

  update public.pvp_ratings
     set rating = p_defender_rating,
         wins   = wins   + (case when v_d_win then 1 else 0 end),
         losses = losses + (case when v_a_win then 1 else 0 end)
   where user_id = p_defender;

  /* 무승부는 판수를 안 센다 — 트리거의 «한 번에 하나» 규칙과도 어긋나지 않는다 */
  if v_draw then null; end if;
end $$;

revoke all on function public.pvp_bump(uuid, uuid, integer, integer, text) from public;
-- 실행은 service_role(Edge Function) 만.


-- ════════════════════════════════════════════════════════════════════════════
-- 11. 재생 불일치 신고 — **클라이언트가 부르는 유일한 쓰기 경로**
-- ════════════════════════════════════════════════════════════════════════════

/* ★★ 왜 클라에게 여는가
 *   서버가 정한 승패와 클라가 재생한 결과가 다르면 «화면에선 이겼는데 점수는 졌다» 가 된다.
 *   그 일이 얼마나 일어나는지는 **클라만 안다.** 골든 픽스처(§68)는 고정 편성만 보므로
 *   실제 편성에서 갈리는 것은 이 통로로만 수치가 된다.
 *
 * ★ 열되 **좁게** 연다:
 *   · 자기가 낀 판에만 남길 수 있다 (아래 exists 검사)
 *   · 남기는 것은 승자 두 값과 지문뿐 — 레이팅에 손대지 못한다
 *   · 판당 한 줄 (unique) — 반복 호출로 테이블을 채우지 못한다
 */
create unique index if not exists pvp_desync_once
  on public.pvp_desync (match_id, user_id);

create or replace function public.pvp_desync_log(
  p_match bigint,
  p_engine_hash text,
  p_server_winner text,
  p_client_winner text,
  p_detail jsonb default null,
  p_ua text default null
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then return false; end if;

  -- 자기가 낀 판인가 (남의 판에 낙서할 수 없다)
  if not exists (
    select 1 from public.pvp_matches m
     where m.id = p_match and (m.attacker_id = v_me or m.defender_id = v_me)
  ) then
    return false;
  end if;

  insert into public.pvp_desync
    (match_id, user_id, engine_hash, client_ua, server_winner, client_winner, detail)
  values
    (p_match, v_me, left(coalesce(p_engine_hash, ''), 32), left(coalesce(p_ua, ''), 200),
     left(coalesce(p_server_winner, ''), 16), left(coalesce(p_client_winner, ''), 16), p_detail)
  on conflict (match_id, user_id) do nothing;

  return true;
end $$;

revoke all on function public.pvp_desync_log(bigint, text, text, text, jsonb, text) from public;
grant execute on function public.pvp_desync_log(bigint, text, text, text, jsonb, text) to authenticated;
