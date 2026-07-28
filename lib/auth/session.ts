import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// 💡 [신규] API 라우트 핸들러에서 로그인한 사용자의 id만 필요할 때 쓰는 공용 헬퍼.
// middleware.ts와 같은 방식(쿠키 기반 세션)으로 조회하되, 여기서는 응답 쿠키를 갱신할
// 필요가 없어 setAll은 아무 것도 하지 않습니다. middleware.ts가 이미 로그인 여부를
// 검증하므로 이 값은 거의 항상 null이 아니지만, 방어적으로 호출부에서 null도 처리해야 합니다.
export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // 세션 조회 전용이라 응답 쿠키를 갱신할 필요가 없습니다.
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}
