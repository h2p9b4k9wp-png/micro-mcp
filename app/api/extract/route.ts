import { NextResponse } from 'next/server';
import { extractFileText, FileExtractError, resolveFileExtension } from '@/lib/file-text-extract';
import { getSessionSupabase } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkFileQuota, getPlanLimits, PRO_PRICE_LABEL } from '@/lib/plan-limits';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.
// 파일 하나를 받아 텍스트만 뽑아 돌려줍니다. 실제 파일 판별·파싱은 lib/file-text-extract.ts를 씁니다.

// 💡 [신규] 실패 원인을 기계가 읽을 수 있는 code로도 함께 돌려줍니다. 클라이언트가 이 code로
// 사용자 언어에 맞는 안내를 조립합니다 — 예전엔 서버가 만든 한국어 문장 하나만 내려줘서
// 다른 언어 사용자에게도 한국어가 그대로 보였고, "몇 MB인지/얼마나 남았는지" 같은 숫자도
// 문장 안에 묻혀 있어 클라이언트가 다시 쓸 수 없었습니다.
export type ExtractFailureCode =
  | 'rate_limited'
  | 'quota_exceeded'
  | 'too_large'
  | 'no_content'
  | 'parse_failed'
  | 'empty_text'
  | 'server_error';

// 💡 [신규] 업로드 실패를 서버 로그에 한 줄로 남깁니다 — 어떤 형식·크기에서 주로 실패하는지
// 나중에 확인할 수 있도록. 파일명은 개인정보가 섞일 수 있어 확장자만 남기고, 크기는 KB
// 단위로 반올림합니다.
function logExtractFailure(
  code: ExtractFailureCode,
  info: { fileName?: string; mimeType?: string; approxBytes?: number; isPro?: boolean; detail?: string }
) {
  const ext = info.fileName ? resolveFileExtension(info.fileName, info.mimeType) || '(확장자 없음)' : '(파일명 없음)';
  const kb = info.approxBytes != null ? Math.round(info.approxBytes / 1024) : null;
  console.warn(
    `[extract] 업로드 실패 code=${code} ext=${ext} mime=${info.mimeType || '-'} size=${kb != null ? kb + 'KB' : '-'} isPro=${info.isPro ?? '-'}` +
      (info.detail ? ` detail=${info.detail}` : '')
  );
}

export async function POST(req: Request) {
  // catch 블록에서도 파일 정보를 로그에 남길 수 있도록 바깥에 둡니다.
  let logFileName: string | undefined;
  let logMimeType: string | undefined;
  let logBytes: number | undefined;
  let logIsPro: boolean | undefined;
  try {
    // 💡 [수정] /api/chat과 동일하게 분당 10회로 제한합니다.
    const { supabase, userId } = await getSessionSupabase();
    if (userId && !checkRateLimit(`extract:${userId}`, 10, 60_000)) {
      logExtractFailure('rate_limited', {});
      return NextResponse.json(
        { error: '요청이 너무 많아요. 잠시 후(1분 뒤) 다시 시도해주세요.', code: 'rate_limited' },
        { status: 429 }
      );
    }

    // 💡 [신규] 유료 전환 준비 — 월간 파일 처리 한도(무료/Pro). checkFileQuota를
    // /api/upload-quota와 공유합니다 — 채팅 이미지 첨부처럼 이 라우트를 거치지 않는 경로는
    // 그쪽에서 같은 함수로 검사합니다. isPro는 아래 파일 크기 상한(무료 5MB/Pro 20MB)에도
    // 그대로 재사용해 profiles를 두 번 조회하지 않습니다.
    let isPro = false;
    if (userId) {
      const quota = await checkFileQuota(supabase, userId);
      if (!quota.ok) {
        logExtractFailure('quota_exceeded', { isPro: quota.isPro, detail: `limit=${quota.limit}` });
        return NextResponse.json(
          {
            error: quota.error,
            code: 'quota_exceeded',
            limitReached: true,
            limitType: 'file',
            // 클라이언트가 "이번 달 N회 중 N회를 다 썼어요"를 자기 언어로 조립할 수 있게
            // 숫자를 문장이 아니라 필드로도 내려줍니다.
            monthlyLimit: quota.limit,
            isPro: quota.isPro ?? false,
          },
          { status: 403 }
        );
      }
      isPro = quota.isPro ?? false;
      logIsPro = isPro;
    }

    const body = await req.json();
    const { fileName, mimeType, content } = body as {
      fileName?: string;
      mimeType?: string;
      content?: string; // base64
    };

    logFileName = fileName;
    logMimeType = mimeType;

    if (!content || !fileName) {
      logExtractFailure('no_content', { fileName, mimeType });
      return NextResponse.json({ error: '파일 내용이 없습니다.', code: 'no_content' }, { status: 400 });
    }

    // 💡 [신규] 클라이언트는(app/page.tsx) 첨부 시점에 파일 크기를 안내하지만, 이 API를 직접
    // 호출하면 그 안내가 적용되지 않습니다. base64 길이로 대략적인 바이트 수를 먼저 확인해
    // 무료 5MB/Pro 20MB 상한을 넘는 페이로드는 굳이 파싱을 시도하지 않고 빠르게 거절합니다.
    const maxUploadBytes = getPlanLimits(isPro).maxUploadBytes;
    const approxBytes = (content.length * 3) / 4;
    logBytes = approxBytes;
    if (approxBytes > maxUploadBytes) {
      const maxMB = Math.round(maxUploadBytes / (1024 * 1024));
      logExtractFailure('too_large', { fileName, mimeType, approxBytes, isPro });
      return NextResponse.json(
        {
          error: `파일이 너무 큽니다 (${maxMB}MB 초과). 더 작은 파일로 시도해주세요.${isPro ? '' : ` Upgrade to Pro — ${PRO_PRICE_LABEL}`}`,
          code: 'too_large',
          // 숫자를 그대로 내려서 클라이언트가 "이 파일은 12.3MB인데 최대 5MB까지예요"처럼
          // 실제 크기와 함께 안내할 수 있게 합니다.
          sizeBytes: Math.round(approxBytes),
          maxBytes: maxUploadBytes,
          isPro,
          limitReached: true,
          limitType: 'file',
        },
        { status: 413 }
      );
    }

    const text = await extractFileText(fileName, mimeType, content);

    // 💡 [신규] 파싱은 성공했는데 글자가 하나도 안 나온 경우. 예전에는 빈 문자열을 그대로
    // 200으로 돌려줘서, 클라이언트가 내용 없는 첨부를 조용히 붙이고 사용자는 "왜 아무것도
    // 모르지?"만 겪었습니다. 이미지로만 이뤄진 PPTX·스캔 PDF가 대표적입니다.
    if (!text || !text.trim()) {
      const ext = resolveFileExtension(fileName, mimeType);
      logExtractFailure('empty_text', { fileName, mimeType, approxBytes, isPro });
      return NextResponse.json(
        {
          error: '파일에서 글자를 찾지 못했어요. 이미지로만 이뤄진 슬라이드나 스캔 문서는 아직 글자를 읽지 못합니다.',
          code: 'empty_text',
          format: ext || null,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ fileName, text });
  } catch (error) {
    if (error instanceof FileExtractError) {
      logExtractFailure('parse_failed', {
        fileName: logFileName,
        mimeType: logMimeType,
        approxBytes: logBytes,
        isPro: logIsPro,
        detail: `${error.code}: ${error.message}`,
      });
      // FileExtractError는 lib/file-text-extract.ts가 형식별 실패 원인을 직접 한국어로
      // 작성해 던지는 것이라(암호화된 hwp, 지원하지 않는 버전 등) 그대로 보여줘도 안전합니다.
      return NextResponse.json(
        { error: error.message, code: 'parse_failed', reasonCode: error.code },
        { status: 400 }
      );
    }
    // 💡 [수정] 그 외의 예상 못한 예외는 하위 라이브러리의 영어 에러 원문이 그대로 노출될 수
    // 있어 고정된 한국어 안내 문구로 바꾸고, 상세 내용은 서버 로그에만 남깁니다.
    console.error('파일 텍스트 추출 중 오류 발생:', error);
    logExtractFailure('server_error', {
      fileName: logFileName,
      mimeType: logMimeType,
      approxBytes: logBytes,
      isPro: logIsPro,
      detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
    return NextResponse.json(
      { error: '파일을 처리하지 못했어요. 잠시 후 다시 시도해주세요.', code: 'server_error' },
      { status: 500 }
    );
  }
}
