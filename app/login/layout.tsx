import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/site-config';

// 💡 [신규] app/login/page.tsx는 'use client'라 metadata/generateMetadata를 직접
// export할 수 없어서(Next.js App Router 제약), 같은 라우트 폴더에 이 서버 컴포넌트
// layout.tsx를 두어 메타데이터만 담당합니다 — page.tsx 자체는 손대지 않습니다.
//
// 💡 robots: {index:false, follow:false} — 로그인/체험 폼이 구글 검색에 실제로 잡혔다는
// 신고에 따른 조치입니다. 이 라우트는 middleware.ts에서 비로그인 방문자도 접근 가능한
// 공개 경로(isPublicRoute)라 크롤러가 도달할 수 있으므로, app/robots.ts의 disallow만으론
// 이미 발견된 URL의 색인을 막지 못합니다 — noindex 메타태그가 실제 색인 제외를 보장하는
// 신호입니다.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: `${SITE_URL}/login`,
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
