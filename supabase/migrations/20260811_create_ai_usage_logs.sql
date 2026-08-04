-- 💡 [신규] /api/analyze·/api/analyze-professor가 호출될 때마다 실제 OpenAI 응답의
-- usage(prompt_tokens/completion_tokens/total_tokens)를 그대로 기록합니다. 추정이 아니라
-- 실측값이라, /admin/ai-usage 페이지의 "이번 달 총 토큰 사용량·예상 비용"이 이 테이블
-- 하나만 집계하면 됩니다. model을 함께 저장해두는 이유는 나중에 모델이 바뀌어도(가격이
-- 달라져도) 과거 행의 비용을 그 시점 모델 기준으로 정확히 계산할 수 있게 하기 위함입니다
-- (lib/ai-pricing.ts의 AI_MODEL_PRICING이 model 문자열로 가격을 찾습니다).
create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  route text not null check (route in ('analyze', 'analyze-professor')),
  model text not null,
  prompt_tokens integer not null,
  completion_tokens integer not null,
  total_tokens integer not null,
  created_at timestamptz not null default now()
);

alter table public.ai_usage_logs enable row level security;

-- 로그인한 사용자가 자기 자신의 호출 1건을 기록할 수 있게 합니다(analyze/analyze-professor
-- 라우트가 이미 세션에 바인딩된 supabase 클라이언트로 인서트합니다 — lib/auth/session.ts의
-- getSessionSupabase 참고). SELECT 정책은 두지 않습니다 — 이 데이터를 읽는 곳은
-- /admin/ai-usage 하나뿐이고, 그 페이지는 서비스 롤 키로 조회해 RLS를 우회합니다(다른
-- 사용자의 사용량까지 합산해야 하므로 "본인 것만" 정책으로는 애초에 안 됨 — funnel_events,
-- anonymous_trial_usage와 같은 패턴).
create policy "Users can record their own AI usage"
  on public.ai_usage_logs for insert
  with check (auth.uid() = user_id);

create index if not exists ai_usage_logs_created_idx on public.ai_usage_logs (created_at desc);
create index if not exists ai_usage_logs_route_created_idx on public.ai_usage_logs (route, created_at desc);
