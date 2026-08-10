import OpenAI from 'openai';
import { LENSES, detectLens, capLensResult, type LensId } from '@/lib/lenses';
import { truncateForPrompt } from '@/lib/truncate-text';
import { getAiModel, buildMaxTokensParam, buildReasoningParam } from '@/lib/ai-model';

export class LensAnalysisParseError extends Error {}

// 💡 OpenAI SDK의 completion.usage를 우리 인터페이스로 변환하는 공용 헬퍼 — 두 함수가
// 완전히 동일한 매핑을 하므로 하나로 뺐습니다. usage가 없으면(극히 예외적) null.
function extractUsage(completion: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }): LensAnalysisUsage | null {
  const usage = completion.usage;
  if (!usage || typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number') return null;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens,
  };
}

export interface RunLensAnalysisParams {
  apiKey: string;
  text: string;
  fileName?: string;
  lens?: LensId;
  responseLanguage?: string;
  // 💡 [신규] 교수님 성향 참고자료 블록(lib/professor-analysis.ts의 buildProfessorContext가
  // 만든 문자열). "교수님 자료로 만들기"에서만 채워지고, 평소 채팅 첨부 분석이나 게스트
  // 체험에서는 undefined입니다.
  professorContext?: string;
}

export interface LensAnalysisUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface RunLensAnalysisResult {
  lensId: LensId;
  result: unknown;
  // 💡 [신규] OpenAI 응답에 실려오는 실제 토큰 사용량 — app/api/analyze가 ai_usage_logs에
  // 그대로 기록합니다(lib/ai-usage-logging.ts). 응답에 usage 필드가 없는 극히 예외적인
  // 경우를 위해 null을 허용합니다(호출부는 null이면 기록을 건너뜁니다).
  usage: LensAnalysisUsage | null;
  // 💡 [신규] 이 호출에 실제로 쓰인 모델명. 호출부(app/api/analyze)가 ai_usage_logs에
  // 그대로 기록하도록 함께 돌려줍니다 — 기록 쪽에서 getAiModel()을 따로 부르면 그 사이
  // 환경변수가 바뀐 경우 호출에 쓴 모델과 기록된 모델이 어긋날 수 있습니다.
  model: string;
}

// 💡 [신규] /api/analyze(로그인 사용자)와 /api/public-analyze(로그인 없는 체험용)가
// 공유하는 핵심 분석 로직 — 텍스트 절단, 렌즈 감지, OpenAI Structured Outputs 호출, JSON
// 파싱까지. 두 라우트가 각자 다른 방식으로 남용을 막지만(전자는 분당 속도 제한, 후자는
// IP당 하루 1회) "텍스트를 넣으면 렌즈 결과가 나오는" 핵심 부분은 한 곳에 둬서 어긋나지
// 않게 합니다.
export async function runLensAnalysis({
  apiKey,
  text,
  fileName,
  lens,
  responseLanguage,
  professorContext,
}: RunLensAnalysisParams): Promise<RunLensAnalysisResult> {
  const truncatedText = truncateForPrompt(text);
  const lensId: LensId = lens && lens in LENSES ? lens : detectLens(truncatedText, fileName);
  const lensDef = LENSES[lensId];

  const openai = new OpenAI({ apiKey, maxRetries: 1 });
  const model = getAiModel();

  // 💡 답변 언어는 lensDef.systemPrompt(COMMON_RULES 포함, 모든 요청에 동일한 고정 문자열
  // — OpenAI가 프롬프트 캐싱하는 부분)에 넣지 않고, 요청마다 어차피 매번 달라지는 user 메시지
  // 앞에 붙입니다. 고정 프리픽스에 넣으면 사용자마다 언어가 달라질 때 캐시가 갈라져서
  // 캐싱 이득이 사라집니다.
  const languageDirective = responseLanguage
    ? `Respond entirely in ${responseLanguage}. This overrides the document's language.\n\n`
    : '';
  // 💡 교수님 성향 블록도 같은 이유로 user 메시지에 넣습니다 — 교수님마다 내용이 달라
  // 시스템 프롬프트에 넣으면 교수님 수만큼 캐시가 갈라집니다. 블록 자체가 "[분석 대상 문서]"
  // 머리말로 끝나므로 바로 뒤에 본문을 이어붙이면 됩니다(lib/professor-analysis.ts 참고).
  const userContent = `${languageDirective}${professorContext || ''}${truncatedText}`;

  const completion = await openai.chat.completions.create({
    model,
    ...buildMaxTokensParam(model, 4096, 16384),
    ...buildReasoningParam(model),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: `${lensId}_result`,
        schema: lensDef.schema,
        strict: true,
      },
    },
    messages: [
      { role: 'system', content: lensDef.systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  let result: unknown;
  try {
    result = JSON.parse(raw);
  } catch {
    console.error('AI 응답 파싱 실패:', raw);
    throw new LensAnalysisParseError('The AI had trouble organizing the analysis result. Please try again.');
  }

  return { lensId, result: capLensResult(lensId, result), usage: extractUsage(completion), model };
}

export interface RunLensAnalysisOnImageParams {
  apiKey: string;
  dataUrl: string; // data:image/...;base64,...
  lens: LensId;
  responseLanguage?: string;
}

// 💡 [신규] 게스트 가이드 체험(app/api/public-guided-trial) 전용 — 텍스트가 아니라 이미지
// 한 장을 분석 대상으로 삼습니다. runLensAnalysis와 스키마·시스템 프롬프트(LENSES[lens])는
// 완전히 동일하게 재사용하되(잘 다듬어진 anti-hallucination 규칙을 새로 쓰지 않기 위함),
// 사용자 메시지만 일반 텍스트 대신 app/api/chat/route.ts가 chatAttachments 이미지에 쓰는
// 것과 동일한 형식의 멀티모달 content 배열(image_url part)로 바꿉니다. 이미지에는
// detectLens를 적용할 텍스트가 없으므로 lens는 필수입니다(자동 감지 없음).
export async function runLensAnalysisOnImage({
  apiKey,
  dataUrl,
  lens,
  responseLanguage,
}: RunLensAnalysisOnImageParams): Promise<RunLensAnalysisResult> {
  const lensDef = LENSES[lens];
  const openai = new OpenAI({ apiKey, maxRetries: 1 });
  const model = getAiModel();

  const languageDirective = responseLanguage
    ? `Respond entirely in ${responseLanguage}. This overrides the document's language.\n\n`
    : '';

  const completion = await openai.chat.completions.create({
    model,
    ...buildMaxTokensParam(model, 4096, 16384),
    ...buildReasoningParam(model),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: `${lens}_result`,
        schema: lensDef.schema,
        strict: true,
      },
    },
    messages: [
      { role: 'system', content: lensDef.systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${languageDirective}아래 첨부된 이미지가 분석 대상 문서입니다.` },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  let result: unknown;
  try {
    result = JSON.parse(raw);
  } catch {
    console.error('AI 응답 파싱 실패:', raw);
    throw new LensAnalysisParseError('The AI had trouble organizing the analysis result. Please try again.');
  }

  return { lensId: lens, result: capLensResult(lens, result), usage: extractUsage(completion), model };
}
