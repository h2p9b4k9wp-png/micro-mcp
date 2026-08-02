import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PRO_PRICE_LABEL } from '@/lib/plan-limits';

// 💡 [수정] /privacy와 같은 이유·같은 패턴으로 next-intl 기반 10개 언어 지원으로 전환했습니다
// — 사용자가 명시적으로 요청했고, 이미 /privacy에서 "법적 페이지도 UI 로케일을 따라간다"는
// 선례를 만들어뒀습니다. getTranslations()는 서버 컴포넌트용이라 이 페이지도 계속 서버
// 컴포넌트로 유지합니다. 굵은 글씨(<b>)·개인정보처리방침 링크(<privacylink>)·요금제 링크
// (<pricinglink>)·Polar 자체 약관 링크(<polarlink>)·메일 링크(<mailto>)는 t.rich()의 태그
// 치환으로 렌더링합니다.
//
// 💡 번역 시 Merchant of Record 조항의 법적 의미가 흐려지지 않도록 "Merchant of Record"라는
// 용어 자체는 /privacy와 동일하게 모든 로케일에서 번역하지 않고 그대로 남겨뒀습니다(이미
// 업계·법률 용어로 굳어진 표현이라 억지로 번역하면 오히려 부정확해질 수 있음). 일본어판은
// 특정商取引法(특정상거래법)상 표시 의무가 실제 거래 당사자인 Polar 쪽에 있다는 점을,
// 독일어·프랑스어·이탈리아어·스페인어·포르투갈어·네덜란드어판은 EU 소비자권리지침에 따른
// Widerrufsrecht/droit de rétractation/diritto di recesso/derecho de desistimiento/direito
// de retratação/herroepingsrecht(청약철회권에 해당하는 각국 법률 용어)가 있다면 그 권리
// 행사도 Merchant of Record인 Polar를 통해 이루어진다는 점을 명시했습니다 — Carrotly가 이
// 요건들을 자체적으로 준수한다고 주장하는 게 아니라, "실제 판매자는 Polar이므로 그쪽 규정을
// 따른다"는 정확한 사실만 진술합니다.
//
// 💡 "Governing law(준거법)" 섹션은 /privacy의 Supabase 리전 자리표시자와 같은 이유로 —
// 코드베이스만으로는 알 수 없는 값이라 10개 언어 전부 자리표시자로 남겨뒀습니다. 실제
// 서비스에 적용하기 전 반드시 실제 준거법을 채워넣고 변호사 검토를 받으시길 권장합니다.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('terms');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export default async function TermsPage() {
  const t = await getTranslations('terms');

  const bold = (chunks: React.ReactNode) => <span className="font-semibold text-[#F5F2F7]">{chunks}</span>;
  const privacyLink = (chunks: React.ReactNode) => (
    <Link href="/privacy" className="text-[#F4679B] hover:underline">
      {chunks}
    </Link>
  );
  const pricingLink = (chunks: React.ReactNode) => (
    <Link href="/pricing" className="text-[#F4679B] hover:underline">
      {chunks}
    </Link>
  );
  const polarLink = (chunks: React.ReactNode) => (
    <a
      href="https://polar.sh/legal/terms"
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#F4679B] hover:underline"
    >
      {chunks}
    </a>
  );
  const mailto = (chunks: React.ReactNode) => (
    <a
      href="mailto:kcw022@naver.com"
      className="text-[#F4679B] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
    >
      {chunks}
    </a>
  );

  return (
    <div className="min-h-screen bg-[#15131A] text-[#E4DEEA]">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
        <Link
          href="/"
          className="text-sm text-[#AFA6BD] hover:text-[#F5F2F7] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
        >
          {t('backLink')}
        </Link>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F2F7] mt-6 mb-2 tracking-tight">
          {t('title')}
        </h1>
        <p className="text-sm text-[#857C93] mb-10">{t('lastUpdated')}</p>

        <div className="flex flex-col gap-8 text-[15px] leading-relaxed">
          <section>
            <p>{t.rich('intro', { b: bold })}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('service.heading')}</h2>
            <p>{t('service.body')}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('account.heading')}</h2>
            <p>{t.rich('account.body', { privacylink: privacyLink })}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('subscriptions.heading')}</h2>
            <p>{t.rich('subscriptions.intro', { pricinglink: pricingLink, price: PRO_PRICE_LABEL })}</p>
            <p className="mt-3">{t.rich('subscriptions.mor', { b: bold, polarlink: polarLink })}</p>
            <p className="mt-3">{t('subscriptions.renewal')}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('aiContent.heading')}</h2>
            <p>{t('aiContent.body')}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('content.heading')}</h2>
            <p>{t.rich('content.body', { privacylink: privacyLink })}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('acceptableUse.heading')}</h2>
            <p>{t('acceptableUse.intro')}</p>
            <ul className="flex flex-col gap-2 list-disc list-inside marker:text-[#F4679B] mt-2">
              <li>{t('acceptableUse.item1')}</li>
              <li>{t('acceptableUse.item2')}</li>
              <li>{t('acceptableUse.item3')}</li>
              <li>{t('acceptableUse.item4')}</li>
            </ul>
            <p className="mt-3">{t('acceptableUse.outro')}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('disclaimer.heading')}</h2>
            <p>{t('disclaimer.body')}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('changes.heading')}</h2>
            <p>{t('changes.body')}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('governingLaw.heading')}</h2>
            <p>{t('governingLaw.body')}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('contact.heading')}</h2>
            <p>{t.rich('contact.body', { mailto })}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
