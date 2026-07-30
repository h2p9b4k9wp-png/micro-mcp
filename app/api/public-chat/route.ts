import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { truncateForPrompt } from '@/lib/truncate-text';
import { getClientIp, checkAnonymousUsage, recordAnonymousUsage } from '@/lib/anonymous-usage';

// 💡 [신규] 로그인 없이 AI에게 자유 질문 하나를 던져보는 체험(app/login/page.tsx의 "AI에게
// 바로 질문하기") 전용 라우트입니다. middleware.ts의 isPublicRoute에 등록돼 있어야 세션
// 없이도 호출할 수 있습니다. app/api/chat과 달리 첨부 파일·마감일·교수님 자료·최근 대화
// 기록·웹 검색은 전부 계정이 있어야 의미가 있는 기능이라 이 라우트에는 없습니다 — 사용자가
// 방금 입력한 질문 하나만 받아서 답합니다.
//
// 남용 방지는 app/api/public-analyze와 동일하게 lib/anonymous-usage.ts의 IP 기반 시간당/
// 일일 호출 횟수 제한을 공유합니다(두 라우트가 같은 예산을 소진).
export const dynamic = 'force-dynamic';

// 프롬프트 길이 상한 — 로그인 사용자 문서 첨부용 기본값(6만 자, lib/truncate-text.ts)은
// 사람이 직접 타이핑하는 질문 하나에는 과도하게 큽니다. 토큰 비용을 이 라우트 자체에서도
// 한 번 더 통제합니다.
const MAX_ANONYMOUS_PROMPT_CHARS = 2000;

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key is not configured.' }, { status: 500 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[public-chat] Supabase service role is not configured.');
      return NextResponse.json({ error: 'Server is misconfigured.' }, { status: 500 });
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const ip = getClientIp(req);
    const usageCheck = await checkAnonymousUsage(supabaseAdmin, ip);
    if (!usageCheck.ok) {
      return NextResponse.json(
        {
          error: 'Guest trial limit reached. Log in to keep using it.',
          limitReached: true,
          limitType: usageCheck.limitType,
        },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { prompt, responseLanguage } = body as { prompt?: string; responseLanguage?: string };
    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: 'Please enter a question.' }, { status: 400 });
    }

    // 💡 실제 OpenAI 호출 전에 먼저 기록합니다 — 스트리밍 도중 오류가 나도 이미 비용이
    // 발생하는 요청을 보낸 것이므로, app/api/public-analyze와 같은 원칙으로 여기서 한 번을
    // 소진한 것으로 기록합니다.
    await recordAnonymousUsage(supabaseAdmin, ip, 'chat');

    const truncatedPrompt = truncateForPrompt(prompt.trim(), MAX_ANONYMOUS_PROMPT_CHARS);

    const nowKST = new Date().toLocaleDateString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });

    const systemInstruction = `You are a helpful AI assistant.
Today is ${nowKST} (Korea Standard Time). If asked about dates, weekdays, or relative time ("this week", "in 3 days"), calculate exactly from this date.
This is a login-free trial of the assistant, so you have no access to any saved documents, deadlines, professor materials, past conversations, or web search — answer only from the user's message itself, and say so plainly if the question needs information you don't have.`;

    const languageDirective = responseLanguage
      ? `Respond entirely in ${responseLanguage}. This overrides the document's language.\n\n`
      : '';

    const openai = new OpenAI({ apiKey, maxRetries: 1 });
    const stream = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      max_tokens: 1024,
      stream: true,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `${languageDirective}${truncatedPrompt}` },
      ],
    });

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) {
              controller.enqueue(encoder.encode(delta));
            }
          }
          controller.close();
        } catch (streamErr) {
          console.error('[public-chat] streaming error:', streamErr);
          controller.error(streamErr);
        }
      },
    });

    return new Response(readableStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    console.error('[public-chat] error:', error);
    return NextResponse.json(
      { error: "Couldn't process your request. Please try again in a moment." },
      { status: 500 }
    );
  }
}
