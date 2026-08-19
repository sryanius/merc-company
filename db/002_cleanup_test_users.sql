-- 테스트로 만들어진 익명 계정 정리
--
-- S5(접속 계층) 검증 과정에서 익명 계정 몇 개가 실제로 만들어졌다.
-- 랭킹에 등재된 것도 없고 용량도 무시할 수준이지만, 무료 티어의 MAU 를
-- 테스트 계정이 차지할 이유는 없다.
--
-- ★ 먼저 확인만 해 보고 (SELECT), 결과가 예상과 맞으면 DELETE 를 돌려라.
-- ★ 본인 계정을 지우지 않도록 주의 — 게임에서 클라우드를 켠 적이 있으면
--   그 계정도 익명이다. saves 에 실제 진행이 담긴 행은 남겨라.

-- 1) 지금 있는 익명 계정과 각자의 세이브를 본다
select u.id,
       u.created_at,
       u.last_sign_in_at,
       s.day        as 세이브_일차,
       s.rev        as 저장횟수,
       octet_length(s.payload) as 크기
  from auth.users u
  left join public.saves s on s.user_id = u.id
 where u.is_anonymous
 order by u.created_at;

-- 2) 세이브가 아예 없거나 사실상 비어 있는 계정 = 테스트 잔여물
--    (진짜 플레이어라면 세이브가 있고 rev 가 여러 번 올라가 있다)
-- delete from auth.users u
--  where u.is_anonymous
--    and u.created_at < now() - interval '1 hour'
--    and not exists (
--      select 1 from public.saves s
--       where s.user_id = u.id and s.rev > 3
--    );

-- saves / scores / ledger 는 user_id 에 on delete cascade 가 걸려 있어
-- auth.users 를 지우면 같이 정리된다.
