import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extractFileText, FileExtractError } from '@/lib/file-text-extract';
import { runLensAnalysis, LensAnalysisParseError } from '@/lib/run-lens-analysis';
import { MAX_ANONYMOUS_UPLOAD_BYTES } from '@/lib/upload-limits';

// 💡 [신규] 로그인 없이 파일 1개를 분석해보는 체험(app/login/page.tsx의 "로그인 없이
// 체험하기") 전용 라우트입니다. middleware.ts의 isPublicRoute에 이 경로가 등록돼 있어야
// 세션 없이도 호출할 수 있습니다.
//
// 남용 방지는 로그인 사용자용 분당 속도 제한과는 완전히 다른 방식입니다 — 여기엔 사용자
// 계정이 아예 없으므로, 요청 IP를 키로 anonymous_trial_usage 테이블에 하루 1건만 허용하는
// 식으로 제한합니다(서비스 롤 키로 RLS 우회 — 로그인 사용자의 소유 데이터가 아니라 IP별
// 집계이므로 auth.uid() 기반 RLS 자체가 적용될 수 없습니다). 파일 크기도 로그인 사용자
// (10MB)보다 훨씬 낮은 3MB로 제한합니다.
function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  // IP를 전혀 알 수 없는 상황(로컬 개발 등)에서는 모든 요청이 하나의 버킷을 공유하게
  // 됩니다 — 완벽하진 않지만, 하루 1회 제한이 아예 작동하지 않는 것보다는 안전합니다.
  return 'unknown';
}

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
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: usageCount, error: usageError } = await supabaseAdmin
      .from('anonymous_trial_usage')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .gte('created_at', oneDayAgo);
    if (usageError) throw usageError;
    if (usageCount !== null && usageCount >= 1) {
      return NextResponse.json(
        { error: '로그인 없는 체험은 하루에 한 번만 사용할 수 있어요. 계정을 만들면 계속 이용할 수 있어요.' },
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
      return NextResponse.json({ error: '파일 내용이 없습니다.' }, { status: 400 });
    }

    const approxBytes = (content.length * 3) / 4;
    if (approxBytes > MAX_ANONYMOUS_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: '로그인 없이 체험할 수 있는 파일은 3MB까지예요. 더 작은 파일로 시도하거나, 계정을 만들면 더 큰 파일도 분석할 수 있어요.' },
        { status: 413 }
      );
    }

    // 💡 이 지점부터는 실제 파싱·OpenAI 호출로 이어지는 비용 발생 구간이라, 이후 실패
    // (파싱 오류, AI 오류 등)와 무관하게 여기서 하루 1회를 소진한 것으로 기록합니다 — 그래야
    // 일부러 깨진 파일을 계속 보내며 재시도하는 방식으로 한도를 우회할 수 없습니다.
    const { error: recordError } = await supabaseAdmin
      .from('anonymous_trial_usage')
      .insert({ ip_address: ip });
    if (recordError) console.error('[public-analyze] 사용 이력 기록 실패:', recordError);

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

