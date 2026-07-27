-- 교수님 단위로 자료를 모아 분석하는 기능을 위한 테이블.
-- professors: 사용자가 등록한 교수님 목록.
-- documents: 그 교수님에게 속한 자료 — 추출된 텍스트(content)까지 저장해서, "이 교수님 분석" 시
-- 자료를 다시 올리지 않고도 지금까지 쌓인 자료 전체를 재사용할 수 있게 합니다.
-- 둘 다 본인 소유 행만 보이도록 RLS로 제한합니다 (다른 사용자와 공유하지 않음).

create table if not exists public.professors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  school text,
  department text,
  created_at timestamptz not null default now()
);

alter table public.professors enable row level security;

create policy "사용자는 자신이 등록한 교수님만 조회"
  on public.professors for select
  using (auth.uid() = user_id);

create policy "사용자는 자신의 교수님만 추가"
  on public.professors for insert
  with check (auth.uid() = user_id);

create policy "사용자는 자신의 교수님만 수정"
  on public.professors for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "사용자는 자신의 교수님만 삭제"
  on public.professors for delete
  using (auth.uid() = user_id);

create index if not exists professors_user_id_created_at_idx
  on public.professors (user_id, created_at desc);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  professor_id uuid references public.professors(id) on delete cascade,
  file_name text not null,
  format text not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.documents enable row level security;

create policy "사용자는 자신의 자료만 조회"
  on public.documents for select
  using (auth.uid() = user_id);

create policy "사용자는 자신의 자료만 추가"
  on public.documents for insert
  with check (auth.uid() = user_id);

create policy "사용자는 자신의 자료만 삭제"
  on public.documents for delete
  using (auth.uid() = user_id);

create index if not exists documents_professor_id_idx
  on public.documents (professor_id, created_at desc);

create index if not exists documents_user_id_idx
  on public.documents (user_id, created_at desc);
