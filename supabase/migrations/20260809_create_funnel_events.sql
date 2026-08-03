-- 전환 퍼널(랜딩 방문 → 파일 업로드 → 결과 확인 → 회원가입 → 결제) 이벤트를 익명으로
-- 기록합니다. anon_id는 브라우저 쿠키에 저장되는 무작위 UUID(lib/funnel-tracking.ts가
-- 발급)일 뿐이라 계정·이메일·IP 등 실제 신원과 연결되지 않습니다 — 로그인 이후 이벤트
-- (signup/payment)도 user_id 없이 같은 anon_id만 기록해, 퍼널 전체가 끝까지 완전히
-- 익명으로 남습니다.
--
-- anonymous_trial_usage(supabase/migrations/20260802_create_anonymous_trial_usage.sql)와
-- 같은 이유로 RLS는 켜두되 정책을 하나도 만들지 않습니다 — 이 테이블은 특정 로그인
-- 사용자 소유가 아닌 내부 집계용 로그라 auth.uid() 기반 정책을 적용할 대상 자체가 없고,
-- app/api/track-funnel-event가 SUPABASE_SERVICE_ROLE_KEY로만 쓰고 app/admin/funnel이
-- 같은 키로만 읽습니다.
create table if not exists public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  anon_id text not null,
  event_type text not null check (event_type in ('landing_visit', 'file_upload', 'result_view', 'signup', 'payment')),
  created_at timestamptz not null default now()
);

alter table public.funnel_events enable row level security;

create index if not exists funnel_events_event_type_created_idx
  on public.funnel_events (event_type, created_at desc);
create index if not exists funnel_events_anon_id_idx
  on public.funnel_events (anon_id);
