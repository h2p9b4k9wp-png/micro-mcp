import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
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
  title: "Micro-MCP — 나만의 AI 업무 비서",
  description: "블록을 조립하듯, 나만의 업무와 일상을 자동화하는 AI 워크플로우 플랫폼",
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
        <footer className="shrink-0 bg-[#15131A] border-t border-[#2A2632] px-5 py-4 text-center text-xs text-[#5B5566]">
          © {new Date().getFullYear()} Micro-MCP ·{' '}
          <Link
            href="/privacy"
            className="text-[#857C93] hover:text-[#F4679B] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
          >
            Privacy Policy
          </Link>
        </footer>
      </body>
    </html>
  );
}
