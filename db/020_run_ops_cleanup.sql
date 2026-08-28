-- ─────────────────────────────────────────────────────────────────────────────
-- 020 · `run_ops` 보관 기간과 청소 — **첫 사용자와 같은 커밋에 들어간다**
--
-- ★★ 왜 지금인가. `run_ops` 는 표만 있고 **쓰는 코드가 0줄**이었다 (확인함).
--   9단계가 첫 사용자다. 그리고 청소를 «있으면 좋은 것» 으로 미루면 안 된다 —
--   전 행동을 서버로 옮긴 뒤 인구 7명 기준 **하루 약 3,000 op** 이 쌓인다.
--   `result` 를 500B 로 잡아도 월 ~45MB, 상한(65,536B)에 가까운 정산 결과를 담으면
--   월 수백 MB 다. 무료 500MB 를 **몇 달 안에** 먹는다.
--   인덱스는 db/015:140 (`run_ops_age_idx`) 에 **이미 있다** — 지우는 코드만 없었다.
--
-- ★ 보관 기간을 왜 7일로 잡나. `run_ops` 는 «재시도가 같은 답을 받게» 하는 멱등성 키다.
--   그 목적에 필요한 창은 «한 번의 네트워크 실패 ~ 사람이 다시 눌러 볼 시간» 이다.
--   src/net/config.js 의 백오프 최대 간격이 6시간이므로 7일은 그 28배다.
--   ★ 감사 기록이 아니다 — 무엇이 일어났는지는 `run_*` 자체가 갖는다.
--
-- ★★ `security definer` 로 만들고 **아무에게도 execute 를 안 준다.**
--   운영자(service_role)만 부른다. 플레이어가 남의 op 을 지울 길을 만들면 안 된다.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.run_ops_sweep(p_days int default 7)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
  d int := greatest(1, least(coalesce(p_days, 7), 365));   -- 1~365일로 가둔다
begin
  delete from public.run_ops
   where created_at < now() - make_interval(days => d);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ★★ 아무에게도 주지 않는다. service_role 은 이 revoke 와 무관하게 부를 수 있다.
revoke execute on function public.run_ops_sweep(int) from anon, authenticated, public;

comment on function public.run_ops_sweep(int) is
  'run_ops 에서 p_days 보다 오래된 행을 지운다. 멱등성 키의 보관 기간 관리용이며 감사 기록이 아니다. service_role 전용.';
