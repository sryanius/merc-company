-- ════════════════════════════════════════════════════════════════════════════
-- 015. 013 이 **잃는 칸**을 메운다 — 이관보다 반드시 먼저
--
-- 적용: npx supabase db query --linked -f db/015_run_state_gaps.sql
-- 두 번 실행해도 안전하다 (전부 if not exists / or replace).
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 왜 이관보다 먼저인가
--
--   이관(`run_import`)은 **계정당 한 번**이다 (db/013:66 의 `imported_at`).
--   칸이 없는 채로 이관하면 그 값은 **영영 빈다** — 다시 이관할 길이 없다.
--   그래서 「무엇을 잃는가」 를 먼저 재고, 칸을 먼저 판다.
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 실측 — 실제 세이브(120일차)를 `toRows` 에 통과시켜 셌다
--
--   세이브 최상위 키 27개 · 013 이 담당 13개 · **자리 없음 14개**
--
--   | 잃던 것 | 크기 | 무엇인가 |
--   |---|---|---|
--   | `quests`         | 4,520B | 도시별 의뢰 목록 |
--   | `shop`           | 3,048B | 상점 재고 |
--   | `reputation`     |   220B | 도시별 평판 ← **주점 고용 관문이 본다** |
--   | `tavern`         |   168B | 주점 후보 |
--   | `log`            |    95B | 일지 |
--   | `flagSquadId`    |     9B | ★ **대표 부대** — 순위표가 읽는다 |
--   | `formations`     |     9B | 보유 진형 |
--   | `companyName`    |     6B | ★ **용병단 이름** — 순위표가 읽는다 |
--   | `repTouch` `dungeons` `autoSellRarity` `version` `dataVersion` `petSeq` | 각 2B 내외 | |
--
--   그리고 `run_squads` 는 `status`/`returnDay` (파견 중인가)를 잃고 있었다.
--
--   ★ `quests`·`shop`·`tavern` 은 「시드로 다시 만들면 된다」 고 §104.4 에 적혀 있었지만
--     **그렇지 않다** — `refreshCity` 가 공유 전역 rng 를 그대로 넘기고(state.js:1700),
--     `genShop` 은 명부 평균 레벨에 의존한다(state.js:1678). 재현이 안 되므로 실어 둔다.
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 모양의 결정 — **`data jsonb` 를 판다** (013 의 철학 그대로)
--
--   013 은 「자주 묻는 것만 컬럼, 나머지는 jsonb」 로 정했고 `run_mercs`·`run_items`·
--   `run_pets` 에는 그 칸이 있다. **`run_state` 에만 없었다** — 그게 이 구멍의 뿌리다.
--
--   ⇒ 서버가 **판단에 쓰는 둘**(`company_name`·`flag_squad_id`)만 컬럼으로 꺼내고,
--     나머지는 통째로 `data` 에 둔다. 나중에 필요해지면 그때 승격하면 된다 —
--     **잃지만 않으면 언제든 꺼낼 수 있다.**
-- ════════════════════════════════════════════════════════════════════════════
-- ★ 적용 뒤 반드시:  node tools/rlscheck.mjs
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 1. run_state — 순위표가 읽는 둘 + 나머지 전부를 담을 칸
-- ════════════════════════════════════════════════════════════════════════════

alter table public.run_state
  -- ★ 순위표 카드에 그대로 뜬다 (rules.js extractScore → scores.company_name).
  --   클라가 코드포인트 24자로 자른다 (state.js:713). 여유를 둬서 64 로 잡는다 —
  --   좁게 잡으면 이관이 통째로 실패하는데, 그건 계정당 한 번뿐이라 특히 아프다.
  add column if not exists company_name  text,

  -- ★★ **대표 부대**. 없으면 이관 뒤 전원의 대표 부대가 «첫 부대» 로 되돌아간다
  --   (rules.js topSquadOf 가 이 값으로 고른다). 제작자가 §101 무렵에 일부러 넣은 기능이다.
  --   run_squads.sid 를 가리키지만 FK 는 안 건다 — 부대를 지웠을 때 이관이 터지면 안 된다.
  add column if not exists flag_squad_id text,

  -- ★★ 나머지 전부. 013 의 다른 표에는 있는데 여기만 없었다.
  --   reputation · repTouch · formations · dungeons · autoSellRarity · petSeq ·
  --   version · dataVersion · quests · shop · tavern · log
  add column if not exists data jsonb not null default '{}'::jsonb;

-- 이름 길이 — 클라 상한(24)의 배는 준다. char_length 는 코드포인트를 센다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'run_state_company_name_len') then
    alter table public.run_state
      add constraint run_state_company_name_len
      check (company_name is null or char_length(company_name) <= 64);
  end if;
end $$;

-- ★ 크기 상한 — db/010 의 관례를 따른다 (거기선 units 에 256KB).
--   실측: 위 12종을 다 담아 ~8KB. 아이템이 400개인 세이브도 items 는 별도 표라 여기 안 온다.
--   256KB 면 열 배 이상 여유다. 상한이 없으면 조작된 이관 하나가 표를 부풀릴 수 있다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'run_state_data_size') then
    alter table public.run_state
      add constraint run_state_data_size check (pg_column_size(data) <= 262144);
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. run_squads — 파견 상태
--
--   ★ 없으면 `run_snapshot` 이 「이 부대는 지금 원정 중」 을 클라에 못 알려 준다.
--     전력 계산에는 안 걸린다 (빼고 재 봤다 — 11판 전부 같은 값이었다, §110).
--   ★ 값은 `src/game/squad.js` 의 SQUAD_IDLE='idle' / SQUAD_AWAY='away' 둘뿐이다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.run_squads
  add column if not exists status     text    not null default 'idle',
  add column if not exists return_day integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'run_squads_status_ok') then
    alter table public.run_squads
      add constraint run_squads_status_ok check (status in ('idle', 'away'));
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. run_ops — **멱등성 키** (같은 요청이 두 번 들어와도 한 번만 먹는다)
--
--   ★★ 왜 필요한가: 앞으로 만들 고용·착용·판매·전직 RPC 는 **비멱등**이다.
--     네트워크가 끊겨 클라가 재시도하면 두 번 고용되거나 골드가 두 번 빠진다.
--     PvP 는 `challengeId` 로 그걸 막는데(src/net/pvp.js), `run_*` 에는 그런 칸이 없었다.
--
--   ★ 013 위에 지금 판다 — 이관보다 먼저다. RPC 를 쓸 때 만들려 하면
--     그때는 이미 이관이 끝나 있을 수 있다.
--
--   ★ `result` 에 답을 그대로 담아 둔다. 재시도가 오면 **다시 실행하지 않고** 그걸 돌려준다.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.run_ops (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  op_id      text        not null,
  kind       text        not null,
  result     jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, op_id),
  constraint run_ops_op_id_len check (char_length(op_id) between 1 and 64),
  constraint run_ops_kind_len  check (char_length(kind) between 1 and 32),
  constraint run_ops_result_size check (result is null or pg_column_size(result) <= 65536)
);

alter table public.run_ops enable row level security;
-- 정책 없음 — 통로는 security definer 함수뿐이다 (§010·§013 과 같다).

-- 오래된 것을 지울 때 쓴다 (아직 지우는 코드는 없다 — 있을 때 인덱스가 없으면 전수 훑는다)
create index if not exists run_ops_age_idx on public.run_ops (created_at);


-- ════════════════════════════════════════════════════════════════════════════
-- 확인 (적용 후)
--
--   ① node tools/rlscheck.mjs          ← RLS·정책 전수. run_ops 가 새로 잡힌다
--      ★ `tools/lib/rlsjudge.mjs` 의 GAME_TABLES 에 'run_ops' 를 더해야
--        «모르는 테이블» 로 안 뜬다.
--   ② 칸이 실제로 생겼나:
--        select column_name, data_type from information_schema.columns
--         where table_schema='public' and table_name='run_state' order by ordinal_position;
--   ③ 정책이 하나도 없어야 한다:
--        select tablename, policyname from pg_policies
--         where schemaname='public' and tablename like 'run\_%';   -- 0행
-- ════════════════════════════════════════════════════════════════════════════
