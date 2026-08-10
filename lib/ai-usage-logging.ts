import type { SupabaseClient } from '@supabase/supabase-js';

// 💡 [수정] 'chat' 추가 — /api/chat은 스트리밍이라 usage를 그냥은 못 받는데, 그 이유로
// 지금까지 /admin/ai-usage에 채팅 토큰이 한 건도 안 쌓이고 있었습니다(호출량은 가장 많은데).
// stream_options: { include_usage: true }로 마지막 청크에서 받아 여기로 넘깁니다.
// DB의 route check 제약도 함께 넓혀야 합니다 —
// supabase/migrations/20260818_allow_chat_route_in_ai_usage_logs.sql
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
