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

// 💡 [신규] 플랫폼(Vercel) 요청 본문 상한.
//
// Vercel 서버리스 함수는 요청 본문이 약 4.5MB를 넘으면 우리 코드가 실행되기도 전에 플랫폼
// 단에서 413을 반환합니다. 그 응답은 JSON이 아니라 HTML 에러 페이지라, 클라이언트가 곧바로
// res.json()을 부르면 "Unexpected token 'R'"(Request Entity Too Large의 첫 글자) 같은
// 의미 없는 오류가 사용자에게 그대로 보입니다.
//
// ⚠️ 이 앱은 파일을 base64로 감싸 JSON에 실어 보냅니다. base64는 원본보다 약 4/3배 커지므로,
// "올릴 수 있는 실제 파일 크기"는 4.5MB가 아니라 그보다 훨씬 작습니다. 이 계산을 안 하면
// 등급별 상한(무료 5MB)이 플랫폼 상한보다 커져서, 3.3~5MB 파일은 우리 안내 없이 무조건
// 플랫폼 413으로 죽습니다 — 실제로 그렇게 되고 있었습니다.
export const PLATFORM_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

// base64 팽창분(4/3)과 JSON 필드(fileName·mimeType·따옴표 등) 여유를 함께 뺀, 실제로 보낼 수
// 있는 원본 파일 크기입니다. 0.95는 그 여유분입니다.
export const MAX_REQUEST_FILE_BYTES = Math.floor((PLATFORM_BODY_LIMIT_BYTES * 0.95 * 3) / 4);

// 등급 상한과 플랫폼 상한 중 더 작은 값이 실제 상한입니다. 화면 안내와 사전 검사 모두
// 이 값을 써야 "안내한 크기는 되는데 실제로는 실패"가 생기지 않습니다.
export function getEffectiveUploadLimitBytes(planMaxBytes: number): number {
  return Math.min(planMaxBytes, MAX_REQUEST_FILE_BYTES);
}
