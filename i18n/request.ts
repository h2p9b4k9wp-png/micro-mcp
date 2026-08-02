import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type AppLocale } from './locales';

// 💡 [신규] URL 경로 기반 로케일 라우팅(/en/..., /ko/...)은 안 씁니다 — 이 앱은 app/page.tsx
// 하나짜리 클라이언트 SPA라, [locale] 세그먼트로 쪼개면 기존 middleware.ts의 Supabase 인증
// 로직과 합치는 과정에서 손댈 범위가 너무 커집니다. 대신 "locale" 쿠키 하나로만 언어를
// 결정합니다 — 기본값은 한국어.
//
// 💡 [수정] 쿠키보다 x-locale 요청 헤더를 먼저 확인합니다. middleware.ts가 매 요청마다
// 이 헤더에 "이번 요청에 실제로 적용해야 할 로케일"을 실어 보내는데(쿠키가 아직 없는
// 최초 방문자는 Accept-Language로 감지한 값), next/headers의 cookies()는 브라우저가 이미
// 들고 있던 쿠키만 읽을 수 있어서 쿠키만 보면 최초 요청엔 그 값이 아직 없습니다 — 헤더가
// 없는 경우(미들웨어를 거치지 않는 예외적 경로)에만 쿠키로, 그마저 없으면 DEFAULT_LOCALE로
// 떨어집니다.
export default getRequestConfig(async () => {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const candidate = headerStore.get('x-locale') ?? cookieStore.get('locale')?.value;
  const locale = SUPPORTED_LOCALES.includes(candidate as AppLocale) ? (candidate as AppLocale) : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
