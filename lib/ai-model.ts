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

/** 모델명만 보고 추론 모델인지 판별합니다(환경변수 우회 없음). */
export function isReasoningModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return REASONING_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * 접두사 기반 추정이라 미래의 새 모델명을 놓칠 수 있습니다. 그래서 환경변수
 * OPENAI_MODEL_MAX_COMPLETION_TOKENS로 강제 지정할 수 있게 열어뒀습니다 — 추정이 틀렸을 때
 * 코드를 고쳐 재배포하지 않고 환경변수만으로 되돌릴 수 있어야 하기 때문입니다.
 * ('true' → max_completion_tokens 사용 / 'false' → max_tokens 사용 / 미설정 → 접두사 추정)
 *
 * 💡 이 우회는 토큰 상한 파라미터 "이름"에만 적용되고 reasoning_effort에는 적용되지
 * 않습니다 — 둘을 같은 스위치에 묶으면, 이 값을 true로 켠 채 비추론 모델을 쓸 때
 * reasoning_effort까지 딸려 나가 400이 납니다.
 */
export function usesMaxCompletionTokens(model: string): boolean {
  const override = process.env.OPENAI_MODEL_MAX_COMPLETION_TOKENS?.trim().toLowerCase();
  if (override === 'true') return true;
  if (override === 'false') return false;
  return isReasoningModel(model);
}

/**
 * 출력 토큰 상한을 그 모델이 받아들이는 이름으로 담아 돌려줍니다.
 *
 * 💡 reasoningLimit을 따로 받는 이유: 추론 모델은 이 상한 안에 "추론 토큰"까지 포함해서
 * 세기 때문에, 기존 값을 그대로 쓰면 추론이 상한을 다 먹고 정작 답변이 잘려 나옵니다.
 * 그렇다고 상향된 값을 비추론 모델에도 그대로 쓰면 OPENAI_MODEL을 지워 되돌렸을 때
 * 예전과 다른 동작(더 긴 답변 허용)이 남습니다. 모델 계열별로 값을 나눠, 되돌리면
 * 정확히 예전 상태로 돌아가게 합니다.
 */
export function buildMaxTokensParam(
  model: string,
  limit: number,
  reasoningLimit?: number
): { max_tokens?: number; max_completion_tokens?: number } {
  return usesMaxCompletionTokens(model)
    ? { max_completion_tokens: reasoningLimit ?? limit }
    : { max_tokens: limit };
}

// 💡 [신규] reasoning_effort가 받는 값. gpt-5.6 계열은 none/low/medium/high/xhigh/max를
// 받고, 가장 낮은 단계가 'none'입니다('minimal'은 GPT-5 초기 세대 표기 — 그 세대 모델을
// 지정할 수도 있으므로 목록에는 남겨둡니다). 오타를 그대로 보내면 400이 나므로, 아는 값만
// 통과시키고 나머지는 기본값으로 떨어뜨립니다.
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const VALID_REASONING_EFFORTS: ReasoningEffort[] = [
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
];

// 강의자료 요약·문제 생성은 깊은 추론이 필요한 작업이 아니라 낮은 쪽을 기본값으로 둡니다.
// (모델을 지정하지 않으면 medium이 기본이라 그대로 두면 느리고 비쌉니다.)
const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low';

/**
 * 추론 모델일 때만 reasoning_effort를 담아 돌려줍니다. 비추론 모델에는 빈 객체를
 * 돌려주므로, OPENAI_MODEL을 지워 gpt-4.1-mini로 되돌리면 이 파라미터는 자동으로
 * 사라집니다(환경변수를 따로 지울 필요 없음).
 *
 * OPENAI_REASONING_EFFORT를 'off'로 두면 추론 모델에도 보내지 않습니다 — 이 파라미터
 * 자체가 문제를 일으킬 때 코드 수정 없이 뺄 수 있는 탈출구입니다.
 */
export function buildReasoningParam(model: string): { reasoning_effort?: ReasoningEffort } {
  if (!isReasoningModel(model)) return {};
  const raw = process.env.OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  if (raw === 'off') return {};
  const isKnown = (v: string | undefined): v is ReasoningEffort =>
    Boolean(v) && (VALID_REASONING_EFFORTS as string[]).includes(v as string);
  const effort: ReasoningEffort = isKnown(raw) ? raw : DEFAULT_REASONING_EFFORT;
  if (raw && !isKnown(raw)) {
    console.warn(`[ai-model] 알 수 없는 OPENAI_REASONING_EFFORT="${raw}" — ${DEFAULT_REASONING_EFFORT}로 대체합니다.`);
  }
  return { reasoning_effort: effort };
}
