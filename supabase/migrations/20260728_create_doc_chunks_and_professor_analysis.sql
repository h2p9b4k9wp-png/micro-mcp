-- doc_chunks: 문서를 일정 길이로 쪼갠 조각. 지금 당장은 분석에서 documents.content 전체를
-- 그대로 쓰지만, 나중에 청크 단위 검색/임베딩으로 확장할 수 있도록 업로드 시점에 미리 쪼개서
-- 저장해둡니다. documents가 삭제되면 이 조각들도 함께 사라집니다(on delete cascade).
create table if not exists public.doc_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.doc_chunks enable row level security;

create policy "사용자는 자신의 자료 조각만 조회"
  on public.doc_chunks for select
  using (auth.uid() = user_id);

create policy "사용자는 자신의 자료 조각만 추가"
  on public.doc_chunks for insert
  with check (auth.uid() = user_id);

create policy "사용자는 자신의 자료 조각만 삭제"
  on public.doc_chunks for delete
  using (auth.uid() = user_id);

create index if not exists doc_chunks_document_id_idx
  on public.doc_chunks (document_id, chunk_index);

create index if not exists doc_chunks_user_id_idx
  on public.doc_chunks (user_id);

-- professor_analysis: 교수님별 최신 분석 결과 캐시(1교수님당 1행, professor_id에 upsert).
-- 자료가 추가/삭제될 때마다 클라이언트가 다시 계산해서 덮어씁니다 — 오래된 결과가 그대로 남지 않도록.
create table if not exists public.professor_analysis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  professor_id uuid not null unique references public.professors(id) on delete cascade,
  result jsonb not null,
  document_count integer not null,
  updated_at timestamptz not null default now()
);

alter table public.professor_analysis enable row level security;

create policy "사용자는 자신의 교수님 분석 결과만 조회"
  on public.professor_analysis for select
  using (auth.uid() = user_id);

create policy "사용자는 자신의 교수님 분석 결과만 추가"
  on public.professor_analysis for insert
  with check (auth.uid() = user_id);

create policy "사용자는 자신의 교수님 분석 결과만 수정"
  on public.professor_analysis for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "사용자는 자신의 교수님 분석 결과만 삭제"
  on public.professor_analysis for delete
  using (auth.uid() = user_id);
