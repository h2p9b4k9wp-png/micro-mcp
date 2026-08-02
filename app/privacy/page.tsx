import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — Carrotly',
  description: 'How Carrotly collects, uses, and stores your data.',
};

// 💡 [신규] 로그인 없이도 봐야 하는 공개 법적 페이지라 next-intl(ko/en 전환)을 거치지 않고
// 영어로 고정된 정적 텍스트를 씁니다(요청대로). middleware.ts의 isPublicRoute에 '/privacy'가
// 추가돼 있어야 로그인 안 한 방문자도 접근할 수 있습니다.
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#15131A] text-[#E4DEEA]">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
        <Link
          href="/"
          className="text-sm text-[#AFA6BD] hover:text-[#F5F2F7] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
        >
          ← Back to Carrotly
        </Link>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F2F7] mt-6 mb-2 tracking-tight">
          Privacy Policy
        </h1>
        <p className="text-sm text-[#857C93] mb-10">Last updated: August 2026</p>

        <div className="flex flex-col gap-8 text-[15px] leading-relaxed">
          <section>
            <p>
              Carrotly (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;the service&rdquo;) is a personal AI work
              assistant. This page explains what information we collect when you use it, why we
              collect it, who we share it with, how long we keep it, and what rights you have
              over it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Information we collect</h2>
            <ul className="flex flex-col gap-2 list-disc list-inside marker:text-[#F4679B]">
              <li>
                <span className="font-semibold text-[#F5F2F7]">Your email address</span>, used to
                create and identify your account.
              </li>
              <li>
                <span className="font-semibold text-[#F5F2F7]">The content of files you upload</span>{' '}
                — documents, lecture materials, and images you attach or add to the service —
                including the text extracted from them.
              </li>
              <li>
                <span className="font-semibold text-[#F5F2F7]">Your conversation history</span> —
                the prompts you send and the responses you receive.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Why we collect it</h2>
            <p>We use this information to:</p>
            <ul className="flex flex-col gap-2 list-disc list-inside marker:text-[#F4679B] mt-2">
              <li>Provide and operate the service — authenticate you, save your files and
                deadlines, and keep your conversation history available across devices.</li>
              <li>Generate AI-powered analysis you request — summarizing documents, extracting
                deadlines, drafting answers to expected questions, and similar features.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Who we share it with</h2>
            <p>We do not sell your data. We share it only with the service providers that make Carrotly work:</p>
            <ul className="flex flex-col gap-2 list-disc list-inside marker:text-[#F4679B] mt-2">
              <li>
                <span className="font-semibold text-[#F5F2F7]">OpenAI</span> — receives the text of
                your prompts, attached documents, and images so it can generate the AI analysis
                and responses you ask for.
              </li>
              <li>
                <span className="font-semibold text-[#F5F2F7]">Supabase</span> — our database and
                authentication provider, used to store your account, files, and conversation
                history. Your data is hosted in Supabase&rsquo;s{' '}
                <span className="font-semibold text-[#F5F2F7]">
                  {/* TODO: 실제 Supabase 프로젝트 리전으로 바꿔주세요 (Supabase 대시보드 →
                      Project Settings → General → Region에서 확인) — 코드베이스만으로는
                      알 수 없는 값이라 추측해서 채우지 않았습니다. */}
                  [insert Supabase project region, e.g. &ldquo;US East (N. Virginia)&rdquo;]
                </span>{' '}
                region.
              </li>
              <li>
                <span className="font-semibold text-[#F5F2F7]">Polar</span> — our payment processor,
                used to handle Pro subscription checkout and billing. Polar receives the
                information needed to process your payment (such as your email address); we do
                not send them your files or conversation history.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">How long we keep it</h2>
            <ul className="flex flex-col gap-2 list-disc list-inside marker:text-[#F4679B]">
              <li>Your account data (email, files, deadlines) is kept until you delete your account.</li>
              <li>On the free plan, conversation history is kept for 30 days and then automatically deleted. Pro accounts have no automatic deletion — conversation history is kept until account deletion, same as everything else.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Your rights</h2>
            <p>
              You can request a copy of the data we hold about you at any time by emailing us at
              the address below — we&rsquo;ll respond as soon as we can.
            </p>
            <p className="mt-3">
              To delete your account, use the &ldquo;Delete Account&rdquo; button at the bottom of
              the sidebar once you&rsquo;re logged in — it immediately and permanently deletes your
              uploaded files, professor materials, conversation history, and your login credentials
              (email, sign-in info) themselves, with no need to email us first. If you&rsquo;d rather
              have us do it for you, email us and we&rsquo;ll delete it manually.
            </p>
            <p className="mt-3">
              If you have an active Pro subscription, deleting your account does not cancel it —
              Polar (our Merchant of Record, see{' '}
              <Link href="/terms" className="text-[#F4679B] hover:underline">
                Terms of Service
              </Link>
              ) handles billing independently of your Carrotly login, so we have no way to cancel
              it on your behalf. You&rsquo;ll need to cancel your subscription first (via the
              link in the receipt/confirmation email Polar sent you, or by emailing us) before we
              can delete your account.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Contact</h2>
            <p>
              Questions about this policy, or requests to access or delete your data, can be sent to{' '}
              <a
                href="mailto:kcw022@naver.com"
                className="text-[#F4679B] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
              >
                kcw022@naver.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
