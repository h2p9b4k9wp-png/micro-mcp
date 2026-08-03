-- "세션당 업로드 1건" 예산을 DB 레벨에서 원자적으로 강제합니다.
--
-- 기존엔 lib/anonymous-usage.ts의 checkGuestUploadAllowed()(SELECT로 "이미 썼는지" 확인)와
-- recordAnonymousUsage()(INSERT로 실제 기록)가 서로 다른 두 번의 왕복 요청이었습니다. 같은
-- guest_session_id 쿠키로 여러 요청을 동시에 보내면(예: 병렬 curl 100개) 전부 "아직 안 씀"
-- 상태로 SELECT 확인을 통과해버리는 경쟁 조건(TOCTOU)이 있어, 세션당 1건으로 설계된 예산을
-- 사실상 무제한으로 우회할 수 있었습니다.
--
-- 이 부분 유니크 인덱스는 같은 session_id가 analyze/guided/chat_attachment(셋 다 "업로드"
-- 예산을 공유하는 kind) 중 하나로 두 번 이상 기록되는 것 자체를 DB가 거부하게 만듭니다.
-- 동시에 여러 INSERT가 들어와도 정확히 하나만 성공하고 나머지는 23505(unique_violation)로
-- 실패합니다 — lib/anonymous-usage.ts의 recordAnonymousUploadIfAllowed()가 이 에러 코드를
-- "이미 사용함"으로 해석해 AI 호출 전에 요청을 중단시킵니다.
--
-- 'chat'(채팅 턴, 세션당 최대 3회까지 정상적으로 허용)은 이 인덱스 대상에서 제외합니다 —
-- 여러 행이 정상인 kind라 유니크 제약을 걸 수 없습니다. 이 kind의 카운트 기반 확인은 여전히
-- 작은 경쟁 조건 여지가 남아있지만(동시 요청이 3턴 한도를 살짝 넘길 수 있음), IP당 일일
-- 세션 상한과 게스트 전체 일일 상한이 최종 안전판으로 남아 있어 실질적 노출은 제한적입니다.
create unique index if not exists anonymous_trial_usage_session_upload_once_idx
  on public.anonymous_trial_usage (session_id)
  where kind in ('analyze', 'guided', 'chat_attachment') and session_id is not null;
