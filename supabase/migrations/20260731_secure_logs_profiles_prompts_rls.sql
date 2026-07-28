-- logs/profiles/prompts는 이 저장소에 원래 마이그레이션이 없는(사전에 만들어진) 테이블이라
-- RLS 활성화 여부와 정책 존재 여부를 코드만으로 확신할 수 없습니다. 이 마이그레이션은 세
-- 테이블 모두에 "본인 행만 접근 가능"을 명시적으로 강제합니다.
--
-- 멱등성: ENABLE ROW LEVEL SECURITY는 이미 켜져 있어도 안전하게 재실행 가능합니다.
-- 정책은 PostgreSQL이 "CREATE POLICY IF NOT EXISTS"를 지원하지 않으므로 DROP POLICY IF
-- EXISTS 후 CREATE POLICY로 재실행 가능하게 했습니다. 이미 동일한 이름이 아닌 다른 이름의
-- 정책이 있어도 permissive 정책끼리는 겹쳐도 무해합니다(OR로 합쳐짐).

-- ── logs ─────────────────────────────────────────────────────────────
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
-- profiles.id는 auth.users.id와 동일한 값(가입 시 그대로 채워짐)이라는 이 저장소 전반의
-- 전제를 따릅니다 — app/api/v1/[username]/[slug]/route.ts가 profiles.id를 그대로
-- session user.id와 비교하는 방식과 일치합니다.
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
-- app/api/v1/[username]/[slug]/route.ts는 서비스 롤 키로 이 테이블에 접근해 RLS를
-- 우회하므로(대신 라우트 코드 자체에서 소유권을 검증함, 최근 커밋 참고) 이 정책은 그
-- 라우트를 막지 않습니다 — 다만 앞으로 클라이언트에서 prompts를 직접 조회/수정하는 경로가
-- 생기더라도 기본적으로 안전하도록 방어선을 깔아둡니다.
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
