import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SITE_URL } from '@/lib/site-config';

// 💡 [수정] 원래 로그인 없이도 봐야 하는 공개 법적 페이지라는 이유로 next-intl을 거치지 않고
// 영어 고정 텍스트였습니다. 하지만 서울 리전 국제 데이터 이전 고지를 추가하면서 사용자가
// "10개 언어 전부 반영"을 명시적으로 요청해, 이 페이지도 다른 페이지와 같은 "locale" 쿠키
// 기반 next-intl 번역을 쓰도록 바꿨습니다 — 이제 UI 언어를 바꾸면 이 페이지도 같이
// 바뀝니다(이전의 "법적 페이지는 UI 로케일과 무관하게 고정"이라는 설계를 뒤집는 변경입니다).
// getTranslations()는 서버 컴포넌트용이라 이 페이지를 계속 서버 컴포넌트로 유지할 수
// 있습니다(클라이언트 상태가 필요 없는 정적 텍스트라 'use client'로 바꿀 이유가 없음).
// 굵은 글씨(<b>)·이용약관 링크(<termslink>)·메일 링크(<mailto>)는 t.rich()의 태그
// 치환으로 렌더링합니다 — messages/*.json의 privacy 네임스페이스 문자열 안에 그 태그가
// 그대로 들어있습니다.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('privacy');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: {
      canonical: `${SITE_URL}/privacy`,
    },
  };
}

export default async function PrivacyPage() {
  const t = await getTranslations('privacy');

  const bold = (chunks: React.ReactNode) => <span className="font-semibold text-[#F5F2F7]">{chunks}</span>;
  const termsLink = (chunks: React.ReactNode) => (
    <Link href="/terms" className="text-[#F4679B] hover:underline">
      {chunks}
    </Link>
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
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('collect.heading')}</h2>
            <ul className="flex flex-col gap-2 list-disc list-inside marker:text-[#F4679B]">
              <li>{t.rich('collect.email', { b: bold })}</li>
              <li>{t.rich('collect.files', { b: bold })}</li>
              <li>{t.rich('collect.history', { b: bold })}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('why.heading')}</h2>
            <p>{t('why.intro')}</p>
            <ul className="flex flex-col gap-2 list-disc list-inside marker:text-[#F4679B] mt-2">
              <li>{t('why.operate')}</li>
              <li>{t('why.analyze')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('sharing.heading')}</h2>
            <p>{t('sharing.intro')}</p>
            <ul className="flex flex-col gap-2 list-disc list-inside marker:text-[#F4679B] mt-2">
              <li>{t.rich('sharing.openai', { b: bold })}</li>
              <li>{t.rich('sharing.supabase', { b: bold, region: t('region') })}</li>
              <li>{t.rich('sharing.polar', { b: bold })}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('retention.heading')}</h2>
            <ul className="flex flex-col gap-2 list-disc list-inside marker:text-[#F4679B]">
              <li>{t('retention.account')}</li>
              <li>{t('retention.logs')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('transfers.heading')}</h2>
            <p>{t('transfers.body1')}</p>
            <p className="mt-3">{t('transfers.body2')}</p>
            <p className="mt-3">{t('transfers.body3')}</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#F5F2F7] mb-3">{t('rights.heading')}</h2>
            <p>{t('rights.copy')}</p>
            <p className="mt-3">{t('rights.delete')}</p>
            <p className="mt-3">{t.rich('rights.proSubscription', { termslink: termsLink })}</p>
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
