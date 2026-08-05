import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runLensAnalysis, runLensAnalysisOnImage, LensAnalysisParseError } from '@/lib/run-lens-analysis';
import { extractFileText, FileExtractError } from '@/lib/file-text-extract';
import { MAX_ANONYMOUS_UPLOAD_BYTES, MAX_ANONYMOUS_FILENAME_CHARS } from '@/lib/upload-limits';
import { SUPPORTED_CHAT_IMAGE_MIME_TYPES } from '@/lib/image-constraints';
import {
  getClientIp,
  getGuestSessionIdOrNull,
  checkGuestUploadAllowed,
  recordAnonymousUploadIfAllowed,
} from '@/lib/anonymous-usage';

// 💡 [신규] 로그인 없이 자료 하나를 올려 회로도 애니메이션 + 예상 문제 + 요약정리를
// 보여주는 "가이드 체험" 전용 라우트입니다. middleware.ts의 isPublicRoute에 이 경로가
// 등록돼 있어야 세션 없이도 호출할 수 있습니다.
//
// 💡 [수정] 원래 이미지 한 장만 받았지만, 이 라우트를 쓰는 /welcome 히어로의 "지금 체험하기"가
// 랜딩 페이지의 유일한 주 CTA라 사진이 아닌 자료(PDF·워드·PPT·엑셀·한글)를 고른 방문자가
// 형식 오류만 보고 이탈했습니다. 이제 mimeType으로 갈라서, 이미지는 기존 비전 경로 그대로,
// 그 외 문서는 app/api/public-analyze와 같은 extractFileText()로 텍스트를 뽑아 텍스트 렌즈로
// 분석합니다 — 두 갈래 모두 결과 모양({questions, summary})이 같아서 클라이언트 UI는
// 그대로입니다.
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
    // 💡 세션 발급이 실패하면(극히 예외적) session_id 없이 진행하지 않고 400으로 거절합니다
    // — lib/anonymous-usage.ts의 getGuestSessionIdOrNull() 주석 참고.
    const sessionId = await getGuestSessionIdOrNull();
    if (!sessionId) {
      return NextResponse.json({ error: '세션을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.' }, { status: 400 });
    }
    const usageCheck = await checkGuestUploadAllowed(supabaseAdmin, ip, sessionId);
    if (!usageCheck.ok) {
      return NextResponse.json(
        {
          error: 'Guided trial already used. Log in to keep using it.',
          limitReached: true,
          limitType: usageCheck.limitType,
          ...(usageCheck.limitType === 'session' ? { remainingUploads: 0 } : {}),
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
    const fileName = rawFileName.slice(0, MAX_ANONYMOUS_FILENAME_CHARS);

    // 💡 이미지 계열인데 비전이 못 읽는 형식(대표적으로 아이폰 기본 HEIC)만 여기서 거절합니다.
    // 이미지가 아닌 파일은 아래 문서 경로로 내려가고, 거기서 실제로 지원하지 않는 형식이면
    // extractFileText()가 형식별 안내 메시지를 담은 FileExtractError를 던집니다.
    const isImage = Boolean(mimeType?.startsWith('image/'));
    if (isImage && !SUPPORTED_CHAT_IMAGE_MIME_TYPES.includes(mimeType!)) {
      return NextResponse.json(
        { error: 'PNG, JPEG, GIF, WEBP 형식만 지원해요. HEIC 사진이라면 JPEG로 변환해서 다시 시도해주세요.' },
        { status: 400 }
      );
    }

    const approxBytes = (content.length * 3) / 4;
    if (approxBytes > MAX_ANONYMOUS_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: '로그인 없이 체험할 수 있는 파일은 3MB까지예요. 더 작은 파일로 시도하거나, 계정을 만들면 더 큰 파일도 분석할 수 있어요.' },
        { status: 413 }
      );
    }

    // 💡 이 지점부터는 실제 비전 호출로 이어지는 비용 발생 구간이라, 이후 실패와 무관하게
    // 여기서 1회를 소진한 것으로 기록합니다 — 그래야 일부러 깨진 이미지를 계속 보내며
    // 재시도하는 방식으로 "평생 1회" 제한을 우회할 수 없습니다.
    //
    // 💡 checkGuestUploadAllowed의 사전 확인과 이 기록 사이의 경쟁 조건(동시 요청 우회)을
    // DB 부분 유니크 인덱스로 막습니다 — public-analyze와 동일한 이유.
    const recordResult = await recordAnonymousUploadIfAllowed(supabaseAdmin, ip, 'guided', sessionId);
    if (!recordResult.ok) {
      return NextResponse.json(
        { error: 'Guided trial already used. Log in to keep using it.', limitReached: true, limitType: 'session', remainingUploads: 0 },
        { status: 429 }
      );
    }

    // 💡 이미지는 비전으로(OCR이 약한 손글씨·기울어진 사진 때문에 — 위 주석 참고), 문서는
    // 텍스트를 뽑아 같은 두 렌즈로 분석합니다. 렌즈(questions/digest)를 명시적으로 넘겨서
    // 문서 경로에서도 detectLens의 자동 감지가 끼어들지 않게 합니다 — 이 체험 화면은 항상
    // "예상 문제 + 요약정리" 두 카드를 보여주는 고정 구성이라 렌즈가 바뀌면 결과 모양이
    // UI와 어긋납니다.
    const [questions, summary] = isImage
      ? await (async () => {
          const dataUrl = `data:${mimeType};base64,${content}`;
          return Promise.all([
            runLensAnalysisOnImage({ apiKey, dataUrl, lens: 'questions' }),
            runLensAnalysisOnImage({ apiKey, dataUrl, lens: 'digest' }),
          ]);
        })()
      : await (async () => {
          const text = await extractFileText(fileName, mimeType, content);
          if (!text.trim()) {
            throw new FileExtractError('파일에서 읽을 수 있는 글자를 찾지 못했어요. 다른 자료로 시도해주세요.');
          }
          return Promise.all([
            runLensAnalysis({ apiKey, text, fileName, lens: 'questions' }),
            runLensAnalysis({ apiKey, text, fileName, lens: 'digest' }),
          ]);
        })();

    return NextResponse.json({
      questions: questions.result,
      summary: summary.result,
      // 💡 세션당 업로드 1건 예산을 이 요청이 방금 소모했으므로 항상 0 — 당근 게이지가
      // 다음 429를 기다리지 않고 바로 "잎만 남음"으로 갱신하도록.
      remainingUploads: 0,
    });
  } catch (error) {
    if (error instanceof LensAnalysisParseError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof FileExtractError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[public-guided-trial] 처리 중 오류 발생:', error);
    return NextResponse.json(
      { error: '분석하지 못했어요. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
