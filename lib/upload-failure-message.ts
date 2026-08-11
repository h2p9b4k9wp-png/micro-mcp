// 💡 [신규] 업로드 실패 안내 문구를 한 곳에서 만듭니다.
//
// 예전에는 실패 지점마다 문구가 제각각이었고("오류가 발생했습니다", 서버가 만든 한국어 문장을
// 그대로 노출 등) 정작 사용자가 알아야 할 숫자(내 파일이 몇 MB인지, 한도가 몇 MB인지)가
// 빠져 있었습니다. 세 곳(채팅 첨부·교수님 자료·내 파일)이 전부 다른 코드로 같은 실패를
// 다뤘기 때문에, 한 군데를 고쳐도 나머지 두 곳은 그대로였습니다.
//
// 서버(/api/extract)는 사람이 읽는 문장 대신 code와 숫자를 함께 내려주고, 실제 문장은 여기서
// 사용자 언어로 조립합니다.

export interface ExtractFailurePayload {
  code?: string;
  error?: string;
  sizeBytes?: number;
  maxBytes?: number;
  monthlyLimit?: number;
  // JSON이 아닌 응답(플랫폼 에러 페이지 등)에서 상태 코드만 알 수 있을 때 씁니다.
  status?: number;
  // /api/extract가 한도 도달 시 함께 주는 플래그 — 클라이언트가 업그레이드 모달을 띄우는 데 씁니다.
  limitReached?: boolean;
  limitType?: string;
  // 성공 응답의 추출 텍스트(같은 헬퍼로 함께 읽기 때문에 여기 둡니다).
  text?: string;
  fileName?: string;
  // 파싱 실패의 세부 사유(암호 걸린 한글, 옛 오피스 형식 등). 서버가 code로 내려줍니다.
  reasonCode?: string;
  format?: string | null;
  isPro?: boolean;
}

// "12.3MB" / "820KB" — 1MB 미만은 KB로 보여줍니다. 소수점 한 자리면 "이 파일이 얼마나
// 초과했는지" 감을 잡기에 충분하고, 그 이상은 읽기만 번거로워집니다.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  // 딱 떨어지는 값은 "5MB"로, 아니면 "12.3MB"로 — "5.0MB"는 읽는 데 방해만 됩니다.
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * 💡 [신규] 응답을 JSON으로 읽되, JSON이 아닐 때 절대 터지지 않게 합니다.
 *
 * 플랫폼(Vercel)이 요청 본문 크기 때문에 우리 코드 실행 전에 413을 반환하면 본문이 HTML
 * 에러 페이지입니다. 예전 코드는 상태·content-type을 보지 않고 곧바로 res.json()을 불러서
 * "Unexpected token 'R'"(Request Entity Too Large의 R) 같은 문구가 사용자에게 그대로
 * 보였습니다 — 파일이 크다는 사실은 어디에도 안 나오고요.
 *
 * 그래서 content-type을 먼저 확인하고, JSON이 아니면 상태 코드만으로 실패 종류를 정합니다.
 */
export async function readUploadResponse(
  res: Response
): Promise<{ ok: boolean; payload: ExtractFailurePayload }> {
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (isJson) {
    try {
      const data = (await res.json()) as ExtractFailurePayload;
      return { ok: res.ok, payload: data ?? {} };
    } catch {
      // content-type은 JSON이라고 했는데 본문이 깨진 경우(중간에 끊긴 응답 등).
      return { ok: false, payload: { code: 'http_status', status: res.status } };
    }
  }

  if (res.ok) {
    // 성공인데 JSON이 아닌 건 우리 라우트가 아닌 무언가가 응답했다는 뜻입니다.
    return { ok: false, payload: { code: 'http_status', status: res.status } };
  }

  if (res.status === 413) return { ok: false, payload: { code: 'platform_too_large' } };
  if (res.status === 504 || res.status === 524) return { ok: false, payload: { code: 'timeout' } };
  return { ok: false, payload: { code: 'http_status', status: res.status } };
}

/**
 * 서버 응답(또는 클라이언트에서 먼저 걸린 경우의 payload)을 사용자 언어 안내 문구로 바꿉니다.
 * 모르는 code는 서버가 준 문장을 그대로 쓰고, 그것마저 없으면 일반 실패 문구로 떨어집니다 —
 * 새 실패 유형이 생겨도 화면이 비어버리지 않게 하기 위함입니다.
 */
export function buildUploadFailureMessage(
  t: Translate,
  fileName: string,
  payload: ExtractFailurePayload,
  // 플랫폼 상한 안내에 쓸 값 — 호출부(app/page.tsx)가 실효 상한을 넘겨줍니다.
  maxRequestFileBytes = 0,
  // Pro 등급의 "실효" 상한. 이 값이 현재 상한보다 커야 업그레이드 안내가 의미가 있습니다.
  proEffectiveMaxBytes = 0
): string {
  const { code } = payload;

  if (code === 'too_large' && payload.sizeBytes != null && payload.maxBytes != null) {
    const base = t('upload.errors.tooLarge', {
      fileName,
      size: formatBytes(payload.sizeBytes),
      max: formatBytes(payload.maxBytes),
    });
    // 💡 [수정] 업그레이드 안내는 "Pro면 실제로 더 큰 파일이 되는 경우"에만 붙입니다.
    // 지금은 플랫폼 요청 본문 상한이 등급 상한보다 낮아 Pro도 같은 크기에서 막히므로,
    // 이 안내가 뜨면 거짓말이 됩니다(결제해도 안 됨).
    const proHelps =
      !payload.isPro && proEffectiveMaxBytes > 0 && payload.maxBytes < proEffectiveMaxBytes;
    return proHelps ? `${base} ${t('upload.errors.tooLargeUpgradeHint')}` : base;
  }

  if (code === 'empty_text') {
    // 형식을 알면 "PPTX에서" 처럼 짚어주고, 모르면 "이 파일에서"로 둡니다.
    return payload.format
      ? t('upload.errors.emptyTextWithFormat', { fileName, format: payload.format.toUpperCase() })
      : t('upload.errors.emptyText', { fileName });
  }

  if (code === 'quota_exceeded' && payload.monthlyLimit != null) {
    return t('upload.errors.quotaExceeded', { fileName, limit: payload.monthlyLimit });
  }

  if (code === 'rate_limited') return t('upload.errors.rateLimited');

  // 💡 [신규] 플랫폼이 우리 코드 실행 전에 거절한 경우 — 우리가 아는 건 "너무 크다"뿐이라
  // 파일별 실제 크기 대신 허용 상한만 알려줍니다.
  if (code === 'platform_too_large') {
    return t('upload.errors.platformTooLarge', { fileName, max: formatBytes(maxRequestFileBytes) });
  }

  if (code === 'timeout') return t('upload.errors.timeout', { fileName });

  // 💡 [신규] 브라우저 → Storage 업로드 자체가 실패한 경우(네트워크 끊김, 버킷 정책 등).
  // 서버는 이 파일을 본 적조차 없으므로 "처리 실패"와는 다른 안내가 필요합니다.
  if (code === 'storage_upload_failed') return t('upload.errors.storageUploadFailed', { fileName });

  // 서버가 경로를 받았는데 그 객체를 못 찾은 경우 — 업로드가 중간에 끊겼을 때 주로 납니다.
  if (code === 'storage_missing') return t('upload.errors.storageMissing', { fileName });

  if (code === 'http_status') {
    return t('upload.errors.httpStatus', { fileName, status: payload.status ?? 0 });
  }

  if (code === 'parse_failed') {
    // 형식별 세부 사유는 번역 키가 있으면 사용자 언어로, 없으면 서버 원문으로 떨어집니다.
    // (서버 원문은 한국어라, 번역 키가 있는 쪽이 항상 우선입니다.)
    const known = ['hwp_too_old', 'hwp_encrypted', 'legacy_office', 'too_large', 'corrupt'];
    const reason =
      payload.reasonCode && known.includes(payload.reasonCode)
        ? t(`upload.errors.reasons.${payload.reasonCode}`)
        : payload.error || '';
    return t('upload.errors.parseFailed', { fileName, reason });
  }

  if (code === 'server_error') return t('upload.errors.serverError', { fileName });

  return payload.error
    ? t('upload.errors.generic', { fileName, error: payload.error })
    : t('upload.errors.unknown', { fileName });
}
