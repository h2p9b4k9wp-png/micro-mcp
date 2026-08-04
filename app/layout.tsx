import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { SiteFooter } from "@/components/site-footer";
import { SITE_URL } from "@/lib/site-config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 💡 [수정] title/description이 원래 static export로 한국어 고정이라, 다른 로케일로
// 전환해도 브라우저 탭 제목/검색엔진 설명은 항상 한국어로 나왔습니다 — messages/*.json의
// app.title/app.description(next-intl의 getTranslations, 요청별 로케일 인식)으로 옮겨
// generateMetadata()로 바꿨습니다. app/manifest.ts(PWA 설치 시 이름)도 같은 이유로 별도로
// 고쳤습니다 — 거긴 next-intl 요청 컨텍스트 밖이라 locale 쿠키를 직접 읽습니다.
// 💡 [신규] metadataBase — 하위 라우트의 상대 경로 metadata(OpenGraph 이미지 등)를 절대
// URL로 만들 때 next가 참조하는 기준값입니다. alternates.canonical(아래)도 여기 있으면
// 각 라우트의 generateMetadata()가 매번 절대 URL을 직접 조립하지 않고 상대 경로만 넘겨도
// 되지만, canonical은 라우트별로 명시적으로 지정하는 게 더 안전해 각 페이지에서 SITE_URL로
// 직접 절대 URL을 만듭니다. 루트("/")의 canonical은 여기서 지정 — app/page.tsx(로그인된
// 대시보드)는 이 루트 레이아웃 말고는 별도 layout.tsx가 없어서 라우트별 override를 걸 곳이
// 없습니다. 더 구체적인 라우트(로그인/웰컴/프라이버시 등)는 자기 자신의 layout.tsx나
// generateMetadata()에서 이 값을 덮어씁니다.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return {
    title: t('title'),
    description: t('description'),
    metadataBase: new URL(SITE_URL),
    alternates: {
      canonical: `${SITE_URL}/`,
    },
  };
}

// 💡 [수정] 사용자가 다크/라이트를 직접 고를 수 있게 되면서 "dark"로 고정 선언하던 걸
// "light dark"(둘 다 지원)로 되돌렸습니다 — 실제 색은 app/globals.css의 html.dark/html.light
// 클래스 선택자가 정확히 어느 테마가 켜져 있는지에 따라 정합니다. 예전에 "dark" 고정이
// 필요했던 이유(강제 다크모드가 마스코트 밝은 영역을 재반전시키던 문제)는 그때는 라이트
// 테마가 전혀 없어서 "light dark" 선언만으론 브라우저의 오판을 못 막았기 때문인데, 지금은
// 진짜로 라이트 테마를 지원하니 "light dark"가 정확한 선언입니다. <html>에 인라인
// style={{colorScheme:'dark'}}를 고정으로 붙이지 않는 이유도 같습니다 — 인라인 스타일은
// CSS 클래스 선택자보다 우선순위가 높아서, 라이트 모드에서도 강제로 dark가 이겨버립니다.
export const viewport: Viewport = {
  colorScheme: "light dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    // 💡 [신규] suppressHydrationWarning — next-themes가 저장된 테마를 <head>의 동기
    // 스크립트로 하이드레이션 이전에 바로 <html class="dark|light">에 반영합니다(FOUC
    // 방지의 핵심). React 서버 렌더 결과와 클라이언트의 class 속성이 이 때문에 다를 수
    // 있는데, 이건 next-themes 공식 가이드가 명시하는 정상적인 불일치이므로 <html>에서만
    // 경고를 끕니다.
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem themes={["light", "dark"]}>
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
          </NextIntlClientProvider>
          <SiteFooter />
        </ThemeProvider>
        {/* 💡 [신규] Vercel Web Analytics — 쿠키 없이 익명 페이지 조회 통계만 수집합니다
            (Vercel 공식 문서: 개인을 식별하는 쿠키/로컬스토리지를 쓰지 않음). /privacy
            페이지의 sharing.analytics 항목이 이 사실을 고지합니다. */}
        <Analytics />
      </body>
    </html>
  );
}
