import { NextResponse } from 'next/server';
import type { LensId } from '@/lib/lenses';
import { getSessionUserId } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { runLensAnalysis, LensAnalysisParseError } from '@/lib/run-lens-analysis';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '[ERROR] OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    // 💡 [신규] 매 호출마다 유료 OpenAI 요청이 나가므로 /api/chat과 동일하게 1분당 호출
    // 횟수를 제한합니다 — 계정 탈취·자동화 남용으로 인한 비용 폭주 방지.
    const userId = await getSessionUserId();
    if (userId && !checkRateLimit(`analyze:${userId}`, 10, 60_000)) {
      return NextResponse.json(
        { error: '요청이 너무 많아요. 잠시 후(1분 뒤) 다시 시도해주세요.' },
        { status: 429 }
      );
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

    const { lensId, result } = await runLensAnalysis({ apiKey, text, fileName, lens, locale });

    return NextResponse.json({ lens: lensId, result });
  } catch (error) {
    if (error instanceof LensAnalysisParseError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // 💡 [수정] error.message를 그대로 응답에 담으면 OpenAI SDK 등 하위 라이브러리의 영어
    // 에러 원문이 사용자에게 그대로 노출될 수 있어, 고정된 한국어 안내 문구로 바꾸고 상세
    // 내용은 서버 로그에만 남깁니다.
    console.error('문서 분석 중 오류 발생:', error);
    return NextResponse.json(
      { error: '분석 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
