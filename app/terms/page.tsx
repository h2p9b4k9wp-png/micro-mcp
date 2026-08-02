import Link from 'next/link';
import { PRO_PRICE_LABEL } from '@/lib/plan-limits';

export const metadata = {
  title: 'Terms of Service — Carrotly',
  description: 'The terms that apply when you use Carrotly.',
};

// 💡 [신규] GDPR/결제 점검 중 발견 — 이 저장소엔 이용약관 페이지 자체가 아예 없었습니다
// (/pricing, /privacy만 있었음). Polar가 Merchant of Record라는 사실을 명시할 곳이 없었던
// 근본 원인이 이거였습니다. /privacy와 같은 이유로 로그인 없이도 봐야 하는 공개 법적
// 페이지라 next-intl을 거치지 않고 영어로 고정된 정적 텍스트를 씁니다 — middleware.ts의
// isPublicRoute에 '/terms'를 추가해야 로그인 안 한 방문자도 접근할 수 있습니다.
//
// 💡 이 페이지는 스타터 초안입니다 — 특히 "Governing Law"의 관할지와 "Storage location"류
// 항목은 코드베이스만으로 알 수 없어 자리표시자로 남겨뒀습니다. 실제 서비스에 적용하기 전에
// 변호사 검토를 권장합니다.
export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="text-sm text-[#857C93] mb-10">Last updated: August 2026</p>

        <div className="flex flex-col gap-8 text-[15px] leading-relaxed">
          <section>
            <p>
              These terms govern your use of Carrotly (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;the
              service&rdquo;), a personal AI work assistant that reads and organizes documents you
              upload. By creating an account or using the service, you agree to these terms. If you
              don&rsquo;t agree, please don&rsquo;t use the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">The service</h2>
            <p>
              Carrotly lets you upload documents, photos, and other files and uses AI to extract
              deadlines, summarize content, predict likely exam/assignment questions, and answer
              questions about what you&rsquo;ve uploaded. Some features require an account; a limited
              set of features can be tried without one, subject to usage limits described in the
              product itself.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Your account</h2>
            <p>
              You&rsquo;re responsible for keeping your login credentials secure and for all activity
              under your account. You must provide a valid email address and are responsible for its
              accuracy. You can delete your account at any time — see{' '}
              <Link href="/privacy" className="text-[#F4679B] hover:underline">
                our Privacy Policy
              </Link>{' '}
              for how.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Subscriptions &amp; payment</h2>
            <p>
              Carrotly offers a free plan and a paid &ldquo;Pro&rdquo; plan ({PRO_PRICE_LABEL}) with
              higher usage limits — see{' '}
              <Link href="/pricing" className="text-[#F4679B] hover:underline">
                Pricing
              </Link>{' '}
              for the current details.
            </p>
            <p className="mt-3">
              <span className="font-semibold text-[#F5F2F7]">
                All payments are processed by Polar Software, Inc. (&ldquo;Polar&rdquo;), acting as
                the Merchant of Record for this purchase.
              </span>{' '}
              This means Polar — not Carrotly — is the seller you&rsquo;re contracting with for the
              transaction itself: Polar appears as the merchant on your card/bank statement, collects
              and remits any applicable sales tax or VAT, and handles billing, invoicing, and
              payment-related customer support. Refund requests, billing disputes, and chargebacks
              are handled under{' '}
              <a
                href="https://polar.sh/legal/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#F4679B] hover:underline"
              >
                Polar&rsquo;s own terms
              </a>
              . We receive confirmation that a payment succeeded (and the reference tied to your
              account) so we can upgrade you to Pro — we don&rsquo;t receive or store your full
              payment card details.
            </p>
            <p className="mt-3">
              Subscriptions renew automatically each billing period until cancelled. You can manage
              or cancel your subscription through the receipt/confirmation email Polar sends you
              after checkout, or by contacting us at the email below and we&rsquo;ll help you reach
              Polar.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">AI-generated content</h2>
            <p>
              Summaries, predicted questions, deadlines, and answers are generated by AI models and
              can be incomplete, outdated, or wrong. Carrotly is a study/work aid, not a substitute
              for reading your actual source material or verifying important dates and requirements
              yourself. Don&rsquo;t rely on AI output alone for anything with real consequences (exam
              dates, assignment requirements, legal or medical decisions, etc.).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Your content</h2>
            <p>
              You keep ownership of whatever you upload. You&rsquo;re responsible for having the
              right to upload it, and for not uploading anything illegal, or content that infringes
              someone else&rsquo;s rights. We only use your content to provide the service to you (see{' '}
              <Link href="/privacy" className="text-[#F4679B] hover:underline">
                our Privacy Policy
              </Link>{' '}
              for exactly who it&rsquo;s shared with and why) — we don&rsquo;t claim ownership of it
              and don&rsquo;t use it to train AI models.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Acceptable use</h2>
            <p>Please don&rsquo;t use Carrotly to:</p>
            <ul className="flex flex-col gap-2 list-disc list-inside marker:text-[#F4679B] mt-2">
              <li>Break the law, or upload content you don&rsquo;t have the right to share.</li>
              <li>Attempt to disrupt, overload, or gain unauthorized access to the service.</li>
              <li>Resell or provide the service to others without our agreement.</li>
              <li>Circumvent usage limits (e.g. free/Pro plan caps) through abuse or automation.</li>
            </ul>
            <p className="mt-3">
              We can suspend or terminate accounts that violate these terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Disclaimer &amp; limitation of liability</h2>
            <p>
              Carrotly is provided &ldquo;as is&rdquo;, without warranties of any kind. We don&rsquo;t
              guarantee the service will be uninterrupted, error-free, or that AI output will be
              accurate. To the maximum extent permitted by law, Carrotly is not liable for indirect,
              incidental, or consequential damages arising from your use of the service — including
              decisions made based on AI-generated content.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Changes to these terms</h2>
            <p>
              We may update these terms as the service changes. If we make material changes,
              we&rsquo;ll update the &ldquo;Last updated&rdquo; date above; continued use of the
              service after a change means you accept the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Governing law</h2>
            <p>
              {/* TODO: 실제 관할지로 바꿔주세요 — 코드베이스만으로는 알 수 없는 값이라
                  추측해서 채우지 않았습니다. */}
              [Insert governing law / jurisdiction, e.g. &ldquo;the laws of the Republic of
              Korea&rdquo;].
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">Contact</h2>
            <p>
              Questions about these terms can be sent to{' '}
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
