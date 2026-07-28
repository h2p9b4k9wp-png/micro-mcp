import OpenAI from 'openai';
import { LENSES, detectLens, type LensId } from '@/lib/lenses';
import { truncateForPrompt } from '@/lib/truncate-text';

export class LensAnalysisParseError extends Error {}

export interface RunLensAnalysisParams {
  apiKey: string;
  text: string;
  fileName?: string;
  lens?: LensId;
  locale?: string;
}

export interface RunLensAnalysisResult {
  lensId: LensId;
  result: unknown;
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
  locale,
}: RunLensAnalysisParams): Promise<RunLensAnalysisResult> {
  const truncatedText = truncateForPrompt(text);
  const lensId: LensId = lens && lens in LENSES ? lens : detectLens(truncatedText, fileName);
  const lensDef = LENSES[lensId];

  const openai = new OpenAI({ apiKey, maxRetries: 1 });

  // 💡 답변 언어는 lensDef.systemPrompt(COMMON_RULES 포함, 모든 요청에 동일한 고정 문자열
  // — OpenAI가 프롬프트 캐싱하는 부분)에 넣지 않고, 요청마다 어차피 매번 달라지는 user 메시지
  // 앞에 붙입니다. 고정 프리픽스에 넣으면 언어가 바뀔 때마다(혹은 로케일별로) 캐시가 갈라져서
  // 캐싱 이득이 사라집니다.
  const languageDirective = locale === 'en'
    ? '[Answer language: English — you must answer in English regardless of the document\'s language.]\n\n'
    : '';
  const userContent = `${languageDirective}${truncatedText}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    max_tokens: 4096,
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
    throw new LensAnalysisParseError('AI가 분석 결과를 정리하는 데 실패했어요. 다시 시도해주세요.');
  }

  return { lensId, result };
}
