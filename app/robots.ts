import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-config';

// 💡 [신규] Next.js App Router 컨벤션 — 이 파일이 /robots.txt를 자동으로 만들어줍니다.
// 이전엔 robots.txt 자체가 없었습니다(없으면 크롤러는 기본적으로 전체 허용으로 간주하므로
// 실제로 뭔가를 막고 있던 건 아니었지만, 명시적으로 정의해둡니다). /api/*는 페이지가
// 아니라 색인할 이유가 없고, /auth/*는 OAuth 콜백이라 크롤러가 접근해봐야 코드 파라미터
// 없이 실패만 하므로 크롤 예산 낭비를 막기 위해 제외합니다.
//
// 💡 [수정] /login도 disallow에 추가(사용자 명시 요청 — 구글 검색에 /login이 실제로
// 잡혔다는 신고). 로그인/체험 폼은 검색 결과에 노출될 이유가 없는 페이지입니다. 이 페이지
// 자체는 로그인 없이도 열리므로(middleware.ts의 isPublicRoute) disallow만으로 이미 색인된
// URL이 즉시 빠지진 않을 수 있어, app/login/layout.tsx의 noindex 메타태그와 함께 적용합니다
// — disallow는 "크롤링 금지", noindex는 "이미 발견했어도 색인하지 말 것"으로 서로 보완적입니다.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/auth/', '/login'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
