-- ════════════════════════════════════════════════════════════════════════════
-- 용병단 — Supabase 초기 스키마
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 새 쿼리에 이 파일 전체를 붙여넣고 Run.
-- 두 번 실행해도 안전하다 (전부 if not exists / or replace).
--
-- ─────────────────────────────────────────────────────────────────────────
-- ★ 설계의 핵심: 세이브 백업과 랭킹 제출은 **완전히 다른 물건이다.**
--
--   · 세이브(saves)   = 본인 데이터의 백업. **검증하지 않는다.**
--     조작해 봐야 본인 게임만 이상해진다. 여기에 검증을 걸면 정상 플레이어가
--     밸런스 패치 때마다 세이브를 잃는다.
--   · 랭킹(scores)    = 남과 비교되는 숫자. **여기만 검증한다.**
--     클라이언트는 이 테이블에 쓸 권한이 아예 없다 — Edge Function 만 쓴다.
--
--   이렇게 가르면 save() 가 초당 여러 번 불려도 서버 함수는 한 번도 안 돌고,
--   함수는 기록이 실제로 갱신될 때만(나락 주 1회 · 탑 월 1회) 호출된다.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ★ 정직하게: 이건 "조작 방지"가 아니라 "개연성 검사"다.
--   전투 승패·아이템 스탯 위조는 이 규칙들로 못 잡는다. 그렇게 광고하면 안 된다.
--   막는 것은 "물리적으로 불가능한 값"과 "게임 규칙상 나올 수 없는 증가폭"이다.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 1. 클라우드 세이브
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.saves (
  user_id    uuid        primary key references auth.users(id) on delete cascade,

  -- ★ seed 는 "어느 플레이스루인가"를 가른다. newGame() 마다 새로 뽑히므로
  --   seed 가 다르면 같은 사람의 **다른 게임**이다 — 자동으로 덮어쓰면 안 된다.
  seed       bigint      not null,
  -- ★ rev 는 save() 마다 +1 하는 단조 증가값. 기기 간 최신 판정의 1차 기준이다.
  --   시각(saved_at)을 1차 기준으로 쓰면 기기 시계가 틀어졌을 때 최신본이 밀린다.
  rev        bigint      not null,
  saved_at   timestamptz not null,          -- 클라 시계. 참고용이고 신뢰하지 않는다
  day        integer     not null,          -- 충돌 모달에 "N일차 vs M일차"를 띄우려고 꺼내 둔다

  -- payload 를 jsonb 가 아니라 text 로 두는 이유: 서버가 내용을 볼 일이 없다.
  -- 후반 세이브가 수백 KB 인데 jsonb 파싱은 공유 인스턴스에서 순수 낭비다.
  payload    text        not null,

  updated_at timestamptz not null default now(),   -- 서버 시각. 이쪽이 진실이다

  constraint saves_payload_size check (octet_length(payload) <= 3145728)   -- 3MB
);

alter table public.saves enable row level security;

drop policy if exists "saves_select_own" on public.saves;
create policy "saves_select_own" on public.saves
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "saves_insert_own" on public.saves;
create policy "saves_insert_own" on public.saves
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "saves_update_own" on public.saves;
create policy "saves_update_own" on public.saves
  for update to authenticated using ((select auth.uid()) = user_id)
                                with check ((select auth.uid()) = user_id);

-- ★ DELETE 정책을 **일부러 안 만든다.** 클라이언트가 세이브를 지울 수단이 없어야
--   버그나 오조작으로 남의 진행이 날아가는 일이 안 생긴다.


-- 다른 플레이스루로 갈아탈 때 직전 것을 하나만 보관한다.
-- (유저당 최대 2행으로 상한이 잡혀서 무료 티어 용량을 안 잡아먹는다)
create table if not exists public.saves_archive (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  seed        bigint      not null,
  rev         bigint      not null,
  payload     text        not null,
  archived_at timestamptz not null default now()
);

alter table public.saves_archive enable row level security;

drop policy if exists "archive_select_own" on public.saves_archive;
create policy "archive_select_own" on public.saves_archive
  for select to authenticated using ((select auth.uid()) = user_id);


/* 되감기 방어 + 플레이스루 분기 보관.
 *
 * ★ RLS 위반은 "0행 갱신"으로 조용히 끝난다. 그래서 거절 사유는 예외로 알려야
 *   클라이언트가 "왜 안 올라갔는지"를 안다. */
create or replace function public.saves_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();

  if new.seed = old.seed then
    -- 같은 플레이스루: 뒤로 가는 저장은 거절한다.
    -- (기기 A 가 오래된 상태를 늦게 올려서 기기 B 의 진행을 덮는 것을 막는다)
    if new.rev <= old.rev then
      raise exception '오래된 세이브다 (서버 rev=%, 보낸 rev=%)', old.rev, new.rev
        using errcode = 'P0001';
    end if;
  else
    -- 다른 플레이스루: 덮어쓰되 직전 것을 한 벌 보관한다.
    insert into public.saves_archive (user_id, seed, rev, payload)
    values (old.user_id, old.seed, old.rev, old.payload)
    on conflict (user_id) do update
      set seed = excluded.seed, rev = excluded.rev,
          payload = excluded.payload, archived_at = now();
  end if;

  return new;
end $$;

drop trigger if exists saves_guard_bu on public.saves;
create trigger saves_guard_bu before update on public.saves
  for each row execute function public.saves_guard();


-- ════════════════════════════════════════════════════════════════════════════
-- 2. 랭킹
--
-- ★ 시즌을 만들지 않는다 (제작자 결정: 영구 누적).
--   다만 season_id 컬럼은 기본값 0 으로 남겨 둔다 — 나중에 시즌을 붙일 때
--   테이블을 갈아엎지 않아도 되고, 지금은 아무 데도 안 보인다.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.scores (
  user_id        uuid    primary key references auth.users(id) on delete cascade,
  season_id      integer not null default 0,
  company_name   text    not null check (char_length(company_name) between 1 and 24),
  seed           bigint  not null,

  -- ── 순위 지표 (전부 단조 증가) ────────────────────────────────
  -- best_day = 기록을 세운 날. 동점일 때 "더 적은 일수로 도달한 쪽"이 위다.
  abyss_best     integer  not null default 0 check (abyss_best  between 0 and 300),
  abyss_best_day integer  not null default 0,
  tower_best     integer  not null default 0 check (tower_best  between 0 and 500),
  tower_best_day integer  not null default 0,
  quests_done    integer  not null default 0 check (quests_done >= 0),

  -- ── 순위표에 같이 보여줄 것 ──────────────────────────────────
  day            integer  not null default 1  check (day >= 1),
  city_id        text,
  city_tier      smallint          check (city_tier between 1 and 5),
  roster_n       smallint not null default 0,
  roster_cap     smallint not null default 20 check (roster_cap between 20 and 70),
  top_level      smallint not null default 1  check (top_level between 1 and 80),
  squads_n       smallint not null default 0  check (squads_n between 0 and 5),
  pets_n         smallint not null default 0,

  /* ★ status — 제작자 결정: "랭킹에서만 숨김".
   *   ok      정상
   *   flagged 개연성 검사에 걸렸다. **게임은 그대로 즐긴다.** 순위표에만 안 나온다.
   *           본인에게 알리지 않는다 — 오탐이었을 때 정상 플레이어를 불안하게 만들 이유가 없고,
   *           진짜 조작자에게는 "무엇이 걸렸는지" 힌트가 된다.
   *   held    사람이 직접 확인하려고 잡아 둔 것 (수동 전용) */
  status         text     not null default 'ok' check (status in ('ok','flagged','held')),
  submitted_at   timestamptz not null default now()
);

alter table public.scores enable row level security;

-- 자기 점수만 직접 읽을 수 있다. 남의 점수는 아래 leaderboard() 로만 본다
-- (user_id·seed 를 노출하지 않기 위해서다).
drop policy if exists "scores_select_own" on public.scores;
create policy "scores_select_own" on public.scores
  for select to authenticated using ((select auth.uid()) = user_id);

-- ★ INSERT/UPDATE 정책이 **없다.** 클라이언트는 이 테이블에 못 쓴다.
--   Edge Function 이 service_role 로만 쓴다. 이게 랭킹 신뢰의 뿌리다.

-- 정렬과 정확히 같은 순서의 부분 인덱스 (status='ok' 만 순위에 오른다)
create index if not exists scores_abyss_idx  on public.scores
  (abyss_best desc, abyss_best_day asc, submitted_at asc) where status = 'ok';
create index if not exists scores_tower_idx  on public.scores
  (tower_best desc, tower_best_day asc, submitted_at asc) where status = 'ok';
create index if not exists scores_quests_idx on public.scores
  (quests_done desc, day asc, submitted_at asc) where status = 'ok';


/* ★ 최후 방어선.
 *   Edge Function 에 버그가 있어도, service_role 키가 새어 나가도,
 *   같은 플레이스루의 기록이 **뒤로 갈 수는 없다.**
 *   (seed 가 바뀌면 새 플레이스루이므로 이 검사를 건너뛴다) */
create or replace function public.scores_monotonic() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.abyss_best  < old.abyss_best
  or new.tower_best  < old.tower_best
  or new.quests_done < old.quests_done
  or new.day         < old.day then
    raise exception '기록은 감소할 수 없다 (나락 %→%, 탑 %→%, 의뢰 %→%, 일차 %→%)',
      old.abyss_best, new.abyss_best, old.tower_best, new.tower_best,
      old.quests_done, new.quests_done, old.day, new.day
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists scores_monotonic_bu on public.scores;
create trigger scores_monotonic_bu before update on public.scores
  for each row when (old.seed = new.seed) execute function public.scores_monotonic();


-- ════════════════════════════════════════════════════════════════════════════
-- 3. 검증 원장 — 서버만 본다
--
-- "지난번에 받아들인 값"을 여기 보관해 두고, 다음 제출과 **차이**를 잰다.
-- 세이브 본문 전체를 다시 계산하지 않고 증가폭만 봐도 대부분의 조작이 걸린다.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.ledger (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  seed               bigint  not null,
  day                integer not null,
  gold               bigint  not null,
  renown             integer not null,
  quests_done        integer not null,
  battles_won        integer not null,
  battles_lost       integer not null,
  abyss_best         integer not null,
  abyss_last_run_day integer not null,
  tower_best         integer not null,
  tower_last_run_day integer not null,
  exp_total          bigint  not null,     -- 로스터 누적 경험치 합
  items_n            integer not null,
  pets_n             integer not null,
  accepted_at        timestamptz not null default now()
);

-- RLS 만 켜고 정책을 **하나도 안 만든다** = 클라이언트는 존재조차 못 건드린다.
alter table public.ledger enable row level security;


create table if not exists public.rejections (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- A = 물리적으로 불가능 (오탐 0)
  -- B = 총량 상한 초과 (오탐 가능 → 원본을 남겨 사람이 확인한다)
  tier       text not null check (tier in ('A','B','C')),
  reasons    jsonb not null,
  payload    text,
  created_at timestamptz not null default now()
);

alter table public.rejections enable row level security;

create index if not exists rejections_user_idx on public.rejections (user_id, created_at desc);


-- ════════════════════════════════════════════════════════════════════════════
-- 4. 공개 순위표
--
-- 뷰가 아니라 함수로 만든다 — 밖으로 내보낼 컬럼을 **명시적으로 고르기** 위해서다.
-- 뷰는 나중에 컬럼을 추가하면 조용히 같이 새어 나간다.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.leaderboard(
  p_kind  text,
  p_limit integer default 100
)
returns table (
  rank         bigint,
  company_name text,
  value        integer,
  at_day       integer,
  city_id      text,
  city_tier    smallint,
  top_level    smallint,
  roster_n     smallint,
  day          integer
)
language sql stable security definer set search_path = '' as $$
  select
    row_number() over (
      order by
        case p_kind when 'abyss' then s.abyss_best
                    when 'tower' then s.tower_best
                    else s.quests_done end desc,
        case p_kind when 'abyss' then s.abyss_best_day
                    when 'tower' then s.tower_best_day
                    else s.day end asc,
        s.submitted_at asc
    ),
    s.company_name,
    case p_kind when 'abyss' then s.abyss_best
                when 'tower' then s.tower_best
                else s.quests_done end,
    case p_kind when 'abyss' then s.abyss_best_day
                when 'tower' then s.tower_best_day
                else s.day end,
    s.city_id, s.city_tier, s.top_level, s.roster_n, s.day
  from public.scores s
  where s.status = 'ok'
    and case p_kind when 'abyss' then s.abyss_best
                    when 'tower' then s.tower_best
                    else s.quests_done end > 0
  order by 3 desc, 4 asc, s.submitted_at asc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.leaderboard(text, integer) from public;
grant execute on function public.leaderboard(text, integer) to authenticated;


/* keep-alive.
 * ★ 무료 티어는 일정 기간 요청이 없으면 프로젝트가 일시정지된다.
 *   순위표가 조용히 죽지 않도록 매일 한 번 두드린다 (GitHub Actions). */
create or replace function public.ping() returns integer
language sql security definer set search_path = '' as $$ select 1 $$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. 배포 전 필수 확인
--
-- publishable 키는 브라우저에 그대로 실린다 = 100% 공개다.
-- RLS 를 안 켠 public 테이블이 하나라도 있으면 그 테이블은 전부 유출된다.
-- 아래 쿼리 결과가 **반드시 0행**이어야 한다.
-- ════════════════════════════════════════════════════════════════════════════

-- select c.relname
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
