import type { MetadataRoute } from 'next';
import { cookies } from 'next/headers';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type AppLocale } from '@/i18n/locales';

// 💡 [수정] name/description이 원래 한국어로 고정 하드코딩돼 있어서, PWA로 설치할 때
// 로케일에 상관없이 항상 한국어 앱 이름이 나왔습니다. manifest()는 next-intl의 요청
// 컨텍스트(NextIntlClientProvider) 밖에서 실행되지만, 여전히 요청마다 실행되는 서버
// 함수라 next/headers의 cookies()로 i18n/request.ts와 똑같은 방식으로 "locale" 쿠키를
// 직접 읽을 수 있습니다 — 그 값으로 해당 로케일의 메시지 파일에서 app.title/description만
// 뽑아 씁니다.
async function getAppMeta(locale: AppLocale) {
  const messages = (await import(`@/messages/${locale}.json`)).default;
  return messages.app as { title: string; description: string };
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('locale')?.value;
  const locale = SUPPORTED_LOCALES.includes(cookieLocale as AppLocale)
    ? (cookieLocale as AppLocale)
    : DEFAULT_LOCALE;
  const { title, description } = await getAppMeta(locale);

  return {
    name: title,
    short_name: 'Carrotly',
    description,
    start_url: '/',
    display: 'standalone',
    background_color: '#15131A',
    theme_color: '#15131A',
    icons: [
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
