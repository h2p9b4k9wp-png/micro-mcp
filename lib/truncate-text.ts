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

export function truncateForPrompt(text: string, maxChars = MAX_PROMPT_TEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  return `${text.slice(0, headChars)}\n\n...(문서가 너무 길어 가운데 일부가 생략되었습니다)...\n\n${text.slice(-tailChars)}`;
}
