// 💡 [신규] 클라이언트가 첨부 시점에 안내하는 것과 동일한 기준을 서버 API에서도 그대로
// 강제하기 위한 공용 상수 — API를 직접 호출하면 클라이언트 쪽 체크가 우회되므로, 서버에서도
// 같은 기준으로 거절해야 실제로 방어가 됩니다.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// 채팅창(물어보기)에서 한 번에 첨부할 수 있는 파일+이미지 개수 상한.
export const MAX_CHAT_ATTACHMENTS = 5;

// 로그인 없이 체험할 수 있는 /api/public-analyze 전용 상한 — 로그인 사용자(10MB)보다
// 훨씬 낮게 잡아, 남용 시 비용 노출을 최소화합니다.
export const MAX_ANONYMOUS_UPLOAD_BYTES = 3 * 1024 * 1024;
