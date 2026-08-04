import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth/session';
import { redeemSocietyCode } from '@/lib/society-codes';

// 💡 [신규] "소사이어티 코드 입력" 버튼(app/page.tsx의 업그레이드 모달)이 부릅니다. 실제
// 검증·기록·profiles 갱신 로직은 전부 lib/society-codes.ts의 redeemSocietyCode()에
// 있습니다 — 여러 사용자에 걸친 조회·갱신이 필요해 서비스 롤 키를 쓰므로, 그 로직을
// 라우트 밖으로 빼서 재사용 가능하게 했습니다. userId는 요청 바디가 아니라 호출자 자신의
// 세션에서만 읽습니다 — 다른 사용자 대신 코드를 사용하도록 요청을 조작할 수 없게 하기
// 위해서입니다.
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Please log in first.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { code } = body as { code?: string };
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Please enter a code.' }, { status: 400 });
  }

  const result = await redeemSocietyCode(userId, code);
  if (!result.ok) {
    const status =
      result.errorCode === 'server_error'
        ? 500
        : result.errorCode === 'kill_switch'
          ? 503
          : 400;
    return NextResponse.json({ error: result.error, errorCode: result.errorCode }, { status });
  }

  return NextResponse.json({ ok: true, expiresAt: result.expiresAt });
}
