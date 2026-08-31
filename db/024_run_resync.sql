-- ─────────────────────────────────────────────────────────────────────────────
-- 024 · 진행도를 **다시 올린다** (재동기화)
--
-- ★★★ 왜. `run_import` 은 계정당 한 번이다 (`imported_at` 자물쇠, db/016:109).
--   그런데 서버 사본을 **따라오게 할 길이 없다** — 의뢰·하루 넘기기·고용이 골드·경험·
--   아이템·부상을 바꾸는데 그건 op 이 아니다. 실측으로 사흘 만에 `dayLag 56` 이 됐고,
--   서버가 센 전력 차 −137 은 치트가 아니라 **시차**였다.
--   낡은 사본으로는 §104 18단계(순위 축 전환)를 켤 수 없다.
--
-- ★★ 제작자가 정했다 (2026-09-01): 「자동으로 열어라」.
--
-- ★★ **위험을 알고 연다.** 이건 「클라가 언제든 서버 사본을 덮는다」 는 뜻이다.
--   지금은 안전하다 — `run_*` 로 **판정하는 코드가 한 줄도 없다** (전부 그림자다).
--   ⇒ 권위를 넘기는 단계(각 op 을 서버가 결정)로 갈 때 **이 함수를 반드시 잠가라.**
--     그때는 클라가 덮는 것이 곧 «되돌리기» 가 된다.
--
-- ★ `run_import` 을 **고치지 않는다.** 첫 이관의 「한 번」 계약은 그대로 두고,
--   재동기화는 **다른 이름의 다른 함수**로 연다. 그래야 나중에 이것만 잠글 수 있다.
--
-- ★ 자기 것만 건드린다 (`auth.uid()`). 인자는 행 묶음 하나뿐이라 남의 것을 못 만진다.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.run_resync(p_rows jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $fn$
declare
  me uuid := (select auth.uid());
  r  jsonb;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;

  -- ★ 첫 이관을 **여기서 대신하지 않는다.** 아직 이관 전이면 `run_import` 이 할 일이다
  --   (그쪽이 열 확인·클램프를 갖고 있다). 여기는 «이미 있는 것을 새로 고친다» 뿐이다.
  if not exists (select 1 from public.run_state where user_id = me) then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;

  -- ★ 자물쇠를 풀고 `run_import` 을 그대로 부른다 — **사상을 두 벌로 만들지 않는다.**
  --   db/016 이 열 클램프(level ≤ 80 · rarity ≤ 5 · ilvl ≤ 80)와 자식 표 정리를
  --   전부 갖고 있다. 여기서 다시 쓰면 반드시 갈라진다 (§94·§98·§107).
  update public.run_state set imported_at = null where user_id = me;

  select public.run_import(p_rows) into r;

  -- ★ run_import 의 답을 **그대로** 돌려준다. 여기서 다시 지어내면 두 벌이 된다.
  return r;
end;
$fn$;

revoke all    on function public.run_resync(jsonb) from anon, authenticated, public;
grant execute on function public.run_resync(jsonb) to authenticated;

comment on function public.run_resync(jsonb) is
  '진행도를 서버에 다시 올린다(재동기화). 자기 것만. ★ 권위를 서버로 넘길 때 반드시 잠가라.';
