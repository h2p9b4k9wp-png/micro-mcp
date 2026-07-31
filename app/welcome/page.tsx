'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Logomark } from '@/components/logomark';
import { WelcomeHeroTrial } from '@/components/welcome-hero-trial';

// 💡 [신규] 링크로 바로 들어온 미로그인 방문자의 첫 화면(middleware.ts가 "/" 미로그인
// 요청을 여기로 보냅니다). 나머지 페이지(app/page.tsx, app/login/page.tsx, /pricing,
// /privacy)는 전부 다크 테마인데, 이 페이지만 의도적으로 라이트 테마입니다 — 로그인 없이도
// 핵심 기능을 바로 체험할 수 있게 유도하는 마케팅성 첫 화면이라 산뜻한 인상이 우선입니다.
// 전역 다크 푸터(components/site-footer.tsx)는 이 경로에서만 숨기고, 대신 라이트 톤의
// 자체 푸터를 아래에 둡니다.
export default function WelcomePage() {
  const t = useTranslations();

  // 💡 [신규] PWA 서비스워커 등록 — app/page.tsx·app/login/page.tsx와 동일 패턴. 링크로
  // 처음 들어온 방문자가 실제로는 이 페이지를 가장 먼저 만나므로 여기서도 등록해둡니다.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('서비스워커 등록 실패:', err);
      });
    }
  }, []);

  const features = [
    { icon: '📄', title: t('landing.features.analysis.title'), desc: t('landing.features.analysis.desc') },
    { icon: '💬', title: t('landing.features.chat.title'), desc: t('landing.features.chat.desc') },
    { icon: '🗓', title: t('landing.features.deadlines.title'), desc: t('landing.features.deadlines.desc') },
  ];

  return (
    <div className="min-h-screen bg-white text-[#1C1922] flex flex-col">
      <style jsx global>{`
        @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
        * { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      <header className="w-full max-w-5xl mx-auto flex items-center justify-between px-6 sm:px-10 py-6">
        <div className="flex items-center gap-2 text-[#F4679B]">
          <Logomark className="w-7 h-7" />
          <span className="text-base font-extrabold text-[#1C1922] tracking-tight">Cramly</span>
        </div>
        <Link
          href="/login"
          className="text-sm font-semibold text-[#5B5566] hover:text-[#F4679B] transition-colors px-3.5 py-1.5 rounded-lg border border-[#E5E1EA] hover:border-[#F4679B]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
        >
          {t('landing.loginButton')}
        </Link>
      </header>

      {/* 💡 [신규] 정적 헤드라인+CTA 링크 대신 인라인 체험 컴포넌트 — "지금 체험하기"를
          눌러도 페이지 이동 없이 이 자리에서 바로 파일 선택창이 열리고, 히어로 전체가
          드래그앤드롭 영역이며, 업로드하면 URL 변경 없이 이 자리에서 회로도 애니메이션 →
          결과로 전환됩니다. */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16 sm:py-24">
        <WelcomeHeroTrial />
      </main>

      <section className="px-6 pb-20 sm:pb-28">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-8">
          {features.map((f) => (
            <div key={f.title} className="flex flex-col items-center text-center gap-2.5">
              <span className="text-3xl" aria-hidden="true">{f.icon}</span>
              <h3 className="text-sm font-bold text-[#1C1922]">{f.title}</h3>
              <p className="text-sm text-[#857C93] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="px-6 py-6 text-center text-xs text-[#AFA6BD] border-t border-[#EDEAF0]">
        © {new Date().getFullYear()} Cramly ·{' '}
        <Link href="/pricing" className="underline underline-offset-2 hover:text-[#F4679B] transition-colors">
          Pricing
        </Link>{' '}
        ·{' '}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-[#F4679B] transition-colors">
          Privacy Policy
        </Link>
      </footer>
    </div>
  );
}
