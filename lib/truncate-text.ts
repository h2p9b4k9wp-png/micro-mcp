// 💡 [신규] 추출된 문서 텍스트가 지나치게 길면 OpenAI에 보내는 프롬프트 토큰(=비용)이
// 그대로 커집니다. 6만 자를 넘으면 앞부분(70%)과 뒷부분(30%)만 남기고 가운데를 생략합니다 —
// 앞부분엔 대체로 핵심 도입부·목차가, 뒷부분엔 결론·마감일 같은 정보가 있는 경우가 많아서
// 완전히 앞만 자르는 것보다 정보 손실이 적습니다.
export const MAX_PROMPT_TEXT_CHARS = 60_000;

export function truncateForPrompt(text: string, maxChars = MAX_PROMPT_TEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  return `${text.slice(0, headChars)}\n\n...(문서가 너무 길어 가운데 일부가 생략되었습니다)...\n\n${text.slice(-tailChars)}`;
}
