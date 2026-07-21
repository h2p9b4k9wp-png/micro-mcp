import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

type RouteParams = {
  params: Promise<{
    username: string;
    slug: string;
  }>;
};

// [1] 데이터 조회 기능 (GET)
export async function GET(request: Request, props: RouteParams) {
  try {
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