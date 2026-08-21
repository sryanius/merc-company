-- ════════════════════════════════════════════════════════════════════════════
-- 순위 축 추가 — S 용병 수 · 부대 전력
--
-- 적용: npx supabase db query --linked -f db/008_rank_axes.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- 플레이어 요청: "순위표 랭킹에 s 용병 갯수, 부대 전력 순위도 추가되었으면 좋겠어".
--
-- ★ 둘 다 **본인 신고값**이다. 서버가 계산하지 않는다 — 부대 전력은 장비·진형 보정까지
--   들어가는 값이라 서버가 다시 계산하려면 게임 전체가 Deno 로 딸려 온다.
--   상한은 `game/rules.js checkStatic` 이 건다 (S 용병 ≤ 단원 수, 전력 ≤ 500만).
--   화면에 «검증됨» 같은 말을 붙이면 안 된다.
--
-- ★ 정렬의 «동점 처리» 는 축마다 다르다:
--     나락·탑  — 기록을 **먼저 세운 날**이 이긴다 (일찍 도달한 쪽)
--     의뢰     — **현재 일차가 적은** 쪽이 이긴다 (같은 성과를 적은 날에)
--     S용병·전력 — 마찬가지로 현재 일차가 적은 쪽. 짧은 시간에 만든 쪽이 낫다.

alter table public.scores add column if not exists s_mercs   smallint not null default 0;
alter table public.scores add column if not exists top_power integer  not null default 0;

-- 값 범위는 rules.js 와 같은 기준으로 DB 에서도 한 번 더 막는다.
-- ★ 서버 함수가 통과시킨 값만 들어오지만, 제약을 걸어 두면 **함수를 잘못 고쳤을 때**
--   조용히 이상한 값이 쌓이는 대신 즉시 터진다.
alter table public.scores drop constraint if exists scores_s_mercs_range;
alter table public.scores add constraint scores_s_mercs_range
  check (s_mercs >= 0 and s_mercs <= 200);
alter table public.scores drop constraint if exists scores_top_power_range;
alter table public.scores add constraint scores_top_power_range
  check (top_power >= 0 and top_power <= 5000000);

-- ★ 리턴 타입을 바꾸므로 반드시 먼저 지운다 (42P13).
drop function if exists public.leaderboard(text, integer);

create function public.leaderboard(
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
  day          integer,
  squad        jsonb,
  s_mercs      smallint,
  top_power    integer
)
language sql stable security definer set search_path = '' as $$
  select
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
    ),
    s.company_name,
    case p_kind when 'abyss' then s.abyss_best
                when 'tower' then s.tower_best
                when 'smercs' then s.s_mercs
                when 'power' then s.top_power
                else s.quests_done end,
    case p_kind when 'abyss' then s.abyss_best_day
                when 'tower' then s.tower_best_day
                else s.day end,
    s.city_id, s.city_tier, s.top_level, s.roster_n, s.day,
    s.squad, s.s_mercs, s.top_power
  from public.scores s
  where s.status = 'ok'
    and case p_kind when 'abyss' then s.abyss_best
                    when 'tower' then s.tower_best
                    when 'smercs' then s.s_mercs
                    when 'power' then s.top_power
                    else s.quests_done end > 0
  order by 1
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.leaderboard(text, integer) from public;
grant execute on function public.leaderboard(text, integer) to anon, authenticated;

-- 「모든 부대 보기」도 같은 정렬을 써야 한다 — 목록과 다른 순서면 엉뚱한 사람이 열린다.
drop function if exists public.squads_at(text, integer);

create function public.squads_at(
  p_kind text,
  p_rank integer
)
returns table (company_name text, squads_full jsonb)
language sql stable security definer set search_path = '' as $$
  with ranked as (
    select
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
      ) as rk,
      s.company_name, s.squads_full
    from public.scores s
    where s.status = 'ok'
      and case p_kind when 'abyss' then s.abyss_best
                      when 'tower' then s.tower_best
                      when 'smercs' then s.s_mercs
                      when 'power' then s.top_power
                      else s.quests_done end > 0
  )
  select r.company_name, r.squads_full from ranked r where r.rk = p_rank;
$$;

revoke all on function public.squads_at(text, integer) from public;
grant execute on function public.squads_at(text, integer) to anon, authenticated;

-- 확인
select
  count(*)                          as 등재,
  count(*) filter (where s_mercs > 0)   as S용병있음,
  count(*) filter (where top_power > 0) as 전력있음
from public.scores;
