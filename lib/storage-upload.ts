import type { SupabaseClient } from '@supabase/supabase-js';

// 💡 [신규] 브라우저에서 Supabase Storage로 파일을 직접 올리고, 서버에는 그 "경로"만 넘기기
// 위한 공용 헬퍼입니다.
//
// 왜 이렇게 바뀌었나:
// 예전에는 파일을 base64로 바꿔 JSON 본문에 담아 /api/extract로 보냈습니다. 그런데 Vercel
// 서버리스 함수는 요청 본문이 약 4.5MB를 넘으면 우리 코드가 실행되기도 전에 플랫폼이 413을
// 돌려줍니다. base64는 원본보다 4/3 크므로 실제로 올릴 수 있는 파일은 3.2MB 남짓이었고,
// 등급별 상한(무료 5MB / Pro 20MB)은 도달할 수 없는 숫자였습니다.
//
// 이제 파일 바이트는 브라우저에서 Supabase Storage로 바로 갑니다 — Vercel 함수를 아예 지나지
// 않으므로 그 상한과 무관합니다. 서버는 경로 문자열 하나만 받아 Storage에서 내려받습니다.
//
// 보안: 버킷은 비공개이고, storage.objects 정책이 "경로의 첫 폴더가 자기 auth.uid()인 객체"만
// 읽기/쓰기/삭제하도록 제한합니다(supabase/migrations/20260822_create_uploads_bucket.sql).
// 그래서 남의 파일 경로를 서버에 넘겨도 세션 클라이언트로는 내려받히지 않습니다.

export const UPLOAD_BUCKET = 'uploads';

export class StorageUploadError extends Error {}

// 💡 Storage 객체 키에는 원본 파일명을 쓰지 않습니다.
//
// 이 앱의 파일명은 대부분 한글이고 공백·괄호도 흔한데(`3주차 강의자료(수정).pdf`), Storage 키로
// 쓰면 인코딩 문제로 조용히 실패하거나 나중에 경로를 다시 못 찾는 경우가 생깁니다. 진짜
// 파일명은 어차피 요청 본문의 fileName 필드로 따로 보내고(형식 판별도 그걸로 합니다),
// 여기서는 충돌하지 않는 임의 키에 확장자만 남깁니다.
function buildObjectPath(userId: string, fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${userId}/${id}${ext ? `.${ext}` : ''}`;
}

/**
 * 파일을 Storage에 올리고 객체 경로를 돌려줍니다. 실패하면 StorageUploadError를 던집니다.
 *
 * 업로드된 객체는 /api/extract가 텍스트를 뽑은 직후 서버에서 삭제합니다 — 원본을 계속 보관할
 * 이유가 없고(필요한 건 뽑아낸 글자뿐, documents.content에 따로 저장됩니다) 보관비가 매달
 * 쌓이기 때문입니다. 추출 요청이 아예 오지 않은 고아 객체는 하루 한 번 크론이 치웁니다
 * (app/api/cron/cleanup-uploads).
 */
export async function uploadFileToStorage(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<string> {
  const path = buildObjectPath(userId, file.name);
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new StorageUploadError(error.message);
  return path;
}

/**
 * 서버가 받은 경로가 정말 그 사용자의 폴더 안인지 확인합니다.
 *
 * Storage 정책만으로도 남의 파일은 내려받히지 않지만, 그 경우 "권한 없음"이 아니라 "파일 없음"에
 * 가까운 에러로 뭉뚱그려지고 로그에도 남지 않습니다. 서버에서 먼저 형태를 확인해두면 잘못된
 * 경로가 왔다는 사실 자체를 명확히 알 수 있습니다.
 */
export function isOwnedStoragePath(path: string, userId: string): boolean {
  if (typeof path !== 'string' || path.length === 0 || path.length > 300) return false;
  if (path.includes('..')) return false;
  return path.startsWith(`${userId}/`) && path.slice(userId.length + 1).length > 0;
}
