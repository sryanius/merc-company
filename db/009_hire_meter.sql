-- ════════════════════════════════════════════════════════════════════════════
-- 고용 계량기 — 「S 가 나올 수 있는 횟수였나」를 묻기 위한 원장 칸
--
-- 적용: npx supabase db query --linked -f db/009_hire_meter.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- 배경: 순위표에 «43일차 · 단원 6명 전원 S · 완료 의뢰 3건» 이 올라왔다.
--   일반 주점은 S 확률이 **0** 이고 명물 슬롯에서만 최대 5% 인데,
--   «명물 고용을 몇 번 했나» 가 기록에 없어서 그게 가능한 횟수인지 물을 수 없었다.
--
-- ★ 검사는 **증가분끼리** 비교한다 (rules.js checkGrowth):
--     지난 제출 이후 늘어난 S  ≤  그 사이 명물 고용 횟수 × 5% × 4(운 여유)
--   전체를 비교하면 계량기가 없던 시절의 세이브가 전부 걸린다 —
--   오래 한 정상 플레이어를 날리는 게 치트를 놓치는 것보다 나쁜 사고다.
--
-- ★ ledger 는 «지난번에 받아들인 값» 이라 여기에 있어야 다음 제출과 비교할 수 있다.
--   scores 에는 안 넣는다 — 순위표가 쓰지 않는 값이고, 공개할 이유도 없다.

alter table public.ledger add column if not exists s_mercs    integer not null default 0;
alter table public.ledger add column if not exists spec_hires integer not null default 0;
alter table public.ledger add column if not exists hires      integer not null default 0;

-- 확인
select
  count(*)                                as 원장,
  count(*) filter (where spec_hires > 0)  as 명물고용기록있음
from public.ledger;
