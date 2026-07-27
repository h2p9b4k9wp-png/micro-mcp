import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type AppLocale } from './locales';

// 💡 [신규] URL 경로 기반 로케일 라우팅(/en/..., /ko/...)은 안 씁니다 — 이 앱은 app/page.tsx
// 하나짜리 클라이언트 SPA라, [locale] 세그먼트로 쪼개면 기존 middleware.ts의 Supabase 인증
// 로직과 합치는 과정에서 손댈 범위가 너무 커집니다. 대신 "locale" 쿠키 하나로만 언어를
// 결정합니다 — 기본값은 한국어.
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('locale')?.value;
  const locale = SUPPORTED_LOCALES.includes(cookieLocale as AppLocale) ? (cookieLocale as AppLocale) : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
