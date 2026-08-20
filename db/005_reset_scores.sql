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

-- 지금 것을 통째로 옮긴다
insert into public.scores_history
  select s.*, now() from public.scores s;

-- 새 시즌 번호 = 지금까지 중 가장 큰 것 + 1
do $$
declare next_season integer;
begin
  select coalesce(max(season_id), 0) + 1 into next_season from public.scores_history;
  raise notice '새 시즌: %', next_season;
  alter table public.scores alter column season_id set default next_season;
end $$;

delete from public.scores;

commit;

-- 확인
select
  (select count(*) from public.scores)          as 현재_등재,
  (select count(*) from public.scores_history)  as 보관본,
  (select coalesce(max(season_id), 0) from public.scores_history) as 지난_시즌;
