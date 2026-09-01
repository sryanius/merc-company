-- ─────────────────────────────────────────────────────────────────────────────
-- 025 · 재동기화에 **자물쇠를 건다** — §152 ⑤ (제작자 결정: B «문을 닫는다»)
--
-- ★★★ 왜. db/024 는 「클라가 서버 사본을 언제든 덮는다」 였다. 그래서 ①~④단계가
--   잡는 것은 «결과만 위조» 까지이고, **«스탯을 부풀린 뒤 정직하게 이기는 것»** 은
--   원리적으로 못 잡았다 (§152.1). 검증이 연극이 되는 지점이 거기다.
--
-- ★★ 그런데 **그냥 잠그면 정직한 플레이어의 사본이 굳는다.** 그래서 먼저 쟀다
--   (`tools/driftcheck.mjs`, 30일 플레이):
--     골드 차이 0 · 레벨 차이 0 · **아이템 차이 36점(61%)**
--   ⇒ 전리품만 정산이 올리게 고친 뒤(§158) 다시 재니 **세 축 모두 0** 이 됐다.
--   그 수치가 이 자물쇠의 근거다. 감으로 잠그지 않는다.
--
-- ★★★ **그래도 두 경우는 연다.** 안 열면 게임이 망가진다:
--
--   ① **판이 바뀌었을 때** (시드가 다르다) — 새 게임·다른 세이브 복원.
--      ★ 이건 공격 통로가 아니다: 새로 시작하면 일차·의뢰수·명성이 전부 0 으로 돌아가고,
--        그 셋이 순위 축이다. «부풀린 새 판» 은 `checkStatic`·`checkGrowth`·`seen_power`
--        가 이미 보는 자리다. 얻는 것보다 잃는 것이 크다.
--
--   ② **이 고침 이전에 만들어진 사본** — 아직 전리품이 안 올라가던 때의 것이라
--      이미 벌어져 있다. 한 번은 따라잡을 기회를 줘야 한다.
--      ★ 이 창은 **스스로 닫힌다** — 날짜가 박혀 있어서 잊어도 안전하다.
--
-- ★ 막는 것은 딱 하나다: **같은 판인데 통째로 덮기.** 그게 공격이다.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.run_resync(p_rows jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $fn$
declare
  me       uuid := (select auth.uid());
  cur      public.run_state%rowtype;
  new_seed bigint;
  r        jsonb;
  -- ★ 이 고침이 나가기 전에 만들어진 사본에만 주는 유예. 지나면 스스로 닫힌다.
  grace    timestamptz := timestamptz '2026-09-03 00:00:00+00';
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;

  select * into cur from public.run_state where user_id = me;
  if not found then
    -- 첫 이관은 `run_import` 의 몫이다 (열 확인·클램프를 그쪽이 갖고 있다)
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;

  new_seed := coalesce((p_rows -> 'state' ->> 'seed')::bigint, -1);

  -- ★★ 같은 판을 통째로 덮으려는 것이면 **거절한다.** 이게 이 자물쇠의 전부다.
  --   ★ 사유를 그대로 돌려준다 — 이건 판정이 아니라 **행동**이고, 클라가 «막혔다» 를
  --     알아야 조용히 어긋나지 않는다 (§55 는 판정 사유를 숨기라는 것이지 이건 아니다).
  if new_seed = cur.seed and cur.updated_at >= grace then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  -- 여기까지 왔으면 정당하다: 새 판이거나, 아직 유예 안이다.
  update public.run_state set imported_at = null where user_id = me;
  select public.run_import(p_rows) into r;
  return r;
end;
$fn$;

revoke all    on function public.run_resync(jsonb) from anon, authenticated, public;
grant execute on function public.run_resync(jsonb) to authenticated;

comment on function public.run_resync(jsonb) is
  '진행도를 다시 올린다. ★ 같은 판을 통째로 덮는 것은 막는다 (§152 ⑤). 새 판·유예 안만 허용.';
