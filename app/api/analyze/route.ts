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
    const { text, fileName, lens, locale } = body as {
      text?: string;
      fileName?: string;
      lens?: LensId;
      locale?: string;
    };

    if (!text) {
      return NextResponse.json({ error: '분석할 텍스트가 없습니다.' }, { status: 400 });
    }

    const lensId: LensId = lens && lens in LENSES ? lens : detectLens(text, fileName);
    const lensDef = LENSES[lensId];

    const openai = new OpenAI({ apiKey });

    // 💡 [신규] 답변 언어는 lensDef.systemPrompt(COMMON_RULES 포함, 모든 요청에 동일한 고정 문자열
    // — OpenAI가 프롬프트 캐싱하는 부분)에 넣지 않고, 요청마다 어차피 매번 달라지는 user 메시지
    // 앞에 붙입니다. 고정 프리픽스에 넣으면 언어가 바뀔 때마다(혹은 로케일별로) 캐시가 갈라져서
    // 캐싱 이득이 사라집니다.
    const languageDirective = locale === 'en'
      ? '[Answer language: English — you must answer in English regardless of the document\'s language.]\n\n'
      : '';
    const userContent = `${languageDirective}${text}`;

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
        { role: 'user', content: userContent },
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
