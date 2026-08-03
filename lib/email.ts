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
