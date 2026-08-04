import { NextResponse } from 'next/server';
import { getSessionUserEmail } from '@/lib/auth/session';
import { generateSocietyCode, getSupabaseAdmin } from '@/lib/society-codes';

// 💡 [신규] app/admin/society-codes/page.tsx의 "코드 발급" 폼이 부르는 라우트 —
// app/admin/ai-usage·funnel 페이지와 같은 ADMIN_EMAIL 인증 패턴이지만, 그 페이지들은
// 서버 컴포넌트 안에서 직접 redirect()하는 반면 이건 API 라우트라 401/403 JSON으로
// 응답합니다. middleware.ts는 /api/admin/*를 로그인 여부까지만 확인하고 관리자인지는
// 확인하지 않으므로, 이 라우트 자체가 ADMIN_EMAIL과 대조하는 마지막 방어선입니다.
async function requireAdmin(): Promise<{ ok: true; email: string } | { ok: false; response: NextResponse }> {
  const email = await getSessionUserEmail();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!email || !adminEmail || email !== adminEmail) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }) };
  }
  return { ok: true, email };
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await req.json().catch(() => ({}));
  const { label, maxUses, expiresAt } = body as { label?: string; maxUses?: number; expiresAt?: string };

  if (!Number.isInteger(maxUses) || (maxUses as number) <= 0) {
    return NextResponse.json({ error: 'maxUses must be a positive integer.' }, { status: 400 });
  }
  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
  if (!expiresAtDate || Number.isNaN(expiresAtDate.getTime()) || expiresAtDate.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'expiresAt must be a valid future date.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  // 💡 code 충돌은 사실상 불가능에 가깝지만(32^8 조합), unique 제약 위반을 대비해 몇 번
  // 재시도합니다 — 다른 이유의 실패는 그대로 던집니다.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateSocietyCode();
    const { data, error } = await supabaseAdmin
      .from('society_codes')
      .insert({
        code,
        label: label?.trim() || null,
        max_uses: maxUses,
        expires_at: expiresAtDate.toISOString(),
        created_by: admin.email,
      })
      .select('id, code, label, max_uses, expires_at, created_at')
      .single();
    if (!error) {
      return NextResponse.json({ ok: true, code: data });
    }
    lastError = error;
    if (error.code !== '23505') break;
  }
  console.error('[admin/society-codes] 코드 발급 실패:', lastError);
  return NextResponse.json({ error: 'Failed to issue code.' }, { status: 500 });
}

// 💡 [신규] 코드 하나를 조기 무효화 — 남용 정황 발견 시 만료일을 기다리지 않고 즉시 막는
// 수동 안전장치. body에 codeId만 받아 revoked_at을 채웁니다(soft delete — 이미 발급받은
// 학생들의 사용 이력은 그대로 남습니다).
export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await req.json().catch(() => ({}));
  const { codeId } = body as { codeId?: string };
  if (!codeId) {
    return NextResponse.json({ error: 'codeId is required.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from('society_codes')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', codeId);
  if (error) {
    console.error('[admin/society-codes] 코드 무효화 실패:', error);
    return NextResponse.json({ error: 'Failed to revoke code.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
