import type { SupabaseClient } from '@supabase/supabase-js';

// 💡 [신규] 유료 전환 준비 — 결제 시스템은 아직 없고, profiles.is_pro 플래그(지금은
// Supabase 대시보드에서 수동으로 켜는 것)만으로 무료/Pro 한도를 가릅니다. 파일/채팅
// 월간 한도는 서버(app/api/chat, app/api/extract, app/api/upload-quota)에서, 교수님
// 개수/자료 개수 한도는 클라이언트(app/page.tsx)에서 검사합니다 — 후자는
// professors/documents 테이블에 클라이언트가 직접(Supabase RLS로) insert하는 구조라
// 서버 라우트를 거치지 않기 때문입니다.
// 💡 [신규] 파일 하나(또는 /api/analyze·analyze-professor로 직접 보내는 텍스트 한 뭉치)의
// 크기 상한 — 무료 5MB, Pro 20MB. app/api/extract·app/api/analyze·app/api/analyze-professor가
// 이 값을 공유해 검증합니다(자세한 이유는 각 라우트 주석 참고). 위 filesPerMonth(월간 처리
// "횟수" 한도)와는 별개의, 요청 1건당 크기 한도입니다.
export const FREE_LIMITS = {
  filesPerMonth: 10,
  chatsPerMonth: 50,
  maxProfessors: 1,
  maxDocumentsPerProfessor: 10,
  maxUploadBytes: 5 * 1024 * 1024,
};

export const PRO_LIMITS = {
  filesPerMonth: 200,
  chatsPerMonth: 1000,
  maxProfessors: Infinity,
  maxDocumentsPerProfessor: Infinity,
  maxUploadBytes: 20 * 1024 * 1024,
};

export function getPlanLimits(isPro: boolean) {
  return isPro ? PRO_LIMITS : FREE_LIMITS;
}

// 💡 [신규] Pro 가격 — /pricing 페이지, 한도 초과 안내(채팅·파일·교수님·자료), 업그레이드
// 모달이 전부 이 상수 하나를 참조합니다. 가격이 바뀌면 여기만 고치면 됩니다.
export const PRO_PRICE_USD = 6.99;
export const PRO_PRICE_LABEL = `$${PRO_PRICE_USD}/month`;

// 💡 [수정] Polar 결제 연동 — 대시보드에서 미리 만들어둔 정적 Checkout Link를 환경변수
// (NEXT_PUBLIC_POLAR_CHECKOUT_URL)로 뺐습니다. 예전엔 소스에 하드코딩돼 있었는데, 샌드박스로
// 테스트하려고 이 값을 임시로 바꿨다가 실수로 그 상태로 main에 커밋/배포하면 프로덕션
// 결제가 통째로 샌드박스로 새는 사고가 날 수 있습니다 — 환경변수면 Vercel의 Preview/
// Production 스코프를 분리해서 소스를 건드리지 않고 안전하게 전환할 수 있습니다.
//
// NEXT_PUBLIC_ 접두사가 필요한 이유: 아래 getPolarCheckoutUrl()이 app/page.tsx(클라이언트
// 컴포넌트)의 렌더링 중에 직접 호출됩니다 — Next.js는 NEXT_PUBLIC_ 접두사가 붙은
// 환경변수만 클라이언트 번들에 실어보내므로, 접두사 없이 이 값을 참조하면 브라우저에서는
// 항상 undefined가 됩니다. 이 값 자체는 비밀이 아니라(누구나 브라우저에서 접근 가능한
// 결제 페이지 URL) 클라이언트에 노출돼도 문제없습니다 — NEXT_PUBLIC_SUPABASE_URL과 같은
// 성격입니다.
//
// 💡 [신규] 값이 없으면 조용히 깨진 링크('#')로 넘어가지 않고 명확한 에러를 던집니다.
// getPolarCheckoutUrl()이 실제로 호출되는 시점에만 검사합니다 — 이 값이 없다고 해서
// lib/plan-limits.ts를 같이 쓰는 무관한 기능들(getPlanLimits, PRO_PRICE_LABEL을 쓰는
// /api/chat·/api/extract·/pricing 등)까지 모듈 로드 시점에 죽어버리면 안 되기 때문입니다.
//
// 로그인한 사용자를 위 Checkout Link로 보낼 때 쓰는 URL 빌더. reference_id에 user.id를
// 실어 보내면 결제 완료 시 웹훅 payload의 metadata.reference_id로 그대로 돌아옵니다 —
// 이게 app/api/webhooks/polar가 어느 계정의 profiles.is_pro를 켤지 찾는 유일한 단서입니다.
// customer_email은 필수는 아니지만 Polar 결제 폼의 이메일 입력을 미리 채워 사용자 손이
// 덜 가게 하는 용도로 함께 붙입니다.
export function getPolarCheckoutUrl(userId: string, email?: string | null): string {
  const checkoutUrlBase = process.env.NEXT_PUBLIC_POLAR_CHECKOUT_URL;
  if (!checkoutUrlBase) {
    throw new Error(
      'NEXT_PUBLIC_POLAR_CHECKOUT_URL이 설정되지 않았습니다 — .env.local(또는 Vercel 환경변수)에 Polar Checkout Link를 설정하세요.'
    );
  }
  const url = new URL(checkoutUrlBase);
  url.searchParams.set('reference_id', userId);
  if (email) {
    url.searchParams.set('customer_email', email);
  }
  return url.toString();
}

// 💡 [신규] Polar 호스티드 고객 포털 — polar.sh/<조직 slug>/portal 고정 URL이고, 이메일만
// 입력하면 매직링크로 로그인해서 구독 취소·결제수단 변경·인보이스 다운로드를 셀프서비스로
// 처리할 수 있는 페이지입니다(Polar 공식 문서: 로그인 세션이 필요한 링크가 아니라 조직
// slug만 있으면 누구나 열 수 있는 상시 접근 가능한 경로 — Checkout Link와 같은 이유로
// 비밀이 아닙니다). "영수증 이메일을 뒤져서 그 안의 링크를 찾아야 한다"는 기존 안내보다
// 훨씬 바로 접근하기 쉬워서, 계정 삭제 전 구독 취소 유도(app/page.tsx의 Pro 구독 경고
// 모달)에 씁니다.
//
// 조직 slug는 코드베이스 어디에도 없는 값입니다 — NEXT_PUBLIC_POLAR_CHECKOUT_URL은
// slug가 아니라 polar_cl_...형태의 불투명 체크아웃 링크 ID라 여기서 slug를 역산할 수
// 없습니다. 추측해서 채우지 않았으니, Polar 대시보드 → Settings → General에서 조직
// slug를 확인해 아래 값을 실제 값으로 바꿔주세요.
export const POLAR_ORG_SLUG = 'REPLACE_WITH_YOUR_POLAR_ORG_SLUG';

export function getPolarCustomerPortalUrl(): string {
  return `https://polar.sh/${POLAR_ORG_SLUG}/portal`;
}

// 💡 [신규] 무료 등급 대화 기록 보관 기간(app/privacy 페이지에 적힌 문구와 실제 삭제
// 동작이 어긋나지 않도록, app/api/cron/cleanup-logs/route.ts가 이 값을 그대로 씁니다).
// Pro는 보관 기간 제한이 없고(계정 삭제 시까지), 이 상수는 무료 등급에만 적용됩니다.
export const FREE_LOG_RETENTION_DAYS = 30;

// 월간 한도 집계 기준 시점(UTC 월 1일 00:00). 정산 정밀도가 필요한 결제 연동 전 단계라
// KST 기준으로 정교하게 맞추지 않고 단순하게 UTC 월 경계를 씁니다.
export function getMonthStartISOString(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export interface FileQuotaResult {
  ok: boolean;
  error?: string;
  limit?: number;
  // 💡 [신규] 호출부가 이 검사와 별도로 maxUploadBytes 같은 다른 tier별 한도를 마저 확인해야
  // 할 때, profiles를 다시 조회하지 않도록 이미 조회한 is_pro를 함께 돌려줍니다.
  isPro?: boolean;
}

// 💡 [신규] "이번 달 파일 처리 한도" 검사를 한 곳에 모아둡니다 — /api/extract(텍스트 파일)와
// /api/upload-quota(채팅 이미지 첨부처럼 /api/extract를 거치지 않는 경로가 첨부 시점에
// 확인용으로 부르는 조회 전용 라우트)가 이 함수를 공유합니다. document_uploads는 성공한
// 파일/이미지 첨부마다 한 행씩 쌓이는 이력이라(recordDocumentUpload), 이번 달 행 수를 세는
// 것이 곧 "이번 달 몇 번 파일을 올렸는지"와 같습니다.
export async function checkFileQuota(supabase: SupabaseClient, userId: string): Promise<FileQuotaResult> {
  const [{ data: profile }, { count: monthlyCount }] = await Promise.all([
    supabase.from('profiles').select('is_pro').eq('id', userId).single(),
    supabase
      .from('document_uploads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', getMonthStartISOString()),
  ]);
  const isPro = Boolean(profile?.is_pro);
  const limits = getPlanLimits(isPro);
  if (monthlyCount !== null && monthlyCount >= limits.filesPerMonth) {
    return {
      ok: false,
      error: `이번 달 파일 처리 한도(${limits.filesPerMonth}회)에 도달했어요. Upgrade to Pro — ${PRO_PRICE_LABEL}`,
      limit: limits.filesPerMonth,
      isPro,
    };
  }
  return { ok: true, isPro };
}

// 💡 [신규] /api/analyze·/api/analyze-professor처럼 document_uploads 기반 월간 한도와는
// 무관하게 "이 호출자가 Pro인지"만 필요한 라우트를 위한 최소 조회. checkFileQuota와 달리
// document_uploads는 건드리지 않습니다 — 이 두 라우트는 파일 업로드 자체가 아니라 이미
// 추출된 텍스트를 분석하는 라우트라 월간 파일 처리 횟수 한도와는 별개입니다.
export async function getIsPro(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('is_pro').eq('id', userId).single();
  return Boolean(data?.is_pro);
}
