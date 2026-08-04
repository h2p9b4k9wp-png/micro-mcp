import { randomBytes } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getMonthStartISOString } from '@/lib/plan-limits';

// 💡 [신규] "소사이어티 코드" 기능 전용 서비스 롤 클라이언트 — 코드 발급/조회(관리자)와
// 코드 사용(redeem)이 전부 여러 사용자에 걸친 집계·타인의 profiles 갱신이 필요해서
// RLS로는 처리할 수 없습니다(society_codes/society_code_redemptions는 아예 정책이 없고,
// ai_usage_logs도 SELECT 정책이 없습니다 — 마이그레이션 주석 참고). app/api/webhooks/polar,
// app/api/cron/cleanup-logs와 같은 정당화 기준입니다.
export function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role 설정이 없습니다.');
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

// 💡 [신규] 코드로 Pro가 된 계정은 결제 기반 Pro(profiles.is_pro만 놓고 보면 구분이 안 됨)와
// 달리 실제 비용 부담 없이 발급된 계정이라, 정상 사용 범위를 훨씬 넘는 남용만 걸러내는
// 넉넉한 월 분석 횟수 상한을 별도로 둡니다. 결제 기반 Pro·무료 사용자에게는 전혀 적용되지
// 않습니다 — getPlanLimits(filesPerMonth/chatsPerMonth)와는 별개의, 코드 기반 Pro 전용
// 안전장치입니다.
export const SOCIETY_CODE_MONTHLY_ANALYSIS_LIMIT = 100;

// 💡 [신규] 코드 하나로 자동 발급되는 코드 문자열 — 사람이 직접 옮겨 적어도 헷갈리지 않도록
// 대문자+숫자만 쓰고, 시각적으로 혼동되는 문자(0/O, 1/I/L)를 뺐습니다. "SOC-XXXX-XXXX"
// 형태로 8자를 두 묶음(4+4)으로 나눠 가독성을 높입니다.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateSocietyCode(): string {
  const bytes = randomBytes(8);
  let chars = '';
  for (let i = 0; i < 8; i++) {
    chars += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `SOC-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

export interface RedeemResult {
  ok: boolean;
  error?: string;
  errorCode?:
    | 'invalid_code'
    | 'revoked'
    | 'expired'
    | 'full'
    | 'already_pro'
    | 'already_redeemed'
    | 'kill_switch'
    | 'server_error';
  expiresAt?: string;
}

// 💡 [신규] 전체 무료 코드 사용자(profiles.pro_source = 'code')의 이번 달 토큰 합계 —
// 신규 코드 사용을 막을지 판단하는 킬스위치와, /admin/society-codes의 대시보드 상단
// 요약 숫자가 공유합니다. ai_usage_logs에 SELECT 정책이 없어(마이그레이션 주석 참고)
// 서비스 롤 클라이언트로만 조회할 수 있습니다.
export async function getSocietyCodeMonthlyTokenTotal(supabaseAdmin: SupabaseClient): Promise<number> {
  const { data: codeProfiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('pro_source', 'code');
  if (profilesError) {
    console.error('[society-codes] 코드 기반 Pro 사용자 조회 실패:', profilesError);
    return 0;
  }
  const userIds = (codeProfiles ?? []).map((p) => p.id as string);
  if (userIds.length === 0) return 0;

  const { data: usageRows, error: usageError } = await supabaseAdmin
    .from('ai_usage_logs')
    .select('total_tokens')
    .in('user_id', userIds)
    .gte('created_at', getMonthStartISOString());
  if (usageError) {
    console.error('[society-codes] 코드 기반 Pro 토큰 사용량 조회 실패:', usageError);
    return 0;
  }
  return (usageRows ?? []).reduce((sum, row) => sum + (row.total_tokens as number), 0);
}

export interface AnalysisQuotaResult {
  ok: boolean;
  error?: string;
}

// 💡 [신규] /api/analyze·/api/analyze-professor가 호출합니다 — 코드 기반 Pro(pro_source
// === 'code')에만 적용되는 월 분석 횟수 상한. 결제 기반 Pro·무료 사용자는 proSource가
// 'code'가 아니므로 즉시 통과합니다. ai_usage_logs에 SELECT 정책이 없어 서비스 롤로
// 조회합니다. 조회 자체가 실패하면(네트워크 등) 막지 않고 열어둡니다(fail open) — 이
// 상한은 남용 방지용 부가 안전장치일 뿐이라, 조회 실패로 정상적인 분석 요청까지 막으면
// 안 됩니다(checkFileQuota 등 이 코드베이스의 다른 선택적 한도 검사와 같은 원칙).
export async function checkSocietyCodeAnalysisQuota(userId: string, proSource: string | null): Promise<AnalysisQuotaResult> {
  if (proSource !== 'code') return { ok: true };

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { count, error } = await supabaseAdmin
      .from('ai_usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', getMonthStartISOString());
    if (error) {
      console.error('[society-codes] 코드 기반 Pro 분석 횟수 조회 실패:', error);
      return { ok: true };
    }
    if ((count ?? 0) >= SOCIETY_CODE_MONTHLY_ANALYSIS_LIMIT) {
      return {
        ok: false,
        error: `Society-code accounts are limited to ${SOCIETY_CODE_MONTHLY_ANALYSIS_LIMIT} analyses per month. This resets next month.`,
      };
    }
    return { ok: true };
  } catch (error) {
    console.error('[society-codes] 코드 기반 Pro 분석 횟수 조회 중 오류:', error);
    return { ok: true };
  }
}

// 💡 [신규] "설정값"(요청 문구 그대로) — 관리자 UI 없이 환경변수 하나로 킬스위치 임계값을
// 조정합니다(ADMIN_EMAIL·CRON_SECRET 등 이 코드베이스의 다른 관리자 전용 값들과 같은
// 패턴 — 재배포가 필요하다는 트레이드오프가 있지만, 이 값을 위해서만 별도의 설정 테이블 +
// 수정 UI를 새로 만들 정도는 아니라고 판단했습니다). 값이 없으면 킬스위치를 끈 것으로
// 취급합니다(fail open) — 이 프로젝트의 다른 선택적 안전장치들(checkFileQuota 조회 실패
// 시 업로드 허용 등)과 같은 원칙으로, 설정을 깜빡했다고 핵심 가입 흐름이 막히면 안 됩니다.
function getMonthlyTokenLimit(): number | null {
  const raw = process.env.SOCIETY_CODE_MONTHLY_TOKEN_LIMIT;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// 💡 [신규] 코드 사용(redeem) 전체를 서비스 롤로 처리하는 핵심 함수 — app/api/society-code/redeem이
// 이것 하나만 호출합니다. 검증 순서: 코드 존재 → 취소/만료 → 정원 → 이미 Pro인지 → 이미 이
// 코드를 쓴 적 있는지 → 전체 킬스위치. 마지막에 society_code_redemptions insert +
// profiles 갱신을 순서대로 실행합니다.
//
// 💡 동시성에 대한 알려진 한계: 정원 확인(count)과 insert 사이에 이론적인 경쟁 상태가
// 있습니다(두 요청이 동시에 마지막 한 자리를 확인하면 둘 다 통과할 수 있음). society_code_
// redemptions의 unique(code_id, user_id) 제약은 "같은 사용자가 같은 코드를 두 번 쓰는 것"만
// 막고, "서로 다른 두 사용자가 마지막 한 자리를 동시에 채우는 것"은 막지 못합니다. 이 앱의
// 다른 카운트 기반 한도들(anonymous_trial_usage 등)도 같은 성격의 이론적 경쟁 상태를 안고
// 있고, 소사이어티 코드도 플래시세일처럼 초 단위로 몰리는 트래픽이 아니라 학생들이 시차를
// 두고 가입하는 흐름이라 실무적으로 감수 가능한 위험으로 판단했습니다. 완벽한 원자성이
// 필요해지면 Postgres 함수(SELECT ... FOR UPDATE)로 옮기세요.
export async function redeemSocietyCode(userId: string, rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    return { ok: false, errorCode: 'invalid_code', error: 'Please enter a code.' };
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: codeRow, error: codeError } = await supabaseAdmin
    .from('society_codes')
    .select('id, max_uses, expires_at, revoked_at')
    .eq('code', code)
    .maybeSingle();
  if (codeError) {
    console.error('[society-codes] 코드 조회 실패:', codeError);
    return { ok: false, errorCode: 'server_error', error: 'Something went wrong. Please try again.' };
  }
  if (!codeRow) {
    return { ok: false, errorCode: 'invalid_code', error: 'That code is not valid.' };
  }
  if (codeRow.revoked_at) {
    return { ok: false, errorCode: 'revoked', error: 'This code has been deactivated.' };
  }
  if (new Date(codeRow.expires_at).getTime() <= Date.now()) {
    return { ok: false, errorCode: 'expired', error: 'This code has expired.' };
  }

  const [{ count: usedCount, error: countError }, { data: profile, error: profileError }, { data: existing, error: existingError }] =
    await Promise.all([
      supabaseAdmin
        .from('society_code_redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('code_id', codeRow.id),
      supabaseAdmin.from('profiles').select('is_pro').eq('id', userId).single(),
      supabaseAdmin
        .from('society_code_redemptions')
        .select('id')
        .eq('code_id', codeRow.id)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
  if (countError || profileError || existingError) {
    console.error('[society-codes] 검증 조회 실패:', countError || profileError || existingError);
    return { ok: false, errorCode: 'server_error', error: 'Something went wrong. Please try again.' };
  }
  if ((usedCount ?? 0) >= codeRow.max_uses) {
    return { ok: false, errorCode: 'full', error: 'This code has reached its usage limit.' };
  }
  if (profile?.is_pro) {
    return { ok: false, errorCode: 'already_pro', error: 'Your account is already Pro.' };
  }
  if (existing) {
    return { ok: false, errorCode: 'already_redeemed', error: "You've already used this code." };
  }

  const tokenLimit = getMonthlyTokenLimit();
  if (tokenLimit !== null) {
    const monthlyTotal = await getSocietyCodeMonthlyTokenTotal(supabaseAdmin);
    if (monthlyTotal >= tokenLimit) {
      return {
        ok: false,
        errorCode: 'kill_switch',
        error: 'Society codes are temporarily unavailable due to high usage this month. Please try again next month or contact support.',
      };
    }
  }

  const { error: insertError } = await supabaseAdmin
    .from('society_code_redemptions')
    .insert({ code_id: codeRow.id, user_id: userId });
  if (insertError) {
    // unique(code_id, user_id) 위반이면 동시 요청이 먼저 성공한 것 — 사용자에게는
    // "이미 사용함"으로 보여주는 게 정확합니다.
    if (insertError.code === '23505') {
      return { ok: false, errorCode: 'already_redeemed', error: "You've already used this code." };
    }
    console.error('[society-codes] 사용 기록 실패:', insertError);
    return { ok: false, errorCode: 'server_error', error: 'Something went wrong. Please try again.' };
  }

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ is_pro: true, pro_source: 'code', pro_expires_at: codeRow.expires_at })
    .eq('id', userId);
  if (updateError) {
    console.error('[society-codes] Pro 승격 실패:', updateError);
    return { ok: false, errorCode: 'server_error', error: 'Something went wrong. Please try again.' };
  }

  return { ok: true, expiresAt: codeRow.expires_at };
}
