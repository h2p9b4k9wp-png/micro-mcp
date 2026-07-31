import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-config';

// 💡 [신규] Next.js App Router 컨벤션 — 이 파일이 /sitemap.xml을 자동으로 만들어줍니다
// (app/manifest.ts가 /manifest.webmanifest를 만드는 것과 같은 패턴). 로그인 없이도 볼 수
// 있는 공개 페이지만 넣습니다(middleware.ts의 isPublicRoute 참고) — "/"는 넣지 않았습니다,
// 로그인 안 한 방문자에게는 /welcome으로 307 리다이렉트되고(middleware.ts) 로그인한
// 방문자에게는 개인 대시보드라 색인 대상이 아니기 때문입니다. /welcome이 실질적인
// 첫 화면(메인)이자 로그인 없이 바로 체험할 수 있는 페이지라 우선순위가 가장 높습니다.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: `${SITE_URL}/welcome`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
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
