import type { SupabaseClient } from '@supabase/supabase-js';

// 💡 [신규] 로그인 없이 체험할 수 있는 두 기능(app/api/public-analyze, app/api/public-chat)이
// 공유하는 남용 방지 로직입니다. 둘 다 계정이 없는 요청이라 auth.uid() 기반 RLS를 쓸 수
// 없고, 대신 요청 IP를 키로 anonymous_trial_usage 테이블에 기록해 시간당/일일 호출 횟수를
// 셉니다. 두 기능이 동일하게 OpenAI 토큰 비용을 발생시키므로, 한도는 기능별로 따로 두지
// 않고 IP당 하나의 예산으로 합산합니다.
export const ANONYMOUS_HOURLY_LIMIT = 5;
export const ANONYMOUS_DAILY_LIMIT = 15;

export type AnonymousUsageKind = 'analyze' | 'chat';

export interface AnonymousUsageCheck {
  ok: boolean;
  limitType?: 'hourly' | 'daily';
}

// 요청 헤더에서 클라이언트 IP를 뽑습니다. IP를 전혀 알 수 없는 상황(로컬 개발 등)에서는
// 모든 요청이 하나의 버킷을 공유하게 됩니다 — 완벽하진 않지만, 제한이 아예 작동하지
// 않는 것보다는 안전합니다.
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

// 시간당 한도부터 검사합니다 — 짧은 시간에 몰아치는 호출을 먼저 걸러내고, 그걸 통과해도
// 하루 누적이 한도를 넘겼으면 마저 막습니다.
export async function checkAnonymousUsage(
  supabaseAdmin: SupabaseClient,
  ip: string
): Promise<AnonymousUsageCheck> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [hourlyResult, dailyResult] = await Promise.all([
    supabaseAdmin
      .from('anonymous_trial_usage')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .gte('created_at', oneHourAgo),
    supabaseAdmin
      .from('anonymous_trial_usage')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .gte('created_at', oneDayAgo),
  ]);
  if (hourlyResult.error) throw hourlyResult.error;
  if (dailyResult.error) throw dailyResult.error;

  if (hourlyResult.count !== null && hourlyResult.count >= ANONYMOUS_HOURLY_LIMIT) {
    return { ok: false, limitType: 'hourly' };
  }
  if (dailyResult.count !== null && dailyResult.count >= ANONYMOUS_DAILY_LIMIT) {
    return { ok: false, limitType: 'daily' };
  }
  return { ok: true };
}

// 💡 실제 OpenAI 호출 전에 먼저 기록합니다 — 그래야 실패(파싱 오류, AI 오류 등)를 반복
// 재시도하는 방식으로 한도를 우회할 수 없습니다(app/api/public-analyze의 기존 원칙과 동일).
// 기록 자체가 실패해도 이미 진행 중인 요청을 막을 이유는 아니라 throw하지 않고 로그만 남깁니다.
export async function recordAnonymousUsage(
  supabaseAdmin: SupabaseClient,
  ip: string,
  kind: AnonymousUsageKind
): Promise<void> {
  const { error } = await supabaseAdmin.from('anonymous_trial_usage').insert({ ip_address: ip, kind });
  if (error) console.error('[anonymous-usage] 사용 이력 기록 실패:', error);
}
