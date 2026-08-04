// 💡 [신규] OpenAI 모델별 1M 토큰당 가격(USD) — /admin/ai-usage가 ai_usage_logs에 쌓인
// 실측 토큰 수에 이 단가를 곱해 "예상 비용"을 계산합니다. 모델 문자열을 키로 두는 이유는
// ai_usage_logs.model에 호출 당시 실제로 쓰인 모델명이 그대로 저장되기 때문입니다 — 나중에
// 모델을 바꿔도 과거 행은 그 시점 모델의 가격으로 정확히 계산되고, 새 모델 가격만 여기
// 추가하면 됩니다. 가격은 OpenAI 공식 요금표 기준(2026-08 확인, 캐시 할인 미적용 표준가).
export const AI_MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
};

// 알 수 없는 모델(가격표에 없는 model 문자열)이면 null을 반환합니다 — 0으로 조용히 잘못
// 계산하는 대신, 호출부가 "이 모델은 가격을 모른다"는 걸 구분해서 표시할 수 있게 합니다.
export function estimateCostUSD(model: string, promptTokens: number, completionTokens: number): number | null {
  const pricing = AI_MODEL_PRICING[model];
  if (!pricing) return null;
  return (promptTokens / 1_000_000) * pricing.inputPerMillion + (completionTokens / 1_000_000) * pricing.outputPerMillion;
}
