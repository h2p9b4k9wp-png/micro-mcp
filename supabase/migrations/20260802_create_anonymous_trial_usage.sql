-- 로그인 없이 파일 1개를 분석해볼 수 있는 체험(app/login/page.tsx, /api/public-analyze)의
-- 남용 방지용 — IP당 하루 1회로 제한하기 위해 요청 IP와 시각을 기록합니다.
--
-- 이 테이블은 특정 로그인 사용자의 소유가 아니라 "요청을 보낸 IP"를 키로 삼는 서버 내부
-- 집계용이라, 다른 테이블처럼 auth.uid() 기반 RLS 정책이 적용될 수 없습니다(요청자가 아예
-- 로그인하지 않은 상태이므로 auth.uid()가 null). RLS는 켜두되 정책을 하나도 만들지
-- 않습니다 — /api/public-analyze가 SUPABASE_SERVICE_ROLE_KEY로 RLS를 우회해서만
-- 읽고 쓰고, 그 외에는(익명 키·로그인 사용자 키 전부) 아무도 이 테이블에 접근할 수
-- 없습니다.
create table if not exists public.anonymous_trial_usage (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  created_at timestamptz not null default now()
);

alter table public.anonymous_trial_usage enable row level security;

create index if not exists anonymous_trial_usage_ip_created_idx
  on public.anonymous_trial_usage (ip_address, created_at desc);
