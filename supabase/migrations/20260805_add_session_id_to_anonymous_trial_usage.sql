-- 게스트 남용 방지를 "IP당 시간당/일일 호출 횟수"에서 "세션당 1회 예산(업로드 1건 +
-- 후속 질문 3턴) + IP당 하루 3세션"으로 바꾸면서, 어떤 요청이 같은 "세션"에 속하는지
-- 구분할 session_id 컬럼이 필요해졌습니다. 세션은 httpOnly 쿠키(lib/anonymous-usage.ts의
-- getGuestSessionId)로 서버가 직접 발급/판별하므로 프론트엔드에서 조작할 수 없습니다.
-- 기존 행에는 session_id가 없을 수 있어 nullable로 둡니다(과거 데이터는 세션 집계에서
-- 자연히 제외됨 — 문제 없음, 어차피 남용 방지 집계용 로그일 뿐 참조 무결성이 필요한
-- 데이터가 아닙니다).
alter table public.anonymous_trial_usage
  add column if not exists session_id text;

create index if not exists anonymous_trial_usage_session_idx
  on public.anonymous_trial_usage (session_id);
