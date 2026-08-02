import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Carrotly — 나만의 AI 업무 비서",
  description: "블록을 조립하듯, 나만의 업무와 일상을 자동화하는 AI 워크플로우 플랫폼",
};

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
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem themes={["light", "dark"]}>
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
          </NextIntlClientProvider>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
