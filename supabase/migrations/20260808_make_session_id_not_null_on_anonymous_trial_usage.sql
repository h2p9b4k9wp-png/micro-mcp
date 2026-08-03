-- session_id가 NULL인 행은 20260807 마이그레이션의 부분 유니크 인덱스
-- (anonymous_trial_usage_session_upload_once_idx)에서 서로 충돌하지 않습니다 — SQL
-- 표준상 NULL은 그 무엇과도, NULL끼리도 "같다"고 판정되지 않기 때문입니다. 즉 session_id
-- 없이 기록되는 행이 하나라도 생기면 그 행에 대해서는 경쟁 조건 방어가 통째로 무력화됩니다.
--
-- 현재 남아있는 NULL 행은 session_id 컬럼이 생기기 전(20260805 이전, 즉 20260802에 만든
-- 원래 테이블에 쓰인 초기 로그)의 과거 데이터입니다 — lib/anonymous-usage.ts의
-- getGuestSessionId()는 항상 문자열을 반환하므로(쿠키가 있으면 그 값을, 없으면 방금 발급한
-- UUID를) 지금 애플리케이션 코드로는 session_id가 NULL인 새 행이 생길 수 없습니다. 이
-- 테이블은 남용 방지용 카운트 로그일 뿐 참조 무결성이 필요한 사용자 데이터가 아니므로
-- (20260805 마이그레이션 주석 참고), 과거 NULL 행은 안전하게 지웁니다.
--
-- 삭제 후 NOT NULL 제약을 걸어, 애플리케이션 코드에 미래에 버그가 생기더라도(예: 세션 발급
-- 실패를 실수로 무시하고 계속 진행하는 리팩터링) DB 레벨에서 session_id 없는 INSERT 자체가
-- 아예 불가능하게 만듭니다 — 애플리케이션 레벨의 방어(app/api/public-*의
-- getGuestSessionIdOrNull() null 체크)와 이중으로 겹치는 안전장치입니다.
delete from public.anonymous_trial_usage where session_id is null;

alter table public.anonymous_trial_usage
  alter column session_id set not null;
