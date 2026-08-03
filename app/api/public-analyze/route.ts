import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extractFileText, FileExtractError } from '@/lib/file-text-extract';
import { runLensAnalysis, LensAnalysisParseError } from '@/lib/run-lens-analysis';
import { MAX_ANONYMOUS_UPLOAD_BYTES, MAX_ANONYMOUS_FILENAME_CHARS } from '@/lib/upload-limits';
import {
  getClientIp,
  getGuestSessionIdOrNull,
  checkGuestUploadAllowed,
  recordAnonymousUploadIfAllowed,
} from '@/lib/anonymous-usage';

// 💡 [신규] 로그인 없이 파일 1개를 분석해보는 체험(app/login/page.tsx의 "로그인 없이
// 체험하기") 전용 라우트입니다. middleware.ts의 isPublicRoute에 이 경로가 등록돼 있어야
// 세션 없이도 호출할 수 있습니다. 이 요청은 게스트 세션의 "업로드" 예산(세션당 1건,
// 이미지 체험과 공유)을 씁니다 — lib/anonymous-usage.ts의 checkGuestUploadAllowed 참고.
// 파일 크기도 로그인 사용자(10MB)보다 훨씬 낮은 3MB로 제한합니다.

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '[ERROR] OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[public-analyze] Supabase 서비스 롤 설정이 없습니다.');
      return NextResponse.json({ error: '서버 설정이 올바르지 않습니다.' }, { status: 500 });
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const ip = getClientIp(req);
    // 💡 세션 쿠키가 없으면 getGuestSessionIdOrNull()이 새로 발급해서 응답에 심고 그 값을
    // 돌려줍니다(정상 흐름) — 발급 자체가 실패하면 null을 반환하는데, 그 경우 session_id
    // 없이 요청을 계속 진행하면 안 됩니다(경쟁 조건 방어가 session_id NULL 행에는 적용되지
    // 않으므로 — lib/anonymous-usage.ts 주석 참고). 즉시 400으로 거절합니다.
    const sessionId = await getGuestSessionIdOrNull();
    if (!sessionId) {
      return NextResponse.json({ error: '세션을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.' }, { status: 400 });
    }
    const usageCheck = await checkGuestUploadAllowed(supabaseAdmin, ip, sessionId);
    if (!usageCheck.ok) {
      return NextResponse.json(
        {
          error: 'Guest trial limit reached. Log in to keep using it.',
          limitReached: true,
          limitType: usageCheck.limitType,
        },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { fileName: rawFileName, mimeType, content } = body as {
      fileName?: string;
      mimeType?: string;
      content?: string; // base64
    };
    if (!content || !rawFileName) {
      return NextResponse.json({ error: '파일 내용이 없습니다.' }, { status: 400 });
    }
    // 💡 fileName 길이 상한 — 지금은 이 값이 프롬프트에 직접 들어가진 않지만(detectLens의
    // 확장자 판별에만 쓰임), 나중에 실수로 프롬프트에 꽂아 넣는 코드가 추가되더라도 같은
    // 종류의 토큰 비용 남용이 재발하지 않도록 다른 게스트 라우트와 동일한 상한을 방어적으로
    // 적용해둡니다.
    const fileName = rawFileName.slice(0, MAX_ANONYMOUS_FILENAME_CHARS);

    const approxBytes = (content.length * 3) / 4;
    if (approxBytes > MAX_ANONYMOUS_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: '로그인 없이 체험할 수 있는 파일은 3MB까지예요. 더 작은 파일로 시도하거나, 계정을 만들면 더 큰 파일도 분석할 수 있어요.' },
        { status: 413 }
      );
    }

    // 💡 이 지점부터는 실제 파싱·OpenAI 호출로 이어지는 비용 발생 구간이라, 이후 실패
    // (파싱 오류, AI 오류 등)와 무관하게 여기서 한 번을 소진한 것으로 기록합니다 — 그래야
    // 일부러 깨진 파일을 계속 보내며 재시도하는 방식으로 한도를 우회할 수 없습니다.
    //
    // 💡 checkGuestUploadAllowed의 SELECT 확인과 이 INSERT 사이엔 시간차가 있어, 같은
    // 세션으로 동시에 여러 요청을 보내면 전부 확인을 통과해버릴 수 있습니다 —
    // recordAnonymousUploadIfAllowed는 DB의 부분 유니크 인덱스로 이 경쟁 조건을 막습니다
    // (동시 요청 중 정확히 하나만 성공). 실패하면(이미 다른 요청이 슬롯을 가져간 것) AI
    // 호출 없이 바로 중단합니다.
    const recordResult = await recordAnonymousUploadIfAllowed(supabaseAdmin, ip, 'analyze', sessionId);
    if (!recordResult.ok) {
      return NextResponse.json(
        { error: 'Guest trial limit reached. Log in to keep using it.', limitReached: true, limitType: 'session' },
        { status: 429 }
      );
    }

    const text = await extractFileText(fileName, mimeType, content);
    const { lensId, result } = await runLensAnalysis({ apiKey, text, fileName });

    // 💡 text를 그대로 함께 돌려줍니다 — 로그인 후 이 결과를 저장할 때 파일을 다시 올리지
    // 않고 이 응답에 담긴 text를 그대로 쓰기 위함입니다(app/login/page.tsx 참고).
    return NextResponse.json({ fileName, text, lens: lensId, result });
  } catch (error) {
    if (error instanceof LensAnalysisParseError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof FileExtractError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[public-analyze] 처리 중 오류 발생:', error);
    return NextResponse.json(
      { error: '분석하지 못했어요. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}

