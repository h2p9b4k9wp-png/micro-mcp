import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type AppLocale } from './i18n/locales';

// 💡 [신규] Accept-Language 헤더(예: "de-DE,de;q=0.9,en;q=0.8")를 선호도 순으로 파싱해
// SUPPORTED_LOCALES 중 처음 일치하는 언어를 고릅니다. 지원 로케일 코드가 전부 ISO 639-1
// 주 언어 서브태그(ko/en/ja/vi/es/fr/de/it/pt/nl)라 지역 서브태그(-DE, -BR 등)는 무시하고
// 앞부분만 비교합니다. 아무 것도 안 맞으면 'en'으로 — 한국어가 아닌 방문자를 지원하지
// 않는 언어라고 계속 한국어로 두는 것보다는 영어가 더 도움이 됩니다.
function detectLocaleFromAcceptLanguage(header: string): AppLocale {
  const primaryTags = header
    .split(',')
    .map((tag) => tag.split(';')[0]?.trim().toLowerCase().split('-')[0])
    .filter((tag): tag is string => Boolean(tag));

  for (const tag of primaryTags) {
    const match = SUPPORTED_LOCALES.find((locale) => locale === tag);
    if (match) return match;
  }
  return header.length === 0 ? DEFAULT_LOCALE : 'en';
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
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

  // 💡 [신규] "locale" 쿠키가 아직 없는 최초 방문자에게는 Accept-Language 헤더로 브라우저
  // 언어를 감지해 심어줍니다 — 이게 없으면 i18n/request.ts(next-intl)가 쿠키 미존재 시
  // 항상 DEFAULT_LOCALE('ko')로 폴백해서, 해외에서 접속한 방문자도 로그인 화면부터
  // 한국어로 보게 됩니다. SUPPORTED_LOCALES 10개(i18n/locales.ts) 중 브라우저가 선호하는
  // 언어를 detectLocaleFromAcceptLanguage로 고릅니다 — AI 답변 언어(responseLanguage,
  // app/page.tsx)가 navigator.language로 자동 감지하는 것과 같은 취지를 메뉴·버튼 같은
  // 고정 UI 문구에도 적용한 것입니다. LocaleSwitcher로 직접 바꾸면 그 값이 이 쿠키를
  // 그대로 덮어쓰므로, 자동 감지는 "쿠키가 아예 없는 최초 방문" 시점에만 한 번 개입합니다.
  const hasLocaleCookie = Boolean(request.cookies.get('locale'));
  const withDetectedLocale = (res: NextResponse) => {
    if (isApiRoute || hasLocaleCookie) return res;
    const detected = detectLocaleFromAcceptLanguage(request.headers.get('accept-language') || '');
    res.cookies.set('locale', detected, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
    return res;
  };

  // 💡 [수정] /privacy·/pricing은 로그인 없이도 봐야 하는 공개 페이지입니다(앱 심사·가입 전
  // 방문자 등). /welcome은 로그인 없이 링크로 들어온 방문자가 보는 첫 화면(라이트 테마
  // 랜딩 페이지, app/welcome/page.tsx)입니다. /api/cron/*는 세션 쿠키가 아니라 자체
  // CRON_SECRET으로 인증하는 Vercel Cron 전용 라우트라, 여기서 세션을 요구하면 Cron
  // 호출 자체가 401로 막힙니다. /api/public-analyze(파일 분석)와 /api/public-chat(AI 채팅)은
  // 로그인 없이 체험해보는 전용 라우트로, 둘 다 lib/anonymous-usage.ts의 IP 기반 시간당/
  // 일일 제한을 공유하며 자체적으로 남용을 막고 있어 세션이 없어도 됩니다. /api/webhooks/polar는
  // Polar 서버가 세션 쿠키 없이 호출하는 결제 웹훅으로, 인증은 여기가 아니라 라우트 안의
  // 웹훅 서명 검증(POLAR_WEBHOOK_SECRET)이 담당합니다 — /api/cron/*가 CRON_SECRET으로
  // 자체 인증하는 것과 같은 구조입니다.
  const isPublicRoute =
    path === '/login' ||
    path === '/welcome' ||
    path.startsWith('/auth/') ||
    path === '/privacy' ||
    path === '/pricing' ||
    path.startsWith('/api/cron/') ||
    path === '/api/public-analyze' ||
    path === '/api/public-chat' ||
    path === '/api/webhooks/polar';

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

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};