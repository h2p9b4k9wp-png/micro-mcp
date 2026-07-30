-- 로그인 없이 체험 가능한 범위를 "파일 1개 분석"에서 "파일 분석 + AI 채팅"으로 넓히면서,
-- 기존 anonymous_trial_usage 테이블(IP + 시각만 기록)에 어떤 종류의 호출이었는지 구분하는
-- kind 컬럼을 추가합니다. 시간당/일일 호출 한도 계산 자체는 kind와 무관하게 IP당 합산하지만
-- (둘 다 동일하게 OpenAI 토큰 비용이 들기 때문), 어느 기능이 더 많이 쓰이는지 관측하기 위해
-- 남겨둡니다.
alter table public.anonymous_trial_usage
  add column if not exists kind text not null default 'analyze';

alter table public.anonymous_trial_usage
  drop constraint if exists anonymous_trial_usage_kind_check;
alter table public.anonymous_trial_usage
  add constraint anonymous_trial_usage_kind_check check (kind in ('analyze', 'chat'));
