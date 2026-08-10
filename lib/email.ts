import { Resend } from 'resend';

// 💡 [신규] app/api/cron/reddit-digest 전용 — Resend로 일일 다이제스트 이메일 한 통을
// 보냅니다. RESEND_API_KEY 발급 직후(도메인 인증 전)에는 Resend가 제공하는 기본 발신
// 주소 `onboarding@resend.dev`로도 바로 보낼 수 있습니다 — 본인 도메인을 인증하면
// DIGEST_EMAIL_FROM을 그 도메인 주소로 바꾸면 됩니다.

export interface RedditDigestItem {
  subreddit: string;
  title: string;
  url: string;
  score: number;
  relevanceReason: string;
  draftReply: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDigestHtml(items: RedditDigestItem[]): string {
  const sections = items
    .map(
      (item) => `
        <div style="margin-bottom:24px;padding:16px;border:1px solid #e5e1ea;border-radius:8px;">
          <p style="margin:0 0 4px;font-size:12px;color:#857c93;">r/${escapeHtml(item.subreddit)} · 점수 ${item.score}/10</p>
          <p style="margin:0 0 8px;font-size:16px;font-weight:700;">
            <a href="${escapeHtml(item.url)}" style="color:#1c1922;">${escapeHtml(item.title)}</a>
          </p>
          <p style="margin:0 0 12px;font-size:13px;color:#5b5566;">${escapeHtml(item.relevanceReason)}</p>
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#857c93;">답글 초안</p>
          <p style="margin:0;font-size:14px;white-space:pre-wrap;background:#f7f5f9;padding:12px;border-radius:6px;">${escapeHtml(item.draftReply)}</p>
        </div>`
    )
    .join('');

  return `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
    <h1 style="font-size:20px;">오늘의 Reddit 다이제스트 (${items.length}건)</h1>
    <p style="font-size:13px;color:#857c93;">답글은 초안일 뿐입니다 — 실제 게시 여부와 내용은 직접 확인 후 판단하세요.</p>
    ${sections}
  </div>`;
}

export async function sendRedditDigestEmail({
  apiKey,
  to,
  from,
  items,
}: {
  apiKey: string;
  to: string;
  from: string;
  items: RedditDigestItem[];
}): Promise<void> {
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: `Reddit 다이제스트 — 오늘 ${items.length}건`,
    html: buildDigestHtml(items),
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}

// 💡 [신규] 결제 웹훅(app/api/webhooks/polar)이 2xx가 아닌 응답을 낼 때 보내는 즉시 알림.
// 실제 돈이 오간 요청이 실패했는데 아무도 모르는 상황을 막는 게 목적입니다 — 결제는
// 사용자가 "돈은 나갔는데 Pro가 안 켜졌다"고 문의하기 전까지 조용히 깨져 있을 수 있고,
// Polar 대시보드의 배달 로그는 누가 열어보기 전까지 아무 신호도 주지 않습니다.
//
// 새 서비스를 붙이지 않고 이미 매일 돌고 있는 Resend 경로(sendRedditDigestEmail과 같은
// RESEND_API_KEY/DIGEST_EMAIL_FROM)를 그대로 재사용합니다. 수신 주소도 새 환경변수를
// 만들지 않고 DIGEST_EMAIL_TO를 그대로 씁니다 — 결제 알림만 따로 받고 싶어지면 그때
// 별도 변수를 추가하면 됩니다.
export async function sendPaymentWebhookAlertEmail({
  apiKey,
  to,
  from,
  status,
  body,
}: {
  apiKey: string;
  to: string;
  from: string;
  status: number;
  body: string;
}): Promise<void> {
  // 응답 본문이 길거나 통째로 HTML일 수 있어 잘라서 넣습니다(메일이 비대해지는 것 방지).
  const excerpt = body.length > 2000 ? `${body.slice(0, 2000)}\n… (이하 생략)` : body || '(응답 본문 없음)';
  const html = `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
    <h1 style="font-size:20px;color:#b4232c;">Polar 결제 웹훅 실패 (HTTP ${status})</h1>
    <p style="font-size:14px;color:#5b5566;line-height:1.6;">
      <code>/api/webhooks/polar</code>가 2xx가 아닌 응답을 반환했습니다.
      결제가 발생했는데 <code>profiles.is_pro</code>가 켜지지 않았을 수 있습니다.
    </p>
    <p style="font-size:13px;color:#5b5566;line-height:1.6;">
      확인 순서: ① Polar 대시보드 → Webhooks → Deliveries에서 해당 이벤트 확인
      ② 그 계정의 <code>profiles</code> 행과 <code>is_pro</code> 상태를 DB에서 직접 확인
      ③ 원인을 고친 뒤 Polar에서 <strong>Redeliver</strong>
    </p>
    <p style="margin:16px 0 4px;font-size:12px;font-weight:700;color:#857c93;">응답 본문</p>
    <pre style="font-size:12px;white-space:pre-wrap;word-break:break-all;background:#f7f5f9;padding:12px;border-radius:6px;">${escapeHtml(excerpt)}</pre>
    <p style="font-size:12px;color:#857c93;">발생 시각(UTC): ${new Date().toISOString()}</p>
  </div>`;

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: `[Carrotly] 결제 웹훅 실패 — HTTP ${status}`,
    html,
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}

// 💡 [신규] 내부 토큰 상한(lib/token-safety.ts)에 걸렸을 때 운영자에게 보내는 알림.
// 사용자에게는 "이번 달 사용량을 다 쓰셨어요"만 나가고 아무 숫자도 보이지 않으므로,
// 실제로 무슨 일이 있었는지는 이 메일과 서버 로그로만 알 수 있습니다.
//
// 위 두 함수와 같은 Resend 경로·같은 수신 주소(DIGEST_EMAIL_TO)를 재사용합니다.
// 환경변수가 없으면 예외를 던지지 않고 조용히 건너뜁니다 — 알림은 부가 기능이라
// 미설정 때문에 상한 적용 자체가 흔들리면 안 됩니다(호출부도 실패를 삼킵니다).
export async function sendTokenLimitAlertEmail({
  scope,
  userId,
  total,
  limit,
  periodStart,
}: {
  scope: 'user' | 'free_tier';
  userId: string | null;
  total: number;
  limit: number;
  periodStart: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_EMAIL_TO;
  const from = process.env.DIGEST_EMAIL_FROM || 'onboarding@resend.dev';
  if (!apiKey || !to) {
    console.warn('[email] RESEND_API_KEY 또는 DIGEST_EMAIL_TO 미설정 — 토큰 상한 알림을 건너뜁니다.');
    return;
  }

  const isFreeTier = scope === 'free_tier';
  const title = isFreeTier ? '무료 사용자 전체 토큰 킬스위치 발동' : '사용자 개인 월 토큰 상한 도달';
  const detail = isFreeTier
    ? `무료 등급 전체의 이번 달 토큰 합계가 설정된 킬스위치 임계값을 넘었습니다.
       지금부터 무료 사용자의 AI 요청이 막힙니다(Pro 계정은 계속 동작).`
    : `한 사용자의 이번 달 토큰 합계가 개인 상한을 넘었습니다.
       이 계정의 AI 요청만 막히고 다른 사용자에게는 영향이 없습니다.`;

  const html = `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
    <h1 style="font-size:20px;color:#b4232c;">${escapeHtml(title)}</h1>
    <p style="font-size:14px;color:#5b5566;line-height:1.6;">${escapeHtml(detail)}</p>
    <table style="font-size:13px;color:#5b5566;border-collapse:collapse;margin-top:12px;">
      <tr><td style="padding:4px 12px 4px 0;font-weight:700;">대상</td><td>${isFreeTier ? '무료 등급 전체' : `user ${escapeHtml(userId || '(알 수 없음)')}`}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:700;">해당 월</td><td>${escapeHtml(periodStart)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:700;">사용량</td><td>${total.toLocaleString()} 토큰</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:700;">상한</td><td>${limit.toLocaleString()} 토큰</td></tr>
    </table>
    <p style="font-size:13px;color:#5b5566;line-height:1.6;margin-top:16px;">
      확인 순서: ① /admin/ai-usage에서 이번 달 사용량 추이 확인
      ② 정상 사용인지 남용인지 판단 ${isFreeTier
        ? '③ 계속 열어두려면 FREE_TIER_MONTHLY_TOKEN_LIMIT을 올리거나 비우세요'
        : '③ 정상 사용이라면 lib/token-safety.ts의 USER_MONTHLY_TOKEN_LIMIT을 조정하세요'}
    </p>
    <p style="font-size:12px;color:#857c93;">
      이 알림은 해당 월에 대상별로 한 번만 발송됩니다(token_limit_alerts).
      발생 시각(UTC): ${new Date().toISOString()}
    </p>
  </div>`;

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: `[Carrotly] ${title}`,
    html,
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}
