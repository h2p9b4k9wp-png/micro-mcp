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
  title: "Cramly — 나만의 AI 업무 비서",
  description: "블록을 조립하듯, 나만의 업무와 일상을 자동화하는 AI 워크플로우 플랫폼",
};

// 💡 [신규] color-scheme을 명시하지 않으면 크롬의 "다크 모드로 웹 콘텐츠 표시"(강제
// 다크 모드) 설정이 이 사이트를 "아직 다크 테마를 지원 안 하는 사이트"로 오판해서, 이미
// 하드코딩된 다크 배경 위 이미지(토끼 마스코트 등)의 밝은 크림색 영역을 자체적으로 다시
// 어둡게 반전시킵니다 — 확장 프로그램이 아니라 브라우저 자체 기능이라 시크릿 창에서도
// 재현됩니다. light/dark 모두 명시해서 "이 페이지는 색을 직접 관리한다"고 알리면 이 강제
// 보정을 끕니다.
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
