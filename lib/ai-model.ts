// 💡 [신규] OpenAI 모델명을 한 곳에서 정하고, 모델 계열에 따라 달라지는 요청 파라미터를
// 맞춰주는 모듈. 원래는 7개 호출부(app/api/chat, app/api/public-chat,
// app/api/analyze-professor, lib/run-lens-analysis ×2, lib/reddit-scoring ×2)에 모델명이
// 문자열로 하드코딩돼 있어, 모델을 바꾸려면 전부 찾아 고쳐야 했습니다.

export const DEFAULT_AI_MODEL = 'gpt-4.1-mini';

/**
 * 실제로 호출에 쓸 모델명. OPENAI_MODEL 환경변수로 덮어쓸 수 있고, 없으면 기존 모델을
 * 그대로 씁니다 — 환경변수를 설정하지 않은 배포는 동작이 바뀌지 않습니다.
 *
 * 상수가 아니라 함수인 이유: 상수로 두면 모듈이 처음 로드될 때의 값이 굳어버려서,
 * Vercel에서 환경변수만 바꾸고 재배포했을 때 서버리스 인스턴스 재사용 여부에 따라
 * 반영 시점이 들쭉날쭉해집니다. 호출 시점에 읽으면 그런 애매함이 없습니다.
 */
export function getAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_AI_MODEL;
}

// 💡 GPT-5 계열·o 시리즈 같은 추론(reasoning) 모델은 Chat Completions에서 max_tokens를
// 받지 않고 max_completion_tokens만 받습니다. max_tokens를 그대로 보내면 400
// "Unsupported parameter"로 요청 자체가 실패합니다 — 즉 모델명만 바꾸면 모든 AI 기능이
// 한꺼번에 멎습니다. 아래 접두사 목록이 그 분기를 담당합니다.
//
// temperature/top_p/presence_penalty/frequency_penalty도 같은 이유로 추론 모델에서
// 거부되는데, 이 저장소의 호출부는 그중 무엇도 보내지 않고 있어(전부 model/max_tokens/
// stream/response_format/messages만 사용) 추가 대응이 필요 없었습니다. 나중에 온도 같은
// 파라미터를 붙일 일이 생기면 여기서 함께 분기해야 합니다.
const REASONING_MODEL_PREFIXES = ['gpt-5', 'o1', 'o3', 'o4'];

/**
 * 접두사 기반 추정이라 미래의 새 모델명을 놓칠 수 있습니다. 그래서 환경변수
 * OPENAI_MODEL_MAX_COMPLETION_TOKENS로 강제 지정할 수 있게 열어뒀습니다 — 추정이 틀렸을 때
 * 코드를 고쳐 재배포하지 않고 환경변수만으로 되돌릴 수 있어야 하기 때문입니다.
 * ('true' → max_completion_tokens 사용 / 'false' → max_tokens 사용 / 미설정 → 접두사 추정)
 */
export function usesMaxCompletionTokens(model: string): boolean {
  const override = process.env.OPENAI_MODEL_MAX_COMPLETION_TOKENS?.trim().toLowerCase();
  if (override === 'true') return true;
  if (override === 'false') return false;
  const normalized = model.trim().toLowerCase();
  return REASONING_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * 출력 토큰 상한을 그 모델이 받아들이는 이름으로 담아 돌려줍니다. 호출부는
 * `...buildMaxTokensParam(model, 4096)`처럼 펼쳐 넣기만 하면 됩니다.
 */
export function buildMaxTokensParam(
  model: string,
  limit: number
): { max_tokens?: number; max_completion_tokens?: number } {
  return usesMaxCompletionTokens(model) ? { max_completion_tokens: limit } : { max_tokens: limit };
}
