import { NextResponse } from 'next/server';
import { getAiModel } from '@/lib/ai-model';
import { getSessionSupabase } from '@/lib/auth/session';
import { getUsageRatio } from '@/lib/token-safety';

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

    const [{ data: profile }] = await Promise.all([
      // 💡 [수정] pro_source/pro_expires_at도 함께 읽습니다 — 소사이어티 코드로 얻은 Pro는
      // 기간이 끝나면 cron이 조용히 강등시키는데(app/api/cron/cleanup-logs), 지금까지
      // 화면 어디에서도 만료가 다가온다는 걸 알려주지 않아 사용자 입장에서는 어느 날 갑자기
      // Pro가 꺼집니다. 이 두 값이 그 안내의 유일한 근거입니다.
      supabase.from('profiles').select('is_pro, pro_source, pro_expires_at').eq('id', userId).single(),
    ]);

    const isPro = Boolean(profile?.is_pro);
    const proSource = (profile?.pro_source as 'payment' | 'code' | null) ?? null;

    // 💡 [수정] 화면에 내려보내는 사용량이 "채팅 N회 / 파일 N회"에서 **토큰 잔량 비율**
    // 하나로 바뀌었습니다. 다만 클라이언트에는 비율(0~1)과 구간(level)만 주고 토큰 수도
    // 한도 수도 보내지 않습니다 — 화면에 "토큰"이라는 단어와 숫자를 절대 노출하지 않기
    // 위해서입니다. 게이지는 이 ratio 하나만으로 그려집니다(components/carrot-gauge.tsx).
    //
    // 합계 조회는 서비스 롤 RPC라 여기서 직접 부르지 않고 lib/token-safety.ts의 조회를
    // 재사용합니다. 실패하면 usage를 null로 내려보내고, 클라이언트는 게이지를 그리지
    // 않습니다(0/0으로 "다 썼음"처럼 보이는 것보다 안 보이는 편이 낫습니다).
    const usage = await getUsageRatio(userId, isPro, proSource);

    return NextResponse.json({
      isPro,
      usage,
      // 💡 [신규] 사이드바 "OpenAI ○○ 연동됨" 배지가 쓸 실제 모델명. 예전에는 번역 파일
      // 12개에 "GPT-4.1 mini"가 문자열로 박혀 있어서, OPENAI_MODEL을 바꾸면 화면 문구만
      // 조용히 거짓이 됐습니다. 모델을 정하는 건 서버 전용 환경변수라 클라이언트가 직접
      // 읽을 수 없어(NEXT_PUBLIC_ 접두사가 없음), 이미 초기 로드 때 부르고 있는 이
      // 조회 전용 라우트에 얹어 내려보냅니다 — 이 값만 보고 배지를 그리면 환경변수를
      // 바꾸는 즉시 화면도 따라갑니다.
      model: getAiModel(),
      // 결제 기반 Pro는 pro_expires_at이 항상 null이라(구독 종료는 Polar 웹훅이 알려줌)
      // 이 값이 채워져 있는 건 코드 기반 Pro뿐입니다. 그래도 클라이언트가 조건을 명시적으로
      // 쓸 수 있도록 pro_source도 함께 내려보냅니다.
      proSource,
      proExpiresAt: (profile?.pro_expires_at as string | null) ?? null,
    });
  } catch (error) {
    console.error('[usage-summary] 조회 중 오류 발생:', error);
    return NextResponse.json({ error: '사용량을 확인하지 못했어요. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
