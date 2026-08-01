import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
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

// 💡 color-scheme을 명시하지 않으면 크롬의 "다크 모드로 웹 콘텐츠 표시"(강제 다크 모드)
// 설정이 이 사이트를 "아직 다크 테마를 지원 안 하는 사이트"로 오판해서, 이미 하드코딩된
// 다크 배경 위 이미지(토끼 마스코트 등)의 밝은 크림색 영역을 자체적으로 다시 어둡게
// 재반전시킵니다 — 확장 프로그램이 아니라 브라우저 자체 기능이라 시크릿 창에서도
// 재현됩니다. "light dark"(둘 다 지원)로는 이 오판을 막기에 불충분해서 실패했었고, 이
// 사이트는 실제로 다크 전용이므로 "dark"만 명시합니다 — 이게 <meta name="color-scheme">
// 태그로 렌더링되고, app/globals.css의 html/:root color-scheme: dark 선언과 함께 세 곳
// 모두 일치해야 브라우저가 이 힌트를 확실히 인식합니다.
export const viewport: Viewport = {
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <SiteFooter />
      </body>
    </html>
  );
}
