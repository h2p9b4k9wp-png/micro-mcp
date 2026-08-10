import { NextResponse } from 'next/server';
import { getAiModel } from '@/lib/ai-model';
import { getSessionSupabase } from '@/lib/auth/session';
import { getPlanLimits, getMonthStartISOString } from '@/lib/plan-limits';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.
//
// 💡 [신규] 당근 게이지(components/carrot-gauge.tsx)가 로그인 무료 사용자의 사이드바에
// "이번 달 몇 번 남았는지"를 보여주기 위한 조회 전용 엔드포인트입니다. 지금까지는 채팅
// 월간 한도(app/api/chat)와 파일 처리 월간 한도(lib/plan-limits.ts의 checkFileQuota)를
// 서버가 이미 계산하고 있었지만, 한도에 도달했을 때만 403으로 알려줄 뿐 "현재 몇 회 썼는지"를
// 평소에 클라이언트에 내려주는 곳이 없었습니다. 이 라우트는 그 두 카운트 쿼리를 그대로
// 재사용해(로직을 새로 만들지 않음) 현재 사용량/한도를 함께 반환합니다.
export async function GET() {
  try {
    const { supabase, userId } = await getSessionSupabase();
    if (!userId) {
      return NextResponse.json({ error: '인증이 필요합니다. 로그인 후 다시 시도해주세요.' }, { status: 401 });
    }

    const monthStart = getMonthStartISOString();
    const [{ data: profile }, { count: chatCount }, { count: fileCount }] = await Promise.all([
      supabase.from('profiles').select('is_pro').eq('id', userId).single(),
      supabase.from('logs').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabase.from('document_uploads').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
    ]);

    const isPro = Boolean(profile?.is_pro);
    const limits = getPlanLimits(isPro);

    return NextResponse.json({
      isPro,
      chat: { used: chatCount ?? 0, limit: limits.chatsPerMonth },
      file: { used: fileCount ?? 0, limit: limits.filesPerMonth },
      // 💡 [신규] 사이드바 "OpenAI ○○ 연동됨" 배지가 쓸 실제 모델명. 예전에는 번역 파일
      // 12개에 "GPT-4.1 mini"가 문자열로 박혀 있어서, OPENAI_MODEL을 바꾸면 화면 문구만
      // 조용히 거짓이 됐습니다. 모델을 정하는 건 서버 전용 환경변수라 클라이언트가 직접
      // 읽을 수 없어(NEXT_PUBLIC_ 접두사가 없음), 이미 초기 로드 때 부르고 있는 이
      // 조회 전용 라우트에 얹어 내려보냅니다 — 이 값만 보고 배지를 그리면 환경변수를
      // 바꾸는 즉시 화면도 따라갑니다.
      model: getAiModel(),
    });
  } catch (error) {
    console.error('[usage-summary] 조회 중 오류 발생:', error);
    return NextResponse.json({ error: '사용량을 확인하지 못했어요. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
