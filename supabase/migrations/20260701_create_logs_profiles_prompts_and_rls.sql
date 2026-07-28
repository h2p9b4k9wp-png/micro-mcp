-- logs/profiles/prompts는 이 저장소의 supabase/migrations/ 폴더가 생기기 전부터 이미 존재하던
-- 테이블이라(가장 오래된 다른 마이그레이션인 20260724_create_document_uploads.sql보다도 앞선
-- 시점), 여기엔 원래 DDL이 하나도 추적되어 있지 않았습니다. 이 마이그레이션은 실제 운영 DB의
-- 컬럼 구성(Supabase REST API의 OpenAPI 스펙을 service role 키로 직접 조회해 확인함)을 그대로
-- 반영한 CREATE TABLE IF NOT EXISTS와, 본인 행만 접근 가능한 RLS 정책을 함께 기록합니다.
--
-- 멱등성: 테이블이 이미 있으면 CREATE TABLE IF NOT EXISTS는 그냥 아무 일도 하지 않고
-- 넘어갑니다(기존 컬럼을 바꾸거나 덧붙이지 않음) — 이 마이그레이션은 스키마를 변경하는 게
-- 아니라 이미 있는 스키마를 문서화하는 목적입니다. ENABLE ROW LEVEL SECURITY는 이미 켜져
-- 있어도 안전하게 재실행됩니다. 정책은 PostgreSQL이 "CREATE POLICY IF NOT EXISTS"를 지원하지
-- 않으므로 DROP POLICY IF EXISTS 후 CREATE POLICY로 재실행 가능하게 했습니다.

-- ── logs ─────────────────────────────────────────────────────────────
-- app/page.tsx가 대화 기록을 저장/조회하는 테이블. folder_id는 나중에
-- 20260730_create_conversation_folders.sql에서 추가된 컬럼이라 여기서는 만들지 않습니다
-- (그 마이그레이션이 add column if not exists로 처리).
create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  content text not null,
  response text,
  status text default 'SUCCESS',
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.logs enable row level security;

drop policy if exists "사용자는 자신의 대화만 조회" on public.logs;
create policy "사용자는 자신의 대화만 조회"
  on public.logs for select
  using (auth.uid() = user_id);

drop policy if exists "사용자는 자신의 대화만 추가" on public.logs;
create policy "사용자는 자신의 대화만 추가"
  on public.logs for insert
  with check (auth.uid() = user_id);

drop policy if exists "사용자는 자신의 대화만 삭제" on public.logs;
create policy "사용자는 자신의 대화만 삭제"
  on public.logs for delete
  using (auth.uid() = user_id);

-- UPDATE 정책은 20260730_create_conversation_folders.sql에서 이미 추가했으므로 여기서는
-- 중복 생성하지 않습니다.

-- ── profiles ─────────────────────────────────────────────────────────
-- id는 auth.users.id를 그대로 사용합니다(가입 시 채워짐, 트리거 등 이 테이블을 실제로
-- 채우는 로직은 이 저장소 밖에 있어 여기서는 스키마만 기록).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.profiles enable row level security;

drop policy if exists "사용자는 자신의 프로필만 조회" on public.profiles;
create policy "사용자는 자신의 프로필만 조회"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "사용자는 자신의 프로필만 추가" on public.profiles;
create policy "사용자는 자신의 프로필만 추가"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "사용자는 자신의 프로필만 수정" on public.profiles;
create policy "사용자는 자신의 프로필만 수정"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── prompts ──────────────────────────────────────────────────────────
-- 예전에 app/api/v1/[username]/[slug] 라우트가 서비스 롤 키로 접근하던 테이블입니다.
-- 그 라우트는 클라이언트 어디에서도 쓰이지 않고 있어 삭제했으므로(이 저장소 커밋 참고),
-- 지금은 이 앱의 어떤 코드도 prompts를 직접 쓰지 않습니다 — 그래도 테이블 자체는 DB에 남아
-- 있으니 방어적으로 RLS는 켜 둡니다.
create table if not exists public.prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null,
  content text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (user_id, slug)
);

alter table public.prompts enable row level security;

drop policy if exists "사용자는 자신의 프롬프트만 조회" on public.prompts;
create policy "사용자는 자신의 프롬프트만 조회"
  on public.prompts for select
  using (auth.uid() = user_id);

drop policy if exists "사용자는 자신의 프롬프트만 추가" on public.prompts;
create policy "사용자는 자신의 프롬프트만 추가"
  on public.prompts for insert
  with check (auth.uid() = user_id);

drop policy if exists "사용자는 자신의 프롬프트만 수정" on public.prompts;
create policy "사용자는 자신의 프롬프트만 수정"
  on public.prompts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "사용자는 자신의 프롬프트만 삭제" on public.prompts;
create policy "사용자는 자신의 프롬프트만 삭제"
  on public.prompts for delete
  using (auth.uid() = user_id);
