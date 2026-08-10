import { NextResponse } from 'next/server';
import type { LensId } from '@/lib/lenses';
import { getSessionSupabase } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { getIsPro, getProSource, getPlanLimits, PRO_PRICE_LABEL } from '@/lib/plan-limits';
import { runLensAnalysis, LensAnalysisParseError } from '@/lib/run-lens-analysis';
import { recordAiUsage } from '@/lib/ai-usage-logging';
import { checkSocietyCodeAnalysisQuota } from '@/lib/society-codes';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key is not configured.' }, { status: 500 });
    }

    // 💡 [신규] 매 호출마다 유료 OpenAI 요청이 나가므로 /api/chat과 동일하게 1분당 호출
    // 횟수를 제한합니다 — 계정 탈취·자동화 남용으로 인한 비용 폭주 방지.
    const { supabase, userId } = await getSessionSupabase();
    if (userId && !checkRateLimit(`analyze:${userId}`, 10, 60_000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in a minute.' },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { text, fileName, lens, responseLanguage, professorContext } = body as {
      text?: string;
      fileName?: string;
      lens?: LensId;
      responseLanguage?: string;
      professorContext?: string;
    };

    if (!text) {
      return NextResponse.json({ error: 'No text to analyze.' }, { status: 400 });
    }

    // 💡 [신규] 이 라우트는 파일이 아니라 이미 추출된 텍스트를 받기 때문에 /api/extract의
    // 파일 크기 검증(무료 5MB/Pro 20MB)을 우회할 수 있었습니다 — 채팅 첨부문서를 붙여넣어
    // 직접 호출하거나, 텍스트를 아주 크게 붙여넣는 식으로. 같은 상한을 텍스트 바이트 수에도
    // 적용해 우회 경로를 막습니다.
    // 💡 professorContext도 클라이언트가 만들어 보내는 문자열이라 크기 검증에 함께
    // 포함해야 합니다 — text만 재면 본문을 작게 쪼개고 참고자료 쪽에 거대한 문자열을
    // 실어 보내는 식으로 상한을 그대로 우회할 수 있습니다.
    const isPro = userId ? await getIsPro(supabase, userId) : false;
    const maxUploadBytes = getPlanLimits(isPro).maxUploadBytes;
    const textBytes =
      Buffer.byteLength(text, 'utf-8') + (professorContext ? Buffer.byteLength(professorContext, 'utf-8') : 0);
    if (textBytes > maxUploadBytes) {
      const maxMB = Math.round(maxUploadBytes / (1024 * 1024));
      return NextResponse.json(
        {
          error: `Text is too large (over ${maxMB}MB). Please try a smaller document.${isPro ? '' : ` Upgrade to Pro — ${PRO_PRICE_LABEL}`}`,
          limitReached: true,
          limitType: 'file',
        },
        { status: 413 }
      );
    }

    // 💡 [신규] 소사이어티 코드로 얻은 Pro는 결제 기반 Pro와 같은 filesPerMonth 한도가
    // 아니라 별도의 넉넉한 월 분석 횟수 상한이 적용됩니다 — lib/society-codes.ts 참고.
    if (userId) {
      const proSource = await getProSource(supabase, userId);
      const quota = await checkSocietyCodeAnalysisQuota(userId, proSource);
      if (!quota.ok) {
        return NextResponse.json({ error: quota.error, limitReached: true, limitType: 'societyCode' }, { status: 429 });
      }
    }

    const { lensId, result, usage, model } = await runLensAnalysis({
      apiKey,
      text,
      fileName,
      lens,
      responseLanguage,
      professorContext,
    });

    // 💡 [신규] 추정이 아니라 OpenAI가 실제로 돌려준 토큰 수를 그대로 기록합니다. 응답을
    // 내려보내기 전에 await합니다 — 서버리스 함수는 응답을 반환하면 그대로 종료될 수 있어
    // await 없이 던져두면(fire-and-forget) 인서트가 완료되기 전에 함수가 죽어 기록이 조용히
    // 누락될 수 있습니다. 기록 자체가 실패해도(네트워크 등) 응답은 그대로 내려줍니다 —
    // recordAiUsage는 실패 시 throw하지 않고 로그만 남깁니다(lib/ai-usage-logging.ts).
    if (userId && usage) {
      await recordAiUsage(supabase, userId, 'analyze', model, usage);
    }

    return NextResponse.json({ lens: lensId, result });
  } catch (error) {
    if (error instanceof LensAnalysisParseError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // 💡 [수정] error.message를 그대로 응답에 담으면 OpenAI SDK 등 하위 라이브러리의 영어
    // 에러 원문이 사용자에게 그대로 노출될 수 있어, 고정된 안내 문구로 바꾸고 상세
    // 내용은 서버 로그에만 남깁니다.
    console.error('문서 분석 중 오류 발생:', error);
    return NextResponse.json(
      { error: 'Something went wrong during analysis. Please try again in a moment.' },
      { status: 500 }
    );
  }
}
