import { NextResponse } from 'next/server';
import { extractFileText, FileExtractError } from '@/lib/file-text-extract';
import { getSessionUserId } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.
// 파일 하나를 받아 텍스트만 뽑아 돌려줍니다. 실제 파일 판별·파싱은 lib/file-text-extract.ts를 씁니다.

export async function POST(req: Request) {
  try {
    // 💡 [신규] OpenAI 호출은 없지만 xlsx/officeparser/tesseract.js 등 파싱 자체가 서버
    // 자원을 쓰므로, 여러 파일을 한꺼번에 순차 호출하는 정상 업로드 흐름은 넉넉히 허용하되
    // (분당 30회) 자동화된 폭주성 호출은 막습니다.
    const userId = await getSessionUserId();
    if (userId && !checkRateLimit(`extract:${userId}`, 30, 60_000)) {
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
