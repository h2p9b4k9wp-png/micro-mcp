'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { SUPPORTED_LOCALES, type AppLocale } from '@/i18n/locales';

// 💡 [신규] URL 라우팅 없이 "locale" 쿠키만으로 언어를 바꿉니다. 쿠키를 쓰고 router.refresh()로
// 서버 컴포넌트(app/layout.tsx)를 새 로케일로 다시 그리게 합니다 — 클라이언트 컴포넌트인
// app/page.tsx 자체는 next-intl의 NextIntlClientProvider가 이미 새 messages를 내려줘서
// 별도 처리 없이 바로 반영됩니다.
export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();

  const handleChange = (next: AppLocale) => {
    if (next === locale) return;
    document.cookie = `locale=${next}; path=/; max-age=31536000; SameSite=Lax`;
    router.refresh();
  };

  return (
    <div className="flex items-center gap-1 text-xs">
      {SUPPORTED_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => handleChange(code)}
          className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
            locale === code
              ? 'bg-[#331F29] text-[#F4679B]'
              : 'text-[#857C93] hover:text-[#F5F2F7]'
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
