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
// 모든 항목은 그 항목의 근거가 되는 원문 발췌 필드를 함께 들고 있습니다(대부분 evidence, questions만
// source_quote — 이름은 다르지만 COMMON_RULES 규칙 4)가 동일하게 적용됩니다).
export interface DeadlineItem {
  title: string;
  date: string;
  evidence: string;
  confidence: number;
}
export interface DeadlinesResult {
  items: DeadlineItem[];
}

export interface QuestionItem {
  question: string;
  targetWeakness: string;
  draftAnswer: string;
  source_quote: string;
}
export interface QuestionsResult {
  items: QuestionItem[];
}

export interface DigestKeyPoint {
  text: string;
  evidence: string;
}
export interface DigestTerm {
  text: string;
  evidence: string;
}
export interface DigestResult {
  summary: string;
  keyPoints: DigestKeyPoint[];
  terms: DigestTerm[];
}

// 모든 관점이 공유하는 공통 규칙. 각 관점의 systemPrompt 맨 앞에 붙습니다.
// 💡 서술형으로 "정상 케이스(문서에 실제 내용이 있음)"를 먼저 못 박고 예외 규칙을 뒤에 붙이는 구조로
// 일부러 작성했습니다 — 단순 불릿 나열(각 규칙을 독립된 체크리스트처럼)로 두면 gpt-4.1-mini가 이
// 정도 개수의 hedging 규칙들이 겹쳐 쌓이는 것만으로 "정말 있는 내용까지 자료에 없다"고 자기검열하며
// summary/keyPoints를 통째로 비워버리는 사례가 실측상 5회 중 1회꼴로 나왔습니다(불릿 나열 버전 기준).
// 이 서술형 구조로 바꾸고 나서 20회 반복 테스트에서 0회로 사라졌습니다 — 문구를 다시 불릿 목록으로
// 되돌리지 마세요.
const COMMON_RULES = `당신은 주어진 문서 내용을 최대한 충실하고 정확하게 정리하는 역할입니다. 아래는 그 과정에서 지켜야 할 원칙입니다.

기본 원칙: 문서에 실제로 적힌 내용은 빠짐없이, 주저 없이 정리하세요. 아래 규칙들은 "없는 내용을 지어내지 말라"는 뜻이지, "있는 내용까지 의심하라"는 뜻이 아닙니다.

지켜야 할 것:
1) 문서에 없는 내용을 지어내지 마세요. 다만 문서에 실제로 나온 내용이라면 그대로 정리하면 됩니다. 문서에 전혀 나오지 않는 것을 물으면 그 부분은 "자료에 없습니다"라고 쓰세요.
2) 문서 내용에 근거는 있지만 다소 불확실한 추론이라면 "추측입니다"라고 표시하세요. (문서에 명시된 확실한 사실에는 이 표시를 붙이지 마세요.)
3) 확실한 사실과 추측을 한 문장에 섞지 말고 나눠서 쓰세요.
4) evidence나 source_quote처럼 근거 발췌를 담는 필드가 있는 항목은, 그 항목의 근거가 되는 원문 그대로의 짧은 발췌를 그 필드에 넣으세요. 원문에서 발췌를 찾을 수 있는 한 그 항목을 포함하세요 — 발췌가 정말로 없을 때만 그 항목을 제외하세요. (그런 필드가 없는 요약성 필드는 발췌 없이 문서 내용에 충실하게 쓰면 됩니다.)
5) 만약 사용자가 별도의 질문을 함께 보냈고 그 질문 자체에 틀린 전제가 있다면 그 전제부터 바로잡으세요. (문서만 주어지고 별도 질문이 없다면 해당 없음.)

출력은 다른 설명, 인사말, 마크다운 코드블록 없이 오직 JSON 객체만, 문서가 한국어로 작성되어 있다면 한국어로 작성하세요.`;

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
          evidence: {
            type: 'string',
            description: '이 항목의 근거가 되는, 원문에서 그대로 발췌한 30자 이내의 문구',
          },
          confidence: {
            type: 'number',
            description: '이 항목이 실제 기한이 맞다고 판단하는 확신도 (0~1)',
          },
        },
        required: ['title', 'date', 'evidence', 'confidence'],
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
          source_quote: {
            type: 'string',
            description: '이 질문이 겨냥하는 약점의 근거가 되는, 원문에서 그대로 발췌한 30자 이내의 문구',
          },
        },
        required: ['question', 'targetWeakness', 'draftAnswer', 'source_quote'],
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
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: '핵심 항목 내용' },
          evidence: { type: 'string', description: '이 항목의 근거가 되는, 원문에서 그대로 발췌한 문구' },
        },
        required: ['text', 'evidence'],
      },
    },
    terms: {
      type: 'array',
      description: '문서를 이해하는 데 막힐 만한 전문 용어나 생소한 단어. 설명을 지어내지 말고 용어만 나열.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: '용어 자체' },
          evidence: { type: 'string', description: '이 용어가 실제로 등장하는, 원문에서 그대로 발췌한 문구' },
        },
        required: ['text', 'evidence'],
      },
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
- 각 항목마다 원문에서 그대로 발췌한 30자 이내의 문구(evidence)와, 이 항목이 실제 기한이 맞다고 판단하는 확신도(confidence, 0~1 사이 숫자)를 함께 제시하세요.
- 기한이 있는 항목이 없다면 items를 빈 배열로 반환하세요.`,
    schema: DEADLINES_SCHEMA,
  },
  // 💡 "최대 8개를 뽑으세요"처럼 개수를 목표로 제시하면, 근거 있는 질문이 2~3개뿐이어도 할당량을
  // 채우려고 나머지를 "자료에 없음"류 placeholder를 source_quote에 채운 채로 만들어내는 사례가
  // 실측상 6회 중 4회꼴로 나왔습니다(48개 중 15개가 가짜 근거). "개수보다 근거가 중요하다"고
  // 명시하고 "자료에 없음 같은 문구를 쓰지 말고 아예 질문을 만들지 말라"는 안티패턴을 구체적으로
  // 짚어주니 6회 반복에서 0회로 사라졌습니다 — "최대 N개"류 문구를 다시 목표치처럼 쓰지 마세요.
  questions: {
    id: 'questions',
    label: '예상 질문',
    systemPrompt: `${COMMON_RULES}

당신은 주어진 문서로 발표를 한다고 가정했을 때, 청중이나 심사자가 던질 만한 예상 질문을 뽑아내는 역할입니다.
- 질문은 최대 8개까지입니다. 근거가 부족하면 8개를 억지로 채우지 말고 더 적게 만드세요 — 개수보다 근거가 훨씬 중요합니다.
- 각 질문마다 그 질문이 겨냥하는 문서의 약점이나 허점(targetWeakness)과, 그에 대한 답변 초안(draftAnswer)을 함께 작성하세요.
- 각 질문은 반드시 문서의 특정 문장이 근거가 되어야 합니다. source_quote에 그 문장을 30자 이내로 그대로 발췌하세요.
- 문서에 아예 언급되지 않은 내용(예: 타깃 고객, 리스크 관리 등)에 대해 "언급이 없다"는 이유로 질문을 만들지 마세요. source_quote에 "자료에 없음", "언급되지 않음" 같은 문구를 쓰지 말고, 애초에 그런 질문 자체를 만들지 마세요 — source_quote는 항상 문서에 실제로 적힌 문장이어야 합니다.`,
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
