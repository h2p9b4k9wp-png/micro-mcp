import type { SupabaseClient } from '@supabase/supabase-js';

// 💡 [신규] 유료 전환 준비 — 결제 시스템은 아직 없고, profiles.is_pro 플래그(지금은
// Supabase 대시보드에서 수동으로 켜는 것)만으로 무료/Pro 한도를 가릅니다. 파일/채팅
// 월간 한도는 서버(app/api/chat, app/api/extract, app/api/upload-quota)에서, 교수님
// 개수/자료 개수 한도는 클라이언트(app/page.tsx)에서 검사합니다 — 후자는
// professors/documents 테이블에 클라이언트가 직접(Supabase RLS로) insert하는 구조라
// 서버 라우트를 거치지 않기 때문입니다.
// 💡 [수정] 파일 하나의 크기 상한 — 무료 30MB, Pro 100MB.
//
// 예전 값(무료 5MB / Pro 20MB)은 어차피 아무도 도달하지 못하는 숫자였습니다. 파일을 base64로
// 감싸 요청 본문에 실어 보내던 구조라, 플랫폼(Vercel) 요청 본문 상한 4.5MB에 먼저 걸려
// 실제 통과 크기는 두 등급 모두 약 3.2MB였습니다. 이제 파일은 브라우저에서 Supabase Storage로
// 직접 올라가고 서버는 그걸 내려받으므로(lib/storage-upload.ts, app/api/extract), 요청 본문
// 상한을 전혀 타지 않고 이 숫자가 그대로 실효 상한이 됩니다.
//
// 새 숫자의 근거는 실측입니다. 진짜 부담은 파일 크기가 아니라 "글자가 빽빽한 PDF"입니다 —
// 같은 서버리스 함수에서 23MB PDF는 약 950MB·20초, 55MB PDF는 약 1.9GB·50초가 들었습니다
// (반면 76MB PPTX는 슬라이드 XML만 읽으므로 225MB·0.4초). 그래서 Pro 상한은 파서의 기술적
// 한계선(MAX_EXTRACT_FILE_BYTES, 100MB)과 같은 값으로 두고, 그보다 큰 파일은 등급과 무관하게
// 막습니다. 실제 강의자료(PDF 슬라이드·PPTX·한글 파일)는 이 상한에 사실상 닿지 않습니다.
//
// ⚠️ 이 상한이 의미를 가지려면 /api/extract 함수의 메모리·실행시간이 함께 올라가야 합니다
// (vercel.json의 functions 설정 참고). 메모리가 기본값이면 큰 PDF는 상한 안이어도 실패합니다.
//
// app/api/extract·app/api/analyze·app/api/analyze-professor가 이 값을 공유해 검증합니다.
// 위 filesPerMonth(월간 처리 "횟수" 한도)와는 별개의, 요청 1건당 크기 한도입니다.
export const FREE_LIMITS = {
  // 💡 [수정] filesPerMonth는 더 이상 사용자에게 보이는 한도가 아닙니다 — 아래
  // MONTHLY_TOKEN_LIMITS로 통합됐습니다. 그런데 /api/extract(파일에서 글자 뽑기)는
  // OpenAI를 전혀 호출하지 않아 토큰을 1개도 쓰지 않으므로, 토큰 한도로는 막을 수가
  // 없습니다. PDF·OCR·한글 파싱은 CPU/메모리를 많이 쓰는 작업이라 완전히 열어두면
  // 그쪽만 노리는 남용 경로가 생깁니다. 그래서 이 값만 "화면에 안 보이는 내부 안전판"
  // 으로 남깁니다(게이지에는 표시하지 않음).
  filesPerMonth: 10,
  maxProfessors: 1,
  maxDocumentsPerProfessor: 10,
  maxUploadBytes: 30 * 1024 * 1024,
};

export const PRO_LIMITS = {
  filesPerMonth: 200,
  maxProfessors: Infinity,
  maxDocumentsPerProfessor: Infinity,
  maxUploadBytes: 100 * 1024 * 1024,
};

export function getPlanLimits(isPro: boolean) {
  return isPro ? PRO_LIMITS : FREE_LIMITS;
}

// 💡 [신규] 월 토큰 한도 — 사용자에게 보이는 유일한 사용량 축입니다.
//
// 횟수 기준을 버린 이유: 같은 "1회 분석"이 실측에서 182토큰짜리도, 534,676토큰짜리도
// 있었습니다(약 2,900배 차이). 횟수로는 이 격차를 전혀 잡지 못해, 가벼운 사용자는 과하게
// 막히고 무거운 사용자는 사실상 무제한이 됩니다.
//
// ⚠️ 아래 세 값은 **실측 데이터 없이 정한 잠정치**입니다. 사용자가 쌓이면
// ai_usage_logs로 사용자별 월 토큰 분포(중앙값·p90·p99)를 뽑아 다시 조정해야 합니다.
// 특히 free는 p90 근처로 맞추는 게 목표이지 평균이 아닙니다 — 평균에 맞추면 정상
// 사용자의 절반이 막힙니다.
//
// pro(1,500만)는 성격이 다릅니다. 차단이 목적이 아니라 **조사 신호**입니다. 정상
// 사용자는 절대 닿지 않는 값이고, 닿았다면 그 계정 하나가 구독료를 훨씬 넘는 비용을
// 내고 있다는 뜻이라 사람이 들여다봐야 합니다. 그래서 이 한도는 요청을 막지 않고
// 알림 메일만 보냅니다(lib/token-safety.ts 참고).
export const MONTHLY_TOKEN_LIMITS = {
  free: 500_000,
  code: 2_000_000,
  pro: 15_000_000,
} as const;

export type UsageTier = keyof typeof MONTHLY_TOKEN_LIMITS;

/** is_pro와 pro_source 조합을 세 등급 중 하나로 정리합니다. */
export function getUsageTier(isPro: boolean, proSource: 'payment' | 'code' | null): UsageTier {
  if (!isPro) return 'free';
  return proSource === 'code' ? 'code' : 'pro';
}

export function getMonthlyTokenLimit(tier: UsageTier): number {
  return MONTHLY_TOKEN_LIMITS[tier];
}

// 💡 [신규] 게이지 색·문구를 정하는 잔량 구간. 토큰 축은 사용자가 소진 속도를 예측할 수
// 없어서(같은 "1회"가 182일 수도 534,676일 수도 있음) 경고 없이 갑자기 막히면 횟수 기준
// 보다 훨씬 당황스럽습니다. 그래서 두 단계 미리 알려줍니다.
export type UsageLevel = 'ok' | 'warn' | 'low' | 'out';

export function getUsageLevel(remainingRatio: number): UsageLevel {
  if (remainingRatio <= 0) return 'out';
  if (remainingRatio < 0.15) return 'low';
  if (remainingRatio < 0.4) return 'warn';
  return 'ok';
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
    // 💡 [수정] 이건 화면에 노출되는 한도가 아니라 내부 안전판이므로(위 FREE_LIMITS 주석
    // 참고), 숫자나 "파일 처리 한도" 같은 내부 기준을 문구에 넣지 않습니다. 클라이언트는
    // limitType으로 어떤 카드를 띄울지 정하고 문구는 스스로 지역화합니다.
    return {
      ok: false,
      error: 'This month\'s usage limit has been reached.',
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
// 💡 [신규] profiles 조회 실패를 원인별로 구분해 로그로 남깁니다.
//
// 이 파일과 app/page.tsx의 profiles 조회들은 원래 전부 `const { data } = await ...`로
// error를 통째로 버리고 있었습니다. 그래서 조회가 실패해도 data가 null이 되어
// Boolean(data?.is_pro) === false, 즉 **"이 사용자는 무료 등급"과 완전히 같은 결과**가
// 나왔습니다 — 실제로 Pro인 사용자가 무료로 취급돼도 아무 흔적이 남지 않았습니다.
// (실제로 pro_source 컬럼이 없는 상태를 진단할 때 이 침묵 때문에 원인 파악이 늦어졌습니다.)
//
// 세 가지를 구분합니다. 셋 다 호출부는 "무료 등급"으로 안전하게 폴백하되, 로그에서는
// 명확히 갈립니다:
//   - PGRST116 : .single()이 0행(또는 2행 이상)을 받음 = profiles 행 자체가 없음.
//                20260816 마이그레이션의 가입 트리거·백필로 해결되는 경우.
//   - 42703    : 컬럼이 존재하지 않음. 마이그레이션 미적용(예: pro_source는 20260812가 생성).
//   - 그 외    : 네트워크·권한(RLS)·기타 오류.
export type ProfileLookupFailure = 'missing_row' | 'missing_column' | 'query_failed';

export function logProfileLookupFailure(
  context: string,
  userId: string,
  error: { code?: string; message?: string } | null
): ProfileLookupFailure | null {
  if (!error) return null;

  if (error.code === 'PGRST116') {
    console.error(
      `[${context}] profiles 행이 없어 등급을 확인하지 못했습니다 (user ${userId}). ` +
        '무료 등급으로 처리합니다 — 가입 트리거/백필(20260816 마이그레이션)이 적용됐는지 확인하세요.',
      error
    );
    return 'missing_row';
  }

  if (error.code === '42703') {
    console.error(
      `[${context}] profiles에 조회하려는 컬럼이 없습니다 (user ${userId}). ` +
        '무료 등급으로 처리합니다 — 관련 마이그레이션이 적용되지 않았습니다(pro_source/pro_expires_at은 20260812).',
      error
    );
    return 'missing_column';
  }

  console.error(
    `[${context}] profiles 조회에 실패했습니다 (user ${userId}). 무료 등급으로 처리하지만, ` +
      '이는 "실제로 무료 등급"이 아니라 "확인 실패"입니다.',
    error
  );
  return 'query_failed';
}

export async function getIsPro(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('is_pro').eq('id', userId).single();
  if (error) {
    logProfileLookupFailure('getIsPro', userId, error);
    return false;
  }
  return Boolean(data?.is_pro);
}

// 💡 [신규] 소사이어티 코드(lib/society-codes.ts)로 얻은 Pro인지 구분하기 위한 조회 —
// getIsPro와 별도 함수로 둔 이유는 대부분의 호출부(파일/채팅 월간 한도 검사 등)는
// pro_source가 필요 없고, /api/analyze·/api/analyze-professor처럼 코드 기반 Pro 전용
// 월 분석 횟수 상한(lib/society-codes.ts의 checkSocietyCodeAnalysisQuota)을 적용해야
// 하는 곳만 이 값을 씁니다. profiles SELECT RLS 정책이 본인 행만 허용하므로 세션 클라이언트로도
// 안전하게 조회할 수 있습니다.
// 💡 [수정] 조회 실패를 더 이상 조용히 삼키지 않습니다. 반환값 자체는 그대로 null이지만
// (호출부인 checkSocietyCodeAnalysisQuota는 null이면 상한을 적용하지 않고 통과시킵니다 —
// 부가 안전장치라 조회 실패로 정상 요청을 막지 않는 fail-open이 맞습니다), 실패했다는
// 사실은 반드시 로그로 남깁니다. "코드 기반 Pro가 아님(null)"과 "확인 실패(null)"가
// 값으로는 같아서, 로그가 없으면 상한이 조용히 꺼져 있어도 알 방법이 없습니다.
export async function getProSource(supabase: SupabaseClient, userId: string): Promise<'payment' | 'code' | null> {
  const { data, error } = await supabase.from('profiles').select('pro_source').eq('id', userId).single();
  if (error) {
    logProfileLookupFailure('getProSource', userId, error);
    return null;
  }
  return (data?.pro_source as 'payment' | 'code' | null) ?? null;
}
