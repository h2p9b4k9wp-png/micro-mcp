// 💡 [신규] i18n/request.ts(서버 전용 — next/headers를 씀)와 클라이언트 컴포넌트가 공유하는
// 상수만 따로 뺀 파일입니다. locale-switcher.tsx 같은 클라이언트 컴포넌트가 i18n/request.ts를
// 직접 import하면 next/headers까지 클라이언트 번들에 끌려들어가 빌드가 실패합니다.
export const SUPPORTED_LOCALES = ['ko', 'en'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'ko';
