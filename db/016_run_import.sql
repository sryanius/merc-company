-- ════════════════════════════════════════════════════════════════════════════
-- 016. `run_import` — 세이브를 서버로 **한 번** 옮긴다 (§104 1단계)
--
-- 적용: npx supabase db query --linked -f db/016_run_import.sql
-- 두 번 실행해도 안전하다 (create or replace).
-- ★★ 적용 뒤 반드시:  node tools/sqlcheck.mjs   (§109 — 「만들어졌다」 는 증거가 아니다)
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 역할 분담 — **모양은 JS, 쓰기는 SQL**
--
--   행 모양을 만드는 것은 `src/game/runrows.js` 의 `toRows()` 다.
--   그걸 SQL 로 다시 짜면 **사상이 두 벌**이 되고 반드시 갈라진다 (§94·§107·§112).
--   그래서 Edge Function 이 `toRows()` 로 모양을 만들어 **이미 다 된 행들**을 넘긴다.
--
--   여기서 하는 일은 셋뿐이다:
--     ① **자물쇠** — 계정당 한 번 (첫 문장에서)
--     ② **클램프** — 013/015 의 CHECK 범위로 자른다
--     ③ **쓰기**  — 한 트랜잭션으로
--
-- ★★ ①이 **첫 문장**인 이유: 자물쇠가 나중에 있으면 그 사이에 두 요청이 들어와
--   둘 다 쓴다. 그리고 실패했을 때 **아무 표도 안 건드린 상태**여야 한다.
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 왜 클램프인가 (거절이 아니라)
--
--   이관은 **계정당 한 번**이다. 중간에 CHECK 하나로 터지면 그 계정은
--   영영 못 넘어온다. 그건 「운 좋은 사람을 날리는 것보다 나쁜 사고」 다.
--
--   실측: 실제 세이브 10개를 013+015 의 CHECK 에 통과시켜 봤더니
--   **걸리는 것이 하나도 없었다** (걸린 하나는 `{"test":true}` 짜리 시험 행이었다).
--   그러니 클램프는 지금 아무 일도 안 한다 — **조작된 세이브를 위한 안전망**이다.
--   level 999 → 80 처럼 «합법 범위로 끌어내리는» 것뿐이라 이득을 주지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.run_import(p_rows jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $fn$
declare
  me    uuid := (select auth.uid());
  cnt   integer;
  st    jsonb;
  n_m   integer := 0;
  n_i   integer := 0;
  n_q   integer := 0;
  n_p   integer := 0;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'shape');
  end if;

  st := p_rows -> 'state';
  if st is null or jsonb_typeof(st) <> 'object' or (st ->> 'day') is null then
    return jsonb_build_object('ok', false, 'reason', 'shape');
  end if;

  /* 크기 상한 — db/010 의 관례. 실측 최대 세이브가 1MB 남짓이다. */
  if pg_column_size(p_rows) > 4194304 then          -- 4MB
    return jsonb_build_object('ok', false, 'reason', 'too_big');
  end if;

  /* ══════════════════════════════════════════════════════════════════════
   * ① 자물쇠 — **첫 문장이다.**
   *
   *   행이 없으면 만들고, 있으면 `imported_at is null` 일 때만 갱신한다.
   *   이미 이관됐으면 갱신이 0행이고, 그때 **아무 표도 안 건드린 채** 끝낸다.
   * ══════════════════════════════════════════════════════════════════════ */
  insert into public.run_state (
    user_id, seed, day, gold, renown, city_id, roster_cap,
    quests_done, battles_won, battles_lost, hires, spec_hires,
    abyss_best, abyss_best_day, abyss_last_run_day,
    tower_best, tower_best_day, tower_last_run_day,
    company_name, flag_squad_id, data, imported_at, updated_at
  ) values (
    me,
    coalesce((st ->> 'seed')::bigint, 0),
    greatest(1, coalesce((st ->> 'day')::integer, 1)),
    greatest(0, coalesce((st ->> 'gold')::bigint, 0)),
    greatest(0, coalesce((st ->> 'renown')::integer, 0)),
    nullif(st ->> 'city_id', ''),
    least(70, greatest(20, coalesce((st ->> 'roster_cap')::integer, 20))),
    greatest(0, coalesce((st ->> 'quests_done')::integer, 0)),
    greatest(0, coalesce((st ->> 'battles_won')::integer, 0)),
    greatest(0, coalesce((st ->> 'battles_lost')::integer, 0)),
    greatest(0, coalesce((st ->> 'hires')::integer, 0)),
    greatest(0, coalesce((st ->> 'spec_hires')::integer, 0)),
    least(300, greatest(0, coalesce((st ->> 'abyss_best')::integer, 0))),
    greatest(0, coalesce((st ->> 'abyss_best_day')::integer, 0)),
    greatest(0, coalesce((st ->> 'abyss_last_run_day')::integer, 0)),
    least(500, greatest(0, coalesce((st ->> 'tower_best')::integer, 0))),
    greatest(0, coalesce((st ->> 'tower_best_day')::integer, 0)),
    greatest(0, coalesce((st ->> 'tower_last_run_day')::integer, 0)),
    left(nullif(st ->> 'company_name', ''), 64),
    nullif(st ->> 'flag_squad_id', ''),
    coalesce(st -> 'data', '{}'::jsonb),
    now(), now()
  )
  on conflict (user_id) do update set
    seed = excluded.seed, day = excluded.day, gold = excluded.gold, renown = excluded.renown,
    city_id = excluded.city_id, roster_cap = excluded.roster_cap,
    quests_done = excluded.quests_done, battles_won = excluded.battles_won,
    battles_lost = excluded.battles_lost, hires = excluded.hires, spec_hires = excluded.spec_hires,
    abyss_best = excluded.abyss_best, abyss_best_day = excluded.abyss_best_day,
    abyss_last_run_day = excluded.abyss_last_run_day,
    tower_best = excluded.tower_best, tower_best_day = excluded.tower_best_day,
    tower_last_run_day = excluded.tower_last_run_day,
    company_name = excluded.company_name, flag_squad_id = excluded.flag_squad_id,
    data = excluded.data, imported_at = now(), updated_at = now()
  where run_state.imported_at is null;                 -- ★ 여기가 자물쇠다

  get diagnostics cnt = row_count;
  if cnt = 0 then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;

  /* ② 아이 표들 — 이관은 한 번뿐이라 원래 비어 있다. 그래도 **먼저 비운다**
   *   (자물쇠를 손으로 풀고 다시 돌리는 경우를 위해서다). */
  delete from public.run_items  where user_id = me;
  delete from public.run_mercs  where user_id = me;
  delete from public.run_squads where user_id = me;
  delete from public.run_pets   where user_id = me;

  /* ③ 명부 */
  insert into public.run_mercs (user_id, uid, class_id, grade, level, hired_day, data)
  select me,
         m ->> 'uid',
         coalesce(nullif(m ->> 'class_id', ''), 'swordsman'),
         left(coalesce(nullif(m ->> 'grade', ''), 'C'), 1),
         least(80, greatest(1, coalesce((m ->> 'level')::integer, 1))),
         greatest(0, coalesce((m ->> 'hired_day')::integer, 1)),
         coalesce(m -> 'data', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_rows -> 'mercs', '[]'::jsonb)) m
   where (m ->> 'uid') is not null
  on conflict (user_id, uid) do nothing;
  get diagnostics n_m = row_count;

  /* ④ 장비.
   * ★ `equipped_slot` 은 **부분 유니크 인덱스**가 지킨다 (같은 용병의 같은 칸에 둘이 못 온다).
   *   부딪히면 `do nothing` 으로 넘긴다 — 이관이 통째로 터지는 것보다 낫다. */
  insert into public.run_items (
    user_id, uid, base_id, slot, rarity, ilvl, set_id, locked, equipped_by, equipped_slot, data)
  select me,
         i ->> 'uid',
         coalesce(nullif(i ->> 'base_id', ''), 'unknown'),
         coalesce(nullif(i ->> 'slot', ''), 'weapon'),
         least(5, greatest(0, coalesce((i ->> 'rarity')::integer, 0))),
         least(80, greatest(1, coalesce((i ->> 'ilvl')::integer, 1))),
         nullif(i ->> 'set_id', ''),
         coalesce((i ->> 'locked')::boolean, false),
         nullif(i ->> 'equipped_by', ''),
         nullif(i ->> 'equipped_slot', ''),
         coalesce(i -> 'data', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_rows -> 'items', '[]'::jsonb)) i
   where (i ->> 'uid') is not null
  on conflict do nothing;
  get diagnostics n_i = row_count;

  /* ⑤ 부대 — `idx` 는 0~4 만 받는다 (013 의 CHECK). 넘치면 버린다. */
  insert into public.run_squads (
    user_id, idx, sid, name, formation_id, member_uids, pet_uids, status, return_day)
  select me,
         (q ->> 'idx')::smallint,
         coalesce(nullif(q ->> 'sid', ''), 'squad_' || (q ->> 'idx')),
         left(coalesce(nullif(q ->> 'name', ''), '부대'), 64),
         coalesce(nullif(q ->> 'formation_id', ''), 'basic'),
         coalesce(q -> 'member_uids', '[]'::jsonb),
         coalesce(q -> 'pet_uids', '[]'::jsonb),
         case when (q ->> 'status') = 'away' then 'away' else 'idle' end,
         greatest(0, coalesce((q ->> 'return_day')::integer, 0))
    from jsonb_array_elements(coalesce(p_rows -> 'squads', '[]'::jsonb)) q
   where (q ->> 'idx') is not null and (q ->> 'idx')::integer between 0 and 4
  on conflict (user_id, idx) do nothing;
  get diagnostics n_q = row_count;

  /* ⑥ 펫 */
  insert into public.run_pets (user_id, uid, sid, grade, data)
  select me,
         p ->> 'uid',
         coalesce(nullif(p ->> 'sid', ''), 'unknown'),
         left(coalesce(nullif(p ->> 'grade', ''), 'C'), 1),
         coalesce(p -> 'data', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_rows -> 'pets', '[]'::jsonb)) p
   where (p ->> 'uid') is not null
  on conflict (user_id, uid) do nothing;
  get diagnostics n_p = row_count;

  return jsonb_build_object('ok', true, 'mercs', n_m, 'items', n_i, 'squads', n_q, 'pets', n_p);
end $fn$;


/**
 * 서버가 가진 진행도를 통째로 돌려준다.
 *
 * ★ 반환을 **jsonb 한 칸**으로 둔다. `returns table (…)` 로 두면 앞으로 컬럼이 늘 때마다
 *   반환형이 바뀌고, PostgreSQL 은 그때 42P13 (cannot change return type) 으로 거절한다.
 *   그러면 `drop function` 부터 해야 하는데, 배포 중에 함수가 잠깐 사라진다.
 */
create or replace function public.run_snapshot()
returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare
  me uuid := (select auth.uid());
  s  public.run_state%rowtype;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;

  select * into s from public.run_state where user_id = me;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;

  return jsonb_build_object(
    'ok', true,
    'importedAt', s.imported_at,
    'state', jsonb_build_object(
      'seed', s.seed, 'day', s.day, 'gold', s.gold, 'renown', s.renown,
      'city_id', s.city_id, 'roster_cap', s.roster_cap,
      'quests_done', s.quests_done, 'battles_won', s.battles_won,
      'battles_lost', s.battles_lost, 'hires', s.hires, 'spec_hires', s.spec_hires,
      'abyss_best', s.abyss_best, 'abyss_best_day', s.abyss_best_day,
      'abyss_last_run_day', s.abyss_last_run_day,
      'tower_best', s.tower_best, 'tower_best_day', s.tower_best_day,
      'tower_last_run_day', s.tower_last_run_day,
      'company_name', s.company_name, 'flag_squad_id', s.flag_squad_id,
      'data', s.data),
    'mercs',  coalesce((select jsonb_agg(to_jsonb(m) - 'user_id') from public.run_mercs  m where m.user_id = me), '[]'::jsonb),
    'items',  coalesce((select jsonb_agg(to_jsonb(i) - 'user_id') from public.run_items  i where i.user_id = me), '[]'::jsonb),
    'squads', coalesce((select jsonb_agg(to_jsonb(q) - 'user_id' order by q.idx) from public.run_squads q where q.user_id = me), '[]'::jsonb),
    'pets',   coalesce((select jsonb_agg(to_jsonb(p) - 'user_id') from public.run_pets   p where p.user_id = me), '[]'::jsonb)
  );
end $fn$;


-- ════════════════════════════════════════════════════════════════════════════
-- 권한
--   ★★ `revoke from public` 만으로는 안 잠긴다 (§77). 두 역할을 이름으로 지목한다.
-- ════════════════════════════════════════════════════════════════════════════

revoke all on function public.run_import(jsonb) from anon, authenticated, public;
revoke all on function public.run_snapshot()    from anon, authenticated, public;

grant execute on function public.run_import(jsonb) to authenticated;
grant execute on function public.run_snapshot()    to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 확인 (적용 후)
--
--   ① node tools/sqlcheck.mjs   ← **부르면 죽는 문장이 없는지.** 이게 제일 중요하다 (§109)
--   ② node tools/rlscheck.mjs
--   ③ 권한 (§77: 적어 놓은 게 아니라 ACL 을 읽는다)
--        select p.proname, array_to_string(p.proacl, ' | ') from pg_proc p
--          join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname='public' and p.proname in ('run_import','run_snapshot');
-- ════════════════════════════════════════════════════════════════════════════
