import { NextResponse } from 'next/server';
import { getSessionSupabase } from '@/lib/auth/session';
import { checkFileQuota } from '@/lib/plan-limits';

// 이 라우트는 middleware.ts에서 이미 로그인 여부를 검증하므로 별도 인증 체크를 하지 않습니다.
//
// 💡 [신규] 채팅 이미지 첨부는 텍스트 파일과 달리 /api/extract를 거치지 않고 바로 base64로
// 첨부됩니다 — 그래서 월간 파일 처리 한도가 실질적으로 적용되지 않는 구멍이었습니다. 이
// 라우트는 아무 것도 쓰지 않는 조회 전용 엔드포인트로, 이미지를 첨부하기 직전에
// app/page.tsx가 호출해 "지금 하나 더 올려도 되는지"만 확인합니다. 실제 처리(리사이즈 +
// document_uploads 기록)는 여전히 클라이언트에서 하지만, 한도 검사 자체는 checkFileQuota를
// /api/extract와 공유해 서버측에서 이뤄집니다.
export async function GET() {
  try {
    const { supabase, userId } = await getSessionSupabase();
    if (!userId) {
      return NextResponse.json({ error: '인증이 필요합니다. 로그인 후 다시 시도해주세요.' }, { status: 401 });
    }

    const quota = await checkFileQuota(supabase, userId);
    if (!quota.ok) {
      return NextResponse.json(
        { error: quota.error, limitReached: true, limitType: 'file' },
        { status: 403 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('업로드 한도 확인 중 오류 발생:', error);
    return NextResponse.json(
      { error: '한도를 확인하지 못했어요. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
