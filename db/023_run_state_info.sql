-- ─────────────────────────────────────────────────────────────────────────────
-- 023 · 「내 진행도가 서버에 있나」 를 **싸게** 묻는다
--
-- ★★ 왜 필요한가. 접속할 때마다 「이관했나」 를 물어야 하는데, 지금 그걸 아는 길은
--   `run_snapshot()` 하나뿐이고 그건 **명부·장비·부대·펫을 통째로** 돌려준다.
--   실계정은 아이템이 1372개다 — 예/아니오 하나 물자고 매 부팅마다 그걸 내려받는 것은
--   낭비다 (그리고 느린 기기에서 첫 화면을 늦춘다).
--
-- ★ `run_state` 에는 정책이 하나도 없다 (RLS 켜짐 · 정책 0개). 그래서 클라가 표를
--   직접 못 읽는다 — 그건 그대로 두고, **security definer 함수**로 필요한 것만 준다.
--
-- ★★ 돌려주는 것은 **내 것뿐이다.** `auth.uid()` 로만 찾는다 — 인자가 없으니
--   남의 것을 물을 방법이 아예 없다.
--
-- ★ 개인정보를 안 담는다. 용병단 이름조차 안 준다 — 「있나 · 몇 일차인가 · 언제
--   옮겼나」 면 충분하다. 클라는 이 셋으로 「이관하겠습니까」 를 띄울지 정한다.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.run_state_info()
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
    -- ★ `run_snapshot()` 과 **같은 말**을 쓴다 ('none') — 클라가 두 함수를 같은 식으로 읽는다
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;

  return jsonb_build_object(
    'ok', true,
    'day', s.day,
    'importedAt', s.imported_at,
    'updatedAt', s.updated_at
  );
end;
$fn$;

revoke all    on function public.run_state_info() from anon, authenticated, public;
grant execute on function public.run_state_info() to authenticated;

comment on function public.run_state_info() is
  '내 진행도가 서버 표에 있는지 싸게 묻는다. 자기 것만 본다. 개인정보를 안 담는다.';
