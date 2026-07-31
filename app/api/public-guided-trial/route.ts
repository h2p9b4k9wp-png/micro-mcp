import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runLensAnalysisOnImage, LensAnalysisParseError } from '@/lib/run-lens-analysis';
import { MAX_ANONYMOUS_UPLOAD_BYTES } from '@/lib/upload-limits';
import { SUPPORTED_CHAT_IMAGE_MIME_TYPES } from '@/lib/image-constraints';
import { getClientIp, getGuestSessionId, checkGuestUploadAllowed, recordAnonymousUsage } from '@/lib/anonymous-usage';

// 💡 [신규] 로그인 없이 사진/캡처본 한 장을 올려 회로도 애니메이션 + 예상 문제 + 요약정리를
// 보여주는 "가이드 체험" 전용 라우트입니다. middleware.ts의 isPublicRoute에 이 경로가
// 등록돼 있어야 세션 없이도 호출할 수 있습니다.
//
// app/api/public-analyze와 같은 게스트 세션의 "업로드" 예산(세션당 1건)을 공유합니다 —
// 이미지 체험은 비전 호출이라 비용이 더 큰 편이라 파일 분석과 같은 슬롯을 두고 어느 한쪽만
// 세션당 1번 쓸 수 있게 합니다(lib/anonymous-usage.ts의 checkGuestUploadAllowed 참고).
//
// OCR이 아니라 비전(gpt-4.1-mini의 image_url 입력)을 씁니다 — 손글씨·기울어진 사진처럼
// OCR이 약한 입력에서도 정확히 읽어내야 한다는 요구사항 때문입니다(app/api/chat/route.ts의
// chatAttachments 이미지 경로와 동일한 이유). 예상 문제(questions)·요약정리(digest) 두
// 렌즈를 이미지 한 장에 대해 각각 비전 호출하며, lib/lenses.ts의 기존 스키마·시스템
// 프롬프트를 그대로 재사용합니다(새 프롬프트를 만들지 않아 anti-hallucination 튜닝이
// 흐트러질 위험이 없습니다).
export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '[ERROR] OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[public-guided-trial] Supabase 서비스 롤 설정이 없습니다.');
      return NextResponse.json({ error: '서버 설정이 올바르지 않습니다.' }, { status: 500 });
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const ip = getClientIp(req);
    const sessionId = await getGuestSessionId();
    const usageCheck = await checkGuestUploadAllowed(supabaseAdmin, ip, sessionId);
    if (!usageCheck.ok) {
      return NextResponse.json(
        {
          error: 'Guided trial already used. Log in to keep using it.',
          limitReached: true,
          limitType: usageCheck.limitType,
        },
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
      return NextResponse.json({ error: '이미지 내용이 없습니다.' }, { status: 400 });
    }

    if (!mimeType || !SUPPORTED_CHAT_IMAGE_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: 'PNG, JPEG, GIF, WEBP 형식만 지원해요. HEIC 사진이라면 JPEG로 변환해서 다시 시도해주세요.' },
        { status: 400 }
      );
    }

    const approxBytes = (content.length * 3) / 4;
    if (approxBytes > MAX_ANONYMOUS_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: '로그인 없이 체험할 수 있는 이미지는 3MB까지예요. 더 작은 사진으로 시도하거나, 계정을 만들면 더 큰 파일도 분석할 수 있어요.' },
        { status: 413 }
      );
    }

    // 💡 이 지점부터는 실제 비전 호출로 이어지는 비용 발생 구간이라, 이후 실패와 무관하게
    // 여기서 1회를 소진한 것으로 기록합니다 — 그래야 일부러 깨진 이미지를 계속 보내며
    // 재시도하는 방식으로 "평생 1회" 제한을 우회할 수 없습니다.
    await recordAnonymousUsage(supabaseAdmin, ip, 'guided', sessionId);

    const dataUrl = `data:${mimeType};base64,${content}`;
    const [questions, summary] = await Promise.all([
      runLensAnalysisOnImage({ apiKey, dataUrl, lens: 'questions' }),
      runLensAnalysisOnImage({ apiKey, dataUrl, lens: 'digest' }),
    ]);

    return NextResponse.json({
      questions: questions.result,
      summary: summary.result,
    });
  } catch (error) {
    if (error instanceof LensAnalysisParseError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error('[public-guided-trial] 처리 중 오류 발생:', error);
    return NextResponse.json(
      { error: '분석하지 못했어요. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
