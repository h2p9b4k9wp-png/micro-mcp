// 💡 [신규] 추출된 문서 텍스트가 지나치게 길면 OpenAI에 보내는 프롬프트 토큰(=비용)이
// 그대로 커집니다. 6만 자를 넘으면 앞부분(70%)과 뒷부분(30%)만 남기고 가운데를 생략합니다 —
// 앞부분엔 대체로 핵심 도입부·목차가, 뒷부분엔 결론·마감일 같은 정보가 있는 경우가 많아서
// 완전히 앞만 자르는 것보다 정보 손실이 적습니다.
export const MAX_PROMPT_TEXT_CHARS = 60_000;

// 💡 [신규] "교수님" 탭 자료를 /api/chat의 배경 정보로 실을 때의 상한 — 사용자가 방금 첨부한
// 파일(위 60,000자)보다 훨씬 낮게 잡습니다. 첨부 파일은 "지금 이걸 봐달라"고 명시적으로 올린
// 것이지만 교수님 자료는 사용자가 요청하지 않아도 매 요청에 딸려가는 배경 정보라, 같은 예산을
// 줄 이유가 없습니다. 문서 하나가 통째로 예산을 먹어치우지 못하도록 문서별 상한(6,000자)과
// 블록 전체 상한(24,000자)을 함께 겁니다 — 문서별 상한만 있으면 문서 수에 비례해 무한정
// 커지고, 블록 상한만 있으면 첫 문서 하나가 나머지를 다 밀어냅니다.
export const MAX_PROFESSOR_DOC_CHARS = 6_000;
export const MAX_PROFESSOR_CONTEXT_CHARS = 24_000;

const ELLIPSIS_MARKER = '\n\n...(문서가 너무 길어 가운데 일부가 생략되었습니다)...\n\n';

// 💡 [수정] 반환값이 실제로 maxChars를 넘지 않도록 생략 표시 길이를 예산에서 먼저 뺍니다.
// 이전에는 앞 70% + 뒤 30%를 합쳐 정확히 maxChars를 남긴 뒤 그 사이에 생략 표시를 끼워 넣어서,
// 결과가 항상 maxChars + 표시 길이(약 40자)만큼 길었습니다. 호출부가 남은 예산을 계산해
// 여러 조각을 이어 붙이는 경우(app/api/chat의 교수님 자료 조립)에는 이 초과분이 조각마다
// 누적되어 상한을 실제로 넘깁니다 — "maxChars 이하"라는 이름값을 지키도록 고쳤습니다.
export function truncateForPrompt(text: string, maxChars = MAX_PROMPT_TEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  // 생략 표시조차 들어갈 수 없을 만큼 예산이 작으면 그냥 잘라냅니다.
  if (maxChars <= ELLIPSIS_MARKER.length) return text.slice(0, Math.max(0, maxChars));
  const budget = maxChars - ELLIPSIS_MARKER.length;
  const headChars = Math.floor(budget * 0.7);
  const tailChars = budget - headChars;
  return `${text.slice(0, headChars)}${ELLIPSIS_MARKER}${text.slice(-tailChars)}`;
}

// 💡 [신규] "예상 시험 문제" 재생성 시 프롬프트에 함께 넣는 "이미 출제한 문항 요약"의 상한.
// 재생성할수록 목록이 길어지므로 개수와 길이를 모두 제한합니다 — 오래된 문항까지 영원히
// 들고 갈 필요는 없고(최근 것들과 겹치지 않는 게 핵심), 요약 한 줄이 길어질 이유도 없습니다.
// 클라이언트(app/page.tsx)와 서버(app/api/analyze)가 같은 값을 씁니다.
export const MAX_AVOID_QUESTIONS = 40;
export const MAX_AVOID_QUESTION_CHARS = 60;

// 💡 [신규] /api/chat이 "최근 대화 기록"으로 싣는 지난 AI 답변의 길이 상한.
// 예전에는 내 질문(content)만 싣고 답변(response)은 아예 읽지 않아서, "아까 네가 말한 그거"
// 같은 후속 질문이 이어지지 않았습니다. 이제 답변도 함께 싣되 전문이 아니라 앞부분만
// 넣습니다 — 답변은 질문보다 훨씬 길어서(수천 자) 전문을 3건 실으면 배경 정보 대부분이
// 지난 답변으로 채워집니다. 맥락을 잇는 데는 무엇을 답했는지의 요지면 충분합니다.
export const MAX_RECENT_LOG_RESPONSE_CHARS = 200;
