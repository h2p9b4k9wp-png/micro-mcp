// 채팅 첨부 이미지(app/page.tsx)와 게스트 가이드 체험 이미지 업로드
// (components/guest-guided-trial.tsx)가 공유하는 이미지 제약/유틸입니다. 원래 app/page.tsx에만
// 있었는데, 로그인 없는 체험에도 이미지 업로드가 생기면서 같은 규칙(허용 형식, 다운스케일)을
// 두 번 구현하지 않도록 여기로 뺐습니다. 브라우저 전용 API(Image, canvas)를 쓰므로 클라이언트
// 컴포넌트에서만 import하세요.

// GPT-4.1 mini 비전이 내부적으로 다운스케일하는 기준과 맞춰, 그 이상은 보내봐야 비용만
// 늘고 품질 이득이 없습니다.
export const CHAT_IMAGE_MAX_EDGE = 1568;

// OpenAI 비전이 실제로 받는 이미지 형식. 아이폰 기본 사진 형식인 HEIC/HEIF는 목록에 없음 —
// 브라우저가 대신 변환해주지 않는 경우, 그대로 보내면 비전 모델이 못 읽어서 "분석이 안 되는데
// 이유를 알 수 없는" 상황이 됩니다. 업로드 시점에 걸러서 바로 안내합니다.
export const SUPPORTED_CHAT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];

// 💡 폰으로 찍은 사진처럼 큰 이미지를 GPT-4.1 mini에 보내기 전에 긴 변 기준
// CHAT_IMAGE_MAX_EDGE로 줄여서 base64 용량(=토큰 비용)을 낮춥니다. 이미 그보다 작으면(대부분의
// 스크린샷) 원본 포맷을 그대로 유지 — 리사이즈 과정에서 JPEG로 다시 인코딩되면 투명 배경이 깨질
// 수 있어서, 정말 큰 이미지만 다시 인코딩합니다. 디코딩 자체가 실패하면 원본을 그대로 씁니다.
export function resizeImageDataUrl(dataUrl: string, maxEdge = CHAT_IMAGE_MAX_EDGE): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const longEdge = Math.max(img.width, img.height);
      if (longEdge <= maxEdge) {
        resolve(dataUrl);
        return;
      }
      const scale = maxEdge / longEdge;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
