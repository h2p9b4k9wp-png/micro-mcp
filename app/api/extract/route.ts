import { NextResponse } from 'next/server';
import { extractFileText, FileExtractError } from '@/lib/file-text-extract';
import { getSessionUserId } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.
// 파일 하나를 받아 텍스트만 뽑아 돌려줍니다. 실제 파일 판별·파싱은 lib/file-text-extract.ts를 씁니다.

export async function POST(req: Request) {
  try {
    // 💡 [수정] /api/chat과 동일하게 분당 10회로 제한합니다.
    const userId = await getSessionUserId();
    if (userId && !checkRateLimit(`extract:${userId}`, 10, 60_000)) {
      return NextResponse.json(
        { error: '요청이 너무 많아요. 잠시 후(1분 뒤) 다시 시도해주세요.' },
        { status: 429 }
      );
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
  } catch (error: any) {
    if (error instanceof FileExtractError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('파일 텍스트 추출 중 오류 발생:', error);
    return NextResponse.json(
      { error: error.message || '서버 통신 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
