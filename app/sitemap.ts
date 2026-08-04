import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-config';

// 💡 Next.js App Router 컨벤션 — 이 파일이 /sitemap.xml을 자동으로 만들어줍니다
// (app/manifest.ts가 /manifest.webmanifest를 만드는 것과 같은 패턴).
//
// 💡 [수정] 사용자 명시 요청에 따라 /welcome, /pricing, /privacy, /terms 네 개만 남기고
// 나머지는 전부 뺐습니다. 이전 버전이 "/"와 "/login"·"/login?trial=1"까지 사이트맵에
// 올려서 구글이 /login을 색인해버린 게 이번 신고의 직접 원인이었습니다 — 로그인/체험
// 폼은 검색 결과에 노출될 이유가 없는 페이지이므로, 사이트맵에는 실제로 색인되길 원하는
// 공개 페이지만 남깁니다. "/"는 middleware.ts에서 로그인 여부에 따라 /welcome으로
// 리다이렉트되거나 개인 대시보드가 되는 URL이라 애초에 사이트맵에 넣을 이유가 없고
// (크롤러가 리다이렉트를 따라가 결국 /welcome을 보므로 /welcome 엔트리 하나로 충분),
// /login·/login?trial=1은 app/robots.ts의 disallow와 app/login/layout.tsx의 noindex로
// 아예 색인 대상에서 제외했으므로 사이트맵에도 올리지 않습니다.
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
    {
      url: `${SITE_URL}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
