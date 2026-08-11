import { NextResponse } from 'next/server';
import {
  extractFileText,
  extractFileTextFromBuffer,
  FileExtractError,
  resolveFileExtension,
} from '@/lib/file-text-extract';
import { getSessionSupabase } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkFileQuota, getPlanLimits, PRO_PRICE_LABEL } from '@/lib/plan-limits';
import { UPLOAD_BUCKET, isOwnedStoragePath } from '@/lib/storage-upload';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.
// 파일 하나를 받아 텍스트만 뽑아 돌려줍니다. 실제 파일 판별·파싱은 lib/file-text-extract.ts를 씁니다.
//
// 💡 [수정] 파일을 받는 방법이 두 가지입니다.
//   (1) storagePath — 로그인 사용자의 기본 경로. 브라우저가 Supabase Storage에 직접 올린 뒤
//       경로만 보냅니다. 요청 본문이 수백 바이트라 Vercel의 4.5MB 본문 상한과 무관합니다.
//   (2) content(base64) — 예전 방식. 아직 남겨두는 이유는 배포 중 잠깐 옛 클라이언트가 살아있는
//       구간이 있기 때문입니다. 이 경로는 여전히 본문 상한을 타므로 3.2MB 남짓이 한계입니다.
//
// 큰 PDF는 파싱에 수십 초·1GB 이상이 들 수 있어(23MB PDF ≈ 950MB/20초, 55MB PDF ≈ 1.9GB/50초
// 실측) 실행 시간을 늘려 잡습니다. 메모리는 코드로 지정할 수 없어 vercel.json에서 올립니다.
export const maxDuration = 300;

// 💡 [신규] 실패 원인을 기계가 읽을 수 있는 code로도 함께 돌려줍니다. 클라이언트가 이 code로
// 사용자 언어에 맞는 안내를 조립합니다 — 예전엔 서버가 만든 한국어 문장 하나만 내려줘서
// 다른 언어 사용자에게도 한국어가 그대로 보였고, "몇 MB인지/얼마나 남았는지" 같은 숫자도
// 문장 안에 묻혀 있어 클라이언트가 다시 쓸 수 없었습니다.
export type ExtractFailureCode =
  | 'rate_limited'
  | 'quota_exceeded'
  | 'too_large'
  | 'no_content'
  // Storage에 올렸다는 경로를 받았는데 실제로 내려받지 못한 경우(경로가 남의 것이거나,
  // 업로드가 끝나기 전이거나, 이미 지워졌거나).
  | 'storage_missing'
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
    const { fileName, mimeType, content, storagePath } = body as {
      fileName?: string;
      mimeType?: string;
      content?: string; // base64 (구 방식)
      storagePath?: string; // Storage 객체 경로 (기본 방식)
    };

    logFileName = fileName;
    logMimeType = mimeType;

    if (!fileName || (!content && !storagePath)) {
      logExtractFailure('no_content', { fileName, mimeType });
      return NextResponse.json({ error: '파일 내용이 없습니다.', code: 'no_content' }, { status: 400 });
    }

    const maxUploadBytes = getPlanLimits(isPro).maxUploadBytes;

    // 크기 초과 응답은 두 경로가 완전히 같아야 하므로 한 곳에서 만듭니다.
    const tooLargeResponse = (approxBytes: number) => {
      const maxMB = Math.round(maxUploadBytes / (1024 * 1024));
      logExtractFailure('too_large', { fileName, mimeType, approxBytes, isPro });
      return NextResponse.json(
        {
          error: `파일이 너무 큽니다 (${maxMB}MB 초과). 더 작은 파일로 시도해주세요.${isPro ? '' : ` Upgrade to Pro — ${PRO_PRICE_LABEL}`}`,
          code: 'too_large',
          // 숫자를 그대로 내려서 클라이언트가 "이 파일은 12.3MB인데 최대 30MB까지예요"처럼
          // 실제 크기와 함께 안내할 수 있게 합니다.
          sizeBytes: Math.round(approxBytes),
          maxBytes: maxUploadBytes,
          isPro,
          limitReached: true,
          limitType: 'file',
        },
        { status: 413 }
      );
    };

    let text: string;

    if (storagePath) {
      // 💡 남의 경로를 넘겨도 아래 download는 RLS 정책 때문에 어차피 실패하지만, 형태를 먼저
      // 확인해두면 "권한 문제로 실패했다"는 사실이 로그에 명확히 남습니다.
      if (!userId || !isOwnedStoragePath(storagePath, userId)) {
        logExtractFailure('storage_missing', { fileName, mimeType, isPro, detail: 'path not owned' });
        return NextResponse.json(
          { error: '업로드한 파일을 찾지 못했어요. 다시 시도해주세요.', code: 'storage_missing' },
          { status: 400 }
        );
      }

      const { data: blob, error: downloadError } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .download(storagePath);

      if (downloadError || !blob) {
        logExtractFailure('storage_missing', {
          fileName,
          mimeType,
          isPro,
          detail: downloadError?.message?.slice(0, 120) || 'no blob',
        });
        return NextResponse.json(
          { error: '업로드한 파일을 찾지 못했어요. 다시 시도해주세요.', code: 'storage_missing' },
          { status: 404 }
        );
      }

      try {
        // Storage의 file_size_limit이 이미 100MB에서 막지만, 등급별 상한(무료 30MB)은 앱만
        // 알고 있으므로 여기서 한 번 더 봅니다. blob.size는 실제 바이트라 base64 추정보다 정확합니다.
        logBytes = blob.size;
        if (blob.size > maxUploadBytes) return tooLargeResponse(blob.size);

        const buffer = Buffer.from(await blob.arrayBuffer());
        text = await extractFileTextFromBuffer(fileName, mimeType, buffer, maxUploadBytes);
      } finally {
        // 💡 원본은 여기서 끝입니다 — 추출에 성공했든 실패했든 남겨둘 이유가 없습니다.
        // 앱이 이후에 쓰는 건 뽑아낸 글자뿐이고(교수님 자료는 documents.content에 따로 저장,
        // 채팅 첨부는 브라우저 상태로만 존재), 원본을 계속 들고 있으면 보관비가 매달 쌓이고
        // 강의자료·시험지가 계속 남는 개인정보 부담까지 생깁니다.
        //
        // finally에 둔 이유: 파싱 실패로 빠져나가는 경로가 더 흔한데, 그때 안 지우면 실패한
        // 파일만 영원히 쌓입니다. 삭제 실패는 요청을 망치지 않고 로그만 남깁니다 — 그런 객체는
        // 하루 한 번 크론(app/api/cron/cleanup-uploads)이 치웁니다.
        const { error: removeError } = await supabase.storage.from(UPLOAD_BUCKET).remove([storagePath]);
        if (removeError) {
          console.warn(`[extract] 원본 삭제 실패 path=${storagePath} detail=${removeError.message}`);
        }
      }
    } else {
      // 구 방식(base64 본문). 문자열 길이로 대략적인 바이트 수를 먼저 확인해, 상한을 넘는
      // 페이로드는 굳이 디코딩·파싱을 시도하지 않고 빠르게 거절합니다.
      const approxBytes = (content!.length * 3) / 4;
      logBytes = approxBytes;
      if (approxBytes > maxUploadBytes) return tooLargeResponse(approxBytes);
      text = await extractFileText(fileName, mimeType, content!, maxUploadBytes);
    }

    // 💡 [신규] 파싱은 성공했는데 글자가 하나도 안 나온 경우. 예전에는 빈 문자열을 그대로
    // 200으로 돌려줘서, 클라이언트가 내용 없는 첨부를 조용히 붙이고 사용자는 "왜 아무것도
    // 모르지?"만 겪었습니다. 이미지로만 이뤄진 PPTX·스캔 PDF가 대표적입니다.
    if (!text || !text.trim()) {
      const ext = resolveFileExtension(fileName, mimeType);
      logExtractFailure('empty_text', { fileName, mimeType, approxBytes: logBytes, isPro });
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
