import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// 💡 쿠키 기반 세션에 바인딩된 Supabase 클라이언트 생성 — middleware.ts와 같은 방식이지만,
// API 라우트 핸들러에서는 응답 쿠키를 갱신할 필요가 없어(세션 조회/조건부 쿼리 전용) setAll은
// 아무 것도 하지 않습니다. getSessionUserId/getSessionSupabase가 공유하는 내부 헬퍼입니다.
async function buildSessionClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(
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
}

// 💡 [신규] API 라우트 핸들러에서 로그인한 사용자의 id만 필요할 때 쓰는 공용 헬퍼.
// middleware.ts가 이미 로그인 여부를 검증하므로 이 값은 거의 항상 null이 아니지만,
// 방어적으로 호출부에서 null도 처리해야 합니다.
export async function getSessionUserId(): Promise<string | null> {
  const supabase = await buildSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// 💡 [신규] 로그인한 사용자 본인 소유 행만 보이는(RLS 적용) Supabase 클라이언트가 함께
// 필요할 때 쓰는 헬퍼 — 예: profiles.is_pro 조회, document_uploads 월간 개수 집계처럼
// service role 키 없이 "이 사용자 소유 데이터"만 안전하게 읽어야 하는 경우.
export async function getSessionSupabase(): Promise<{ supabase: SupabaseClient; userId: string | null }> {
  const supabase = await buildSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

// 💡 [신규] app/admin/funnel/page.tsx(서버 컴포넌트)가 ADMIN_EMAIL 환경변수와 비교하기
// 위해 씁니다 — 위 두 헬퍼는 Route Handler용으로 문서화돼 있었지만 buildSessionClient()
// 자체는 next/headers의 cookies()만 읽는 순수 조회라 서버 컴포넌트에서도 그대로 동작합니다.
export async function getSessionUserEmail(): Promise<string | null> {
  const supabase = await buildSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}
