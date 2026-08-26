-- ════════════════════════════════════════════════════════════════════════════
-- 011. 순위표에서 편성 보기
-- ════════════════════════════════════════════════════════════════════════════
--
-- 제작자: 「pvp 순위에서 부대 보는거 안되나?」
--
-- ★★ 이건 **설계를 뒤집는 변경**이다. §93 에서 순위표가 편성을 안 주게 만든 이유는
--   «도전하기 전에 남의 편성을 보면 맞춰 짜기가 된다» 였다. 제작자가 그 설명을 읽고
--   그래도 열자고 했다 — 「순위표의 누구나」. 그 결정을 따른다.
--
--   대신 무엇이 달라지는지는 적어 둔다: 이제 «상대를 보고 → 거기 맞춰 다시 등록 → 도전»
--   이 가능하다. 다시 등록하면 **내 방어도 같이 바뀌므로** 공짜는 아니지만,
--   도전자는 이미 승점 프리미엄을 받고 있어서 공격 쪽이 더 유리해진다.
--   나중에 이게 문제가 되면 되돌릴 곳은 여기 한 곳이다 (grant 를 빼면 된다).
--
-- ★ 노출 범위는 **순위표와 정확히 같다.**
--     · 순위표에 뜨는 편성만 준다 (`r.status = 'ok'` — flagged 는 순위에서 숨기므로 편성도 숨긴다)
--     · `user_id` 는 안 준다 (§010 과 같은 규칙 — 지목은 handle 로만)
--     · **`raw` 는 안 준다.** 위조 검사용 장비 원본이라 화면에 쓸 일이 없고,
--       내보내면 «남의 장비 굴림값» 까지 통째로 열린다. 노출면은 좁을수록 좋다.
--
-- ★ 목록에 싣지 않고 **한 명씩 따로 부른다.** units 는 부대 5개 × 7명이면 수십 KB 라
--   순위표에 통째로 얹으면 목록이 무거워진다 (§007 의 400KB 교훈).
--
-- 적용: npx supabase db query --linked -f db/011_pvp_lineup.sql
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.pvp_lineup(p_handle uuid)
returns table (
  company_name text,
  units        jsonb,
  power        integer,
  engine_hash  text,
  updated_at   timestamptz
)
language sql stable security definer set search_path = '' as $$
  select
    d.company_name,
    d.units,
    d.power,
    d.engine_hash,
    d.updated_at
  from public.pvp_defense d
  join public.pvp_ratings r on r.user_id = d.user_id
  where d.handle = p_handle
    and r.status = 'ok';
$$;

revoke all on function public.pvp_lineup(uuid) from public;
-- ★ 순위표(pvp_board)와 **같은 대상**에게 연다. 한쪽만 로그인을 요구하면
--   로그아웃 상태에서 «버튼은 보이는데 눌리면 실패» 라는 상태가 생긴다.
grant execute on function public.pvp_lineup(uuid) to anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 확인용 (적용 후 눈으로 보라)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★★ §77 의 교훈: **권한은 «SQL 에 뭐라고 적었나» 가 아니라 «실제 ACL 이 어떤가» 로 확인한다.**
--   Supabase 는 public 스키마 함수에 anon·authenticated 의 EXECUTE 를 따로 주기 때문에
--   `revoke ... from public` 만으로는 잠기지도 않고, 반대로 grant 를 빠뜨려도 눈치채기 어렵다.
--
-- ① 권한이 pvp_board 와 **같은가** — 두 줄의 acl 이 같아야 한다
--   select p.proname, p.prosecdef, array_to_string(p.proacl,' | ') as acl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname in ('pvp_board','pvp_lineup');
--
-- ② 실제로 편성이 나오는가 — 순위표의 손잡이로 물어본다
--   select b.rank, jsonb_array_length(l.units) as squads, pg_column_size(l.units) as bytes
--     from public.pvp_board(10) b
--     cross join lateral public.pvp_lineup(b.handle) l
--     order by b.rank;
--
-- ③ 로그아웃 상태에서 200 이 오는가 — `node tools/supacheck.mjs` 의 「6. PvP RPC」
--    (여기서 raw·user_id 가 새 나가지 않는지도 같이 본다)
