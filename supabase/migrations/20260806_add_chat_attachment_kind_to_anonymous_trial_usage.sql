-- 게스트 채팅("AI에게 바로 질문하기")에도 파일/사진 첨부를 허용하면서, 첨부가 포함된
-- 채팅 호출을 구분할 kind 값을 추가합니다. 첨부는 파싱/비전 호출이 있어 일반 텍스트
-- 질문(chat)보다 비용이 크므로, sessionHasUsedUpload()가 이 kind도 "업로드 예산 소진"으로
-- 함께 세도록 lib/anonymous-usage.ts에서 처리합니다(파일 분석/이미지 체험과 같은 세션당
-- 1건 예산을 공유) — 첨부가 포함된 요청은 여전히 별도로 'chat' kind도 기록해 채팅 턴도
-- 정상적으로 소모합니다.
alter table public.anonymous_trial_usage
  drop constraint if exists anonymous_trial_usage_kind_check;
alter table public.anonymous_trial_usage
  add constraint anonymous_trial_usage_kind_check check (kind in ('analyze', 'chat', 'guided', 'chat_attachment'));
