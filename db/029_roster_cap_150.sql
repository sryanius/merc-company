-- 029 · 단원 정원 상한 70 → 150 (제작자 요청).
--
-- §186 뒤 상황: 기록 500 이면 소탕만으로 주 1,809,000G 가 들어오는데
-- 상시 지출은 인건비뿐이다 (실측: Lv80 S 4차 391G/일 · dailyUpkeep 기준
-- 40명 주 99,218G · 150명 주 174,482G). 정원을 늘려도 임금은 벽이 못 된다 —
-- 벽은 확장 비용(ROSTER_CAP_COST)이 진다.
--
-- ★ DB 쪽이 막고 있던 자리 — 여기를 안 풀면 **정직한 플레이어의 제출이 통째로 실패**한다.
--   `submit-score/index.ts:456` 은 roster_cap 을 클램프하지 않고 그대로 넣는다.
--   정원 75 인 계정이 순위를 올리면 scores_roster_cap_check 위반으로 upsert 가 죽는다.
--
-- 바꾸는 것:
--   · scores.roster_cap    20~70 → 20~150 (db/001:147)
--   · run_state.roster_cap 20~70 → 20~150 (db/013:50)
--   · run_import 의 roster_cap 접기 least(70) → least(150) (db/027:67)
--     ※ 본문은 db/027 의 것을 **그대로** 옮기고 그 한 줄만 바꿨다 (라이브 정의와 일치 확인함).
--
-- 안 건드리는 것 (확인함):
--   · scores_history 는 `like public.scores including defaults` 라 CHECK 를 안 물려받는다
--     (라이브 pg_constraint 조회 결과 roster 관련 제약은 scores·run_state 둘뿐이다).
--   · scores.roster_n 에는 애초에 CHECK 가 없다 (db/001:146).
--   · run_snapshot 은 roster_cap 을 읽기만 한다 (클램프 없음).
--   · rank_of / 순위 뷰는 roster_n 만 싣는다.
--
-- ★ 함수 본문 줄에는 주석을 달지 않는다 (026 첫 시도의 쉼표 사고).
-- ★ 돌린 뒤 node tools/sqlcheck.mjs · node tools/rlscheck.mjs.

alter table public.scores drop constraint if exists scores_roster_cap_check;
alter table public.scores add constraint scores_roster_cap_check check (roster_cap between 20 and 150);

alter table public.run_state drop constraint if exists run_state_roster_cap_check;
alter table public.run_state add constraint run_state_roster_cap_check check (roster_cap between 20 and 150);

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
    least(150, greatest(20, coalesce((st ->> 'roster_cap')::integer, 20))),
    greatest(0, coalesce((st ->> 'quests_done')::integer, 0)),
    greatest(0, coalesce((st ->> 'battles_won')::integer, 0)),
    greatest(0, coalesce((st ->> 'battles_lost')::integer, 0)),
    greatest(0, coalesce((st ->> 'hires')::integer, 0)),
    greatest(0, coalesce((st ->> 'spec_hires')::integer, 0)),
    least(500, greatest(0, coalesce((st ->> 'abyss_best')::integer, 0))),
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
         least(100, greatest(1, coalesce((m ->> 'level')::integer, 1))),
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
