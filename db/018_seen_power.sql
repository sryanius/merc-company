-- ─────────────────────────────────────────────────────────────────────────────
-- 018 · 알리바이를 순위 축에서 분리한다 — scores.seen_power
--
-- ★★ 왜 필요한가
--
--   §111 이 「기록은 있는데 부대 전력이 없다」 를 잡을 때, 「이 계정이 **전에 보인**
--   최대 전력」 을 바닥값으로 쓴다 (rules.js 의 `power = max(topPower, seenPower)`).
--   그 바닥값을 지금은 `scores.top_power` 에서 읽는다.
--
--   그런데 `top_power` 는 **순위 축**이라 매 제출마다 **조건 없이 덮인다**
--   (`submit-score/index.ts` — `abyss_best`·`tower_best` 는 `keepMax` 를 쓰는데
--    전력만 안 쓴다). 즉 한 칸이 두 가지 일을 하고 있고, 둘의 요구가 반대다:
--     · 순위 축  → «지금» 값이어야 한다 (장비를 팔면 내려가는 게 맞다)
--     · 알리바이 → «여태 최대» 여야 한다 (내려가면 방어가 풀린다)
--
--   ⇒ 서버가 이 칸을 한 번이라도 낮게(또는 0으로) 쓰면 그 계정의 알리바이가
--     **영구히** 무너지고 「전력 0 이면 교차 검증이 꺼진다」 가 다시 열린다.
--     되살릴 원본이 DB 에 안 남는다 (`scores_history` 는 수동 시즌 리셋만 채운다).
--
-- ★ 그래서 칸을 **하나 더 판다.** `top_power` 는 순위 축 그대로 두고,
--   `seen_power` 가 단조 최대치를 기억한다.
--
-- ★★ 이 값은 판정을 **느슨하게만** 만든다 (바닥값이므로) — 새 거절이 구조상 0 이다.
--   그래서 기존 계정에 대해 «지금 top_power» 로 채워 넣어도 안전하다. 그게 지금
--   알리바이로 쓰이고 있는 바로 그 값이다.
--
-- ★ 두 번 돌려도 안전하다 (§109: `db query` 가 오류 뒤 재시도하는 것을 실제로 겪었다).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.scores
  add column if not exists seen_power bigint not null default 0;

-- 기존 행을 «지금 알리바이로 쓰이는 값» 으로 채운다.
-- ★ `greatest` 라 두 번 돌려도 안 내려간다.
update public.scores
   set seen_power = greatest(coalesce(seen_power, 0), coalesce(top_power, 0))
 where coalesce(seen_power, 0) < coalesce(top_power, 0);

comment on column public.scores.seen_power is
  '이 계정이 여태 보인 최대 부대 전력. 단조 증가만 한다. §111 의 알리바이 바닥값 전용이고 순위 축이 아니다 — 순위는 top_power 를 쓴다.';
