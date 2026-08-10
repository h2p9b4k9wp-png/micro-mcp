-- 💡 [신규] 소사이어티 코드 Pro가 끝나기 전에 이메일로 미리 알려주기 위한 두 가지.
--
-- (1) profiles.locale — 어떤 언어로 메일을 보낼지 알아내기 위한 값
-- (2) pro_expiry_notifications — 같은 사람에게 매일 같은 메일이 가지 않게 하는 발송 이력

-- ── (1) 사용자의 화면 언어 ───────────────────────────────────────────
-- 지금 화면 언어는 브라우저 쿠키(locale)에만 있습니다. 그건 요청을 보낸 브라우저에서만
-- 읽을 수 있어서, 사용자가 접속하지 않은 상태에서 도는 cron은 이 사람이 한국어를 쓰는지
-- 스페인어를 쓰는지 알 방법이 없습니다. 그래서 로그인한 클라이언트가 자기 화면 언어를
-- 이 컬럼에 한 번 적어두고(app/page.tsx), cron은 그걸 읽어 메일 언어를 정합니다.
--
-- 값이 비어 있으면(아직 한 번도 접속 안 함 등) 앱 기본값인 'ko'로 보냅니다.
-- 체크 제약을 걸지 않은 이유: i18n/locales.ts의 SUPPORTED_LOCALES가 늘어날 때마다 DB
-- 제약까지 함께 고쳐야 하는 부담이 생기고, 모르는 값이 들어와도 코드 쪽에서 기본 언어로
-- 떨어뜨리면 그만이라 DB가 막아설 실익이 없습니다.
alter table public.profiles add column if not exists locale text;

-- 💡 20260818_fix_profiles_column_update_lockdown.sql이 authenticated의 UPDATE 권한을
-- (username, updated_at)으로 좁혀놨기 때문에, 그대로 두면 클라이언트가 locale을 적을 수
-- 없습니다. locale은 is_pro처럼 등급을 좌우하는 값이 아니라 본인 표시 설정이므로 본인이
-- 쓸 수 있어야 맞습니다(행 제한은 기존 RLS 정책이 계속 담당).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant update (locale) on public.profiles to authenticated';
  end if;
end $$;

-- ── (2) 발송 이력 ────────────────────────────────────────────────────
-- cron은 매일 돌기 때문에, 만료 3일 전부터는 같은 사람이 매일 조회에 걸립니다. 이력을
-- 남겨두지 않으면 3일 내내 같은 메일이 갑니다.
--
-- unique 키를 (user_id, expires_at)으로 잡은 게 핵심입니다. user_id만으로 잡으면 나중에
-- 새 코드를 등록해 기간이 연장돼도 "이미 보냈다"고 판단해 다시는 알리지 않게 됩니다.
-- 만료 시각까지 키에 넣으면 기간이 바뀔 때마다 새로 한 번씩 알립니다.
--
-- anonymous_trial_usage·society_codes·token_limit_alerts와 같은 패턴으로 RLS는 켜되 정책은
-- 만들지 않습니다 — 클라이언트가 읽거나 쓸 이유가 없고, 정책이 없으면 서비스 롤 외에는
-- 누구도 접근할 수 없습니다.
create table if not exists public.pro_expiry_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 알림을 보낸 시점에 이 사용자의 profiles.pro_expires_at 값
  expires_at timestamptz not null,
  sent_at timestamptz not null default now()
);

alter table public.pro_expiry_notifications enable row level security;

create unique index if not exists pro_expiry_notifications_user_expiry_uniq
  on public.pro_expiry_notifications (user_id, expires_at);

-- ── 적용 후 확인 ─────────────────────────────────────────────────────
--   select column_name from information_schema.columns
--   where table_schema='public' and table_name='profiles' and column_name='locale';
--   -- 1행 나와야 정상
--
--   select has_column_privilege('authenticated','public.profiles','locale','UPDATE');   -- true
--   select has_column_privilege('authenticated','public.profiles','is_pro','UPDATE');   -- false (그대로)
