import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSessionUserId } from '@/lib/auth/session';

// 💡 [신규] "계정 삭제" 버튼(app/page.tsx의 handleDeleteAccount)이 관련 데이터 행을 지운
// 다음 마지막 단계로 호출합니다 — Supabase Auth의 실제 로그인 계정(auth.users)을 지웁니다.
// 지금까지는 documents/logs/professors 같은 관련 데이터 행만 지우고 auth.users는 그대로
// 남겨둬서, "계정 삭제" 후에도 같은 이메일/OAuth로 다시 로그인하면 그대로 들어와지는
// 문제가 있었습니다 — GDPR 삭제 요청 관점에서도 불완전합니다(로그인 자격 증명이 남아있으면
// 진짜 삭제가 아닙니다).
//
// supabase/migrations의 사용자 데이터 테이블(profiles/logs/document_uploads/professors/
// documents/doc_chunks/professor_analysis/conversation_folders/prompts)이 전부
// "references auth.users(id) on delete cascade"로 걸려있어서, auth.admin.deleteUser()
// 하나만 불러도 이 테이블들은 전부 자동으로 같이 지워집니다 — 그래도 handleDeleteAccount의
// 기존 명시적 6개 테이블 삭제는 그대로 남겨둡니다("라이브 DB의 cascade 설정이 이 저장소의
// 마이그레이션과 실제로 일치하는지 가정하지 않는다"는 그 함수의 기존 원칙과 같은 이유 —
// 이 라우트는 그 위에 실제 로그인 계정 삭제만 더합니다.
//
// userId는 요청 바디가 아니라 호출자 자신의 세션에서만 읽습니다 — 그렇지 않으면 다른
// 사용자의 계정을 대신 삭제하도록 요청을 조작할 수 있습니다. middleware.ts가 이 경로를
// isPublicRoute에 넣지 않아 세션 없이는 애초에 호출할 수 없지만, userId 자체는 어차피
// 세션에서만 읽어야 하는 값이라 별도 인증 체크 없이 getSessionUserId()의 null 반환으로
// 방어합니다.
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[account/delete] Supabase 서비스 롤 설정이 없습니다.');
    return NextResponse.json({ error: '서버 설정이 올바르지 않습니다.' }, { status: 500 });
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[account/delete] 계정 삭제 중 오류 발생:', error);
    return NextResponse.json({ error: '계정을 삭제하지 못했어요.' }, { status: 500 });
  }
}
