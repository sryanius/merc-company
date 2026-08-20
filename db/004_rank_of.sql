-- ════════════════════════════════════════════════════════════════════════════
-- 내 기록이 지금 몇 위인가
--
-- 적용: SQL Editor 에 붙여넣고 Run (또는 npx supabase db query --linked -f db/004_rank_of.sql)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ 왜 순위표를 받아 세지 않고 따로 두나
--   `leaderboard()` 는 상위 200명까지만 준다. 그걸로 세면 **201위부터는 순위를 모른다** —
--   그런데 순위를 가장 궁금해하는 건 아직 위에 못 올라간 사람이다.
--   여기서는 "나보다 잘한 사람 수 + 1" 만 세므로 몇 위든 정확하다.
--
-- ★ 값만 받고 누구인지는 안 받는다. 로그인 없이도 "이 기록이면 몇 위" 를 볼 수 있어서
--   기록을 세운 직후에 바로 보여 줄 수 있다 — 경쟁을 유도하기 가장 좋은 순간이다.
--   남의 정보를 내보내지 않으므로 익명에게 열어도 안전하다.

create or replace function public.rank_of(p_kind text, p_value integer)
returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer + 1
    from public.scores s
   where s.status = 'ok'
     and case p_kind
           when 'abyss' then s.abyss_best
           when 'tower' then s.tower_best
           else s.quests_done
         end > greatest(coalesce(p_value, 0), 0);
$$;

revoke all on function public.rank_of(text, integer) from public;
grant execute on function public.rank_of(text, integer) to anon, authenticated;

-- 등재 인원 (순위 옆에 "N명 중" 을 붙이려고)
create or replace function public.rank_total(p_kind text)
returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
    from public.scores s
   where s.status = 'ok'
     and case p_kind
           when 'abyss' then s.abyss_best
           when 'tower' then s.tower_best
           else s.quests_done
         end > 0;
$$;

revoke all on function public.rank_total(text) from public;
grant execute on function public.rank_total(text) to anon, authenticated;
