import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
  // 한국어로 보게 됩니다. 지원 로케일이 ko/en 둘뿐이라(i18n/locales.ts) 한국어가 아니면
  // 전부 영어로 보냅니다 — AI 답변 언어(responseLanguage, app/page.tsx)가 navigator.language로
  // 자동 감지하는 것과 같은 취지를 메뉴·버튼 같은 고정 UI 문구에도 적용한 것입니다.
  // LocaleSwitcher로 직접 바꾸면 그 값이 이 쿠키를 그대로 덮어쓰므로, 자동 감지는
  // "쿠키가 아예 없는 최초 방문" 시점에만 한 번 개입합니다.
  const hasLocaleCookie = Boolean(request.cookies.get('locale'));
  const withDetectedLocale = (res: NextResponse) => {
    if (isApiRoute || hasLocaleCookie) return res;
    const acceptLanguage = request.headers.get('accept-language') || '';
    const primaryLang = acceptLanguage.split(',')[0]?.trim().toLowerCase().split('-')[0];
    res.cookies.set('locale', primaryLang === 'ko' ? 'ko' : 'en', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
    return res;
  };

  // 💡 [수정] /privacy·/pricing은 로그인 없이도 봐야 하는 공개 페이지입니다(앱 심사·가입 전
  // 방문자 등). /api/cron/*는 세션 쿠키가 아니라 자체 CRON_SECRET으로 인증하는 Vercel
  // Cron 전용 라우트라, 여기서 세션을 요구하면 Cron 호출 자체가 401로 막힙니다.
  // /api/public-analyze는 로그인 없이 파일 1개를 체험 분석해보는 전용 라우트로, 자체적으로
  // IP 기반 하루 1회 제한을 두고 있어(app/api/public-analyze/route.ts) 세션이 없어도 됩니다.
  // /api/webhooks/polar는 Polar 서버가 세션 쿠키 없이 호출하는 결제 웹훅으로, 인증은
  // 여기가 아니라 라우트 안의 웹훅 서명 검증(POLAR_WEBHOOK_SECRET)이 담당합니다 —
  // /api/cron/*가 CRON_SECRET으로 자체 인증하는 것과 같은 구조입니다.
  const isPublicRoute =
    path === '/login' ||
    path.startsWith('/auth/') ||
    path === '/privacy' ||
    path === '/pricing' ||
    path.startsWith('/api/cron/') ||
    path === '/api/public-analyze' ||
    path === '/api/webhooks/polar';

  if (!user && !isPublicRoute) {
    if (isApiRoute) {
      return NextResponse.json({ error: '인증이 필요합니다. 로그인 후 다시 시도해주세요.' }, { status: 401 });
    }
    return withDetectedLocale(NextResponse.redirect(new URL('/login', request.url)));
  }

  return withDetectedLocale(response);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};