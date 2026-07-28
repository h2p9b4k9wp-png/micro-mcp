import { NextResponse } from 'next/server';
import { extractFileText, FileExtractError } from '@/lib/file-text-extract';
import { getSessionSupabase } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits';
import { checkFileQuota } from '@/lib/plan-limits';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.
// 파일 하나를 받아 텍스트만 뽑아 돌려줍니다. 실제 파일 판별·파싱은 lib/file-text-extract.ts를 씁니다.

export async function POST(req: Request) {
  try {
    // 💡 [수정] /api/chat과 동일하게 분당 10회로 제한합니다.
    const { supabase, userId } = await getSessionSupabase();
    if (userId && !checkRateLimit(`extract:${userId}`, 10, 60_000)) {
      return NextResponse.json(
        { error: '요청이 너무 많아요. 잠시 후(1분 뒤) 다시 시도해주세요.' },
        { status: 429 }
      );
    }

    // 💡 [신규] 유료 전환 준비 — 월간 파일 처리 한도(무료/Pro). checkFileQuota를
    // /api/upload-quota와 공유합니다 — 채팅 이미지 첨부처럼 이 라우트를 거치지 않는 경로는
    // 그쪽에서 같은 함수로 검사합니다.
    if (userId) {
      const quota = await checkFileQuota(supabase, userId);
      if (!quota.ok) {
        return NextResponse.json(
          { error: quota.error, limitReached: true, limitType: 'file' },
          { status: 403 }
        );
      }
    }

    const body = await req.json();
    const { fileName, mimeType, content } = body as {
      fileName?: string;
      mimeType?: string;
      content?: string; // base64
    };

    if (!content || !fileName) {
      return NextResponse.json({ error: '파일 내용이 없습니다.' }, { status: 400 });
    }

    // 💡 [신규] 클라이언트는 10MB 초과 파일을 첨부 시점에 걸러 안내하지만, 이 API를 직접
    // 호출하면 그 제한이 적용되지 않습니다. base64 길이로 대략적인 바이트 수를 먼저 확인해
    // 큰 페이로드는 굳이 파싱을 시도하지 않고 빠르게 거절합니다.
    const approxBytes = (content.length * 3) / 4;
    if (approxBytes > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: '파일이 너무 큽니다 (10MB 초과). 더 작은 파일로 시도해주세요.' },
        { status: 413 }
      );
    }

    const text = await extractFileText(fileName, mimeType, content);

    return NextResponse.json({ fileName, text });
  } catch (error) {
    if (error instanceof FileExtractError) {
      // FileExtractError는 lib/file-text-extract.ts가 형식별 실패 원인을 직접 한국어로
      // 작성해 던지는 것이라(암호화된 hwp, 지원하지 않는 버전 등) 그대로 보여줘도 안전합니다.
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // 💡 [수정] 그 외의 예상 못한 예외는 하위 라이브러리의 영어 에러 원문이 그대로 노출될 수
    // 있어 고정된 한국어 안내 문구로 바꾸고, 상세 내용은 서버 로그에만 남깁니다.
    console.error('파일 텍스트 추출 중 오류 발생:', error);
    return NextResponse.json(
      { error: '파일을 처리하지 못했어요. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
