import OpenAI from 'openai';
import { getAiModel, buildMaxTokensParam } from '@/lib/ai-model';

// 💡 [신규] lib/run-lens-analysis.ts와 완전히 같은 패턴(OpenAI 클라이언트 생성, Structured
// Outputs `response_format: {type:'json_schema', strict:true}`) — 이 저장소가 이미 정한
// 방식을 그대로 따릅니다.
//
// 두 단계로 나눈 이유: 채점만(1차)은 훨씬 싼 스키마라 서브레딧 6개 × 최대 100개 글을
// 매일 돌려도 비용이 크지 않지만, 답글 초안(2차)까지 매번 생성하면 7점 미만인(대부분일)
// 글에도 비용이 나갑니다. 7점 이상인 글에만 2차를 호출해 비용을 아낍니다.

export class RedditScoringParseError extends Error {}

const SCORE_SYSTEM_PROMPT = `당신은 Reddit 게시글이 "시험 준비, 기출문제, 강의자료 정리"에 대한
실제 어려움을 호소하는 글인지 0~10점으로 채점하는 평가자입니다.

높은 점수(7~10): 시험/과제를 앞두고 자료가 너무 많아서 정리가 안 되거나, 기출문제를 못 구해서
막막하거나, 강의자료가 흩어져 있어서 뭘 봐야 할지 모르겠다는 등 구체적이고 실제적인 어려움을
직접 겪고 있다고 호소하는 글.

낮은 점수(0~3): 단순 잡담, 밈, 뉴스 공유, 채용 공고, 이미 해결된 문제에 대한 회고, 광고성 글,
또는 학업과 무관한 내용.

중간 점수(4~6): 학업 관련이긴 하지만 "정리/준비의 어려움"이 핵심이 아니거나(예: 전공 선택
고민, 교수 뒷담화, 학점 계산법 질문), 어려움이 있긴 하지만 모호하거나 이미 스스로 해결한
것처럼 보이는 글.

게시글 제목과 본문만 보고 판단하고, 확신이 서지 않으면 낮은 쪽으로 채점하세요.`;

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 10 },
  },
  required: ['score'],
  additionalProperties: false,
} as const;

export async function scoreRedditPost({
  apiKey,
  title,
  body,
}: {
  apiKey: string;
  title: string;
  body: string;
}): Promise<{ score: number }> {
  const openai = new OpenAI({ apiKey, maxRetries: 1 });
  const model = getAiModel();
  const completion = await openai.chat.completions.create({
    model,
    ...buildMaxTokensParam(model, 100),
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'reddit_post_score', schema: SCORE_SCHEMA, strict: true },
    },
    messages: [
      { role: 'system', content: SCORE_SYSTEM_PROMPT },
      { role: 'user', content: `제목: ${title}\n\n본문: ${body || '(본문 없음)'}` },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(raw) as { score: number };
    return { score: parsed.score };
  } catch {
    console.error('[reddit-scoring] 채점 응답 파싱 실패:', raw);
    throw new RedditScoringParseError('Failed to parse score response');
  }
}

// 💡 [신규] 답글 초안 생성 — 사용자가 명시적으로 확정한 톤과 규칙을 그대로 시스템 프롬프트에
// 넣습니다: 진짜 도움이 되는 조언이 먼저이고 구체적이어야 하며, 앱 언급은 정말 맞는 경우에만
// 마지막 한 줄로, 절대 숨기지 않고 "제가 이런 문제 때문에 만든 게 있는데" 식으로 만든
// 사람이라는 걸 명확히 드러내는 톤으로 씁니다. 이 초안은 이메일로만 전달되고, 실제 게시는
// 사람이 직접 판단해서 합니다 — 이 함수도, 이 파일의 어떤 함수도 Reddit에 아무것도 쓰지
// 않습니다.
const DRAFT_SYSTEM_PROMPT = `당신은 Carrotly(업로드한 자료로 예상 문제·요약·마감일을 정리해주는
학습 도구)를 만든 사람입니다. 아래 Reddit 게시글에 실제로 도움이 되는 답글 초안을 작성하세요
(게시글이 쓰인 언어와 같은 언어로 쓰세요 — 대부분 영어일 것입니다).

반드시 지킬 규칙:
1. 먼저 그 사람의 실제 문제에 진짜 도움이 되는 구체적인 조언을 2~4문장으로 쓰세요. 이
   게시글 내용에 맞춘 조언이어야 하고, 일반론이면 안 됩니다.
2. Carrotly를 언급하는 게 정말 자연스럽고 도움이 되는 경우에만, 답글 맨 마지막에 한 줄을
   추가하세요. 절대 숨기거나 얼버무리지 마세요 — "제가 이런 문제 때문에 만든 도구가
   있어요" 같이 본인이 만든 사람이라는 걸 명확하게 드러내는 톤으로 쓰세요.
3. 이 게시글의 문제가 Carrotly와 실제로 안 맞으면(예: 대학원 논문 주제 상담, 학점 계산법
   질문 등) 아예 언급하지 마세요 — 언급 자체가 목적이 아니라 진짜 도움이 목적입니다.
4. "지금 가입하세요", "무료로 써보세요" 같은 상투적인 광고/CTA 문구는 쓰지 마세요 — 그냥
   있는 그대로, 자기소개하듯 담백하게 한 줄만 씁니다.

그리고 이 게시글이 왜 관련 있는지 한 줄로 요약하세요(이메일에서 빠르게 훑어볼 용도).`;

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    relevanceReason: { type: 'string' },
    draftReply: { type: 'string' },
  },
  required: ['relevanceReason', 'draftReply'],
  additionalProperties: false,
} as const;

export async function draftReplyForRedditPost({
  apiKey,
  title,
  body,
}: {
  apiKey: string;
  title: string;
  body: string;
}): Promise<{ relevanceReason: string; draftReply: string }> {
  const openai = new OpenAI({ apiKey, maxRetries: 1 });
  const model = getAiModel();
  const completion = await openai.chat.completions.create({
    model,
    ...buildMaxTokensParam(model, 1024),
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'reddit_post_draft', schema: DRAFT_SCHEMA, strict: true },
    },
    messages: [
      { role: 'system', content: DRAFT_SYSTEM_PROMPT },
      { role: 'user', content: `제목: ${title}\n\n본문: ${body || '(본문 없음)'}` },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  try {
    return JSON.parse(raw) as { relevanceReason: string; draftReply: string };
  } catch {
    console.error('[reddit-scoring] 초안 응답 파싱 실패:', raw);
    throw new RedditScoringParseError('Failed to parse draft response');
  }
}
