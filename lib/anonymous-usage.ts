import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// 💡 [신규] 로그인 없이 체험할 수 있는 세 기능(app/api/public-analyze, app/api/public-chat,
// app/api/public-guided-trial)이 공유하는 남용 방지 로직입니다. 예전엔 "IP당 시간당/일일
// 호출 횟수"만 셌는데, 그러면 방문자가 파일 하나만 올려보고 끝나버려서(AI에게 직접 물어보는
// 경험을 못 해봐서) 가입 전환이 잘 안 됐습니다. 그래서 "세션" 개념을 도입합니다:
//
//   1세션 = 업로드 1건(파일 분석 또는 이미지 체험 중 하나) + 후속 질문(채팅) 최대 3턴
//
// 세션은 httpOnly 쿠키로 서버가 직접 발급·판별합니다(GUEST_SESSION_COOKIE) — 클라이언트
// JS가 값을 읽거나 조작할 수 없고, localStorage처럼 지운다고 새 세션이 되지도 않습니다
// (같은 쿠키가 남아있는 한 서버는 계속 같은 세션으로 취급). 여기에 두 겹의 상한을 더 둡니다:
//   - IP당 하루 최대 IP_DAILY_SESSION_LIMIT개의 "새 세션" 시작 허용 (세션 자체를 계속
//     새로 시작하며 우회하는 것을 막음 — 쿠키를 지워도 같은 IP면 하루 3번까지만 새 세션이
//     허용됩니다)
//   - 전체 게스트(모든 IP 합산) 일일 API 호출 GLOBAL_DAILY_GUEST_LIMIT — 이걸 넘으면 그날은
//     특정 IP나 세션 상태와 무관하게 모든 게스트 요청을 막고 로그인을 유도합니다(비용 폭주
//     방지용 최종 안전판).
export const IP_DAILY_SESSION_LIMIT = 3;
export const SESSION_CHAT_TURN_LIMIT = 3;
export const GLOBAL_DAILY_GUEST_LIMIT = 100;

const GUEST_SESSION_COOKIE = 'guest_session_id';
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24; // 24시간 — IP 일일 한도 집계 창과 맞춤

export type AnonymousUsageKind = 'analyze' | 'chat' | 'guided' | 'chat_attachment';

export type GuestLimitType = 'session' | 'ip' | 'global';

export interface GuestUsageCheck {
  ok: boolean;
  limitType?: GuestLimitType;
}

// 요청 헤더에서 클라이언트 IP를 뽑습니다. IP를 전혀 알 수 없는 상황(로컬 개발 등)에서는
// 모든 요청이 하나의 버킷을 공유하게 됩니다 — 완벽하진 않지만, 제한이 아예 작동하지
// 않는 것보다는 안전합니다.
//
// 💡 [수정] x-vercel-forwarded-for를 최우선으로 확인하도록 바꿨습니다. 이 앱은 Vercel에
// 배포되는데(vercel.json), Vercel의 엣지 네트워크가 모든 요청의 TLS를 직접 종료하는
// 유일한 진입점이라 클라이언트가 origin에 직접 연결할 방법이 없습니다 — Vercel은 이
// 지점에서 x-forwarded-for/x-real-ip를 클라이언트가 보낸 값에 무언가를 "덧붙이는" 게
// 아니라 자신이 실제로 관측한 연결 IP로 통째로 덮어씁니다(공식 문서: "Vercel currently
// overwrites the X-Forwarded-For header and does not forward external IPs... to prevent
// IP spoofing" — 프록시 뒤에 있는 경우조차 예외가 아니라고 명시돼 있고, 특정 프록시를
// 명시적으로 신뢰하려면 Enterprise 전용 유료 기능인 Verified Proxy를 별도로 활성화해야
// 합니다). 즉 일반적인 리버스 프록시 구성과 달리 Vercel에서는 x-forwarded-for 값 자체를
// 클라이언트가 위조할 수 없습니다.
//
// x-vercel-forwarded-for는 값 자체는 x-forwarded-for와 동일하지만, Vercel 자체
// 네임스페이스(x-vercel-*)로 제공되는 별도 헤더입니다 — 이 이름은 Vercel 엣지만 설정할 수
// 있어서(다른 어떤 미들웨어·프록시·클라이언트도 우연히 같은 이름을 미리 심어둘 수 없음),
// "이 값은 반드시 Vercel 엣지가 설정했다"는 걸 헤더 이름 자체로 더 명확히 보장합니다.
// 로컬 개발이나 이 세션처럼 Vercel 엣지를 거치지 않는 환경에서는 이 헤더 자체가 존재하지
// 않으므로, 기존 x-forwarded-for/x-real-ip를 폴백으로 유지합니다 — 실제 프로덕션(Vercel)
// 트래픽에서는 이미 같은 값이라 폴백이어도 보안이 약해지지 않습니다.
export function getClientIp(req: Request): string {
  const vercelForwardedFor = req.headers.get('x-vercel-forwarded-for');
  if (vercelForwardedFor) {
    const first = vercelForwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

// 💡 [신규] 게스트 세션 ID — 기존 쿠키가 있으면 그대로 쓰고, 없으면 새로 발급해서 응답에
// 심습니다(httpOnly라 JS로는 못 읽고 못 지웁니다 — localStorage 기반 표시와 달리 진짜
// 서버 판정입니다). Route Handler 안에서 next/headers의 cookies()는 읽기와 쓰기(응답에
// Set-Cookie로 반영)를 모두 지원합니다.
export async function getGuestSessionId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(GUEST_SESSION_COOKIE)?.value;
  if (existing) return existing;

  const sessionId = randomUUID();
  cookieStore.set(GUEST_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return sessionId;
}

// 💡 [신규] 위 getGuestSessionId()는 항상 문자열을 반환하도록 타입이 잡혀있고 실제로도
// 쿠키가 있으면 그 값을, 없으면 방금 발급한 UUID를 반환합니다 — 정상 동작에서는 빈 값이
// 나올 수 없습니다. 하지만 cookies().set()이 예외를 던지는 극히 예외적인 상황(예: 응답
// 헤더가 이미 전송된 뒤 호출되는 등)까지 포함해 이 함수를 호출하는 라우트가 "세션 발급
// 실패"를 명시적으로 구분하게 만듭니다 — 실패 시 null을 반환하고, 호출부는 AI 호출이나
// anonymous_trial_usage 기록으로 넘어가지 않고 즉시 400으로 거절해야 합니다.
//
// session_id 없이 기록을 진행하면 anonymous_trial_usage에 session_id가 NULL인 행이
// 생기는데, SQL 표준상 NULL은 유니크 인덱스에서 서로 "같다"고 판정되지 않으므로
// (anonymous_trial_usage_session_upload_once_idx가 있어도) session_id가 NULL인 행끼리는
// 절대 충돌하지 않습니다 — 즉 recordAnonymousUploadIfAllowed()의 경쟁 조건 방어가
// session_id가 없는 요청에 대해서는 통째로 무력화됩니다. 세션 발급 실패를 "그냥 진행"이
// 아니라 요청 자체를 막는 이유가 이것입니다.
export async function getGuestSessionIdOrNull(): Promise<string | null> {
  try {
    const sessionId = await getGuestSessionId();
    return sessionId || null;
  } catch (err) {
    console.error('[anonymous-usage] 게스트 세션 발급 실패:', err);
    return null;
  }
}

// 전체 게스트(모든 IP 합산) 일일 호출 수 — 이게 GLOBAL_DAILY_GUEST_LIMIT을 넘으면 그날은
// 누구든 막습니다. 세 라우트 모두 다른 어떤 검사보다 먼저 이걸 확인합니다.
export async function checkGlobalDailyGuestLimit(supabaseAdmin: SupabaseClient): Promise<boolean> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from('anonymous_trial_usage')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', oneDayAgo);
  if (error) throw error;
  return (count ?? 0) < GLOBAL_DAILY_GUEST_LIMIT;
}

// 이 세션이 오늘 이 IP에서 "새로 시작하는" 세션인지 판단합니다 — 이미 이 session_id로
// 기록된 행이 하나라도 있으면 기존 세션을 이어가는 것이므로 IP 일일 세션 한도 검사를
// 건너뜁니다(이미 카운트된 세션이라 다시 셀 필요 없음, 그리고 이어가는 중인 세션까지
// 막아버리면 "후속 질문 3턴"을 도중에 끊어버리게 됨).
async function isNewSession(supabaseAdmin: SupabaseClient, sessionId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from('anonymous_trial_usage')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) throw error;
  return (count ?? 0) === 0;
}

// 이 IP가 오늘 이미 시작한 "서로 다른" 세션이 몇 개인지 셉니다. Supabase JS 클라이언트는
// count-distinct를 직접 지원하지 않아서, 오늘치 행의 session_id를 가져와 JS에서
// 중복 제거합니다 — 한도 자체가 낮아서(하루 IP당 몇 세션) 이 정도 데이터량은 문제 없습니다.
async function countDistinctSessionsToday(supabaseAdmin: SupabaseClient, ip: string): Promise<number> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('anonymous_trial_usage')
    .select('session_id')
    .eq('ip_address', ip)
    .gte('created_at', oneDayAgo)
    .not('session_id', 'is', null);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.session_id)).size;
}

// 이 세션이 이미 업로드(분석/이미지체험/채팅 첨부 중 하나)를 썼는지 — 세션당 업로드는 딱 1건입니다.
// 'chat_attachment'도 포함하는 이유: 채팅에 파일/사진을 첨부하는 것도 파싱·비전 호출이 있어
// 비용 구조가 파일 분석·이미지 체험과 동일하므로, 같은 예산 슬롯을 공유합니다.
async function sessionHasUsedUpload(supabaseAdmin: SupabaseClient, sessionId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from('anonymous_trial_usage')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .in('kind', ['analyze', 'guided', 'chat_attachment']);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// 이 세션이 이미 채팅 3턴을 다 썼는지.
async function sessionChatTurnsUsed(supabaseAdmin: SupabaseClient, sessionId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('anonymous_trial_usage')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('kind', 'chat');
  if (error) throw error;
  return count ?? 0;
}

// 💡 [신규] app/api/public-analyze, app/api/public-guided-trial(둘 다 "업로드" 액션),
// 그리고 app/api/public-chat이 요청에 첨부가 포함된 경우에 호출합니다. 검사 순서:
// 전체 일일 한도 → (새 세션이면) IP 일일 세션 한도 → 이 세션이 이미 업로드를 썼는지.
export async function checkGuestUploadAllowed(
  supabaseAdmin: SupabaseClient,
  ip: string,
  sessionId: string
): Promise<GuestUsageCheck> {
  if (!(await checkGlobalDailyGuestLimit(supabaseAdmin))) {
    return { ok: false, limitType: 'global' };
  }
  if (await isNewSession(supabaseAdmin, sessionId)) {
    const distinctSessions = await countDistinctSessionsToday(supabaseAdmin, ip);
    if (distinctSessions >= IP_DAILY_SESSION_LIMIT) {
      return { ok: false, limitType: 'ip' };
    }
  }
  if (await sessionHasUsedUpload(supabaseAdmin, sessionId)) {
    return { ok: false, limitType: 'session' };
  }
  return { ok: true };
}

// 💡 [신규] app/api/public-chat("후속 질문")이 호출합니다. 검사 순서: 전체 일일 한도 →
// (새 세션이면) IP 일일 세션 한도 → 이 세션의 채팅 턴이 이미 3턴을 다 썼는지.
// 업로드 없이 채팅부터 시작한 세션도 허용합니다(기존 "AI에게 바로 질문하기" 진입점을
// 그대로 유지하기 위함) — 그 경우 이 세션은 채팅 예산만 쓰고 업로드 예산은 그대로 남습니다.
export async function checkGuestChatAllowed(
  supabaseAdmin: SupabaseClient,
  ip: string,
  sessionId: string
): Promise<GuestUsageCheck> {
  if (!(await checkGlobalDailyGuestLimit(supabaseAdmin))) {
    return { ok: false, limitType: 'global' };
  }
  if (await isNewSession(supabaseAdmin, sessionId)) {
    const distinctSessions = await countDistinctSessionsToday(supabaseAdmin, ip);
    if (distinctSessions >= IP_DAILY_SESSION_LIMIT) {
      return { ok: false, limitType: 'ip' };
    }
  }
  const turnsUsed = await sessionChatTurnsUsed(supabaseAdmin, sessionId);
  if (turnsUsed >= SESSION_CHAT_TURN_LIMIT) {
    return { ok: false, limitType: 'session' };
  }
  return { ok: true };
}

// 💡 실제 OpenAI 호출 전에 먼저 기록합니다 — 그래야 실패(파싱 오류, AI 오류 등)를 반복
// 재시도하는 방식으로 한도를 우회할 수 없습니다. 기록 자체가 실패해도 이미 진행 중인
// 요청을 막을 이유는 아니라 throw하지 않고 로그만 남깁니다.
//
// 💡 이 함수 단독으로는 "세션당 업로드 1건" 예산을 진짜로 강제하지 못합니다 — 'analyze'/
// 'guided'/'chat_attachment' 업로드 경로는 checkGuestUploadAllowed()로 먼저 확인한 뒤에
// 이 함수를 호출하는데, 확인과 기록이 서로 다른 두 번의 왕복 요청이라 같은 세션으로 동시에
// 여러 요청을 보내면 전부 "아직 안 씀" 상태로 확인을 통과해버리는 경쟁 조건(TOCTOU)이
// 있었습니다. 업로드 계열 3종은 반드시 아래 recordAnonymousUploadIfAllowed()를 쓰세요 —
// 'chat'(채팅 턴, 세션당 최대 3회까지 허용)처럼 "여러 번 허용"되는 kind만 이 함수를
// 그대로 씁니다.
export async function recordAnonymousUsage(
  supabaseAdmin: SupabaseClient,
  ip: string,
  kind: AnonymousUsageKind,
  sessionId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('anonymous_trial_usage')
    .insert({ ip_address: ip, kind, session_id: sessionId });
  if (error) console.error('[anonymous-usage] 사용 이력 기록 실패:', error);
}

export type GuestUploadKind = 'analyze' | 'guided' | 'chat_attachment';

// 💡 [신규] "세션당 업로드 1건" 예산을 DB 레벨에서 원자적으로 강제합니다. 위
// recordAnonymousUsage()와 달리 이 함수는 INSERT 자체를 예산 판정으로 씁니다 —
// supabase/migrations의 부분 유니크 인덱스(anonymous_trial_usage_session_upload_once_idx,
// session_id 하나당 analyze/guided/chat_attachment 중 딱 1행만 허용)가 같은 session_id의
// 두 번째 업로드 INSERT를 DB가 직접 거부하게 만들어서, 동시에 여러 요청이 들어와도
// 정확히 하나만 성공하고 나머지는 23505(unique_violation)로 실패합니다 — checkGuestUploadAllowed()의
// SELECT 기반 사전 확인(사용자에게 빠른 429를 보여주기 위한 용도로 여전히 유지)과 달리,
// 이 함수의 실패는 "진짜로 이미 다른 요청이 먼저 슬롯을 가져갔다"는 뜻이라 호출부는 반드시
// 이 반환값을 확인하고 AI 호출 전에 중단해야 합니다.
export async function recordAnonymousUploadIfAllowed(
  supabaseAdmin: SupabaseClient,
  ip: string,
  kind: GuestUploadKind,
  sessionId: string
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from('anonymous_trial_usage')
    .insert({ ip_address: ip, kind, session_id: sessionId });
  if (!error) return { ok: true };
  if (error.code === '23505') return { ok: false };
  // 유니크 제약과 무관한 오류(네트워크 등)는 위 recordAnonymousUsage와 같은 원칙으로 요청을
  // 막지 않고 로그만 남깁니다 — 인프라 문제로 체험 기능 전체가 막히는 걸 피하기 위함이며,
  // 이 fail-open은 경쟁 조건 방지 목적과는 무관한 경로입니다.
  console.error('[anonymous-usage] 업로드 기록 실패(경쟁 조건 방지와 무관):', error);
  return { ok: true };
}
