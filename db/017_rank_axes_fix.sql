-- ════════════════════════════════════════════════════════════════════════════
-- 017. `rank_of` 가 **조용히 틀린 답**을 하던 것 · 전력 상한이 어긋나 있던 것
--
-- 적용: npx supabase db query --linked -f db/017_rank_axes_fix.sql
-- 두 번 실행해도 안전하다.
-- ★★ 적용 뒤 반드시:  node tools/sqlcheck.mjs
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ ① `rank_of` / `rank_total` 이 순위 축 다섯 중 **셋만** 안다
--
--   db/008 이 축 둘(`smercs`·`power`)을 더할 때 `leaderboard`·`squads_at` 만 다시 만들고
--   여기는 안 건드렸다. 그래서 모르는 축이 오면 `else s.quests_done` 으로 떨어진다 —
--   **오류가 아니라 «그럴듯한 오답»** 이라 아무도 안 알아챈다.
--
--   실제 데이터로 잰 값:
--
--     rank_of('smercs', 38)   → 7위   (정답 2위)   ← 38 을 의뢰 수와 견줬다
--     rank_of('power', 100000) → 1위   (정답 3위)   ← 의뢰가 10만을 넘는 사람이 없으니 항상 1위
--     rank_total('smercs')     → 6명   (정답 4명)
--
--   ★ 지금 호출부(`src/ui/ranknote.js`)가 abyss·tower·quests 만 써서 안 터졌을 뿐이다.
--     「이 전력이면 몇 위」 를 붙이는 순간 **항상 1위**라고 답한다.
--
-- ★★ 모르는 축이 오면 **0 을 준다** — 조용히 다른 축으로 떨어지지 않는다.
--   («그럴듯한 오답» 보다 «답을 안 함» 이 낫다. 그래야 붙일 때 바로 보인다.)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.rank_of(p_kind text, p_value integer)
returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer + 1
    from public.scores s
   where s.status = 'ok'
     and case p_kind
           when 'abyss'  then s.abyss_best
           when 'tower'  then s.tower_best
           when 'quests' then s.quests_done
           when 'smercs' then s.s_mercs::integer
           when 'power'  then s.top_power
           else null                                   -- ★ 모르는 축이면 아무도 안 세어진다
         end > greatest(coalesce(p_value, 0), 0);
$$;

create or replace function public.rank_total(p_kind text)
returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
    from public.scores s
   where s.status = 'ok'
     and case p_kind
           when 'abyss'  then s.abyss_best
           when 'tower'  then s.tower_best
           when 'quests' then s.quests_done
           when 'smercs' then s.s_mercs::integer
           when 'power'  then s.top_power
           else null
         end > 0;
$$;

revoke all on function public.rank_of(text, integer) from anon, authenticated, public;
revoke all on function public.rank_total(text)       from anon, authenticated, public;
grant execute on function public.rank_of(text, integer) to anon, authenticated;
grant execute on function public.rank_total(text)       to anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- ★★ ② `scores.top_power` 의 상한이 `rules.js` 의 `POWER_CAP` 과 **26배 어긋나 있다**
--
--   db/008 은 `<= 5000000`, `rules.js` 는 `POWER_CAP = 1_000_000`.
--   §96 이 「제약을 좁히면 옛 행이 걸릴 수 있어 그대로 뒀다」 고 적어 뒀는데,
--   그때의 옛 행은 이미 다 지나갔다 — **지금 최댓값은 174,034 다** (실측).
--
--   ★ 손으로 옮겨 적은 두 번째 사본이라 어차피 갈라진다. 좁혀서 맞춘다.
--     서버가 이미 `POWER_CAP` 으로 클램프해서 넣으므로 이 제약에 걸릴 일은 없고,
--     혹시 걸리면 그건 **클램프가 안 돌았다는 신호**다.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare mx bigint;
begin
  select coalesce(max(top_power), 0) into mx from public.scores;
  if mx > 1000000 then
    raise notice '지금 최대 전력이 % 라 상한을 못 좁힌다 — 그 행부터 보라', mx;
  else
    alter table public.scores drop constraint if exists scores_top_power_range;
    alter table public.scores add constraint scores_top_power_range
      check (top_power >= 0 and top_power <= 1000000);
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 확인 (적용 후)
--   ① node tools/sqlcheck.mjs
--   ② select public.rank_of('power', 100000);   -- 의뢰 수가 아니라 전력과 견줘야 한다
--   ③ select public.rank_of('없는축', 0);        -- 1 (아무도 안 세어짐) 이어야 한다
-- ════════════════════════════════════════════════════════════════════════════
