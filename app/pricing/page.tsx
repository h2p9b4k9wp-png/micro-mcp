import Link from 'next/link';
import { FREE_LIMITS, PRO_LIMITS, PRO_PRICE_LABEL, FREE_LOG_RETENTION_DAYS } from '@/lib/plan-limits';

export const metadata = {
  title: 'Pricing — Carrotly',
  description: 'Carrotly Free and Pro plans.',
};

// 💡 [신규] 로그인 없이도 봐야 하는 공개 페이지라(middleware.ts의 isPublicRoute에 등록)
// /privacy와 마찬가지로 next-intl을 거치지 않는 영어 고정 텍스트입니다. 숫자는
// lib/plan-limits.ts의 상수를 그대로 읽어서, 실제 한도가 바뀌면 이 페이지도 자동으로
// 맞게 표시됩니다(가격은 PRO_PRICE_LABEL 하나로 앱 전체가 공유 — 업그레이드 모달, 한도
// 초과 안내도 같은 값을 씁니다).
export default function PricingPage() {
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

            <Link
              href="/login"
              className="mt-8 w-full text-center py-2.5 rounded-lg bg-[#F4679B] hover:bg-[#D1477F] text-white text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
            >
              Upgrade to Pro — {PRO_PRICE_LABEL}
            </Link>
          </div>
        </div>

        <p className="text-xs text-[#5B5566] mt-8 text-center sm:text-left">
          No payment integration yet — requesting Pro from inside the app sends us your email and
          we&rsquo;ll follow up. See our{' '}
          <Link href="/privacy" className="text-[#857C93] hover:text-[#F4679B] underline underline-offset-2">
            Privacy Policy
          </Link>{' '}
          for how we handle your data.
        </p>
      </div>
    </div>
  );
}
