// 💡 [신규] 전환 퍼널(랜딩 방문 → 파일 업로드 → 결과 확인 → 회원가입 → 결제) 이벤트를
// 익명으로 기록하는 클라이언트 전용 유틸입니다. anon_id는 계정·이메일과 무관한 무작위
// UUID를 브라우저 쿠키에 저장해 재사용합니다 — httpOnly가 아닌 이유는 이 값이 서버가
// 아니라 이 파일(클라이언트 JS) 자신이 직접 읽고 써야 하기 때문입니다(lib/anonymous-usage.ts의
// guest_session_id처럼 위·변조 방지가 필요한 값이 아니라, 단순히 "같은 방문자의 이벤트를
// 서로 연결"하는 용도라 httpOnly로 잠글 이유가 없습니다).
export type FunnelEventType = 'landing_visit' | 'file_upload' | 'result_view' | 'signup' | 'payment';

const FUNNEL_ANON_ID_COOKIE = 'funnel_anon_id';
const FUNNEL_ANON_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1년

function getOrCreateFunnelAnonId(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${FUNNEL_ANON_ID_COOKIE}=([^;]*)`));
  if (match) return decodeURIComponent(match[1]);

  const id = crypto.randomUUID();
  document.cookie = `${FUNNEL_ANON_ID_COOKIE}=${id}; path=/; max-age=${FUNNEL_ANON_ID_MAX_AGE_SECONDS}; SameSite=Lax`;
  return id;
}

// 💡 실패해도 절대 throw하지 않습니다 — 트래킹은 부가 기능이라 실패가 실제 사용자 흐름
// (업로드·회원가입·결제)을 막으면 안 됩니다. keepalive: true는 결제 링크 클릭(새 탭 전환)이나
// 회원가입 직후 router.push처럼 페이지가 곧바로 이동/언마운트되는 시점에도 요청이 중간에
// 끊기지 않게 하기 위함입니다.
export function trackFunnelEvent(eventType: FunnelEventType): void {
  try {
    const anonId = getOrCreateFunnelAnonId();
    fetch('/api/track-funnel-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anonId, eventType }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // document/crypto가 없는 환경(SSR 등)이거나 그 외 예외 — 조용히 무시.
  }
}
