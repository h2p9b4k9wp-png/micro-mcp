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
export function LocaleSwitcher() {
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
      className="bg-transparent border border-[#322D3B] rounded-md px-2 py-1 text-xs font-semibold text-[#AFA6BD] outline-none focus:border-[#F4679B] cursor-pointer hover:text-[#F5F2F7]"
    >
      {SUPPORTED_LOCALES.map((code) => (
        <option key={code} value={code} className="bg-[#211E28] text-[#F5F2F7]">
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  );
}
