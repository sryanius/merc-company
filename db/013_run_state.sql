-- ════════════════════════════════════════════════════════════════════════════
-- 013. 진행도를 서버가 갖는다 — **1단계: 명부·장비**
--
-- 적용: npx supabase db query --linked -f db/013_run_state.sql
-- 두 번 실행해도 안전하다 (전부 if not exists / or replace).
--
-- ★ 설계 전문은 docs/HANDOFF.md §104 다. 여기 요약만 적는다.
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 왜 여기까지 오나
--
--   제작자: 「용병 정보들도 클라에서 조작하면 뚫리는거 아닌가?」 — 맞다.
--
--   서버가 전투를 다시 돌려도 «이 부대가 네 것이 맞나» 는 못 묻는다.
--   조작된 최강 부대를 올리면 서버가 성실하게 돌려 최강 기록을 내준다.
--
--   ⇒ 핵심은 «시뮬레이션» 이 아니라 **«누가 주느냐»** 다.
--     전투는 클라에서 돌려 보여줘도 된다. **무엇을 얻었나**만 서버가 정하면 고리가 닫힌다.
--
--   1단계가 닫는 것: **S 용병 수 · 부대 전력** (지금은 둘 다 본인 신고값이다)
-- ════════════════════════════════════════════════════════════════════════════
-- ★★ 모양에 대한 결정 — «자주 묻는 것만 컬럼, 나머지는 jsonb»
--
--   용병·아이템 객체는 필드가 많고(아이템은 15개 남짓) **자주 바뀐다.**
--   전부 컬럼으로 펴면 게임을 손볼 때마다 마이그레이션이 따라오고,
--   한 번 빠뜨리면 조용히 값이 사라진다 (§58 에서 `p` 하나로 겪었다).
--
--   ⇒ **서버가 판단에 쓰는 것만** 컬럼으로 꺼낸다 (등급·레벨·슬롯·희귀도…).
--     나머지는 `data jsonb` 에 통째로 둔다. 서버가 **직접 만든 값**이라 검증할 이유가 없다.
-- ════════════════════════════════════════════════════════════════════════════
-- ★ 접두어는 `run_` 이다 — 이 DB 는 자료실(침묵의 기록자)과 공유한다 (§98).
-- ★ RLS 를 켜고 **정책을 하나도 안 만든다**. 통로는 security definer 함수뿐이다 (§010).
-- ★ 만들고 나면 반드시:  node tools/rlscheck.mjs
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 1. 판 하나 (스칼라 진행도)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.run_state (
  user_id      uuid        primary key references auth.users(id) on delete cascade,

  -- ★ seed 는 «이 판이 무엇인가» 다. 나락·탑 시드가 여기서 나온다 (abyss.js depthSeed).
  seed         bigint      not null,
  day          integer     not null default 1 check (day >= 1),

  gold         bigint      not null default 0 check (gold >= 0),
  renown       integer     not null default 0 check (renown >= 0),
  city_id      text,
  roster_cap   smallint    not null default 20 check (roster_cap between 20 and 70),

  -- 계량기 — 지금은 클라가 신고하던 것들이다. 2·3단계에서 서버가 올린다.
  quests_done  integer     not null default 0 check (quests_done >= 0),
  battles_won  integer     not null default 0 check (battles_won >= 0),
  battles_lost integer     not null default 0 check (battles_lost >= 0),
  hires        integer     not null default 0 check (hires >= 0),
  spec_hires   integer     not null default 0 check (spec_hires >= 0),

  abyss_best         integer not null default 0 check (abyss_best between 0 and 300),
  abyss_best_day     integer not null default 0,
  abyss_last_run_day integer not null default 0,
  tower_best         integer not null default 0 check (tower_best between 0 and 500),
  tower_best_day     integer not null default 0,
  tower_last_run_day integer not null default 0,

  -- ★★ 이관은 **계정당 한 번**이다. 이관 순간이 조작이 들어오는 마지막 자리라(§104.5)
  --   두 번 돌 수 있으면 그때마다 새 세이브를 밀어 넣을 수 있다.
  imported_at  timestamptz,
  updated_at   timestamptz not null default now()
);

alter table public.run_state enable row level security;
-- 정책 없음.


-- ════════════════════════════════════════════════════════════════════════════
-- 2. 명부
--
--   ★ `uid` 는 **클라가 쓰던 문자열을 그대로 유지**한다.
--     편성(`run_squads.member_uids`)이 uid 로 참조하므로, 새로 매기면
--     이관에서 편성이 통째로 깨진다.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.run_mercs (
  user_id    uuid     not null references auth.users(id) on delete cascade,
  uid        text     not null,

  -- 서버가 판단에 쓰는 것만 꺼낸다
  class_id   text     not null,
  grade      text     not null check (char_length(grade) = 1),  -- S 용병 수를 세는 열쇠
  level      smallint not null default 1 check (level between 1 and 80),
  hired_day  integer  not null default 1,

  data       jsonb    not null,     -- 나머지 전부 (name·exp·hp·status·look·kills…)

  primary key (user_id, uid)
);

alter table public.run_mercs enable row level security;
create index if not exists run_mercs_grade_idx on public.run_mercs (user_id, grade);


-- ════════════════════════════════════════════════════════════════════════════
-- 3. 장비
--
--   ★★ `data.stats` 는 **서버가 굴린 값**이다. 클라는 못 바꾼다 —
--     그게 이 표가 존재하는 이유 전부다.
--   ★ 착용은 여기서 «누구의 어느 칸» 으로 기록한다. 용병 쪽에 equipment 를 두면
--     아이템과 용병 양쪽을 고쳐야 해서 반드시 어긋난다.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.run_items (
  user_id       uuid     not null references auth.users(id) on delete cascade,
  uid           text     not null,

  base_id       text     not null,
  slot          text     not null,
  rarity        smallint not null default 0 check (rarity between 0 and 5),
  ilvl          smallint not null default 1 check (ilvl between 1 and 80),
  set_id        text,
  locked        boolean  not null default false,

  -- 착용 (null 이면 가방에 있다)
  equipped_by   text,      -- run_mercs.uid
  equipped_slot text,

  data          jsonb    not null,   -- 나머지 전부 (name·stats·affixes·value…)

  primary key (user_id, uid)
);

alter table public.run_items enable row level security;
create index if not exists run_items_worn_idx on public.run_items (user_id, equipped_by)
  where equipped_by is not null;
-- 한 용병의 한 칸에는 하나만 (착용이 겹치면 전력이 두 배로 잡힌다)
create unique index if not exists run_items_slot_uniq
  on public.run_items (user_id, equipped_by, equipped_slot)
  where equipped_by is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. 부대 · 펫
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.run_squads (
  user_id      uuid     not null references auth.users(id) on delete cascade,
  idx          smallint not null check (idx between 0 and 4),
  sid          text     not null,        -- 클라의 squad.id (편성 참조를 유지한다)
  name         text     not null default '부대',
  formation_id text     not null default 'basic',
  member_uids  jsonb    not null default '[]'::jsonb,
  pet_uids     jsonb    not null default '[]'::jsonb,
  primary key (user_id, idx)
);

alter table public.run_squads enable row level security;

create table if not exists public.run_pets (
  user_id uuid     not null references auth.users(id) on delete cascade,
  uid     text     not null,
  sid     text     not null,        -- 종 id
  grade   text     not null check (char_length(grade) = 1),
  data    jsonb    not null,
  primary key (user_id, uid)
);

alter table public.run_pets enable row level security;


-- ════════════════════════════════════════════════════════════════════════════
-- 확인 (적용 후)
--
--   ① node tools/rlscheck.mjs          ← RLS·정책·버킷 전수
--   ② 정책이 하나도 없어야 한다:
--        select tablename, policyname from pg_policies
--         where schemaname='public' and tablename like 'run\_%';   -- 0행
-- ════════════════════════════════════════════════════════════════════════════
