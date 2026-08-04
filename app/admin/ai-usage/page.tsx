import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { getSessionUserEmail } from '@/lib/auth/session';
import { getMonthStartISOString } from '@/lib/plan-limits';
import { estimateCostUSD } from '@/lib/ai-pricing';

export const metadata = {
  title: 'AI Usage — Carrotly Admin',
  robots: { index: false, follow: false },
};

// 💡 [신규] "이번 달 총 토큰 사용량과 예상 비용"을 보여주는 관리자 전용 페이지 —
// app/admin/funnel/page.tsx와 완전히 같은 인증 패턴(ADMIN_EMAIL 환경변수와 로그인 이메일
// 비교, middleware.ts가 /admin/*를 비로그인 접근으로부터 이미 막아줌)입니다. 집계 대상은
// ai_usage_logs 하나뿐입니다 — app/api/analyze·app/api/analyze-professor가 OpenAI 응답의
// 실제 usage(prompt_tokens/completion_tokens)를 매 호출마다 그대로 기록해둔 실측 데이터라
// (lib/ai-usage-logging.ts), 여기서는 이번 달 범위로 조회해 합산·가격 환산만 합니다.
const ROUTE_LABELS: Record<string, string> = {
  analyze: '/api/analyze (파일 분석)',
  'analyze-professor': '/api/analyze-professor (강의자/교수님 분석)',
};

export default async function AdminAiUsagePage() {
  const email = await getSessionUserEmail();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!email || !adminEmail || email !== adminEmail) {
    redirect('/');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return (
      <div className="min-h-screen bg-[#15131A] text-[#E4DEEA] flex items-center justify-center p-8">
        <p>서버 설정이 올바르지 않습니다.</p>
      </div>
    );
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const monthStart = getMonthStartISOString();
  const { data, error } = await supabaseAdmin
    .from('ai_usage_logs')
    .select('route, model, prompt_tokens, completion_tokens, total_tokens')
    .gte('created_at', monthStart);

  if (error) {
    return (
      <div className="min-h-screen bg-[#15131A] text-[#E4DEEA] flex items-center justify-center p-8">
        <p>사용량 데이터를 불러오지 못했어요: {error.message}</p>
      </div>
    );
  }

  const rows = data ?? [];

  // 💡 route별로 나눠 집계하고, cost는 행마다 그 행에 저장된 model로 계산합니다(모델이
  // 바뀌어도 과거 행은 그 시점 가격으로 정확하게 — lib/ai-pricing.ts 참고). 가격표에 없는
  // model(estimateCostUSD가 null 반환)이 있으면 그 토큰 수는 별도로 표시하고 합계에서
  // 제외합니다 — 있지도 않은 가격을 0으로 조용히 섞어 넣지 않기 위함입니다.
  interface RouteStats {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUSD: number;
    unpricedTokens: number;
  }
  const byRoute = new Map<string, RouteStats>();
  const unpricedModels = new Set<string>();

  for (const row of rows) {
    const key = row.route;
    const stats = byRoute.get(key) ?? { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUSD: 0, unpricedTokens: 0 };
    stats.calls += 1;
    stats.promptTokens += row.prompt_tokens;
    stats.completionTokens += row.completion_tokens;
    stats.totalTokens += row.total_tokens;
    const cost = estimateCostUSD(row.model, row.prompt_tokens, row.completion_tokens);
    if (cost === null) {
      stats.unpricedTokens += row.total_tokens;
      unpricedModels.add(row.model);
    } else {
      stats.costUSD += cost;
    }
    byRoute.set(key, stats);
  }

  const totals = Array.from(byRoute.values()).reduce(
    (acc, s) => ({
      calls: acc.calls + s.calls,
      promptTokens: acc.promptTokens + s.promptTokens,
      completionTokens: acc.completionTokens + s.completionTokens,
      totalTokens: acc.totalTokens + s.totalTokens,
      costUSD: acc.costUSD + s.costUSD,
      unpricedTokens: acc.unpricedTokens + s.unpricedTokens,
    }),
    { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUSD: 0, unpricedTokens: 0 }
  );

  const fmt = (n: number) => n.toLocaleString();
  const fmtUSD = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

  return (
    <div className="min-h-screen bg-[#15131A] text-[#E4DEEA]">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F2F7] tracking-tight">
            AI 토큰 사용량
          </h1>
          <div className="flex items-center gap-4">
            <Link href="/admin/funnel" className="text-xs text-[#857C93] hover:text-[#F4679B] transition-colors">
              전환 퍼널 →
            </Link>
            <Link href="/admin/society-codes" className="text-xs text-[#857C93] hover:text-[#F4679B] transition-colors">
              소사이어티 코드 →
            </Link>
          </div>
        </div>
        <p className="text-sm text-[#AFA6BD] mb-10">
          이번 달(UTC 월 기준) /api/analyze·/api/analyze-professor 실제 호출의 토큰 사용량과 예상 비용 — OpenAI가 매 호출마다 응답한 실측값입니다(추정 아님).
        </p>

        <div className="bg-[#1C1922] border border-[#2A2632] rounded-xl p-5 mb-6">
          <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-3">이번 달 전체</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-2xl font-extrabold text-[#F5F2F7]">{fmt(totals.calls)}</p>
              <p className="text-xs text-[#857C93] mt-1">호출 횟수</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold text-[#F5F2F7]">{fmt(totals.totalTokens)}</p>
              <p className="text-xs text-[#857C93] mt-1">총 토큰(입력+출력)</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold text-[#F5F2F7]">{fmt(totals.promptTokens)} / {fmt(totals.completionTokens)}</p>
              <p className="text-xs text-[#857C93] mt-1">입력 / 출력 토큰</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold text-[#F4679B]">{fmtUSD(totals.costUSD)}</p>
              <p className="text-xs text-[#857C93] mt-1">예상 비용</p>
            </div>
          </div>
          {totals.unpricedTokens > 0 && (
            <p className="text-xs text-[#857C93] mt-4">
              ⚠ 가격표에 없는 모델({Array.from(unpricedModels).join(', ')})로 호출된 {fmt(totals.unpricedTokens)} 토큰은 위 예상 비용에서 제외됐어요 — lib/ai-pricing.ts에 가격을 추가해주세요.
            </p>
          )}
        </div>

        <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-3">라우트별</p>
        <div className="flex flex-col gap-3">
          {Object.keys(ROUTE_LABELS).map((routeKey) => {
            const s = byRoute.get(routeKey);
            if (!s) {
              return (
                <div key={routeKey} className="bg-[#1C1922] border border-[#2A2632] rounded-xl p-4">
                  <p className="text-sm font-semibold text-[#F5F2F7] mb-1">{ROUTE_LABELS[routeKey]}</p>
                  <p className="text-xs text-[#857C93]">이번 달 호출 없음</p>
                </div>
              );
            }
            const avgTokensPerCall = s.calls > 0 ? Math.round(s.totalTokens / s.calls) : 0;
            const avgCostPerCall = s.calls > 0 ? s.costUSD / s.calls : 0;
            return (
              <div key={routeKey} className="bg-[#1C1922] border border-[#2A2632] rounded-xl p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-sm font-semibold text-[#F5F2F7]">{ROUTE_LABELS[routeKey]}</span>
                  <span className="text-xs text-[#857C93]">{fmt(s.calls)}회 호출 · {fmtUSD(s.costUSD)}</span>
                </div>
                <p className="text-xs text-[#857C93]">
                  입력 {fmt(s.promptTokens)} / 출력 {fmt(s.completionTokens)} 토큰 · 호출당 평균 {fmt(avgTokensPerCall)} 토큰({fmtUSD(avgCostPerCall)})
                </p>
              </div>
            );
          })}
        </div>

        {totals.calls === 0 && (
          <p className="mt-8 text-sm text-[#857C93]">
            이번 달 기록된 호출이 아직 없어요. 로그인 사용자가 파일 분석이나 강의자/교수님 분석을 실행하면 여기 쌓입니다.
          </p>
        )}
      </div>
    </div>
  );
}
