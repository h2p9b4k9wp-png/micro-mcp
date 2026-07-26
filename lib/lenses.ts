// 문서를 바라보는 세 가지 "관점(lens)"을 정의합니다.
// 각 관점은 시스템 프롬프트와, OpenAI Structured Outputs(strict JSON)에 사용할 JSON 스키마로 구성됩니다.

export type LensId = 'deadlines' | 'questions' | 'digest';

export interface LensDefinition {
  id: LensId;
  label: string;
  systemPrompt: string;
  schema: Record<string, unknown>;
}

// 각 관점의 analyze 결과(JSON 스키마와 1:1로 대응하는 TS 타입) — 클라이언트에서 결과를 렌더링할 때 사용합니다.
export interface DeadlineItem {
  title: string;
  date: string;
  excerpt: string;
  confidence: number;
}
export interface DeadlinesResult {
  items: DeadlineItem[];
}

export interface QuestionItem {
  question: string;
  targetWeakness: string;
  draftAnswer: string;
}
export interface QuestionsResult {
  items: QuestionItem[];
}

export interface DigestResult {
  summary: string;
  keyPoints: string[];
  terms: string[];
}

// 모든 관점이 공유하는 공통 규칙. 각 관점의 systemPrompt 맨 앞에 붙습니다.
const COMMON_RULES = `다음 규칙을 반드시 지키세요.
- 문서 원문에 없는 내용은 절대 추가하거나 추측하지 마세요.
- 다른 설명, 인사말, 마크다운 코드블록 표시 없이 오직 JSON 객체만 출력하세요.
- 문서가 한국어로 작성되어 있다면 한국어로 응답하세요.`;

const DEADLINES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: {
            type: 'string',
            description: '무엇에 대한 기한인지 (예: "1차 과제 제출")',
          },
          date: {
            type: 'string',
            description: '문서에 적힌 표기 그대로의 날짜/기한 문구. 계산하거나 변환하지 않음.',
          },
          excerpt: {
            type: 'string',
            description: '원문에서 그대로 발췌한 30자 이내의 문구',
          },
          confidence: {
            type: 'number',
            description: '이 항목이 실제 기한이 맞다고 판단하는 확신도 (0~1)',
          },
        },
        required: ['title', 'date', 'excerpt', 'confidence'],
      },
    },
  },
  required: ['items'],
};

const QUESTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: {
            type: 'string',
            description: '이 문서로 발표할 때 받을 만한 예상 질문',
          },
          targetWeakness: {
            type: 'string',
            description: '이 질문이 겨냥하는 문서의 약점이나 허점',
          },
          draftAnswer: {
            type: 'string',
            description: '이 질문에 대한 답변 초안',
          },
        },
        required: ['question', 'targetWeakness', 'draftAnswer'],
      },
    },
  },
  required: ['items'],
};

const DIGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      description: '문서 전체를 한 줄로 요약한 문장',
    },
    keyPoints: {
      type: 'array',
      description: '핵심 항목 (최대 7개)',
      items: { type: 'string' },
    },
    terms: {
      type: 'array',
      description: '문서를 이해하는 데 막힐 만한 전문 용어나 생소한 단어. 설명을 지어내지 말고 용어만 나열.',
      items: { type: 'string' },
    },
  },
  required: ['summary', 'keyPoints', 'terms'],
};

export const LENSES: Record<LensId, LensDefinition> = {
  deadlines: {
    id: 'deadlines',
    label: '마감 뽑기',
    systemPrompt: `${COMMON_RULES}

당신은 문서에서 기한이 있는 항목(마감일, 제출기한, 시험일 등)을 찾아내는 역할입니다.
- 날짜/기한은 문서에 적힌 표기 그대로 옮기세요. 상대적인 표현("다음 주 금요일" 등)을 실제 날짜로 계산하거나 변환하지 마세요.
- 각 항목마다 원문에서 그대로 발췌한 30자 이내의 문구(excerpt)와, 이 항목이 실제 기한이 맞다고 판단하는 확신도(confidence, 0~1 사이 숫자)를 함께 제시하세요.
- 기한이 있는 항목이 없다면 items를 빈 배열로 반환하세요.`,
    schema: DEADLINES_SCHEMA,
  },
  questions: {
    id: 'questions',
    label: '예상 질문',
    systemPrompt: `${COMMON_RULES}

당신은 주어진 문서로 발표를 한다고 가정했을 때, 청중이나 심사자가 던질 만한 예상 질문을 뽑아내는 역할입니다.
- 최대 8개의 질문을 뽑으세요.
- 각 질문마다 그 질문이 겨냥하는 문서의 약점이나 허점(targetWeakness)과, 그에 대한 답변 초안(draftAnswer)을 함께 작성하세요.
- 문서 내용에 근거해서만 작성하고, 근거 없는 약점을 지어내지 마세요.`,
    schema: QUESTIONS_SCHEMA,
  },
  digest: {
    id: 'digest',
    label: '핵심 정리',
    systemPrompt: `${COMMON_RULES}

당신은 문서를 빠르게 훑어볼 수 있도록 핵심만 정리하는 역할입니다.
- 문서 전체를 한 줄로 요약하세요(summary).
- 핵심 항목을 최대 7개까지 뽑으세요(keyPoints).
- 문서를 이해하는 데 막힐 만한 전문 용어나 생소한 단어를 뽑으세요(terms). 용어에 대한 설명은 지어내지 말고 용어 자체만 나열하세요.
- 원문에 없는 내용은 절대 덧붙이지 마세요.`,
    schema: DIGEST_SCHEMA,
  },
};

const DEADLINE_KEYWORDS = ['강의계획서', '주차별', '제출기한', '제출 기한', '과제', '시험'];
const QUESTION_KEYWORDS = ['발표', '제안서', '기획안'];

// "YYYY.MM.DD" 류 표기와 "M월 D일" 류 표기를 모두 넓게 잡는 날짜 패턴
const DATE_PATTERN = /\d{1,4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{0,2}\s*일?|\d{1,2}\s*월\s*\d{1,2}\s*일/g;

/**
 * AI를 쓰지 않고 키워드/파일명만으로 세 관점 중 하나를 고릅니다.
 * 애매하면 무조건 digest로 떨어집니다.
 */
export function detectLens(text: string, fileName?: string): LensId {
  const body = text || '';
  const lowerName = (fileName || '').toLowerCase();

  const deadlineKeywordHit = DEADLINE_KEYWORDS.some((k) => body.includes(k));
  const dateMatches = body.match(DATE_PATTERN) || [];
  if (deadlineKeywordHit && dateMatches.length >= 3) {
    return 'deadlines';
  }

  const isPpt = lowerName.endsWith('.ppt') || lowerName.endsWith('.pptx');
  const questionKeywordHit = QUESTION_KEYWORDS.some((k) => body.includes(k));
  if (isPpt || questionKeywordHit) {
    return 'questions';
  }

  return 'digest';
}
