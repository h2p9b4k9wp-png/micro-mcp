'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { SUPPORTED_LOCALES, LOCALE_LABELS, type AppLocale } from '@/i18n/locales';

// 💡 [신규] URL 라우팅 없이 "locale" 쿠키만으로 언어를 바꿉니다. 쿠키를 쓰고 router.refresh()로
// 서버 컴포넌트(app/layout.tsx)를 새 로케일로 다시 그리게 합니다 — 클라이언트 컴포넌트인
// app/page.tsx 자체는 next-intl의 NextIntlClientProvider가 이미 새 messages를 내려줘서
// 별도 처리 없이 바로 반영됩니다.
// 💡 [수정] 로케일이 2개(KO/EN)일 땐 버튼 두 개로 충분했지만 10개로 늘어나면서 한 줄에
// 다 안 들어가 <select> 드롭다운으로 바꿨습니다 — 좁은 데스크톱 헤더(app/layout.tsx의
// 로고 옆)에도 그대로 들어갑니다.
//
// 💡 [신규] className/optionClassName을 외부에서 완전히 덮어쓸 수 있게 열어뒀습니다 — 이
// 컴포넌트가 이제 세 가지 다른 배경 위에 놓입니다: app/page.tsx(다크/라이트 토글, CSS
// 변수), app/login/page.tsx(마찬가지로 토글, CSS 변수), app/welcome/page.tsx(앱 테마
// 설정과 무관하게 항상 고정 라이트). 기본값은 CSS 변수를 쓰는 app/page.tsx·로그인 페이지용
// 스타일이고, /welcome처럼 테마 변수를 쓰지 않는 고정 라이트 페이지에서는 호출부에서
// className을 라이트 전용 색상으로 통째로 넘깁니다 — CSS 변수를 그대로 쓰면 사용자의 앱
// 테마가 다크로 저장돼 있을 때 이 고정 라이트 페이지 위에서 다크 스타일이 새어 나옵니다
// (로그인 페이지 좌측 브랜드 패널에서 겪었던 것과 같은 종류의 버그).
const DEFAULT_SELECT_CLASSNAME =
  'bg-transparent border border-[var(--border-default)] rounded-md px-2 py-1 text-xs font-semibold text-[var(--text-tertiary)] outline-none focus:border-[#F4679B] cursor-pointer hover:text-[var(--text-primary)]';
const DEFAULT_OPTION_CLASSNAME = 'bg-[var(--bg-page)] text-[var(--text-primary)]';

export function LocaleSwitcher({
  className = DEFAULT_SELECT_CLASSNAME,
  optionClassName = DEFAULT_OPTION_CLASSNAME,
}: {
  className?: string;
  optionClassName?: string;
}) {
  const locale = useLocale();
  const router = useRouter();

  const handleChange = (next: AppLocale) => {
    if (next === locale) return;
    document.cookie = `locale=${next}; path=/; max-age=31536000; SameSite=Lax`;
    router.refresh();
  };

  return (
    <select
      value={locale}
      onChange={(e) => handleChange(e.target.value as AppLocale)}
      aria-label="Language"
      className={className}
    >
      {SUPPORTED_LOCALES.map((code) => (
        <option key={code} value={code} className={optionClassName}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  );
}
