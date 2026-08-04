import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUserEmail } from '@/lib/auth/session';
import { getMonthStartISOString } from '@/lib/plan-limits';
import { getSocietyCodeMonthlyTokenTotal, getSupabaseAdmin, SOCIETY_CODE_MONTHLY_ANALYSIS_LIMIT } from '@/lib/society-codes';
import { SocietyCodeAdmin } from '@/components/admin/society-code-admin';

export const metadata = {
  title: 'Society Codes — Carrotly Admin',
  robots: { index: false, follow: false },
};

// 💡 [신규] app/admin/ai-usage·funnel과 같은 ADMIN_EMAIL 인증 패턴 — 서버 컴포넌트에서
// 직접 이메일을 대조하고, 관리자가 아니면 '/'로 돌려보냅니다. 데이터 조회(코드 목록,
// 코드별 사용 인원·이번 달 토큰 사용량)는 전부 여기서 서비스 롤로 미리 계산해 클라이언트
// 컴포넌트(SocietyCodeAdmin)에 넘겨주고, 그 컴포넌트는 발급/무효화 같은 쓰기 동작만
// /api/admin/society-codes로 보낸 뒤 router.refresh()로 이 페이지를 다시 그리게 합니다.
export default async function AdminSocietyCodesPage() {
  const email = await getSessionUserEmail();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!email || !adminEmail || email !== adminEmail) {
    redirect('/');
  }

  const supabaseAdmin = getSupabaseAdmin();
  const monthStart = getMonthStartISOString();

  const [{ data: codes, error: codesError }, { data: redemptions, error: redemptionsError }] = await Promise.all([
    supabaseAdmin
      .from('society_codes')
      .select('id, code, label, max_uses, expires_at, revoked_at, created_at, created_by')
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('society_code_redemptions').select('code_id, user_id, redeemed_at'),
  ]);

  if (codesError || redemptionsError) {
    return (
      <div className="min-h-screen bg-[#15131A] text-[#E4DEEA] flex items-center justify-center p-8">
        <p>데이터를 불러오지 못했어요: {(codesError || redemptionsError)?.message}</p>
      </div>
    );
  }

  const redemptionsByCode = new Map<string, { userId: string; redeemedAt: string }[]>();
  for (const r of redemptions ?? []) {
    const arr = redemptionsByCode.get(r.code_id) ?? [];
    arr.push({ userId: r.user_id, redeemedAt: r.redeemed_at });
    redemptionsByCode.set(r.code_id, arr);
  }

  // 💡 코드별 "이번 달 토큰 사용량"은 그 코드로 가입한 사용자들의 ai_usage_logs를 합산합니다
  // — 관리자가 "어느 코드로 몇 명 가입했고 토큰을 얼마나 썼는지"를 코드 단위로 볼 수 있게
  // 하는 게 이 페이지의 핵심 요구사항이라, 전체 킬스위치 합계(getSocietyCodeMonthlyTokenTotal)
  // 와는 별도로 코드별 세부 합계를 여기서 한 번 더 계산합니다.
  const allRedeemedUserIds = Array.from(new Set((redemptions ?? []).map((r) => r.user_id)));
  const usageByUser = new Map<string, number>();
  if (allRedeemedUserIds.length > 0) {
    const { data: usageRows } = await supabaseAdmin
      .from('ai_usage_logs')
      .select('user_id, total_tokens')
      .in('user_id', allRedeemedUserIds)
      .gte('created_at', monthStart);
    for (const row of usageRows ?? []) {
      usageByUser.set(row.user_id, (usageByUser.get(row.user_id) ?? 0) + (row.total_tokens as number));
    }
  }

  const codesWithStats = (codes ?? []).map((c) => {
    const reds = redemptionsByCode.get(c.id) ?? [];
    const tokensThisMonth = reds.reduce((sum, r) => sum + (usageByUser.get(r.userId) ?? 0), 0);
    return {
      id: c.id as string,
      code: c.code as string,
      label: c.label as string | null,
      maxUses: c.max_uses as number,
      usedCount: reds.length,
      expiresAt: c.expires_at as string,
      revokedAt: c.revoked_at as string | null,
      createdAt: c.created_at as string,
      createdBy: c.created_by as string | null,
      tokensThisMonth,
    };
  });

  const monthlyTokenTotal = await getSocietyCodeMonthlyTokenTotal(supabaseAdmin);
  const tokenLimitRaw = process.env.SOCIETY_CODE_MONTHLY_TOKEN_LIMIT;
  const tokenLimit = tokenLimitRaw ? Number(tokenLimitRaw) : null;

  return (
    <div className="min-h-screen bg-[#15131A] text-[#E4DEEA]">
      <div className="max-w-4xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F2F7] tracking-tight">소사이어티 코드</h1>
          <div className="flex items-center gap-4 text-xs">
            <Link href="/admin/ai-usage" className="text-[#857C93] hover:text-[#F4679B] transition-colors">
              AI 사용량 →
            </Link>
            <Link href="/admin/funnel" className="text-[#857C93] hover:text-[#F4679B] transition-colors">
              전환 퍼널 →
            </Link>
          </div>
        </div>
        <p className="text-sm text-[#AFA6BD] mb-10">
          코드로 가입한 계정에는 결제 없이 코드 만료일까지 Pro가 부여됩니다. 1인당 월 분석 {SOCIETY_CODE_MONTHLY_ANALYSIS_LIMIT}회 상한이 자동으로 적용되고,
          {tokenLimit ? ` 전체 코드 사용자 월 토큰 합계가 ${tokenLimit.toLocaleString()}을 넘으면 신규 코드 사용이 자동으로 막힙니다.` : ' 킬스위치는 SOCIETY_CODE_MONTHLY_TOKEN_LIMIT 환경변수가 없어 꺼져 있어요.'}
        </p>

        <div className="bg-[#1C1922] border border-[#2A2632] rounded-xl p-5 mb-8">
          <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-3">이번 달 코드 사용자 전체</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-2xl font-extrabold text-[#F5F2F7]">{codesWithStats.reduce((s, c) => s + c.usedCount, 0).toLocaleString()}</p>
              <p className="text-xs text-[#857C93] mt-1">가입한 인원</p>
            </div>
            <div>
              <p className={`text-2xl font-extrabold ${tokenLimit && monthlyTokenTotal >= tokenLimit ? 'text-[var(--accent-danger)]' : 'text-[#F5F2F7]'}`}>
                {monthlyTokenTotal.toLocaleString()}
              </p>
              <p className="text-xs text-[#857C93] mt-1">
                총 토큰 사용{tokenLimit ? ` / 한도 ${tokenLimit.toLocaleString()}` : ''}
              </p>
            </div>
            {tokenLimit && monthlyTokenTotal >= tokenLimit && (
              <div className="col-span-2 sm:col-span-1 flex items-center">
                <p className="text-xs font-semibold text-[var(--accent-danger)]">⚠ 킬스위치 작동 중 — 신규 코드 사용이 막혀 있어요</p>
              </div>
            )}
          </div>
        </div>

        <SocietyCodeAdmin initialCodes={codesWithStats} />
      </div>
    </div>
  );
}
