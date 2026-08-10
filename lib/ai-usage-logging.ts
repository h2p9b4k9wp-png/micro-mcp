import type { SupabaseClient } from '@supabase/supabase-js';

// 💡 [수정] 'chat' 추가 — 지금까지 채팅은 토큰을 전혀 기록하지 않아서, 이 앱에서 토큰을
// 가장 많이 쓰는 경로가 ai_usage_logs에 통째로 빠져 있었습니다(/admin/ai-usage 금액도 그만큼
// 과소 계상). 내부 토큰 상한(lib/token-safety.ts)이 의미를 가지려면 이게 먼저 필요합니다.
// DB의 route 체크 제약도 함께 넓혀야 합니다 — 20260819_token_safety_limits.sql 참고.
export type AiUsageRoute = 'analyze' | 'analyze-professor' | 'chat';

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
