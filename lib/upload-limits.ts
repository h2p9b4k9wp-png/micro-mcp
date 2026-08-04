// 💡 [신규] 클라이언트가 첨부 시점에 안내하는 것과 동일한 기준을 서버 API에서도 그대로
// 강제하기 위한 공용 상수 — API를 직접 호출하면 클라이언트 쪽 체크가 우회되므로, 서버에서도
// 같은 기준으로 거절해야 실제로 방어가 됩니다.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// 채팅창(물어보기)에서 한 번에 첨부할 수 있는 파일+이미지 개수 상한.
export const MAX_CHAT_ATTACHMENTS = 5;

// 로그인 없이 체험할 수 있는 /api/public-analyze 전용 상한 — 로그인 사용자(10MB)보다
// 훨씬 낮게 잡아, 남용 시 비용 노출을 최소화합니다.
export const MAX_ANONYMOUS_UPLOAD_BYTES = 3 * 1024 * 1024;

// 💡 [신규] 게스트 라우트(public-analyze/public-chat/public-guided-trial)가 요청 body에서
// 받는 fileName 문자열의 길이 상한. content(파일 본문)는 바이트 크기를 체크하지만 fileName
// 자체는 별도 필드라 그 체크를 안 거칩니다 — 특히 /api/public-chat은 첨부 파일명을
// `[Attached file: ...]`로 프롬프트에 그대로 꽂아 넣는데, fileName에 상한이 없으면 실제
// 파일 크기와 무관하게 fileName 자체를 아주 긴 문자열로 보내 프롬프트(=토큰 비용)를
// 부풀릴 수 있었습니다. 정상적인 파일명은 이 상한을 넘을 이유가 없으므로, 넘으면 그냥
// 잘라서 사용합니다(공격 벡터를 막는 게 목적이라 사용자에게 별도 에러를 보여줄 필요는 없음).
export const MAX_ANONYMOUS_FILENAME_CHARS = 200;
