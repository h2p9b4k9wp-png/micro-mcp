// 💡 [신규] 사이트 정식 도메인 — app/sitemap.ts·app/robots.ts·각 페이지의 canonical
// 태그가 절대 URL을 만들 때 공유합니다. 이 앱엔 NEXT_PUBLIC_SITE_URL류 환경변수가
// 없어서(코드베이스 전체에 site-url 개념 자체가 없었음) 한 곳에만 상수로 둡니다 —
// 나중에 실제 배포 도메인이 바뀌면 여기만 고치면 됩니다.
//
// 💡 [수정] www 서브도메인 기준으로 변경(사용자 명시 요청) — 크롤러에게 보내는 모든
// 신호(사이트맵 URL, robots.txt의 sitemap 위치, 각 페이지 canonical)가 동일한 호스트를
// 가리켜야 중복 콘텐츠/불일치 시그널이 생기지 않습니다. 이 값을 바꾸는 건 실제
// www.carrotly.app이 서비스되거나(또는 carrotly.app이 여기로 리다이렉트되도록) DNS/호스팅이
// 맞춰져 있다는 걸 전제로 합니다 — 그렇지 않다면 검색엔진이 canonical만 보고 존재하지 않는
// 페이지로 인식할 수 있으니 배포 전 반드시 확인하세요.
export const SITE_URL = 'https://www.carrotly.app';
