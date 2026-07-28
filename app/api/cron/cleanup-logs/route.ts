import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { FREE_LOG_RETENTION_DAYS } from '@/lib/plan-limits';

// 💡 [신규] /privacy 페이지에 적힌 "무료 등급 대화 기록은 30일간 보관" 문구가 실제 동작과
// 어긋나지 않도록, 무료 등급 사용자의 오래된 logs 행을 주기적으로 지우는 유지보수 작업입니다
// (vercel.json의 cron 설정이 매일 이 라우트를 호출). Pro는 이 삭제 대상에서 제외됩니다.
//
// 이 라우트는 세션 쿠키가 아니라 Vercel Cron이 보내는 CRON_SECRET으로만 인증합니다
// (middleware.ts가 /api/cron/*를 세션 검증에서 제외하는 이유) — 특정 사용자 대신이 아니라
// 앱 전체를 대상으로 지우는 유지보수 작업이라 서비스 롤 키로 RLS를 우회해야 하고, 그만큼
// 아무나 호출할 수 없게 반드시 CRON_SECRET을 확인합니다.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cleanup-logs] CRON_SECRET이 설정되지 않았습니다.');
    return NextResponse.json({ error: '서버 설정이 올바르지 않습니다.' }, { status: 500 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[cleanup-logs] Supabase 서비스 롤 설정이 없습니다.');
    return NextResponse.json({ error: '서버 설정이 올바르지 않습니다.' }, { status: 500 });
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Pro 사용자는 보관 기간 제한이 없으므로 삭제 대상에서 제외합니다.
    const { data: proProfiles, error: proError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('is_pro', true);
    if (proError) throw proError;
    const proUserIds = (proProfiles ?? []).map((p) => p.id);

    const cutoff = new Date(Date.now() - FREE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    let query = supabaseAdmin.from('logs').delete({ count: 'exact' }).lt('created_at', cutoff);
    if (proUserIds.length > 0) {
      query = query.not('user_id', 'in', `(${proUserIds.join(',')})`);
    }
    const { error: deleteError, count } = await query;
    if (deleteError) throw deleteError;

    console.log(`[cleanup-logs] 무료 등급 ${FREE_LOG_RETENTION_DAYS}일 초과 대화 ${count ?? 0}건 삭제`);
    return NextResponse.json({ ok: true, deleted: count ?? 0 });
  } catch (error) {
    console.error('[cleanup-logs] 대화 기록 정리 중 오류 발생:', error);
    return NextResponse.json({ error: '대화 기록 정리에 실패했어요.' }, { status: 500 });
  }
}
