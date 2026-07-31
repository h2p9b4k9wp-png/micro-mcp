import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-config';

// 💡 [신규] Next.js App Router 컨벤션 — 이 파일이 /robots.txt를 자동으로 만들어줍니다.
// 이전엔 robots.txt 자체가 없었습니다(없으면 크롤러는 기본적으로 전체 허용으로 간주하므로
// 실제로 뭔가를 막고 있던 건 아니었지만, 명시적으로 정의해둡니다). /api/*는 페이지가
// 아니라 색인할 이유가 없고, /auth/*는 OAuth 콜백이라 크롤러가 접근해봐야 코드 파라미터
// 없이 실패만 하므로 크롤 예산 낭비를 막기 위해 제외합니다. 그 외 공개 페이지(/welcome,
// /login, /pricing, /privacy)는 전부 허용 — "/"도 막지 않습니다, 로그인 안 한 크롤러가
// 접근하면 middleware.ts가 /welcome으로 리다이렉트해줄 뿐이라 막을 이유가 없습니다.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/auth/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
