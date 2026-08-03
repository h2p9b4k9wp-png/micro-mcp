-- Reddit 모니터링 cron(app/api/cron/reddit-digest)이 이미 채점·처리한 게시글을 다음
-- 실행에서 다시 채점하지 않도록 기록하는 테이블입니다. reddit_post_id에 unique 제약을
-- 걸어, 같은 글이 여러 서브레딧 크롤에 걸쳐 두 번 기록되는 것도 DB 레벨에서 막습니다.
--
-- anonymous_trial_usage(supabase/migrations/20260802_create_anonymous_trial_usage.sql)와
-- 같은 이유로 RLS는 켜두되 정책을 하나도 만들지 않습니다 — 이 테이블은 특정 로그인
-- 사용자 소유가 아닌 내부 운영용 로그라 auth.uid() 기반 정책을 적용할 대상이 없고,
-- app/api/cron/reddit-digest가 SUPABASE_SERVICE_ROLE_KEY로만 읽고 씁니다.
create table if not exists public.reddit_seen_posts (
  id uuid primary key default gen_random_uuid(),
  reddit_post_id text not null unique,
  subreddit text not null,
  score integer,
  created_at timestamptz not null default now()
);

alter table public.reddit_seen_posts enable row level security;

create index if not exists reddit_seen_posts_created_idx
  on public.reddit_seen_posts (created_at desc);
