import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/site-config';

// 💡 [신규] app/welcome/page.tsx는 'use client'라 metadata/generateMetadata를 직접
// export할 수 없어서(Next.js App Router 제약), 같은 라우트 폴더에 이 서버 컴포넌트
// layout.tsx를 두어 메타데이터만 담당합니다 — page.tsx 자체는 손대지 않습니다.
// /login과 달리 이 페이지는 색인되길 원하는 공개 랜딩 페이지(app/sitemap.ts에도 포함)라
// noindex는 넣지 않고 canonical만 지정합니다.
export const metadata: Metadata = {
  alternates: {
    canonical: `${SITE_URL}/welcome`,
  },
};

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
