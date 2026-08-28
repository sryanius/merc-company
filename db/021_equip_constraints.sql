-- ─────────────────────────────────────────────────────────────────────────────
-- 021 · 착용 칸의 제약 — `run_items_slot_uniq` 하나로는 턱없이 부족하다
--
-- ★★ 지금 있는 것은 부분 유니크 인덱스 하나뿐이다 (db/013:136-138):
--     unique (user_id, equipped_by, equipped_slot) where equipped_by is not null
--
--   그게 막는 것은 «한 용병의 **같은 칸**에 둘» 하나뿐이다. 안 막는 것:
--   ① **지어낸 칸 이름** — `equipped_slot = 'slot_a'..'slot_t'` 로 20칸을 채워도
--      유니크를 한 번도 안 어긴다. 실측(계획 조사): 그렇게 하면 atk 138 → 2038 (14.8배).
--      `mercStats` 는 슬롯 이름을 **안 본다**.
--   ② **`equipped_slot` 이 null 인 착용** — NULL 끼리는 서로 «다르다» 라서 부분 유니크가
--      안 걸린다. `equipped_by` 만 있고 슬롯이 없는 행이 **몇 줄이든** 들어간다.
--   ③ **없는 용병에게 착용** — FK 가 없다.
--
-- ★ 그래서 셋을 막는다. **판정 규칙(무기 타입·레벨·세트·양손)은 여기 안 적는다** —
--   그건 `gear.js:equipIssue` 가 유일한 출처이고, SQL 로 옮기면 또 사본이 된다.
--   여기서는 «SQL 만이 지킬 수 있는 것» 만 지킨다.
--
-- ★★ 기존 행을 깨면 안 된다. 이관된 실계정이 이미 있다 (착용 346점).
--   `not valid` 로 붙이고 **검증은 따로** 한다 — 그래야 옛 행이 있어도 안 터진다.
--   (실제로는 아래 검증까지 통과했다. 그래도 순서를 지킨다.)
-- ─────────────────────────────────────────────────────────────────────────────

-- ① 칸 이름은 게임의 10칸만 (`src/data/items.js` 의 SLOTS)
alter table public.run_items drop constraint if exists run_items_slot_name;
alter table public.run_items add constraint run_items_slot_name
  check (equipped_slot is null or equipped_slot in (
    'weapon','offhand','head','body','legs','hands','feet','neck','ring1','ring2'
  )) not valid;

-- ② 착용은 «둘 다 있거나 둘 다 없거나» — 반쪽 착용을 막는다
alter table public.run_items drop constraint if exists run_items_worn_pair;
alter table public.run_items add constraint run_items_worn_pair
  check ((equipped_by is null) = (equipped_slot is null)) not valid;

-- ③ 없는 용병에게 못 끼운다
alter table public.run_items drop constraint if exists run_items_owner_fk;
alter table public.run_items add constraint run_items_owner_fk
  foreign key (user_id, equipped_by) references public.run_mercs (user_id, uid)
  on delete set null not valid;

-- ★ 이제 기존 행을 검증한다. 여기서 터지면 옛 데이터가 규칙을 어기고 있다는 뜻이다 —
--   그때는 제약을 지우지 말고 **무엇이 어겼는지 먼저 세어라.**
alter table public.run_items validate constraint run_items_slot_name;
alter table public.run_items validate constraint run_items_worn_pair;
alter table public.run_items validate constraint run_items_owner_fk;
