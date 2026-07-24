-- "나의 기록" 대시보드에서 기기와 무관하게 일관된 "분석한 문서" 이력을 보여주기 위한 테이블.
-- 실제 파일 내용은 저장하지 않고, 메타데이터(파일명·형식·업로드 시각)만 누적 기록합니다.
create table if not exists public.document_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_name text not null,
  format text not null,
  created_at timestamptz not null default now()
);

alter table public.document_uploads enable row level security;

create policy "사용자는 자신의 문서 업로드 기록만 조회"
  on public.document_uploads for select
  using (auth.uid() = user_id);

create policy "사용자는 자신의 문서 업로드 기록만 추가"
  on public.document_uploads for insert
  with check (auth.uid() = user_id);

create index if not exists document_uploads_user_id_created_at_idx
  on public.document_uploads (user_id, created_at desc);
