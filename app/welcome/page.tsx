'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Logomark } from '@/components/logomark';
import { WelcomeHeroTrial } from '@/components/welcome-hero-trial';
import { ProfessorDemo } from '@/components/professor-demo';

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

  const capabilities = [
    { icon: '📎', label: t('landing.capabilities.upload') },
    { icon: '🗓', label: t('landing.capabilities.deadlines') },
    { icon: '❓', label: t('landing.capabilities.questions') },
    { icon: '📝', label: t('landing.capabilities.summary') },
    { icon: '💬', label: t('landing.capabilities.ask') },
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
          <span className="text-base font-extrabold text-[#1C1922] tracking-tight">Carrotly</span>
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
      <main className="flex-1 flex flex-col items-center text-center px-6 pt-4 sm:pt-8 pb-10">
        <WelcomeHeroTrial />
      </main>

      {/* 💡 [신규] 히어로 바로 아래 "할 수 있는 것" 짧은 나열 — 기존 3개짜리 feature 그리드를
          대체합니다(사진 업로드 등 새 기능까지 포함해서 더 포괄적). 항목이 전부 한 줄짜리
          짧은 문구라 rigid grid 대신 flex-wrap 칩으로 배치해 어떤 화면 너비에서도 자연스럽게
          줄바꿈됩니다. */}
      <section className="px-6 pb-14 sm:pb-20">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
          {capabilities.map((c) => (
            <span
              key={c.label}
              className="break-keep inline-flex items-center gap-1.5 text-sm font-medium text-[#1C1922] bg-[#F7F5F9] border border-[#E5E1EA] px-3.5 py-2 rounded-full"
            >
              <span aria-hidden="true">{c.icon}</span>
              {c.label}
            </span>
          ))}
        </div>
      </section>

      {/* 💡 [신규] "교수님별 정리" 기능 전용 섹션 — 작은 배지 하나였던 걸 독립 섹션으로 확장.
          더미 데이터로 실제 클릭 가능한 데모(components/professor-demo.tsx)를 붙여서, 로그인
          후 사이드바 "교수님" 탭에서 실제로 어떤 일이 벌어지는지 방문자가 미리 눌러볼 수
          있게 했습니다. */}
      <section className="px-6 pb-20 sm:pb-28 bg-[#FAF8FB] py-16 sm:py-20">
        <div className="max-w-3xl mx-auto text-center mb-8 sm:mb-10">
          <h2 className="break-keep text-2xl sm:text-[32px] font-extrabold tracking-tight text-[#1C1922] mb-3">
            {t('landing.professorSection.title')}
          </h2>
          <p className="break-keep text-sm sm:text-base text-[#5B5566] leading-relaxed max-w-xl mx-auto">
            {t('landing.professorSection.description')}
          </p>
        </div>
        <div className="max-w-3xl mx-auto">
          <ProfessorDemo />
        </div>
      </section>

      <footer className="px-6 py-6 text-center text-xs text-[#AFA6BD] border-t border-[#EDEAF0]">
        © {new Date().getFullYear()} Carrotly ·{' '}
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
