// 브라우저 언어(navigator.language, 예: "ko-KR")를 영어 언어 이름(예: "Korean")으로 변환합니다.
// /api/chat·/api/public-chat 등에 보내는 responseLanguage 값은 프롬프트에 그대로 꽂혀
// 들어가므로("Respond entirely in {language}") 사람이 읽는 영어 이름이어야 모델이 정확히
// 해석합니다. app/page.tsx(로그인 사용자, 계정별로 저장)와 app/login/page.tsx(게스트 채팅
// 체험, 매번 새로 감지)가 함께 씁니다.
export function detectBrowserLanguageName(): string {
  if (typeof navigator === 'undefined') return 'English';
  try {
    const tag = navigator.language || 'en';
    const base = tag.split('-')[0];
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    return displayNames.of(base) || 'English';
  } catch {
    return 'English';
  }
}
