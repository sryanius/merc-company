-- ════════════════════════════════════════════════════════════════════════════
-- 순위표 동점 판정 수정 — 기록일을 모르는 세이브가 1등을 먹는 문제
--
-- 적용: SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전하다.
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ 무엇이 문제였나
--   동점이면 "더 적은 일수로 도달한 쪽"이 위로 가게 `at_day asc` 로 정렬한다.
--   그런데 `bestDay` 필드는 나중에 추가한 것이라, 그 전에 세운 기록은 **0** 이다.
--   0 은 어떤 실제 일수보다 작으므로, **기록일을 모르는 세이브가 항상 1등이 된다.**
--   실제로 그 상태가 관측됐다 (탑 379층 · at_day=0).
--
--   0 은 "0일차에 달성" 이 아니라 "모른다" 는 뜻이다. 모르는 값이 이기면 안 된다 —
--   `nullif(…, 0)` 로 진짜 NULL 로 바꾸고 `nulls last` 로 뒤로 보낸다.
--   그러면 제대로 기록한 사람이 이기고, 모르는 쪽은 제출 시각으로 갈린다.
--
-- ★ 옛 기록을 손대지 않는다. 소급해서 채울 방법이 없기 때문이다(그 날짜는 사라졌다).
--   앞으로 세우는 기록은 정상적으로 채워지므로 시간이 지나면 저절로 해소된다.

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
        -- ★ 0 = "기록일을 모른다". NULL 로 바꿔 뒤로 보낸다 (모르는 값이 이기면 안 된다)
        nullif(case p_kind when 'abyss' then s.abyss_best_day
                           when 'tower' then s.tower_best_day
                           else s.day end, 0) asc nulls last,
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
  order by 3 desc, nullif(4, 0) asc nulls last, s.submitted_at asc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

grant execute on function public.leaderboard(text, integer) to anon, authenticated;

-- 정렬과 같은 모양의 부분 인덱스도 맞춰 준다
drop index if exists public.scores_abyss_idx;
drop index if exists public.scores_tower_idx;
create index scores_abyss_idx on public.scores
  (abyss_best desc, nullif(abyss_best_day, 0) asc nulls last, submitted_at asc) where status = 'ok';
create index scores_tower_idx on public.scores
  (tower_best desc, nullif(tower_best_day, 0) asc nulls last, submitted_at asc) where status = 'ok';
