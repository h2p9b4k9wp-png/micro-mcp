-- "지난 대화"를 폴더로 분류하는 기능. 폴더 개수 제한 없음.
create table if not exists public.conversation_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.conversation_folders enable row level security;

create policy "사용자는 자신의 폴더만 조회"
  on public.conversation_folders for select
  using (auth.uid() = user_id);

create policy "사용자는 자신의 폴더만 추가"
  on public.conversation_folders for insert
  with check (auth.uid() = user_id);

create policy "사용자는 자신의 폴더만 삭제"
  on public.conversation_folders for delete
  using (auth.uid() = user_id);

create index if not exists conversation_folders_user_id_idx
  on public.conversation_folders (user_id, created_at desc);

-- 대화(logs) 테이블에 폴더 컬럼 추가. null 허용 = 미분류(기본값). 폴더를 지워도 대화 자체는
-- 남고 미분류로 돌아갑니다(on delete set null).
alter table public.logs
  add column if not exists folder_id uuid references public.conversation_folders(id) on delete set null;

create index if not exists logs_folder_id_idx
  on public.logs (folder_id);

-- logs 테이블은 이 저장소에 원래 마이그레이션이 없어(사전에 만들어짐) 기존 UPDATE 정책 여부를
-- 확신할 수 없습니다. 대화를 폴더로 옮기려면 UPDATE 권한이 필요해서, 없을 경우를 대비해 추가합니다
-- — 이미 동일한 효과의 정책이 있어도 permissive 정책끼리는 겹쳐도 무해합니다.
create policy "사용자는 자신의 대화만 수정"
  on public.logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
