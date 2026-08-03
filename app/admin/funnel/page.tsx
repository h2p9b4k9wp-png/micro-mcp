import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { getSessionUserEmail } from '@/lib/auth/session';

export const metadata = {
  title: 'Funnel — Carrotly Admin',
  robots: { index: false, follow: false },
};

// 💡 [신규] 전환 퍼널(랜딩 방문 → 파일 업로드 → 결과 확인 → 회원가입 → 결제) 단계별
// 도달자 수를 보여주는 관리자 전용 페이지입니다. 이 앱에는 admin/역할 개념이 아예 없어서
// (1인 운영), 새 컬럼·테이블 없이 ADMIN_EMAIL 환경변수 하나와 로그인 이메일을 비교하는
// 방식으로만 막습니다. middleware.ts가 /admin/*를 isPublicRoute에 넣지 않아 비로그인
// 접근은 이미 /login으로 막히고, 여기서는 "로그인은 했지만 관리자가 아닌" 경우를 추가로
// 막습니다.
const FUNNEL_STEPS: { key: string; label: string }[] = [
  { key: 'landing_visit', label: '랜딩 방문' },
  { key: 'file_upload', label: '파일 업로드' },
  { key: 'result_view', label: '결과 확인' },
  { key: 'signup', label: '회원가입' },
  { key: 'payment', label: '결제(체크아웃 클릭)' },
];

export default async function AdminFunnelPage() {
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

  // 💡 Supabase JS 클라이언트가 count-distinct를 직접 지원하지 않아서
  // (lib/anonymous-usage.ts의 countDistinctSessionsToday와 같은 이유), event_type별
  // anon_id를 전부 가져와 Set으로 중복 제거합니다. 이 테이블은 아직 방문 단위 이벤트라
  // 데이터량이 크지 않아 이 방식으로 충분합니다.
  const { data, error } = await supabaseAdmin.from('funnel_events').select('anon_id, event_type');
  if (error) {
    return (
      <div className="min-h-screen bg-[#15131A] text-[#E4DEEA] flex items-center justify-center p-8">
        <p>퍼널 데이터를 불러오지 못했어요: {error.message}</p>
      </div>
    );
  }

  const distinctByStep = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    if (!distinctByStep.has(row.event_type)) distinctByStep.set(row.event_type, new Set());
    distinctByStep.get(row.event_type)!.add(row.anon_id);
  }

  const counts = FUNNEL_STEPS.map((step) => distinctByStep.get(step.key)?.size ?? 0);
  const landingCount = counts[0] ?? 0;

  return (
    <div className="min-h-screen bg-[#15131A] text-[#E4DEEA]">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F2F7] mb-2 tracking-tight">
          전환 퍼널
        </h1>
        <p className="text-sm text-[#AFA6BD] mb-10">
          단계별 순방문자 수(anon_id 기준 중복 제거) · 랜딩 방문 대비 비율 · 직전 단계 대비 이탈률
        </p>

        <div className="flex flex-col gap-3">
          {FUNNEL_STEPS.map((step, i) => {
            const count = counts[i];
            const pctOfLanding = landingCount > 0 ? Math.round((count / landingCount) * 100) : 0;
            const prevCount = i > 0 ? counts[i - 1] : count;
            const dropOffFromPrev = i > 0 && prevCount > 0 ? Math.round(((prevCount - count) / prevCount) * 100) : null;

            return (
              <div key={step.key} className="bg-[#1C1922] border border-[#2A2632] rounded-xl p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-sm font-semibold text-[#F5F2F7]">{step.label}</span>
                  <span className="text-xs text-[#857C93]">
                    {count.toLocaleString()}명 · 랜딩 대비 {pctOfLanding}%
                    {dropOffFromPrev !== null && <> · 직전 단계 대비 -{dropOffFromPrev}%</>}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#2A2632] overflow-hidden">
                  <div className="h-full bg-[#F4679B]" style={{ width: `${pctOfLanding}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {landingCount === 0 && (
          <p className="mt-8 text-sm text-[#857C93]">
            아직 기록된 랜딩 방문 이벤트가 없어요. /welcome을 방문하면 첫 이벤트가 쌓입니다.
          </p>
        )}
      </div>
    </div>
  );
}
