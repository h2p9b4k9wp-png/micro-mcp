import { MAX_AVOID_QUESTIONS, MAX_AVOID_QUESTION_CHARS } from '@/lib/truncate-text';
import { NextResponse } from 'next/server';
import type { LensId } from '@/lib/lenses';
import { getSessionSupabase } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { getIsPro, getProSource, getPlanLimits, PRO_PRICE_LABEL } from '@/lib/plan-limits';
import { getEffectiveUploadLimitBytes } from '@/lib/upload-limits';
import { runLensAnalysis, LensAnalysisParseError } from '@/lib/run-lens-analysis';
import { recordAiUsage } from '@/lib/ai-usage-logging';
import { checkTokenSafetyLimits } from '@/lib/token-safety';

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
    const { text, fileName, lens, responseLanguage, professorContext, avoidQuestions } = body as {
      text?: string;
      fileName?: string;
      lens?: LensId;
      responseLanguage?: string;
      professorContext?: string;
      avoidQuestions?: string[];
    };

    // 💡 [신규] 이미 출제한 문항 요약 목록 — 클라이언트가 보내는 값이라 서버에서도 개수·길이를
    // 다시 자릅니다(클라이언트 쪽 상한은 우회 가능). 요약이라 짧고, 여기서 잘려도 중복 회피가
    // 조금 느슨해질 뿐 기능이 깨지지는 않습니다.
    const safeAvoidQuestions = Array.isArray(avoidQuestions)
      ? avoidQuestions
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
          .slice(0, MAX_AVOID_QUESTIONS)
          .map((q) => q.trim().slice(0, MAX_AVOID_QUESTION_CHARS))
      : undefined;

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
    // 💡 [수정] 등급 상한을 그대로 쓰지 않고 "요청 본문에 실제로 담길 수 있는 크기"로 낮춥니다.
    // 파일 업로드는 Storage 직접 업로드로 옮겨가 등급 상한(무료 30MB / Pro 100MB)이 그대로
    // 적용되지만, 이 라우트는 여전히 *텍스트*를 본문으로 받습니다 — 30MB 텍스트를 보내면
    // 플랫폼이 우리 코드 실행 전에 413을 돌려주므로, 여기서 30MB라고 검사해봐야 도달할 수 없는
    // 숫자입니다. 추출된 텍스트는 어차피 MAX_EXTRACTED_TEXT_CHARS(30만 자)로 잘려 있어
    // 이 상한에 정상 사용이 걸릴 일은 없습니다.
    const isPro = userId ? await getIsPro(supabase, userId) : false;
    const maxUploadBytes = getEffectiveUploadLimitBytes(getPlanLimits(isPro).maxUploadBytes);
    const textBytes =
      Buffer.byteLength(text, 'utf-8') +
      (professorContext ? Buffer.byteLength(professorContext, 'utf-8') : 0) +
      (safeAvoidQuestions ? Buffer.byteLength(safeAvoidQuestions.join(''), 'utf-8') : 0);
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

    // 💡 [수정] 소사이어티 코드 "월 100회" 상한을 없앴습니다 — 같은 1회가 182토큰일 수도
    // 534,676토큰일 수도 있어 횟수로는 실제 부담을 반영하지 못했습니다. 이제 아래 등급별
    // 월 토큰 한도 하나가 무료·코드·결제 세 등급을 모두 담당합니다.
    if (userId) {
      const proSource = await getProSource(supabase, userId);
      const tokenSafety = await checkTokenSafetyLimits(userId, isPro, proSource);
      if (!tokenSafety.ok) {
        return NextResponse.json(
          { error: tokenSafety.message, limitReached: true, limitType: tokenSafety.tier === 'code' ? 'societyCode' : 'usage' },
          { status: 429 }
        );
      }
    }

    const { lensId, result, usage, model } = await runLensAnalysis({
      apiKey,
      text,
      fileName,
      lens,
      responseLanguage,
      professorContext,
      avoidQuestions: safeAvoidQuestions,
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
