-- 💡 [신규] logs에 professor_id를 추가합니다 — 어떤 교수님을 선택한 상태에서 나눈 대화인지
-- 기록해두고, 다음 요청의 "최근 대화 기록" 컨텍스트를 그 교수님 것으로만 좁히기 위해서입니다.
--
-- 지금까지는 /api/chat이 폴더·주제와 무관하게 시간순 최근 3건을 그대로 실었습니다. 그래서
-- A 교수님 얘기를 하다 B 교수님으로 넘어가면 직전 A 대화가 계속 따라붙어 답변을 흐렸습니다.
--
-- null 허용입니다. 교수님을 선택하지 않은 일반 대화는 계속 null로 쌓이고, 이 마이그레이션
-- 이전에 저장된 기존 대화도 전부 null로 남습니다(백필하지 않습니다 — 어떤 교수님과의
-- 대화였는지 사후에 알아낼 방법이 없고, 앞으로 쌓이는 것부터 적용되면 충분합니다).
--
-- on delete set null: 교수님을 지워도 대화 자체는 남고 "미지정"으로 돌아갑니다. 같은 테이블의
-- folder_id(20260730_create_conversation_folders.sql)와 동일한 판단입니다 — 분류가 사라지는
-- 것과 대화 기록이 사라지는 것은 완전히 다른 일이고, 후자는 사용자가 의도한 적이 없습니다.
alter table public.logs
  add column if not exists professor_id uuid references public.professors(id) on delete set null;

-- /api/chat이 매 요청마다 도는 조회 패턴에 맞춘 인덱스입니다:
--   where user_id = ? and professor_id = ? order by created_at desc limit 3
-- user_id 조건은 RLS 정책(auth.uid() = user_id)이 자동으로 붙이므로 쿼리문에는 안 보이지만
-- 실행 계획에는 들어갑니다. 그래서 세 컬럼을 함께 겁니다.
create index if not exists logs_user_professor_created_idx
  on public.logs (user_id, professor_id, created_at desc);

-- ── 적용 후 검증 ─────────────────────────────────────────────────────
-- 1) 컬럼과 외래키가 실제로 붙었는지
--    select column_name, data_type, is_nullable
--    from information_schema.columns
--    where table_schema = 'public' and table_name = 'logs' and column_name = 'professor_id';
--
--    select conname, confrelid::regclass as references, confdeltype
--    from pg_constraint
--    where conrelid = 'public.logs'::regclass and contype = 'f';
--    -- professor_id 쪽 confdeltype이 'n'(set null)이어야 합니다.
--
-- 2) 기존 대화는 전부 null인지 (백필하지 않았으므로 정상)
--    select professor_id is null as unassigned, count(*)
--    from public.logs group by 1;
--
-- 3) 배포 후 교수님을 고른 채로 채팅을 한 번 해보고 값이 들어오는지
--    select created_at, professor_id, left(content, 40)
--    from public.logs order by created_at desc limit 5;
