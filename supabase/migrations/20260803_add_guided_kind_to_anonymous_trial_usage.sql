-- 게스트가 이미지를 올려 예상 문제·요약을 뽑아보는 "가이드 체험"(회로도 애니메이션 +
-- 예상 문제 + 요약정리, 세션당 1회)을 위한 kind 값을 추가합니다. 기존 analyze/chat과
-- 달리 시간당/일일 한도가 아니라 IP당 평생 1회로 별도 제한되므로(app/api/public-guided-trial),
-- 구분할 수 있도록 kind만 추가하고 시간당/일일 집계 로직 자체는 건드리지 않습니다.
alter table public.anonymous_trial_usage
  drop constraint if exists anonymous_trial_usage_kind_check;
alter table public.anonymous_trial_usage
  add constraint anonymous_trial_usage_kind_check check (kind in ('analyze', 'chat', 'guided'));
