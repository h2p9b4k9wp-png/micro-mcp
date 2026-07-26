import { NextResponse } from 'next/server';
import { extractFileText, FileExtractError } from '@/lib/file-text-extract';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.
// 파일 하나를 받아 텍스트만 뽑아 돌려줍니다. 실제 파일 판별·파싱은 lib/file-text-extract.ts를 공용으로 씁니다
// (/api/parse-deadlines도 동일한 함수를 사용합니다 — 파일 읽는 코드를 두 곳에 두지 않기 위함).

export async function POST(req: Request) {
  try {
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
