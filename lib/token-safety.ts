import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/society-codes';
import {
  getMonthStartISOString, getMonthlyTokenLimit, getUsageTier, getUsageLevel,
  type UsageTier, type UsageLevel,
} from '@/lib/plan-limits';
import { sendTokenLimitAlertEmail } from '@/lib/email';

// 💡 [신규] 사용자에게 보이지 않는 내부 토큰 상한 두 가지.
//
// 화면에 노출되는 한도는 지금처럼 "횟수"(월 채팅 수·파일 수, lib/plan-limits.ts)만입니다.
// 이 파일의 상한은 그 뒤에 두는 안전장치로, 정상 사용은 횟수 상한에 먼저 걸리기 때문에
// 여기까지 오지 않습니다. 프롬프트가 비정상적으로 길거나 자동화로 긁는 경우에만 걸립니다.
//
// ⚠️ 사용자에게 돌려주는 문구에는 "토큰"이라는 단어가 절대 들어가면 안 됩니다. 내부
// 지표를 노출하지 않기 위한 제약이라, 아래 LIMIT_MESSAGE 하나만 쓰고 숫자나 사유를
// 덧붙이지 마세요. 상세 내용은 서버 로그와 알림 메일에만 남습니다.

/**
 * 💡 [수정] 개인 월 토큰 상한이 "보이지 않는 안전장치"에서 **사용자에게 보이는 유일한
 * 사용량 한도**로 승격됐습니다. 예전에는 화면에 월 채팅 수·파일 수가 따로 있고 이 값은
 * 그 뒤의 비상 브레이크였는데, 이제 등급별 한도(lib/plan-limits.ts의 MONTHLY_TOKEN_LIMITS)
 * 하나로 통일됐습니다.
 *
 * 등급별 동작이 다릅니다:
 *   free / code → 한도에 닿으면 **요청을 막습니다**.
 *   pro         → **막지 않고 알림 메일만** 보냅니다. 정상 사용자는 절대 닿지 않는 값이라,
 *                 닿았다면 차단보다 사람이 들여다볼 신호로 쓰는 게 맞습니다(돈을 낸
 *                 사용자를 자동으로 끊는 것도 위험합니다).
 */
export const LIMIT_MESSAGE = '이번 달 사용량을 다 쓰셨어요.';

/**
 * 무료 사용자 전체의 월 토큰 합계 킬스위치. 값이 없으면 꺼진 것으로 취급합니다
 * (fail open) — 이 저장소의 다른 선택적 안전장치들과 같은 원칙입니다.
 *
 * 이미 있던 SOCIETY_CODE_MONTHLY_TOKEN_LIMIT과는 대상이 다릅니다: 그쪽은 코드로 Pro가 된
 * 계정만 세고, 막는 것도 "신규 코드 사용"이지 AI 호출이 아닙니다. 이쪽은 무료 등급 전체를
 * 세고 AI 호출 자체를 막습니다.
 */
function getFreeTierTokenLimit(): number | null {
  const raw = process.env.FREE_TIER_MONTHLY_TOKEN_LIMIT;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// 💡 전체 합계는 모든 무료 사용자의 행을 훑는 조회라 AI 요청마다 그대로 돌리면 부담이
// 큽니다. 킬스위치는 초 단위 정확도가 필요 없으므로(임계값을 살짝 넘겨 몇 건 더 통과해도
// 안전 문제가 아님) 짧게 캐시합니다. 서버리스 인스턴스가 재사용되는 동안만 유효한
// 메모리 캐시로, lib/rate-limit.ts가 쓰는 것과 같은 성격입니다.
const FREE_TIER_CACHE_TTL_MS = 60_000;
let freeTierCache: { total: number; at: number } | null = null;

async function getFreeTierTokenTotal(supabaseAdmin: SupabaseClient, since: string): Promise<number | null> {
  const now = Date.now();
  if (freeTierCache && now - freeTierCache.at < FREE_TIER_CACHE_TTL_MS) {
    return freeTierCache.total;
  }
  const { data, error } = await supabaseAdmin.rpc('free_tier_monthly_token_total', { p_since: since });
  if (error) {
    console.error('[token-safety] 무료 등급 전체 토큰 합계 조회 실패:', error);
    return null;
  }
  const total = Number(data ?? 0);
  freeTierCache = { total, at: now };
  return total;
}

export interface TokenSafetyResult {
  ok: boolean;
  /** 어떤 등급으로 판정했는지 — 호출부가 안내 카드 종류를 고르는 데 씁니다. */
  tier?: UsageTier;
  /** 사용자에게 그대로 보여줄 문구(토큰이라는 단어 없음). ok가 false일 때만 채워집니다. */
  message?: string;
}

/**
 * AI 호출 직전에 부릅니다. 어느 쪽이든 걸리면 서버 로그를 남기고, 이번 달 처음 걸린
 * 경우에만 알림 메일을 한 통 보냅니다.
 *
 * 조회가 실패하면 막지 않고 통과시킵니다(fail open). 이 상한은 남용 방지용 부가
 * 안전장치일 뿐이라, 조회 실패로 정상 요청까지 막으면 안 됩니다 — checkFileQuota,
 * checkSocietyCodeAnalysisQuota 등 이 저장소의 다른 선택적 한도 검사와 같은 원칙입니다.
 *
 * Pro 사용자는 개인 상한을 적용하지 않습니다(돈을 낸 쪽을 내부 안전장치로 막지 않음).
 * 전체 킬스위치도 무료 사용자만 세고 무료 사용자에게만 적용됩니다.
 */
export async function checkTokenSafetyLimits(
  userId: string,
  isPro: boolean,
  proSource: 'payment' | 'code' | null = null
): Promise<TokenSafetyResult> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const since = getMonthStartISOString();
    const tier: UsageTier = getUsageTier(isPro, proSource);
    const limit = getMonthlyTokenLimit(tier);

    // ① 등급별 월 한도
    const { data: userTotalRaw, error: userError } = await supabaseAdmin.rpc('user_monthly_token_total', {
      p_user_id: userId,
      p_since: since,
    });
    if (userError) {
      console.error('[token-safety] 사용자 월 토큰 합계 조회 실패:', userError);
    } else if (Number(userTotalRaw ?? 0) >= limit) {
      const total = Number(userTotalRaw ?? 0);
      console.warn(`[token-safety] 월 한도 도달 — tier=${tier}, user=${userId}, total=${total}, limit=${limit}`);
      await notifyOnce(supabaseAdmin, 'user', userId, since, total, limit);
      // pro는 조사 신호일 뿐이라 통과시킵니다(위 상수 주석 참고).
      if (tier !== 'pro') {
        return { ok: false, message: LIMIT_MESSAGE, tier };
      }
    }

    // ② 무료 사용자 전체 킬스위치 — 무료 등급에만 적용됩니다.
    const freeTierLimit = getFreeTierTokenLimit();
    if (tier === 'free' && freeTierLimit !== null) {
      const total = await getFreeTierTokenTotal(supabaseAdmin, since);
      if (total !== null && total >= freeTierLimit) {
        console.warn(`[token-safety] 무료 등급 전체 킬스위치 발동 — total=${total}, limit=${freeTierLimit}`);
        await notifyOnce(supabaseAdmin, 'free_tier', null, since, total, freeTierLimit);
        return { ok: false, message: LIMIT_MESSAGE, tier };
      }
    }

    return { ok: true, tier };
  } catch (error) {
    console.error('[token-safety] 토큰 상한 검사 중 오류:', error);
    return { ok: true };
  }
}

/**
 * token_limit_alerts에 (이번 달, 이 대상) 행을 하나 만들고, 실제로 새로 만들어졌을 때만
 * 메일을 보냅니다. 중복은 부분 unique 인덱스가 DB에서 막습니다 — 동시 요청 두 건이 같이
 * 들어와도 한 통만 나갑니다(23505로 걸린 쪽은 그냥 건너뜀).
 *
 * 메일 발송 실패가 요청을 깨뜨리면 안 되므로 여기서 삼킵니다. 상한 자체는 이미 적용된
 * 뒤이고, 서버 로그에는 남습니다.
 */
async function notifyOnce(
  supabaseAdmin: SupabaseClient,
  scope: 'user' | 'free_tier',
  userId: string | null,
  since: string,
  total: number,
  limit: number
): Promise<void> {
  const periodStart = since.slice(0, 10); // YYYY-MM-DD (해당 월 1일)
  const { error } = await supabaseAdmin
    .from('token_limit_alerts')
    .insert({ scope, user_id: userId, period_start: periodStart });

  if (error) {
    // 23505 = unique 위반 = 이번 달에 이미 알렸음. 정상 경로이므로 조용히 넘어갑니다.
    if (error.code === '23505') return;
    console.error('[token-safety] 알림 기록 실패:', error);
    return;
  }

  try {
    await sendTokenLimitAlertEmail({ scope, userId, total, limit, periodStart });
  } catch (mailError) {
    console.error('[token-safety] 알림 메일 발송 실패:', mailError);
  }
}

// 💡 [신규] 사이드바 게이지가 쓸 "이번 달 남은 비율". 토큰 수도 한도 수도 돌려주지
// 않습니다 — 화면에 숫자를 노출하지 않는 게 이 기능의 전제라, 애초에 클라이언트로
// 넘기지 않는 편이 실수로 표시될 여지를 없앱니다.
//
// pro 등급은 한도가 차단용이 아니라 조사 신호라(위 주석 참고) 게이지를 그리지 않습니다 —
// "구독했는데 게이지가 줄어든다"는 인상을 주면 안 됩니다.
export interface UsageRatioResult {
  ratio: number;
  level: UsageLevel;
}

export async function getUsageRatio(
  userId: string,
  isPro: boolean,
  proSource: 'payment' | 'code' | null
): Promise<UsageRatioResult | null> {
  const tier = getUsageTier(isPro, proSource);
  if (tier === 'pro') return null;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.rpc('user_monthly_token_total', {
      p_user_id: userId,
      p_since: getMonthStartISOString(),
    });
    if (error) {
      console.error('[token-safety] 게이지용 사용량 조회 실패:', error);
      return null;
    }
    const limit = getMonthlyTokenLimit(tier);
    const ratio = Math.max(0, Math.min(1, (limit - Number(data ?? 0)) / limit));
    return { ratio, level: getUsageLevel(ratio) };
  } catch (err) {
    console.error('[token-safety] 게이지용 사용량 조회 중 오류:', err);
    return null;
  }
}
