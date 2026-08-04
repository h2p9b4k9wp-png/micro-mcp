import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SUPPORTED_LOCALES, type AppLocale } from './i18n/locales';

// 💡 [수정] Accept-Language 헤더(예: "nl;q=0.3,en-US;q=0.9,ko;q=0.95")를 진짜 선호도(q값)
// 순으로 파싱해 SUPPORTED_LOCALES 중 처음 일치하는 언어를 고릅니다. 이전 버전은 q값을
// 무시하고 헤더에 적힌 "글자 순서" 그대로 훑었는데, HTTP 스펙상 Accept-Language는 순서가
// 아니라 q값이 우선순위입니다 — 브라우저 대부분은 순서와 q값이 일치하게 보내지만 전부는
// 아니고(사설 VPN/프록시가 국가 스푸핑용으로 로케일을 끼워 넣는 경우 등), 순서만 보면
// 사용자의 실제 1순위 언어가 아직 SUPPORTED_LOCALES에 없다는 이유만으로 그 뒤에 우연히
// 붙어있던, 훨씬 낮은 우선순위의 지원 언어가 먼저 골라지는 오탐이 날 수 있습니다(네덜란드어가
// 뜬 사례가 이 경로로 재현됩니다 — 실제 1순위 언어가 지원 목록에 없고, q값은 낮지만 목록상
// 앞쪽에 'nl'이 끼어 있던 경우). q값을 실제로 비교해 정렬하면 이 오탐이 사라집니다.
// 지원 로케일 코드가 전부 ISO 639-1 주 언어 서브태그(ko/en/ja/vi/es/fr/de/it/pt/nl)라
// 지역 서브태그(-DE, -BR 등)는 무시하고 앞부분만 비교합니다. 아무 것도 안 맞으면 'en'으로 —
// 한국어가 아닌 방문자를 지원하지 않는 언어라고 계속 한국어로 두는 것보다는 영어가 더 도움이 됩니다.
function detectLocaleFromAcceptLanguage(header: string): AppLocale {
  const entries = header
    .split(',')
    .map((raw) => {
      const [tagPart, ...params] = raw.split(';').map((s) => s.trim());
      const tag = tagPart?.toLowerCase().split('-')[0];
      const qParam = params.find((p) => p.startsWith('q='));
      const q = qParam ? parseFloat(qParam.slice(2)) : 1;
      return { tag, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry): entry is { tag: string; q: number } => Boolean(entry.tag) && entry.q > 0)
    // 배열 sort는 안정 정렬이라 q값이 같으면(가장 흔한 경우 — q 생략 시 전부 1) 원래
    // 헤더 순서(=암묵적 우선순위)가 그대로 유지됩니다.
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    const match = SUPPORTED_LOCALES.find((locale) => locale === tag);
    if (match) return match;
  }
  // 💡 [수정] 지원 언어와 매칭되는 게 하나도 없으면(헤더 자체가 없는 경우 포함) 무조건
  // 영어로 폴백합니다 — 사용자 명시 요청("매칭되는 게 없으면 영어로"). 이전엔 헤더가
  // 아예 없는 경우에만 DEFAULT_LOCALE(한국어)로 폴백하는 예외가 있었는데, 그 구분을 없애고
  // 일관되게 영어로 통일했습니다.
  return 'en';
}

export async function middleware(request: NextRequest) {
  // 💡 [신규] 이번 요청에서 실제로 써야 할 로케일을 미리 계산해 x-locale 요청 헤더로
  // 실어 보냅니다. 쿠키가 아직 없는 최초 방문자의 경우, 아래 withDetectedLocale이 응답에
  // Set-Cookie로 "locale" 쿠키를 심어도 그건 브라우저가 "다음" 요청부터 보내는 값이라,
  // 이번 요청을 렌더링하는 app/layout.tsx(next-intl, i18n/request.ts의 next/headers
  // cookies()는 들어온 요청의 쿠키만 읽습니다)는 여전히 그 쿠키를 못 보고 DEFAULT_LOCALE
  // (한국어)로 렌더링하는 문제가 있었습니다 — 즉 "브라우저 언어 자동 감지"가 실제로는
  // 두 번째 요청부터만 적용되고 있었습니다(랜딩 페이지처럼 방문자가 첫 화면만 보고
  // 이탈할 수도 있는 페이지엔 치명적). x-locale 헤더는 미들웨어→서버 컴포넌트로 같은
  // 요청 안에서 값을 넘기는 Next.js 공식 패턴이라, i18n/request.ts가 쿠키보다 이 헤더를
  // 우선 읽으면 최초 요청부터 바로 감지된 언어로 렌더링됩니다.
  const rawCookieLocale = request.cookies.get('locale')?.value;
  const hasLocaleCookie = Boolean(rawCookieLocale);
  const validCookieLocale = SUPPORTED_LOCALES.find((locale) => locale === rawCookieLocale);
  const effectiveLocale: AppLocale =
    validCookieLocale ?? detectLocaleFromAcceptLanguage(request.headers.get('accept-language') || '');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-locale', effectiveLocale);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 세션 검증 (만료된 토큰은 여기서 자동으로 갱신됩니다)
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isApiRoute = path.startsWith('/api/');

  // 💡 [신규] "locale" 쿠키가 아직 없는 최초 방문자에게는 위에서 계산해둔 effectiveLocale
  // (Accept-Language로 감지한 값)을 심어줍니다 — 이게 없으면 i18n/request.ts(next-intl)가
  // 쿠키 미존재 시 항상 DEFAULT_LOCALE('ko')로 폴백해서, 해외에서 접속한 방문자도 로그인
  // 화면부터 한국어로 보게 됩니다. AI 답변 언어(responseLanguage, app/page.tsx)가
  // navigator.language로 자동 감지하는 것과 같은 취지를 메뉴·버튼 같은 고정 UI 문구에도
  // 적용한 것입니다. LocaleSwitcher로 직접 바꾸면 그 값이 이 쿠키를 그대로 덮어쓰므로,
  // 자동 감지는 "쿠키가 아예 없는 최초 방문" 시점에만 한 번 개입합니다.
  const withDetectedLocale = (res: NextResponse) => {
    if (isApiRoute || hasLocaleCookie) return res;
    res.cookies.set('locale', effectiveLocale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
    return res;
  };

  // 💡 [수정] /privacy·/terms·/pricing은 로그인 없이도 봐야 하는 공개 페이지입니다(앱 심사·가입 전
  // 방문자, 결제 전 약관 확인 등). /welcome은 로그인 없이 링크로 들어온 방문자가 보는 첫 화면(라이트 테마
  // 랜딩 페이지, app/welcome/page.tsx)입니다. /api/cron/*는 세션 쿠키가 아니라 자체
  // CRON_SECRET으로 인증하는 Vercel Cron 전용 라우트라, 여기서 세션을 요구하면 Cron
  // 호출 자체가 401로 막힙니다. /api/public-analyze(파일 분석)·/api/public-chat(AI 채팅)·
  // /api/public-guided-trial(사진 업로드)은 로그인 없이 체험해보는 전용 라우트로, 셋 다
  // lib/anonymous-usage.ts의 게스트 세션(httpOnly 쿠키, Supabase 로그인 세션과는 별개)
  // 기반 남용 방지를 자체적으로 하고 있어 로그인 세션이 없어도 됩니다 — 세션당 업로드
  // 1건+채팅 3턴, IP당 하루 3세션, 전체 게스트 일일 호출 상한까지 서버에서 강제합니다.
  // /api/webhooks/polar는
  // Polar 서버가 세션 쿠키 없이 호출하는 결제 웹훅으로, 인증은 여기가 아니라 라우트 안의
  // 웹훅 서명 검증(POLAR_WEBHOOK_SECRET)이 담당합니다 — /api/cron/*가 CRON_SECRET으로
  // 자체 인증하는 것과 같은 구조입니다.
  const isPublicRoute =
    path === '/login' ||
    path === '/welcome' ||
    path.startsWith('/auth/') ||
    path === '/privacy' ||
    path === '/terms' ||
    path === '/pricing' ||
    path.startsWith('/api/cron/') ||
    path === '/api/public-analyze' ||
    path === '/api/public-chat' ||
    path === '/api/public-guided-trial' ||
    path === '/api/webhooks/polar' ||
    // 전환 퍼널의 랜딩 방문·파일 업로드·결과 확인 이벤트(lib/funnel-tracking.ts)는 로그인
    // 전에 일어나므로 세션 없이도 호출 가능해야 합니다 — app/admin/funnel(집계 결과를 보는
    // 페이지)은 여기 포함하지 않아 로그인이 필요합니다.
    path === '/api/track-funnel-event';

  if (!user && !isPublicRoute) {
    if (isApiRoute) {
      return NextResponse.json({ error: '인증이 필요합니다. 로그인 후 다시 시도해주세요.' }, { status: 401 });
    }
    // 💡 [신규] 링크로 바로 들어온 미로그인 방문자의 "첫 화면"은 로그인 폼이 아니라
    // /welcome(체험 유도 랜딩 페이지)입니다. 그 외 보호된 경로를 북마크 등으로 직접
    // 열었을 때는 기존처럼 /login으로 보냅니다.
    const target = path === '/' ? '/welcome' : '/login';
    return withDetectedLocale(NextResponse.redirect(new URL(target, request.url)));
  }

  return withDetectedLocale(response);
}

// 확장자가 있는 경로(파비콘·마스코트 이미지·manifest.webmanifest·sw.js 등 public/ 정적
// 파일)는 전부 미들웨어를 건너뜁니다. 이전엔 favicon.ico만 예외였어서, 로그인하지 않은
// 방문자(예: /welcome·/login)의 정적 이미지 요청까지 이 미들웨어가 가로채 /login으로
// 307 리다이렉트했습니다 — <img> 태그 입장에선 이미지 대신 HTML을 받은 셈이라 디코딩에
// 실패하고, 브라우저가 기본 "깨진 이미지" 아이콘을 그려서 마스코트가 네모난 박스/검은
// 실루엣처럼 보이는 원인이었습니다. 이 앱의 실제 페이지·API 경로는 전부 확장자가 없으므로
// 이 패턴이 페이지 라우트를 오매칭할 위험은 없습니다.
export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
};