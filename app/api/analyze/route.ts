import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { LENSES, detectLens, type LensId } from '@/lib/lenses';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '[ERROR] OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    const body = await req.json();
    const { text, fileName, lens } = body as {
      text?: string;
      fileName?: string;
      lens?: LensId;
    };

    if (!text) {
      return NextResponse.json({ error: '분석할 텍스트가 없습니다.' }, { status: 400 });
    }

    const lensId: LensId = lens && lens in LENSES ? lens : detectLens(text, fileName);
    const lensDef = LENSES[lensId];

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      max_tokens: 4096,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: `${lensId}_result`,
          schema: lensDef.schema,
          strict: true,
        },
      },
      messages: [
        { role: 'system', content: lensDef.systemPrompt },
        { role: 'user', content: text },
      ],
    });

    const raw = completion.choices[0]?.message?.content || '{}';

    let result: unknown;
    try {
      result = JSON.parse(raw);
    } catch (parseErr) {
      console.error('AI 응답 파싱 실패:', raw);
      return NextResponse.json(
        { error: 'AI가 분석 결과를 정리하는 데 실패했어요. 다시 시도해주세요.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ lens: lensId, result });
  } catch (error: any) {
    console.error('문서 분석 중 오류 발생:', error);
    return NextResponse.json(
      { error: error.message || '서버 통신 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
