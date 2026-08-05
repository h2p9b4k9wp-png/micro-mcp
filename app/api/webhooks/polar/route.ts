import { Webhooks } from '@polar-sh/nextjs';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPaymentWebhookAlertEmail } from '@/lib/email';

// 💡 [신규] Polar 결제 웹훅 — Checkout Link(NEXT_PUBLIC_POLAR_CHECKOUT_URL 환경변수,
// lib/plan-limits.ts의 getPolarCheckoutUrl()이 씀)로
// reference_id=user.id를 실어 보낸 결제가 완료/취소/만료될 때 Polar가 호출합니다.
// 세션 쿠키가 없는 서버-대-서버 호출이라(middleware.ts의 isPublicRoute에 등록) 인증은
// 오직 Webhooks() 헬퍼의 Standard Webhooks 서명 검증(POLAR_WEBHOOK_SECRET)에 의존합니다
// — app/api/cron/cleanup-logs가 CRON_SECRET에 의존하는 것과 같은 이유의 구조입니다.
// 특정 사용자 대신이 아니라 임의의 계정의 profiles.is_pro를 바꿔야 하므로 서비스 롤 키로
// RLS를 우회합니다(다른 두 서비스 롤 키 사용처와 같은 정당화 기준 — CLAUDE.md 참고).
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role 설정이 없습니다.');
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

// 💡 checkout 시 reference_id 쿼리 파라미터로 실어 보낸 값이 Polar에 의해 그대로
// Order/Subscription의 metadata.reference_id로 복사되어 돌아옵니다(Polar 문서 확인 완료).
function extractUserId(metadata: Record<string, string | number | boolean> | undefined): string | null {
  const value = metadata?.reference_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// 💡 [수정] profiles.pro_source/pro_expires_at도 함께 갱신합니다(소사이어티 코드 기능
// 추가 — lib/society-codes.ts). 결제로 Pro가 되면(isPro=true) pro_source를 'payment'로
// 덮어씁니다 — 코드로 먼저 Pro였던 사용자가 나중에 결제하면, 코드 만료와 무관하게 계속
// Pro를 유지해야 하니 결제가 코드보다 우선합니다. isPro=false(구독 해지)면 소스가 무엇이든
// pro_source/pro_expires_at을 함께 null로 되돌려 무료 등급으로 완전히 리셋합니다.
// 💡 [수정] .select('id')로 "실제로 몇 행이 갱신됐는지"를 받아 0행이면 throw합니다.
// UPDATE ... WHERE id = <user>가 아무 행에도 매칭되지 않는 것은 Postgres/PostgREST 기준
// 에러가 아니라 정상 응답(빈 배열)입니다 — 그래서 이 확인이 없으면 대상 profiles 행이
// 없는 사용자의 결제가 "성공"으로 처리되고, Polar는 200을 받고 재시도하지 않으며, 로그에도
// 성공으로 남습니다(실제 돈이 오간 뒤 Pro는 안 켜진 상태). 20260816 마이그레이션의 가입
// 트리거가 그 전제(모든 사용자에게 profiles 행이 있다)를 보장하지만, 트리거가 어떤 이유로든
// 실패한 계정이 하나라도 생기면 같은 증상이 재발하므로 여기서 직접 확인합니다.
//
// throw하면 @polar-sh/nextjs의 Webhooks() 핸들러가 이를 non-2xx 응답으로 바꾸고, Polar가
// 자체 재시도 정책에 따라 같은 이벤트를 다시 보냅니다 — 그 사이 트리거 문제를 고치거나
// 행을 수동으로 만들어두면 재시도가 성공합니다. 조용히 넘어가는 것보다 훨씬 낫습니다.
async function setIsPro(userId: string, isPro: boolean, eventType: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ is_pro: isPro, pro_source: isPro ? 'payment' : null, pro_expires_at: null })
    .eq('id', userId)
    .select('id');
  if (error) {
    console.error(`[polar webhook] ${eventType}: profiles.is_pro 업데이트 실패 (user ${userId}):`, error);
    throw error;
  }
  if (!data || data.length === 0) {
    console.error(
      `[polar webhook] ${eventType}: profiles 행이 없어 is_pro를 갱신하지 못했습니다 (user ${userId}). ` +
        'Polar가 재시도할 수 있도록 에러를 던집니다 — 해당 사용자의 profiles 행이 있는지 확인하세요.'
    );
    throw new Error(`profiles row not found for user ${userId} (${eventType})`);
  }
  console.log(`[polar webhook] ${eventType}: user ${userId} → is_pro=${isPro} (${data.length}행 갱신)`);
}

const handleWebhook = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,

  // 결제 완료 — "구독이 활성화됐다"는 이 이벤트가 최초 결제와 결제 재시도 회복(dunning
  // 복구)을 모두 포함합니다(Polar 문서: "new paid subscription or payment recovered").
  onSubscriptionActive: async (payload) => {
    const userId = extractUserId(payload.data.metadata);
    if (!userId) {
      console.error('[polar webhook] subscription.active: metadata.reference_id가 없습니다.', payload.data.id);
      return;
    }
    await setIsPro(userId, true, 'subscription.active');
  },

  // 단건 결제(구독이 아닌 order)로도 Pro가 될 수 있는 경우를 대비 — 정기 구독이 아니라면
  // 이 이벤트만 오고 subscription.active는 안 올 수 있습니다.
  onOrderPaid: async (payload) => {
    const userId = extractUserId(payload.data.metadata);
    if (!userId) {
      console.error('[polar webhook] order.paid: metadata.reference_id가 없습니다.', payload.data.id);
      return;
    }
    await setIsPro(userId, true, 'order.paid');
  },

  // 구독 취소·만료로 접근 권한을 즉시 잃는 이벤트 — subscription.canceled(예약된 미래
  // 취소, 기간 종료 전까지는 여전히 active)와 달리 subscription.revoked는 "사용자가 즉시
  // 접근 권한을 잃는다"는 것이 Polar 문서에 명시된 이벤트라 이것만 false 처리에 씁니다.
  onSubscriptionRevoked: async (payload) => {
    const userId = extractUserId(payload.data.metadata);
    if (!userId) {
      console.error('[polar webhook] subscription.revoked: metadata.reference_id가 없습니다.', payload.data.id);
      return;
    }
    await setIsPro(userId, false, 'subscription.revoked');
  },
});

// 💡 [신규] 위 핸들러를 얇게 감싸서 2xx가 아닌 응답이 나오면 알림 메일을 한 통 보냅니다.
//
// 핸들러 "안"이 아니라 "바깥"에서 응답 코드만 보는 이유: 이 그물에 걸려야 하는 실패가
// 핸들러 안에서 던지는 예외(위 setIsPro의 0행 방어 등)만이 아니기 때문입니다. 서명 검증
// 실패(403 — POLAR_WEBHOOK_SECRET 불일치나 시크릿 회전 사고)는 Webhooks()가 핸들러를
// 호출하기도 전에 반환하므로, 핸들러 안에 알림을 넣으면 그 케이스를 통째로 놓칩니다.
// 응답 코드 하나만 보면 서명 실패·Supabase 설정 누락·예상 못 한 예외까지 전부 같은
// 그물에 걸립니다.
//
// 알림 전송은 어디까지나 부수효과이므로, 메일이 실패하더라도 Polar에 돌려주는 응답을
// 절대 바꾸지 않습니다 — 응답이 바뀌면 Polar의 재시도 판단이 왜곡됩니다. await하지 않고
// catch로 삼켜 로그만 남깁니다.
//
// 한계: 이 방식은 요청이 우리 앱에 도달했을 때만 동작합니다. 배포가 통째로 깨져 라우트가
// 아예 뜨지 않는 상황은 감지하지 못합니다 — 거기까지 필요해지면 외부 모니터링(Sentry,
// Vercel Log Drain 등)이 답입니다.
export const POST = async (req: NextRequest): Promise<Response> => {
  const res = await handleWebhook(req);

  if (!res.ok) {
    const apiKey = process.env.RESEND_API_KEY;
    // 수신 주소는 새 환경변수를 만들지 않고 Reddit 다이제스트가 쓰는 것을 그대로 재사용합니다.
    const to = process.env.DIGEST_EMAIL_TO;
    const from = process.env.DIGEST_EMAIL_FROM || 'onboarding@resend.dev';

    if (apiKey && to) {
      // 본문은 clone()에서 읽습니다 — 원본 res의 body 스트림을 소비하면 Polar에 돌려줄
      // 응답이 비어버립니다.
      void res
        .clone()
        .text()
        .then((body) => sendPaymentWebhookAlertEmail({ apiKey, to, from, status: res.status, body }))
        .catch((err) => console.error('[polar webhook] 실패 알림 메일 전송 실패:', err));
    } else {
      console.error(
        `[polar webhook] 웹훅이 HTTP ${res.status}로 실패했지만 알림 메일을 보낼 수 없습니다 — ` +
          'RESEND_API_KEY 또는 DIGEST_EMAIL_TO가 설정되지 않았습니다.'
      );
    }
  }

  return res;
};
