-- 유료 전환 준비 — 결제 시스템은 아직 연결하지 않습니다. profiles.is_pro 플래그와
-- "Pro로 업그레이드하기" 요청을 받아두는 pro_requests 테이블만 미리 만들어둡니다. 지금은
-- is_pro를 수동으로(Supabase 대시보드에서 직접) true로 바꾸는 것으로 "결제 승인"을 대신합니다.

-- profiles.is_pro: 기본 false.
alter table public.profiles
  add column if not exists is_pro boolean not null default false;

-- profiles에 SELECT 정책이 아직 없을 수 있어(20260701_create_logs_profiles_prompts_and_rls.sql이
-- 아직 실행되지 않은 경우) 여기서도 동일한 정책을 멱등하게 만들어둡니다 — 두 마이그레이션이
-- 어떤 순서로 실행되든(또는 둘 중 하나만 실행되어도) 본인 프로필만 조회 가능한 상태가
-- 보장됩니다(정책 이름이 같아서 나중에 실행되는 쪽이 덮어쓸 뿐, 중복 생성되지 않음).
alter table public.profiles enable row level security;

drop policy if exists "사용자는 자신의 프로필만 조회" on public.profiles;
create policy "사용자는 자신의 프로필만 조회"
  on public.profiles for select
  using (auth.uid() = id);

-- pro_requests: "Pro로 업그레이드하기" 버튼에서 이메일(+선택 메모)을 입력하면 여기 쌓입니다.
-- 결제 연동 전까지는 이 테이블을 보고 수동으로 안내 메일을 보내거나 is_pro를 켜주는 용도.
create table if not exists public.pro_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  memo text,
  created_at timestamptz not null default now()
);

alter table public.pro_requests enable row level security;

drop policy if exists "사용자는 자신의 업그레이드 요청만 조회" on public.pro_requests;
create policy "사용자는 자신의 업그레이드 요청만 조회"
  on public.pro_requests for select
  using (auth.uid() = user_id);

drop policy if exists "사용자는 자신의 업그레이드 요청만 추가" on public.pro_requests;
create policy "사용자는 자신의 업그레이드 요청만 추가"
  on public.pro_requests for insert
  with check (auth.uid() = user_id);

create index if not exists pro_requests_user_id_idx
  on public.pro_requests (user_id, created_at desc);
