// 💡 [신규] 게스트 세션 예산 상수 — lib/anonymous-usage.ts(서버 전용, next/headers의
// cookies()를 최상단에서 import함)와 값을 공유하기 위해 별도 파일로 뺐습니다. 당근 게이지
// (components/carrot-gauge.tsx)가 "남은/전체" 텍스트를 만들려면 클라이언트 컴포넌트에서도
// 전체 개수(총량)를 알아야 하는데, anonymous-usage.ts를 클라이언트 코드에서 직접 import하면
// next/headers가 클라이언트 번들에 섞여 들어가 빌드가 깨집니다(components/locale-switcher.tsx가
// i18n/request.ts 대신 i18n/locales.ts를 쓰는 것과 같은 이유 — CLAUDE.md 참고). 서버 쪽 실제
// 판정 로직도 이 파일의 값을 그대로 import해서 쓰므로 두 곳의 숫자가 어긋날 일이 없습니다.
export const SESSION_UPLOAD_LIMIT = 1;
export const SESSION_CHAT_TURN_LIMIT = 3;
