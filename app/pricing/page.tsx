import Link from 'next/link';
import {
  FREE_LIMITS,
  PRO_LIMITS,
  PRO_PRICE_LABEL,
  FREE_LOG_RETENTION_DAYS,
  getIsPro,
  getPolarCheckoutUrl,
} from '@/lib/plan-limits';
import { getSessionUser } from '@/lib/auth/session';
import { SITE_URL } from '@/lib/site-config';

export const metadata = {
  title: 'Pricing — Carrotly',
  description: 'Carrotly Free and Pro plans.',
  alternates: {
    canonical: `${SITE_URL}/pricing`,
  },
};

// 💡 [신규] 로그인 없이도 봐야 하는 공개 페이지라(middleware.ts의 isPublicRoute에 등록)
// /privacy와 마찬가지로 next-intl을 거치지 않는 영어 고정 텍스트입니다. 숫자는
// lib/plan-limits.ts의 상수를 그대로 읽어서, 실제 한도가 바뀌면 이 페이지도 자동으로
// 맞게 표시됩니다(가격은 PRO_PRICE_LABEL 하나로 앱 전체가 공유 — 업그레이드 모달, 한도
// 초과 안내도 같은 값을 씁니다).
// 💡 [수정] Pro 카드의 CTA를 로그인 상태로 분기합니다. 예전에는 상태와 무관하게 항상
// /login으로 보냈는데, 이미 로그인한 무료 사용자에게는 그게 막다른 길이었습니다(로그인
// 되어 있으니 /login은 앱으로 되돌려보낼 뿐, 결제로 이어지지 않음). 사이드바 Pro 배지를
// Pro 전용으로 바꾸면서 자발적 업그레이드 경로가 사라진 것도 이 때문입니다.
//
// 세 갈래:
//   비로그인        → 기존대로 /login (가입 후 다시 오면 아래 두 갈래로 들어옵니다)
//   로그인 + Pro    → 버튼 대신 "이미 Pro" 표시 (결제 페이지로 보낼 이유가 없음)
//   로그인 + 무료   → Polar 체크아웃으로 직행 (app/page.tsx 업그레이드 모달과 같은
//                     getPolarCheckoutUrl을 재사용하므로 reference_id 규칙이 어긋날 일 없음)
//
// 이 페이지는 next-intl을 거치지 않는 영어 고정 텍스트라(위 주석 참고) 추가 문구도 영어입니다.
async function resolveProCta(): Promise<
  { kind: 'anonymous' } | { kind: 'already-pro' } | { kind: 'checkout'; url: string }
> {
  const { supabase, userId, email } = await getSessionUser();
  if (!userId) return { kind: 'anonymous' };

  if (await getIsPro(supabase, userId)) return { kind: 'already-pro' };

  // 💡 getPolarCheckoutUrl은 NEXT_PUBLIC_POLAR_CHECKOUT_URL이 없으면 throw합니다. 이 페이지는
  // 결제와 무관하게 누구나 보는 공개 요금 안내라, 환경변수 하나 때문에 페이지 전체가 500이
  // 되면 안 됩니다 — 실패하면 기존 동작(/login)으로 조용히 되돌아갑니다.
  try {
    return { kind: 'checkout', url: getPolarCheckoutUrl(userId, email) };
  } catch (err) {
    console.error('[pricing] Polar 체크아웃 URL을 만들지 못했습니다:', err);
    return { kind: 'anonymous' };
  }
}

export default async function PricingPage() {
  const proCta = await resolveProCta();

  return (
    <div className="min-h-screen bg-[#15131A] text-[#E4DEEA]">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
        <Link
          href="/"
          className="text-sm text-[#AFA6BD] hover:text-[#F5F2F7] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
        >
          ← Back to Carrotly
        </Link>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F2F7] mt-6 mb-2 tracking-tight text-center sm:text-left">
          Pricing
        </h1>
        <p className="text-sm text-[#AFA6BD] mb-10 text-center sm:text-left">
          Start for free. Upgrade whenever you outgrow it.
        </p>

        <div className="grid sm:grid-cols-2 gap-5">
          {/* Free */}
          <div className="bg-[#211E28] border border-[#322D3B] rounded-2xl p-6 flex flex-col">
            <h2 className="text-lg font-bold text-[#F5F2F7]">Free</h2>
            <p className="text-3xl font-extrabold text-[#F5F2F7] mt-2 mb-1">$0</p>
            <p className="text-xs text-[#857C93] mb-6">forever</p>

            <ul className="flex flex-col gap-3 text-sm text-[#C9C0D6]">
              <li className="flex items-start gap-2">
                <span className="text-[#6EE7B7] shrink-0">✓</span>
                {FREE_LIMITS.filesPerMonth} file analyses / month
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#6EE7B7] shrink-0">✓</span>
                {FREE_LIMITS.chatsPerMonth} chat messages / month
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#6EE7B7] shrink-0">✓</span>
                {FREE_LIMITS.maxProfessors} professor
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#6EE7B7] shrink-0">✓</span>
                {FREE_LIMITS.maxDocumentsPerProfessor} documents per professor
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#6EE7B7] shrink-0">✓</span>
                Conversation history kept for {FREE_LOG_RETENTION_DAYS} days
              </li>
            </ul>

            <Link
              href="/login"
              className="mt-8 w-full text-center py-2.5 rounded-lg border border-[#423B4C] text-[#C9C0D6] text-sm font-semibold hover:bg-[#15131A] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
            >
              Get started free
            </Link>
          </div>

          {/* Pro */}
          <div className="bg-[#211E28] border border-[#F4679B] rounded-2xl p-6 flex flex-col relative">
            <span className="absolute -top-3 right-6 bg-[#F4679B] text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
              RECOMMENDED
            </span>
            <h2 className="text-lg font-bold text-[#F5F2F7]">Pro</h2>
            <p className="text-3xl font-extrabold text-[#F5F2F7] mt-2 mb-1">{PRO_PRICE_LABEL}</p>
            <p className="text-xs text-[#857C93] mb-6">billed monthly</p>

            <ul className="flex flex-col gap-3 text-sm text-[#C9C0D6]">
              <li className="flex items-start gap-2">
                <span className="text-[#F4679B] shrink-0">✓</span>
                {PRO_LIMITS.filesPerMonth} file analyses / month
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#F4679B] shrink-0">✓</span>
                {PRO_LIMITS.chatsPerMonth} chat messages / month
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#F4679B] shrink-0">✓</span>
                Unlimited professors
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#F4679B] shrink-0">✓</span>
                Unlimited documents per professor
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#F4679B] shrink-0">✓</span>
                Conversation history kept forever
              </li>
            </ul>

            {proCta.kind === 'already-pro' ? (
              <p className="mt-8 w-full text-center py-2.5 rounded-lg border border-[#6EE7B7]/50 text-[#6EE7B7] text-sm font-semibold">
                You&rsquo;re already on Pro
              </p>
            ) : proCta.kind === 'checkout' ? (
              // 외부(Polar) 결제 페이지라 next/link가 아니라 평범한 <a>로, 새 탭에서 엽니다 —
              // app/page.tsx의 업그레이드 모달과 같은 동작(결제하러 가는 동안 앱을 잃지 않음).
              <a
                href={proCta.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-8 w-full text-center py-2.5 rounded-lg bg-[#F4679B] hover:bg-[#D1477F] text-white text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
              >
                Upgrade to Pro — {PRO_PRICE_LABEL}
              </a>
            ) : (
              <Link
                href="/login"
                className="mt-8 w-full text-center py-2.5 rounded-lg bg-[#F4679B] hover:bg-[#D1477F] text-white text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
              >
                Upgrade to Pro — {PRO_PRICE_LABEL}
              </Link>
            )}
          </div>
        </div>

        {/* 💡 [수정] 예전에는 "No payment integration yet — 앱에서 Pro를 요청하면 이메일로
            연락드립니다"라고 적혀 있었는데, Polar 결제가 붙은 뒤로 사실과 어긋났습니다. 특히
            위 버튼이 이제 실제 결제 페이지로 가기 때문에, 바로 아래에서 "아직 결제가 없다"고
            말하면 그 자리에서 모순됩니다. */}
        <p className="text-xs text-[#5B5566] mt-8 text-center sm:text-left">
          Payments are handled by Polar. You can cancel anytime from the billing portal. See our{' '}
          <Link href="/privacy" className="text-[#857C93] hover:text-[#F4679B] underline underline-offset-2">
            Privacy Policy
          </Link>{' '}
          for how we handle your data.
        </p>
      </div>
    </div>
  );
}
