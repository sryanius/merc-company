-- ════════════════════════════════════════════════════════════════════════════
-- 순위표에서 «그 사람의 모든 부대» 를 눌러서 본다
--
-- 적용: npx supabase db query --linked -f db/007_squads_full.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★★ **목록(leaderboard)에는 절대 싣지 않는다.**
--   순위표는 200행을 한 번에 준다. 전 부대 상세가 1인당 ~2KB 라 400KB 가 된다
--   (요약 `squad` 는 150B → 30KB). 그래서 **누른 한 사람 것만** 따로 받는다.
--
-- ★ 담기는 것은 게임 정보뿐 — 부대 이름·진형·클래스·레벨·등급·착용 칸 수·세트 id.
--   장비를 낱개로 담으면 1인당 5.8KB(200행 1.1MB)가 되고, 빌드에서 의미 있는 건
--   «무슨 세트를 맞췄나» 다.
--
-- ★ `user_id` 는 여전히 안 내보낸다. **순위(rank)로 찾는다** — 순위표와 같은 정렬을
--   그대로 쓰므로 «3위의 부대를 보여 줘» 가 되고, 남의 계정은 알 수 없다.

alter table public.scores add column if not exists squads_full jsonb;

alter table public.scores drop constraint if exists scores_squads_full_size;
alter table public.scores add constraint scores_squads_full_size
  check (squads_full is null or pg_column_size(squads_full) < 8192);

-- 순위 N 번인 사람의 전 부대. 없으면 빈 결과.
create or replace function public.squads_at(
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
                      else s.quests_done end > 0
  )
  select r.company_name, r.squads_full from ranked r where r.rk = p_rank;
$$;

revoke all on function public.squads_at(text, integer) from public;
grant execute on function public.squads_at(text, integer) to anon, authenticated;

select count(*) as 등재, count(squads_full) as 상세있음 from public.scores;
