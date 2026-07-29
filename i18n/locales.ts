// 💡 [신규] i18n/request.ts(서버 전용 — next/headers를 씀)와 클라이언트 컴포넌트가 공유하는
// 상수만 따로 뺀 파일입니다. locale-switcher.tsx 같은 클라이언트 컴포넌트가 i18n/request.ts를
// 직접 import하면 next/headers까지 클라이언트 번들에 끌려들어가 빌드가 실패합니다.
// 💡 [신규] ko/en 2개뿐이던 고정 UI 로케일을 8개 언어(일본어·베트남어·스페인어·프랑스어·
// 독일어·이탈리아어·포르투갈어·네덜란드어)로 확장했습니다. AI 답변 언어(responseLanguage,
// app/page.tsx)는 이미 자유 텍스트로 어떤 언어든 지원하지만, 메뉴·버튼 같은 고정 UI는
// next-intl 메시지 파일(messages/{locale}.json)이 실제로 있어야만 그 언어로 보입니다 —
// 여기 추가한 언어만큼만 messages/ 폴더에 대응 파일이 있어야 합니다.
export const SUPPORTED_LOCALES = ['ko', 'en', 'ja', 'vi', 'es', 'fr', 'de', 'it', 'pt', 'nl'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'ko';

// 💡 [신규] 로케일 코드 → 그 언어로 쓰인 표시명(LocaleSwitcher 드롭다운에 씁니다).
// "EN"처럼 코드를 그대로 보여주던 이전 버튼 방식은 10개로 늘어나면 한 줄에 다 안 들어가서
// <select> 드롭다운으로 바꿨습니다 — 코드 대신 그 언어 화자가 바로 알아볼 수 있는
// 자체 언어명을 보여줍니다(영어 화자에게 "Français"만 보여주면 헷갈릴 수 있어서).
export const LOCALE_LABELS: Record<AppLocale, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  vi: 'Tiếng Việt',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
};
