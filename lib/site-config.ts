// 💡 [신규] 사이트 정식 도메인 — app/sitemap.ts·app/robots.ts가 절대 URL을 만들 때 공유합니다.
// 이 앱엔 NEXT_PUBLIC_SITE_URL류 환경변수가 없어서(코드베이스 전체에 site-url 개념
// 자체가 없었음) 한 곳에만 상수로 둡니다 — 나중에 실제 배포 도메인이 바뀌면 여기만
// 고치면 됩니다.
export const SITE_URL = 'https://carrotly.app';
