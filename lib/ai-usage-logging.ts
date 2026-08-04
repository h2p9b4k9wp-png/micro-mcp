import type { SupabaseClient } from '@supabase/supabase-js';

export type AiUsageRoute = 'analyze' | 'analyze-professor';

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// 💡 [신규] /api/analyze·/api/analyze-professor가 OpenAI 호출 직후 실제 usage(추정이 아닌
// 실측값)를 ai_usage_logs에 기록할 때 씁니다. 두 라우트 모두 이미 세션에 바인딩된
// supabase 클라이언트(lib/auth/session.ts의 getSessionSupabase)를 갖고 있으므로 그걸
// 그대로 받아서 씁니다 — RLS 정책("Users can record their own AI usage")이 auth.uid() =
// user_id만 허용하므로 서비스 롤이 필요 없습니다. 기록 자체가 실패해도(네트워크 등) 이미
// 끝난 분석 응답을 막을 이유가 아니라 throw하지 않고 로그만 남깁니다 — 다른 사용 이력
// 기록 함수들(recordDocumentUpload, recordAnonymousUsage)과 같은 원칙입니다.
export async function recordAiUsage(
  supabase: SupabaseClient,
  userId: string,
  route: AiUsageRoute,
  model: string,
  usage: AiUsage
): Promise<void> {
  const { error } = await supabase.from('ai_usage_logs').insert({
    user_id: userId,
    route,
    model,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
  });
  if (error) console.error('[ai-usage-logging] 토큰 사용량 기록 실패:', error);
}
