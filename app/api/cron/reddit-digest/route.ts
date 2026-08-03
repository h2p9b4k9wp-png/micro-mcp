import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';
import { getRedditAccessToken, fetchNewPosts } from '@/lib/reddit-client';
import { scoreRedditPost, draftReplyForRedditPost } from '@/lib/reddit-scoring';
import { sendRedditDigestEmail, type RedditDigestItem } from '@/lib/email';

// 💡 [신규] 지정한 서브레딧의 새 글을 매일 훑어서(vercel.json의 cron 설정) 시험 준비·
// 기출문제·강의자료 정리에 대한 실제 어려움을 호소하는 글을 LLM으로 채점하고, 7점 이상인
// 글만 답글 초안과 함께 이메일로 보냅니다.
//
// 이 시스템은 절대 자동으로 게시하지 않습니다 — 이 파일과 lib/reddit-client.ts 전체에
// Reddit 댓글/게시글 작성 API 호출이 단 한 줄도 없습니다(읽기 전용 client_credentials
// grant만 사용). 찾고, 채점하고, 초안을 쓰고, 이메일로 보내는 것까지가 이 시스템의 전부이고,
// 실제 Reddit에 무언가를 올리는 건 이메일을 받은 사람이 직접 판단해서 합니다.
//
// CRON_SECRET 인증 패턴은 app/api/cron/cleanup-logs/route.ts와 동일합니다(timingSafeEqual
// 비교 — 그 라우트의 주석에 이유가 자세히 적혀 있습니다).
const SUBREDDITS = ['GetStudying', 'college', 'UniUK', 'AskAcademia', 'StudyTips', 'GradSchool'];
const SCORE_THRESHOLD = 7;

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[reddit-digest] CRON_SECRET이 설정되지 않았습니다.');
    return NextResponse.json({ error: '서버 설정이 올바르지 않습니다.' }, { status: 500 });
  }
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !timingSafeEqualStrings(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const redditClientId = process.env.REDDIT_CLIENT_ID;
  const redditClientSecret = process.env.REDDIT_CLIENT_SECRET;
  const redditUserAgent = process.env.REDDIT_USER_AGENT;
  const resendApiKey = process.env.RESEND_API_KEY;
  const digestEmailTo = process.env.DIGEST_EMAIL_TO;
  const digestEmailFrom = process.env.DIGEST_EMAIL_FROM;

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !openaiApiKey ||
    !redditClientId ||
    !redditClientSecret ||
    !redditUserAgent ||
    !resendApiKey ||
    !digestEmailTo ||
    !digestEmailFrom
  ) {
    console.error('[reddit-digest] 필수 환경변수가 설정되지 않았습니다.');
    return NextResponse.json({ error: '서버 설정이 올바르지 않습니다.' }, { status: 500 });
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { accessToken } = await getRedditAccessToken(redditClientId, redditClientSecret, redditUserAgent);

    const digestItems: RedditDigestItem[] = [];
    let scannedCount = 0;

    for (const subreddit of SUBREDDITS) {
      const posts = await fetchNewPosts(subreddit, accessToken, redditUserAgent);
      scannedCount += posts.length;
      if (posts.length === 0) continue;

      // 이미 처리한 글은 다시 채점하지 않습니다.
      const { data: seenRows } = await supabaseAdmin
        .from('reddit_seen_posts')
        .select('reddit_post_id')
        .in('reddit_post_id', posts.map((p) => p.id));
      const seenIds = new Set((seenRows ?? []).map((r) => r.reddit_post_id));
      const unseenPosts = posts.filter((p) => !seenIds.has(p.id));

      for (const post of unseenPosts) {
        try {
          const { score } = await scoreRedditPost({
            apiKey: openaiApiKey,
            title: post.title,
            body: post.selftext,
          });

          // 7점 이상인 글에만 2차 호출(답글 초안 생성)을 해서 비용을 아낍니다.
          if (score >= SCORE_THRESHOLD) {
            const { relevanceReason, draftReply } = await draftReplyForRedditPost({
              apiKey: openaiApiKey,
              title: post.title,
              body: post.selftext,
            });
            digestItems.push({
              subreddit,
              title: post.title,
              url: `https://www.reddit.com${post.permalink}`,
              score,
              relevanceReason,
              draftReply,
            });
          }

          // 점수와 무관하게 처리한 글로 기록해 다음 실행에서 재처리하지 않습니다.
          await supabaseAdmin.from('reddit_seen_posts').insert({
            reddit_post_id: post.id,
            subreddit,
            score,
          });
        } catch (err) {
          console.error(`[reddit-digest] 게시글 ${post.id} 처리 실패:`, err);
        }
      }
    }

    if (digestItems.length > 0) {
      await sendRedditDigestEmail({
        apiKey: resendApiKey,
        to: digestEmailTo,
        from: digestEmailFrom,
        items: digestItems,
      });
    }

    console.log(`[reddit-digest] ${scannedCount}건 스캔, ${digestItems.length}건 다이제스트 발송`);
    return NextResponse.json({ ok: true, scanned: scannedCount, sent: digestItems.length });
  } catch (error) {
    console.error('[reddit-digest] 처리 중 오류 발생:', error);
    return NextResponse.json({ error: '처리에 실패했어요.' }, { status: 500 });
  }
}
