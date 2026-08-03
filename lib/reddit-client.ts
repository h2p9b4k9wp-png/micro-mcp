// 💡 [신규] Reddit 공개 API 읽기 전용 클라이언트입니다. 이 파일에는 댓글/게시글 작성,
// 투표, 메시지 전송 등 어떤 쓰기성 API 호출도 없습니다 — app/api/cron/reddit-digest는
// 게시글을 찾아 채점하고 이메일로 초안을 보내는 것까지만 하고, 실제 Reddit에 무언가를
// 게시하는 건 사람이 직접 합니다. 이 클라이언트가 발급받는 자격증명(REDDIT_CLIENT_ID/
// REDDIT_CLIENT_SECRET)도 "script" 타입 앱의 client_credentials grant(읽기 전용, 특정
// 사용자 계정으로 로그인하지 않음)면 충분합니다.
//
// app/api/chat/route.ts의 Tavily fetch 호출과 같은 패턴 — 별도 SDK/재시도 라이브러리 없이
// 순수 fetch, 응답이 !res.ok면 명시적으로 에러 처리, 에러 바디는 일부만 로그.

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  permalink: string;
  subreddit: string;
  createdUtc: number;
}

interface RedditAccessToken {
  accessToken: string;
}

// Reddit이 User-Agent 헤더가 부실하면(브라우저 기본값, 빈 값 등) 매우 공격적으로
// rate-limit합니다 — REDDIT_USER_AGENT는 반드시 "앱이름/버전 (by /u/아이디)" 형식의
// 값이어야 합니다.
export async function getRedditAccessToken(
  clientId: string,
  clientSecret: string,
  userAgent: string
): Promise<RedditAccessToken> {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[reddit-client] 토큰 발급 실패 (status ${res.status}):`, errBody.slice(0, 500));
    throw new Error(`Reddit access token request failed: ${res.status}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Reddit access token response missing access_token');
  }
  return { accessToken: data.access_token };
}

// 서브레딧의 최신 글을 가져옵니다(읽기 전용, GET /r/{subreddit}/new).
export async function fetchNewPosts(
  subreddit: string,
  accessToken: string,
  userAgent: string,
  limit = 100
): Promise<RedditPost[]> {
  const res = await fetch(
    `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new?limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': userAgent,
      },
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[reddit-client] r/${subreddit} 조회 실패 (status ${res.status}):`, errBody.slice(0, 500));
    return [];
  }

  const data = await res.json();
  const children = data?.data?.children ?? [];
  return children.map((child: { data: Record<string, unknown> }) => ({
    id: String(child.data.id),
    title: String(child.data.title ?? ''),
    selftext: String(child.data.selftext ?? ''),
    permalink: String(child.data.permalink ?? ''),
    subreddit,
    createdUtc: Number(child.data.created_utc ?? 0),
  }));
}
