// 💡 [신규] OpenAI 모델별 1M 토큰당 가격(USD) — /admin/ai-usage가 ai_usage_logs에 쌓인
// 실측 토큰 수에 이 단가를 곱해 "예상 비용"을 계산합니다. 모델 문자열을 키로 두는 이유는
// ai_usage_logs.model에 호출 당시 실제로 쓰인 모델명이 그대로 저장되기 때문입니다 — 나중에
// 모델을 바꿔도 과거 행은 그 시점 모델의 가격으로 정확히 계산되고, 새 모델 가격만 여기
// 추가하면 됩니다. 가격은 OpenAI 공식 요금표 기준(2026-08 확인, 캐시 할인 미적용 표준가).
export const AI_MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  // 💡 [신규] gpt-5.6-luna — 모델 교체 검토용으로 추가만 해둡니다(실제 사용 여부는
  // OPENAI_MODEL 환경변수가 결정, lib/ai-model.ts 참고).
  //
  // ⚠️ 여기 적힌 값은 **단문(short context) 기준 표준가**입니다. 이 모델은 컨텍스트 길이에
  // 따라 요금이 갈리는 2단 구조라, 요청이 장문(long context) 구간에 들어가면 입력 $0.40 /
  // 출력 $1.80로 올라가고 그 높은 단가가 **요청 전체에** 적용됩니다(초과분에만 붙는 게
  // 아닙니다). 즉 /admin/ai-usage가 보여주는 금액은 장문 요청이 섞여 있으면 실제보다
  // 과소 계상됩니다 — 최대 입력 2배, 출력 1.5배까지 차이날 수 있습니다.
  //
  // 지금 이 표를 2단으로 만들지 않은 이유: ai_usage_logs에는 promptTokens 총합만 남고
  // "이 요청이 장문 구간이었는지"를 판별할 기준(구간 경계 토큰 수)을 확인하지 못했습니다.
  // 경계값이 확정되면 estimateCostUSD가 promptTokens를 보고 단가를 고르도록 바꾸는 게
  // 맞습니다. 그 전까지는 이 표의 금액을 "하한선"으로 읽으세요.
  'gpt-5.6-luna': { inputPerMillion: 0.2, outputPerMillion: 1.2 },
};

// 알 수 없는 모델(가격표에 없는 model 문자열)이면 null을 반환합니다 — 0으로 조용히 잘못
// 계산하는 대신, 호출부가 "이 모델은 가격을 모른다"는 걸 구분해서 표시할 수 있게 합니다.
export function estimateCostUSD(model: string, promptTokens: number, completionTokens: number): number | null {
  const pricing = AI_MODEL_PRICING[model];
  if (!pricing) return null;
  return (promptTokens / 1_000_000) * pricing.inputPerMillion + (completionTokens / 1_000_000) * pricing.outputPerMillion;
}
