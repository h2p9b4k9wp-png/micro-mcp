-- 💡 [신규] 내부 안전장치용 토큰 상한. 사용자에게 보이는 한도는 지금처럼 "횟수"(월 채팅
-- 수·파일 수, lib/plan-limits.ts) 그대로 두고, 그 뒤에 아무도 보지 못하는 토큰 기준
-- 상한을 하나 더 둡니다. 정상 사용은 횟수 상한에 먼저 걸리므로 이 상한에는 닿지 않고,
-- 프롬프트가 비정상적으로 길거나 자동화로 긁는 경우만 여기서 걸립니다.
--
-- 이 마이그레이션이 하는 일은 네 가지입니다:
--   (1) ai_usage_logs.route에 'chat' 허용        — 지금까지 채팅 토큰이 기록되지 않았습니다
--   (2) (user_id, created_at) 인덱스 추가        — 사용자별 월 합계를 매 요청마다 재기 때문
--   (3) 합계 계산용 SQL 함수 2개                 — 행을 앱으로 끌어오지 않고 DB에서 합산
--   (4) token_limit_alerts 테이블                — 알림 메일 중복 발송 방지

-- ── (1) route 체크 제약에 'chat' 추가 ────────────────────────────────
-- 기존 제약은 ('analyze', 'analyze-professor') 둘만 허용해서, 채팅 사용량을 기록하려 하면
-- insert가 제약 위반으로 실패합니다. 채팅은 이 앱에서 토큰을 가장 많이 쓰는 경로라
-- 여기가 빠지면 아래 상한들이 사실상 장님이 됩니다.
--
-- 제약 이름은 Postgres가 자동 생성한 것(ai_usage_logs_route_check)이라 환경에 따라 다를
-- 수 있어, 이름을 하드코딩하지 않고 실제로 걸려 있는 체크 제약을 찾아서 교체합니다.
do $$
declare
  v_constraint_name text;
begin
  select c.conname into v_constraint_name
  from pg_constraint c
  where c.conrelid = 'public.ai_usage_logs'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%route%';

  if v_constraint_name is not null then
    execute format('alter table public.ai_usage_logs drop constraint %I', v_constraint_name);
    raise notice '기존 route 체크 제약 %를 제거했습니다.', v_constraint_name;
  end if;

  alter table public.ai_usage_logs
    add constraint ai_usage_logs_route_check
    check (route in ('analyze', 'analyze-professor', 'chat'));
end $$;

-- ── (2) 사용자별 월 합계 조회용 인덱스 ───────────────────────────────
-- 기존 인덱스는 (created_at)과 (route, created_at)뿐이라 user_id로 거르는 조회가 전부
-- 스캔이 됩니다. 이 조회는 AI 요청마다 한 번씩 도므로 인덱스가 필요합니다.
create index if not exists ai_usage_logs_user_created_idx
  on public.ai_usage_logs (user_id, created_at desc);

-- ── (3) 합계 계산 함수 ───────────────────────────────────────────────
-- 앱에서 select 후 JS로 합산하면 사용량이 많은 계정일수록 행을 통째로 끌어오게 됩니다
-- (lib/society-codes.ts의 getSocietyCodeMonthlyTokenTotal이 그 방식인데, 그쪽은 코드 사용
-- 시점에만 도는 드문 호출이라 그대로 뒀습니다). 이쪽은 매 AI 요청마다 돌기 때문에
-- 숫자 하나만 돌려받도록 DB에서 합산합니다.
--
-- ai_usage_logs에는 SELECT 정책이 없어(20260811 마이그레이션 주석 참고) 일반 롤로는 읽을
-- 수 없습니다. security definer로 두고 service_role에게만 실행 권한을 줍니다.
create or replace function public.user_monthly_token_total(p_user_id uuid, p_since timestamptz)
returns bigint
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(sum(total_tokens), 0)::bigint
  from public.ai_usage_logs
  where user_id = p_user_id
    and created_at >= p_since;
$$;

revoke all on function public.user_monthly_token_total(uuid, timestamptz) from public;
grant execute on function public.user_monthly_token_total(uuid, timestamptz) to service_role;

-- 무료 사용자 전체 합계. profiles.is_pro가 false이거나 행이 없는 계정을 무료로 봅니다
-- (결제/코드로 Pro가 된 계정은 제외 — 그쪽은 SOCIETY_CODE_MONTHLY_TOKEN_LIMIT이 따로
-- 담당합니다). user_id가 null인 행(계정 삭제로 끊긴 기록)은 어느 등급이었는지 알 수 없어
-- 합계에서 빠집니다.
create or replace function public.free_tier_monthly_token_total(p_since timestamptz)
returns bigint
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(sum(l.total_tokens), 0)::bigint
  from public.ai_usage_logs l
  join public.profiles p on p.id = l.user_id
  where l.created_at >= p_since
    and coalesce(p.is_pro, false) = false;
$$;

revoke all on function public.free_tier_monthly_token_total(timestamptz) from public;
grant execute on function public.free_tier_monthly_token_total(timestamptz) to service_role;

-- ── (4) 알림 중복 방지 ───────────────────────────────────────────────
-- 상한에 닿은 사용자는 그 뒤로도 계속 요청을 보낼 수 있는데, 그때마다 메일이 나가면
-- 받는 쪽이 수백 통을 받게 됩니다. "이번 달에 이 사용자 건으로 이미 알렸는가"를 여기
-- 기록해두고, 처음 한 번만 보냅니다.
--
-- anonymous_trial_usage·society_codes와 같은 패턴으로 RLS는 켜되 정책은 만들지 않습니다 —
-- 클라이언트가 읽거나 쓸 이유가 전혀 없고, 정책이 없으면 서비스 롤 외에는 누구도 접근할
-- 수 없습니다.
create table if not exists public.token_limit_alerts (
  id uuid primary key default gen_random_uuid(),
  -- 'user' = 개인 월 상한 도달 / 'free_tier' = 무료 사용자 전체 킬스위치 발동
  scope text not null check (scope in ('user', 'free_tier')),
  -- scope='free_tier'일 때는 특정 사용자에 대한 알림이 아니므로 null입니다.
  user_id uuid references auth.users(id) on delete cascade,
  -- 해당 월의 1일(UTC). 매달 새로 알림이 나갈 수 있게 하는 키입니다.
  period_start date not null,
  created_at timestamptz not null default now()
);

alter table public.token_limit_alerts enable row level security;

-- Postgres에서 NULL은 서로 다른 값으로 취급돼 (scope, user_id, period_start) 단일 unique로는
-- free_tier 행의 중복을 막지 못합니다. scope별로 부분 unique 인덱스를 나눠 겁니다.
create unique index if not exists token_limit_alerts_user_uniq
  on public.token_limit_alerts (user_id, period_start)
  where scope = 'user';

create unique index if not exists token_limit_alerts_free_tier_uniq
  on public.token_limit_alerts (period_start)
  where scope = 'free_tier';
