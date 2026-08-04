import { Webhooks } from '@polar-sh/nextjs';
import { createClient } from '@supabase/supabase-js';

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
async function setIsPro(userId: string, isPro: boolean, eventType: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ is_pro: isPro, pro_source: isPro ? 'payment' : null, pro_expires_at: null })
    .eq('id', userId);
  if (error) {
    console.error(`[polar webhook] ${eventType}: profiles.is_pro 업데이트 실패 (user ${userId}):`, error);
    throw error;
  }
  console.log(`[polar webhook] ${eventType}: user ${userId} → is_pro=${isPro}`);
}

export const POST = Webhooks({
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
