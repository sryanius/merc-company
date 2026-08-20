-- ════════════════════════════════════════════════════════════════════════════
-- 순위표에서 남의 «대표 부대» 를 볼 수 있게 한다
--
-- 적용: npx supabase db query --linked -f db/006_squad_snapshot.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ 담기는 것은 **게임 정보뿐**이다 — 부대 이름, 클래스 id, 레벨, 등급.
--   세이브 원문이나 개인 정보는 안 들어간다 (`rules.js topSquadOf` 가 그것만 뽑는다).
--
-- ★ 이건 **클라이언트가 스스로 신고하는 값**이다. 점수와 마찬가지로 개연성 검사를
--   거칠 뿐 «검증된 편성» 이 아니다. 화면에 그렇게 표기해서도 안 된다.
--
-- ★ 크기: 7명 기준 약 150바이트. 순위표는 200행을 한 번에 주므로 ~30KB 다.
--   부대 5개를 다 담으면 여기서 5배가 된다 — 그래서 **대표 부대 하나만** 담는다.

alter table public.scores add column if not exists squad jsonb;

-- 터무니없는 크기를 막는다 (7명 × 여유). 값의 내용은 엣지 함수가 거른다.
alter table public.scores drop constraint if exists scores_squad_size;
alter table public.scores add constraint scores_squad_size
  check (squad is null or pg_column_size(squad) < 2048);

-- 순위표 함수에 squad 를 얹는다. 나머지 컬럼·정렬은 그대로다.
--
-- ★ `create or replace` 로는 **리턴 타입을 못 바꾼다**
--   (ERROR 42P13: cannot change return type of existing function).
--   컬럼을 하나 더하는 것도 리턴 타입 변경이라 반드시 먼저 지워야 한다.
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
  squad        jsonb
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
    s.city_id, s.city_tier, s.top_level, s.roster_n, s.day,
    s.squad
  from public.scores s
  where s.status = 'ok'
    and case p_kind when 'abyss' then s.abyss_best
                    when 'tower' then s.tower_best
                    else s.quests_done end > 0
  order by 1
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.leaderboard(text, integer) from public;
grant execute on function public.leaderboard(text, integer) to anon, authenticated;

select count(*) as 등재, count(squad) as 부대있음 from public.scores;
