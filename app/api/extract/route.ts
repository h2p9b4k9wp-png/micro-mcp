import { NextResponse } from 'next/server';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.
// 파일 하나를 받아 텍스트만 뽑아 돌려줍니다. 파일 형식 판별·디코딩 로직은 /api/parse-deadlines와 동일합니다.

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

    // 💡 서버 단에서도 파일 크기 재검증 (클라이언트 체크를 우회해서 직접 API를 호출하는 경우 대비)
    const approxBytes = (content.length * 3) / 4;
    if (approxBytes > 15 * 1024 * 1024) {
      return NextResponse.json({ error: '파일이 너무 큽니다 (10MB 초과).' }, { status: 400 });
    }

    const lowerName = fileName.toLowerCase();
    const isTextLike =
      (mimeType && mimeType.startsWith('text/')) ||
      lowerName.endsWith('.ics') ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.txt') ||
      lowerName.endsWith('.ical');

    // ⚠️ 이 라우트는 텍스트 계열 파일만 처리합니다. 이미지·PDF·오피스 문서에서 글자를 뽑으려면 /api/chat의 문서 분석 블록을 이용하세요.
    if (!isTextLike) {
      return NextResponse.json(
        {
          error:
            '현재는 텍스트(.txt), 캘린더(.ics), CSV 파일에서만 글자를 뽑을 수 있어요.',
        },
        { status: 400 }
      );
    }

    const text = Buffer.from(content, 'base64').toString('utf-8');

    return NextResponse.json({ fileName, text });
  } catch (error: any) {
    console.error('파일 텍스트 추출 중 오류 발생:', error);
    return NextResponse.json(
      { error: error.message || '서버 통신 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
