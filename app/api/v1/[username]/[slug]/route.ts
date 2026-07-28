import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// 💡 [수정] 예전엔 이 클라이언트를 모듈 최상단에서 바로 생성했습니다 — env var가 비어있으면
// 요청 핸들러의 try/catch에 들어가기도 전에(모듈 로드 단계에서) 예외가 던져져, Next.js
// 기본 에러 페이지(운영 환경에서도 500/스택트레이스)가 그대로 노출될 수 있었습니다. 각
// 핸들러의 try 블록 안에서 호출하도록 함수로 감싸 그 실패도 정상적으로 catch되게 합니다.
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('서버 설정이 올바르지 않습니다.');
  }
  return createClient(supabaseUrl, supabaseKey);
}

type RouteParams = {
  params: Promise<{
    username: string;
    slug: string;
  }>;
};

// 💡 [신규] 이 라우트는 서비스 롤 키로 RLS를 우회하기 때문에, 호출자의 로그인 세션이
// username의 실제 소유자와 일치하는지 여기서 직접 확인합니다 — middleware.ts는 "로그인
// 여부"만 확인할 뿐 "이 데이터의 소유자인지"는 확인하지 않으므로, 이 검증이 없으면 로그인한
// 임의 사용자가 다른 username의 prompt를 읽거나 덮어쓸 수 있습니다.
async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // 라우트 핸들러에서는 응답 쿠키를 갱신할 필요가 없습니다(세션 조회 전용).
        },
      },
    }
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  return user?.id ?? null;
}

// [1] 데이터 조회 기능 (GET)
export async function GET(request: Request, props: RouteParams) {
  try {
    const supabase = getSupabaseAdmin();
    const resolvedParams = await props.params;
    const { username, slug } = resolvedParams;

    const { data: userProfile, error: userError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .single();

    if (userError || !userProfile) {
      return new NextResponse('User not found', { status: 404 });
    }

    const sessionUserId = await getSessionUserId();
    if (sessionUserId !== userProfile.id) {
      return new NextResponse('본인의 프롬프트만 조회할 수 있습니다.', { status: 403 });
    }

    const { data: prompt, error: promptError } = await supabase
      .from('prompts')
      .select('content')
      .eq('user_id', userProfile.id)
      .eq('slug', slug)
      .single();

    if (promptError || !prompt) {
      return new NextResponse('Prompt not found', { status: 404 });
    }

    return new NextResponse(prompt.content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// [2] 데이터 저장 및 수정 기능 (POST)
export async function POST(request: Request, props: RouteParams) {
  try {
    const supabase = getSupabaseAdmin();
    const resolvedParams = await props.params;
    const { username, slug } = resolvedParams;

    const { content } = await request.json();

    if (!content) {
      return new NextResponse('Content is required', { status: 400 });
    }

    const { data: userProfile, error: userError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .single();

    if (userError || !userProfile) {
      return new NextResponse('User not found', { status: 404 });
    }

    const sessionUserId = await getSessionUserId();
    if (sessionUserId !== userProfile.id) {
      return new NextResponse('본인의 프롬프트만 수정할 수 있습니다.', { status: 403 });
    }

    const { error: upsertError } = await supabase
      .from('prompts')
      .insert({
        user_id: userProfile.id,
        slug: slug,
        content: content
      })
      .select()
      .single();

    if (upsertError) {
      const { error: updateError } = await supabase
        .from('prompts')
        .update({ content: content })
        .eq('user_id', userProfile.id)
        .eq('slug', slug);

      if (updateError) throw updateError;
    }

    return NextResponse.json({ success: true, message: '프롬프트가 성공적으로 저장되었습니다!' });
  } catch (error: any) {
    console.error(error);
    return new NextResponse(error.message || 'Internal Server Error', { status: 500 });
  }
}