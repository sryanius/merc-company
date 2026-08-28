-- ─────────────────────────────────────────────────────────────────────────────
-- 022 · 그림자 관측 표 — **로그 대신 표에 적는다**
--
-- ★★ 왜. 6·12·15·16·17단계의 그림자가 전부 `console.error` 로만 남는다.
--   그런데 이 저장소의 CLI 에는 `supabase functions logs` 가 **없다** —
--   대시보드를 사람이 열어 눈으로 옮겨 적어야 한다. 그러면 «며칠 돌려야 하나» 라는
--   질문에 아무도 수치로 답할 수 없다.
--
-- ★ 그래서 관측을 표에 적는다. 판정이 아니라 **관측**이다:
--   · 아무 판정에도 안 쓴다 (`rules.js` 는 이 표를 모른다)
--   · `run_*` 도 `scores` 도 안 건드린다
--   · 여기 적기가 실패해도 그림자는 그냥 넘어간다
--
-- ★★ 개인정보를 안 담는다. `user_id` 는 담되(누구 것인지 알아야 한다) **payload 에
--   이름·용병단명 같은 문자열을 넣지 마라** — 숫자와 참거짓만 적는다.
--   운영자만 읽는다 (RLS: 아무 정책도 안 만든다 ⇒ service_role 만).
--
-- ★ 무한히 자라면 안 된다. `run_ops_sweep` 과 같은 모양의 청소를 같이 만든다.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.shadow_obs (
  id         bigserial   primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  kind       text        not null,
  obs        jsonb       not null,
  created_at timestamptz not null default now(),
  constraint shadow_obs_kind_len  check (char_length(kind) between 1 and 32),
  constraint shadow_obs_size      check (pg_column_size(obs) <= 16384)
);

-- ★ RLS 를 켜고 **정책을 하나도 안 만든다** — anon·authenticated 는 못 읽고 못 쓴다.
--   Edge Function 은 service_role 로 쓰므로 RLS 를 우회한다.
alter table public.shadow_obs enable row level security;

create index if not exists shadow_obs_age_idx  on public.shadow_obs (created_at);
create index if not exists shadow_obs_kind_idx on public.shadow_obs (kind, created_at);

comment on table public.shadow_obs is
  '그림자 모드의 관측 기록. 판정에 안 쓰인다. 운영자(service_role)만 읽는다. 개인정보를 안 담는다.';

-- 청소 — db/020 의 run_ops_sweep 과 같은 모양
create or replace function public.shadow_obs_sweep(p_days int default 30)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
  d int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  delete from public.shadow_obs where created_at < now() - make_interval(days => d);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.shadow_obs_sweep(int) from anon, authenticated, public;
