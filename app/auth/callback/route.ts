import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    const cookieStore = await cookies();
    
    // 공식 최신 표준 SSR 클라이언트 선언 방식입니다.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // 서버 컴포넌트에서 쿠키를 수정하려고 할 때 발생하는 에러를 방지합니다.
            }
          },
        },
      }
    );

    // 인증 코드를 세션으로 교환합니다.
    await supabase.auth.exchangeCodeForSession(code);
  }

  // 인증 완료 후 메인페이지로 이동
  return NextResponse.redirect(requestUrl.origin);
}