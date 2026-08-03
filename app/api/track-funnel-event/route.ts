import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/anonymous-usage';
import type { FunnelEventType } from '@/lib/funnel-tracking';

// 💡 [신규] lib/funnel-tracking.ts의 trackFunnelEvent()가 호출하는 유일한 라우트입니다.
// 랜딩 방문·파일 업로드·결과 확인은 로그인 전에 일어나므로 middleware.ts의 isPublicRoute에
// 이 경로를 등록해뒀습니다 — 세션 없이도 호출할 수 있어야 합니다.
const VALID_EVENT_TYPES: FunnelEventType[] = ['landing_visit', 'file_upload', 'result_view', 'signup', 'payment'];

// 익명 이벤트 로깅용 라우트라 사용자별로 구분할 방법이 없으므로 IP 기준으로만 아주 느슨하게
// 막습니다 — 진짜 사용자가 이 상한에 걸릴 일은 없고, 단순 스팸성 호출로 집계가 오염되는
// 것만 막는 정도입니다.
const RATE_LIMIT_PER_MINUTE = 60;
const MAX_ANON_ID_CHARS = 100;

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(`track-funnel-event:${ip}`, RATE_LIMIT_PER_MINUTE, 60 * 1000)) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 });
    }

    const body = await req.json();
    const { anonId, eventType } = body as { anonId?: string; eventType?: string };
    if (
      !anonId ||
      typeof anonId !== 'string' ||
      !eventType ||
      !VALID_EVENT_TYPES.includes(eventType as FunnelEventType)
    ) {
      return NextResponse.json({ error: 'invalid request' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[track-funnel-event] Supabase 서비스 롤 설정이 없습니다.');
      return NextResponse.json({ error: '서버 설정이 올바르지 않습니다.' }, { status: 500 });
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { error } = await supabaseAdmin.from('funnel_events').insert({
      anon_id: anonId.slice(0, MAX_ANON_ID_CHARS),
      event_type: eventType,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[track-funnel-event] 기록 실패:', error);
    return NextResponse.json({ error: '기록에 실패했어요.' }, { status: 500 });
  }
}
