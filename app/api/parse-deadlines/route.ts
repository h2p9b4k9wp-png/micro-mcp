import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '[ERROR] GEMINI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
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

    const lowerName = fileName.toLowerCase();
    const isTextLike =
      (mimeType && mimeType.startsWith('text/')) ||
      lowerName.endsWith('.ics') ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.txt') ||
      lowerName.endsWith('.ical');
    const isSupportedBinary =
      (mimeType && mimeType.startsWith('image/')) || mimeType === 'application/pdf';

    if (!isTextLike && !isSupportedBinary) {
      return NextResponse.json(
        {
          error:
            '아직 이 파일 형식은 지원하지 않아요. 이미지(사진/스크린샷), PDF, 텍스트(.txt, .csv), 캘린더(.ics) 파일로 시도해주세요.',
        },
        { status: 400 }
      );
    }

    const instruction = `다음 파일에서 과제·시험·제출 마감일처럼 "언제까지 무언가를 해야 하는" 일정을 모두 찾아주세요.
반드시 JSON 배열 형식으로만 응답하고, 다른 설명이나 마크다운 코드블록 표시는 절대 포함하지 마세요.
각 항목은 아래 형식을 정확히 따르세요:
[{"title": "할 일 이름", "course": "과목명 또는 카테고리 (모르면 빈 문자열)", "dueAt": "YYYY-MM-DDTHH:mm"}]
- 시간 정보가 명확하지 않으면 09:00으로 지정하세요.
- 연도가 파일에 없으면 ${new Date().getFullYear()}년으로 가정하세요.
- 마감일로 볼 만한 정보가 전혀 없으면 빈 배열 []만 반환하세요.
파일 이름: ${fileName}`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.5-flash-lite',
      generationConfig: { responseMimeType: 'application/json' },
    });

    let contents: any[];
    if (isTextLike) {
      const decodedText = Buffer.from(content, 'base64').toString('utf-8');
      contents = [instruction, decodedText];
    } else {
      contents = [instruction, { inlineData: { data: content, mimeType } }];
    }

    const result = await model.generateContent(contents);
    const text = result.response.text();

    let events: any[];
    try {
      events = JSON.parse(text);
      if (!Array.isArray(events)) throw new Error('배열 형식이 아닙니다.');
    } catch (parseErr) {
      console.error('AI 응답 파싱 실패:', text);
      return NextResponse.json(
        { error: 'AI가 일정을 정리하는 데 실패했어요. 다른 파일로 다시 시도해주세요.' },
        { status: 500 }
      );
    }

    // 최소한의 형식 검증 — dueAt이 유효한 날짜가 아닌 항목은 제외
    const validEvents = events.filter(
      (ev) => ev && typeof ev.title === 'string' && typeof ev.dueAt === 'string' && !isNaN(new Date(ev.dueAt).getTime())
    );

    return NextResponse.json({ events: validEvents });
  } catch (error: any) {
    console.error('마감일 추출 중 오류 발생:', error);
    return NextResponse.json(
      { error: error.message || '서버 통신 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
