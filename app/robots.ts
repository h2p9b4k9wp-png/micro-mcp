import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-config';

// 💡 [신규] Next.js App Router 컨벤션 — 이 파일이 /robots.txt를 자동으로 만들어줍니다.
// 이전엔 robots.txt 자체가 없었습니다(없으면 크롤러는 기본적으로 전체 허용으로 간주하므로
// 실제로 뭔가를 막고 있던 건 아니었지만, 명시적으로 정의해둡니다). /api/*는 페이지가
// 아니라 색인할 이유가 없고, /auth/*는 OAuth 콜백이라 크롤러가 접근해봐야 코드 파라미터
// 없이 실패만 하므로 크롤 예산 낭비를 막기 위해 제외합니다.
//
// 💡 [수정] /login은 disallow에 넣지 않습니다(사용자 명시 요청 — 되돌림). 이미 구글에
// 색인된 /login을 빼려면 구글이 그 페이지를 다시 크롤링해서 app/login/layout.tsx의
// noindex 메타태그를 읽어야 하는데, robots.txt에서 disallow로 막으면 크롤러가 페이지에
// 아예 접근하지 않아 noindex를 읽을 방법이 없고, 오히려 "URL만 알고 내용은 못 읽는" 상태로
// 색인에 계속 남을 수 있습니다(구글 자체 가이드가 명시하는 함정) — 그래서 색인 제외는
// noindex 메타태그 단독으로만 수행하고, robots.txt는 크롤링을 열어둡니다.
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
