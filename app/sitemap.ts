import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-config';

// 💡 Next.js App Router 컨벤션 — 이 파일이 /sitemap.xml을 자동으로 만들어줍니다
// (app/manifest.ts가 /manifest.webmanifest를 만드는 것과 같은 패턴). 로그인 없이도 볼 수
// 있는 공개 페이지만 넣습니다(middleware.ts의 isPublicRoute 참고).
//
// 💡 [수정] 루트("/")는 middleware.ts에서 로그인 안 한 방문자에게 /welcome으로 307
// 리다이렉트되고, 로그인한 방문자에게는 개인 대시보드(색인 대상 아님)라 원래 사이트맵에서
// 뺐었습니다 — 항상 리다이렉트되는 URL을 사이트맵에 넣는 건 구글 자체 가이드에서도 권장하지
// 않고(크롤러가 어차피 리다이렉트를 따라가 /welcome을 색인하므로 있으나 없으나 색인 결과는
// 같음), 이미 /welcome이 priority 1로 들어가 있어 사실상 중복이기도 합니다. 그래도 브랜드
// 도메인 루트가 직접 링크·검색의 실제 목적지라는 요청에 따라 다시 추가합니다.
//
// 💡 [신규] "/login?trial=1"(app/welcome/page.tsx의 "지금 체험하기" CTA가 실제로 링크하는
// 주소, app/login/page.tsx가 이 쿼리로 로그인 폼 대신 게스트 체험 패널을 바로 엽니다)도
// 별도 엔트리로 추가합니다 — 로그인 없이 바로 시도해볼 수 있는 진입점이라 순수 로그인
// 폼(`/login`, priority 0.6)보다 우선순위를 높게 잡습니다.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/welcome`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/login?trial=1`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
