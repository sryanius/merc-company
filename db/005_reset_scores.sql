-- ════════════════════════════════════════════════════════════════════════════
-- 순위표 리셋 — 전투 곡선을 바꿀 때 (HANDOFF §25 의 3b 와 **같이** 돌린다)
--
-- 적용: npx supabase db query --linked -f db/005_reset_scores.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★★ 이것만 돌리면 **아무것도 리셋되지 않는다.** ★★
--
--   `src/game/rules.js extractScore` 는 순위 지표를 **클라이언트 세이브**에서 읽는다
--   (`st.abyss.best` · `st.tower.best` · 완료 의뢰 수). 서버 행을 지워도
--   그 사람이 다음에 접속하는 순간 같은 숫자가 그대로 다시 올라온다.
--
--   그래서 리셋은 **양쪽을 같이** 해야 한다:
--     1. 클라이언트: 세이브 마이그레이션에서 tower.best/bestDay · abyss.best/bestDay ·
--        완료 의뢰 수를 0 으로 내린다. → DATA_VERSION 을 올리는 3b 에 얹는다.
--     2. 서버: 이 파일.
--   1 없이 2만 하면 하루 만에 원상복구된다.
--
-- ★ 왜 지우지 않고 옮기나
--   제작자 결정은 "사람 없으니 그냥 리셋" 이었지만, 지우는 것과 옮기는 것은
--   비용이 같고 되돌릴 수 있는 쪽이 하나뿐이다. 곡선을 바꾼 뒤 "예전엔 몇 층까지 갔었나"를
--   비교할 일이 반드시 생긴다 — 그때 원본이 없으면 아무것도 못 한다.
--
-- ★ 돌리는 순서 — **배포가 먼저다.**
--   `scores_monotonic` 트리거는 기록이 줄면 **예외를 던진다**(조용히 무시하는 게 아니다).
--   그래서 클라이언트가 DATA_VERSION 5 로 올라가 tower.best 를 0 으로 내린 채 제출하는데
--   서버에 옛 행(예: 379층)이 남아 있으면 그 사람의 제출이 계속 거부된다.
--   행을 지우고 나면 UPDATE 가 아니라 INSERT 가 되므로 트리거를 안 탄다 — 저절로 풀린다.
--
--     1. 클라이언트 배포 (DATA_VERSION 5)
--     2. 이 파일
--
--   순서가 뒤집혀도 망가지지는 않는다. 그 사이 옛 클라이언트가 올린 행은 2 에서 같이 지워지고,
--   그 뒤 제출은 INSERT 로 새로 들어간다. 잠깐 제출이 실패할 뿐이고 재시도가 알아서 복구한다.

-- ★ season_id 는 이미 scores 에 있다(기본값 0, 아무도 안 읽는다).
--   여기서 처음으로 쓴다 — 보관본에 어느 시즌 것인지 찍어 둔다.

begin;

-- 지나간 시즌 보관함. scores 와 같은 모양에 보관 시각만 더한다.
create table if not exists public.scores_history (
  like public.scores including defaults,
  archived_at timestamptz not null default now()
);
-- scores 의 primary key(user_id) 는 여기서는 안 된다 — 시즌마다 같은 사람이 또 들어온다.
alter table public.scores_history drop constraint if exists scores_history_pkey;
create index if not exists scores_history_season_idx on public.scores_history (season_id, user_id);

alter table public.scores_history enable row level security;
-- 보관본은 아무도 못 읽는다. 순위표에 안 쓰이고, 남의 기록이므로 열어 둘 이유가 없다.
-- (필요하면 대시보드에서 service_role 로 본다.)

-- ★ 보관함이 scores 보다 먼저 만들어졌으면 나중에 생긴 컬럼이 없다.
--   `select s.*` 가 «INSERT has more expressions than target columns» 로 죽는다.
--   실제로 squad 컬럼(006)을 더한 뒤 이 파일을 다시 돌리다 겪었다. 여기서 따라가게 한다.
alter table public.scores_history add column if not exists squad jsonb;

-- 지금 것을 통째로 옮긴다 — 컬럼을 **명시**한다 (s.* 는 순서·개수에 취약하다)
insert into public.scores_history (
  user_id, season_id, company_name, seed,
  abyss_best, abyss_best_day, tower_best, tower_best_day, quests_done,
  day, city_id, city_tier, roster_n, roster_cap, top_level, squads_n, pets_n,
  squad, status, submitted_at, archived_at)
select
  s.user_id, s.season_id, s.company_name, s.seed,
  s.abyss_best, s.abyss_best_day, s.tower_best, s.tower_best_day, s.quests_done,
  s.day, s.city_id, s.city_tier, s.roster_n, s.roster_cap, s.top_level, s.squads_n, s.pets_n,
  s.squad, s.status, s.submitted_at, now()
from public.scores s;

-- 새 시즌 번호 = 지금까지 중 가장 큰 것 + 1
--
-- ★ `alter ... set default next_season` 처럼 변수를 그대로 쓰면
--   「cannot use column reference in DEFAULT expression」으로 죽는다 —
--   DEFAULT 식은 PL/pgSQL 변수를 모르고 컬럼 이름으로 읽는다. 동적 SQL 로 값을 박아야 한다.
do $$
declare next_season integer;
begin
  select coalesce(max(season_id), 0) + 1 into next_season from public.scores_history;
  raise notice '새 시즌: %', next_season;
  execute format('alter table public.scores alter column season_id set default %s', next_season);
end $$;

delete from public.scores;

commit;

-- 확인
select
  (select count(*) from public.scores)          as 현재_등재,
  (select count(*) from public.scores_history)  as 보관본,
  (select coalesce(max(season_id), 0) from public.scores_history) as 지난_시즌;
