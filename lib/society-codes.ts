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
      // 💡 이 문구는 폴백입니다. 실제로 사용자가 보는 안내는 클라이언트가 limitType
      // === 'societyCode'를 보고 t('societyCodeLimit.*')로 지역화해 카드로 그립니다
      // (app/page.tsx). 서버는 사용자의 화면 언어를 모르므로(로케일은 쿠키에만 있고
      // 이 검사는 서버 라우트에서 돕니다) 여기서 번역하지 않습니다 — 클라이언트가
      // 이 문자열을 무시하지 못하는 경우에만 노출됩니다.
      return {
        ok: false,
        error: `Society-code accounts are limited to ${SOCIETY_CODE_MONTHLY_ANALYSIS_LIMIT} uses per month. This resets next month.`,
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

// 💡 [수정] 코드 사용(redeem) — 킬스위치(전체 토큰 합계)만 여기서 미리 확인하고, 나머지
// 검증(코드 존재 → 취소/만료 → 이미 Pro인지 → 이미 이 코드를 쓴 적 있는지 → 정원)과
// 실제 기록·profiles 갱신은 DB 함수 redeem_society_code_atomic()
// (supabase/migrations/20260814_atomic_society_code_redemption_and_profile_lockdown.sql)
// 안에서 FOR UPDATE 잠금으로 원자적으로 처리됩니다 — 이 파일 초기 버전은 "정원 확인(count)과
// insert 사이에 이론적 경쟁 상태가 있다"고 스스로 문서화하고 있었는데(같은 코드의 마지막
// 한 자리를 두 사용자가 동시에 확인하면 둘 다 통과할 수 있음), 그 주석이 제안한 대로
// Postgres 함수로 옮겨 해결했습니다. 킬스위치 확인만 밖에 남겨둔 이유는 그게 하드 제약이
// 아니라("이미 코드를 쓰고 있는 사용자는 안 끊는다") 부드러운 안내성 체크라 잠금 안에
// 넣을 필요가 없기 때문입니다 — 아주 드물게 이 확인과 원자적 redeem 사이에 다른 요청이
// 끼어들어 임계값을 살짝 넘겨도 안전 문제가 아니라 안내 타이밍만 살짝 늦는 정도입니다.
export async function redeemSocietyCode(userId: string, rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    return { ok: false, errorCode: 'invalid_code', error: 'Please enter a code.' };
  }

  const supabaseAdmin = getSupabaseAdmin();

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

  const { data: status, error: rpcError } = await supabaseAdmin.rpc('redeem_society_code_atomic', {
    p_user_id: userId,
    p_code: code,
  });
  if (rpcError) {
    console.error('[society-codes] redeem_society_code_atomic 호출 실패:', rpcError);
    return { ok: false, errorCode: 'server_error', error: 'Something went wrong. Please try again.' };
  }

  switch (status as string) {
    case 'ok':
      break;
    case 'invalid_code':
      return { ok: false, errorCode: 'invalid_code', error: 'That code is not valid.' };
    case 'revoked':
      return { ok: false, errorCode: 'revoked', error: 'This code has been deactivated.' };
    case 'expired':
      return { ok: false, errorCode: 'expired', error: 'This code has expired.' };
    case 'already_pro':
      return { ok: false, errorCode: 'already_pro', error: 'Your account is already Pro.' };
    case 'already_redeemed':
      return { ok: false, errorCode: 'already_redeemed', error: "You've already used this code." };
    case 'full':
      return { ok: false, errorCode: 'full', error: 'This code has reached its usage limit.' };
    default:
      console.error('[society-codes] redeem_society_code_atomic이 알 수 없는 상태를 반환:', status);
      return { ok: false, errorCode: 'server_error', error: 'Something went wrong. Please try again.' };
  }

  // 함수가 'ok'를 반환했으니 성공 — 응답에 실어보낼 expiresAt만 별도로 조회합니다(함수는
  // 상태 문자열만 반환하므로).
  const { data: codeRow, error: codeError } = await supabaseAdmin
    .from('society_codes')
    .select('expires_at')
    .eq('code', code)
    .maybeSingle();
  if (codeError || !codeRow) {
    console.error('[society-codes] 성공 후 expires_at 조회 실패:', codeError);
    return { ok: true };
  }

  return { ok: true, expiresAt: codeRow.expires_at };
}
