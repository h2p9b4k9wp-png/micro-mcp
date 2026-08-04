import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';
import { FREE_LOG_RETENTION_DAYS } from '@/lib/plan-limits';
import { ANONYMOUS_USAGE_RETENTION_DAYS } from '@/lib/anonymous-usage';

// 💡 [신규] CRON_SECRET 비교를 타이밍 세이프하게 — 기존 `authHeader !== \`Bearer ${cronSecret}\``는
// 문자열을 앞에서부터 순서대로 비교하다 첫 불일치 지점에서 바로 반환하는 일반적인 JS 문자열
// 비교라, 이론적으로는 응답 시간 차이를 정밀하게 측정해 시크릿을 한 글자씩 알아내는 타이밍
// 공격에 노출됩니다(인터넷을 통한 원격 공격은 네트워크 지연/지터 때문에 실제로는 어렵지만,
// 비용 없이 막을 수 있는 방어라 적용합니다). timingSafeEqual은 두 버퍼의 길이가 같아야
// 하므로, 길이가 다르면 그 자체로 불일치로 처리합니다(길이 비교는 타이밍에 실질적 정보를
// 노출하지 않습니다 — 시크릿 값 자체의 내용과 무관하게 고정된 접두사 "Bearer "의 존재만으로도
// 대부분의 길이가 이미 드러나 있습니다).
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// 💡 [신규] /privacy 페이지에 적힌 "무료 등급 대화 기록은 30일간 보관" 문구가 실제 동작과
// 어긋나지 않도록, 무료 등급 사용자의 오래된 logs 행을 주기적으로 지우는 유지보수 작업입니다
// (vercel.json의 cron 설정이 매일 이 라우트를 호출). Pro는 이 삭제 대상에서 제외됩니다.
//
// 💡 [수정] anonymous_trial_usage(게스트 체험 남용 방지용 IP 로그) 정리도 같은 라우트에
// 얹었습니다 — 새 cron을 따로 만들 만큼 다른 일이 아니라(둘 다 "오래된 행을 매일 지운다"는
// 동일한 유지보수 작업), 이미 매일 도는 이 라우트에 붙이는 쪽이 더 간단합니다. IP 주소는
// 개인정보라 /privacy 페이지도 "{days}일 후 자동 삭제"를 약속하는데(privacy.retention.ip),
// 이 삭제 로직이 그 약속을 실제로 지킵니다. logs와 달리 Pro/무료 구분이 없습니다 —
// anonymous_trial_usage는 로그인 여부와 무관한 익명 요청 로그라 사용자 등급 개념 자체가
// 없습니다.
//
// 💡 [수정] 소사이어티 코드(lib/society-codes.ts)로 얻은 Pro의 만료 처리도 같은 라우트에
// 얹었습니다 — Polar 구독과 달리 코드 만료는 외부 이벤트(웹훅)가 없어서, 이 cron이 매일
// profiles.pro_expires_at을 확인해 직접 강등시켜야 합니다.
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
  if (!authHeader || !timingSafeEqualStrings(authHeader, `Bearer ${cronSecret}`)) {
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

    // 💡 게스트 IP 로그 정리 — 등급 구분 없이 ANONYMOUS_USAGE_RETENTION_DAYS보다 오래된
    // 행을 전부 지웁니다.
    const anonymousUsageCutoff = new Date(
      Date.now() - ANONYMOUS_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const { error: anonymousUsageDeleteError, count: anonymousUsageDeletedCount } = await supabaseAdmin
      .from('anonymous_trial_usage')
      .delete({ count: 'exact' })
      .lt('created_at', anonymousUsageCutoff);
    if (anonymousUsageDeleteError) throw anonymousUsageDeleteError;

    console.log(
      `[cleanup-logs] ${ANONYMOUS_USAGE_RETENTION_DAYS}일 초과 게스트 IP 로그 ${anonymousUsageDeletedCount ?? 0}건 삭제`
    );

    // 💡 [신규] 소사이어티 코드로 얻은 Pro 만료 처리 — 결제 기반 Pro는 Polar 웹훅이 즉시
    // 반영하지만, 코드 기반 Pro는 별도 웹훅이 없어서(코드 만료는 그냥 시간이 지나는 것뿐,
    // Polar처럼 알려주는 외부 이벤트가 없음) 매일 도는 이 cron이 직접 pro_expires_at을
    // 지난 코드 기반 Pro 계정을 찾아 무료 등급으로 되돌립니다 — 새 cron을 따로 만들 만큼
    // 다른 일이 아니라(둘 다 "만료 조건을 매일 확인해 상태를 되돌린다"는 동일한 유지보수
    // 작업), 이미 매일 도는 이 라우트에 붙였습니다.
    const { data: expiredCodeProfiles, error: expiredError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('pro_source', 'code')
      .lt('pro_expires_at', new Date().toISOString());
    if (expiredError) throw expiredError;

    let expiredCodeProCount = 0;
    if (expiredCodeProfiles && expiredCodeProfiles.length > 0) {
      const expiredIds = expiredCodeProfiles.map((p) => p.id);
      const { error: demoteError } = await supabaseAdmin
        .from('profiles')
        .update({ is_pro: false, pro_source: null, pro_expires_at: null })
        .in('id', expiredIds);
      if (demoteError) throw demoteError;
      expiredCodeProCount = expiredIds.length;
    }

    console.log(`[cleanup-logs] 소사이어티 코드 만료로 무료 등급 강등 ${expiredCodeProCount}건`);

    return NextResponse.json({
      ok: true,
      deletedLogs: count ?? 0,
      deletedAnonymousUsage: anonymousUsageDeletedCount ?? 0,
      expiredCodePro: expiredCodeProCount,
    });
  } catch (error) {
    console.error('[cleanup-logs] 정리 작업 중 오류 발생:', error);
    return NextResponse.json({ error: '정리 작업에 실패했어요.' }, { status: 500 });
  }
}
