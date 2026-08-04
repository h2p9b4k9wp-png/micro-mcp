-- 💡 [신규] "소사이어티 코드" — 관리자가 발급한 코드를 입력한 학생에게 결제 없이 일정 기간
-- Pro를 부여하는 기능(예: 학교 동아리·커뮤니티 프로모션). 결제 기반 Pro(profiles.is_pro,
-- Polar 웹훅)와 완전히 같은 profiles.is_pro 플래그를 재사용하되, 그 Pro가 결제로 얻은
-- 것인지 코드로 얻은 것인지를 profiles.pro_source로 구분합니다 — 코드로 얻은 Pro만 별도의
-- 남용 방지 장치(월 분석 횟수 상한, 만료 시 자동 강등)가 적용되기 때문입니다.
--
-- society_codes/society_code_redemptions 둘 다 RLS는 켜두되 정책은 하나도 만들지 않습니다
-- — anonymous_trial_usage·funnel_events·ai_usage_logs(읽기 쪽)와 같은 패턴으로, 클라이언트가
-- 이 테이블을 직접 읽거나 쓸 이유가 없고(코드 발급은 /admin, 코드 사용은 /api/society-code/redeem
-- 라우트가 각각 서비스 롤 키로만 처리) 아무 정책이 없으면 서비스 롤 키 없이는 누구도(anon도
-- authenticated도) 접근할 수 없습니다.
create table if not exists public.society_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text,
  max_uses integer not null check (max_uses > 0),
  expires_at timestamptz not null,
  -- 관리자가 남용 정황을 발견했을 때 코드 하나만 즉시 무력화할 수 있는 수동 안전장치.
  -- expires_at과 별개로, revoked_at이 채워지면 만료 전이어도 신규 사용이 즉시 막힙니다.
  revoked_at timestamptz,
  -- 별도 관리자 계정 테이블이 없고(ADMIN_EMAIL 환경변수 하나로 관리자를 식별) 발급자를
  -- 추적할 다른 방법이 없어 이메일 문자열을 그대로 기록해둡니다.
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.society_codes enable row level security;

-- society_code_redemptions: 코드 하나당 학생 한 명의 사용 이력. 같은 사용자가 같은 코드를
-- 두 번 사용하는 걸 DB 레벨에서도 막기 위해 unique(code_id, user_id)를 둡니다 — 애플리케이션
-- 로직(app/api/society-code/redeem)도 이미 이 사용자가 Pro가 아닌지, 코드 정원이 남았는지
-- 확인하지만, 동시 요청 경쟁 상태에 대한 마지막 방어선입니다.
create table if not exists public.society_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.society_codes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (code_id, user_id)
);

alter table public.society_code_redemptions enable row level security;

create index if not exists society_code_redemptions_code_idx on public.society_code_redemptions (code_id);
create index if not exists society_code_redemptions_user_idx on public.society_code_redemptions (user_id);

-- profiles.pro_source: is_pro가 true인 이유를 구분합니다. 'payment'는 app/api/webhooks/polar가
-- 붙이고, 'code'는 app/api/society-code/redeem이 붙입니다. is_pro가 false면 이 값도 반드시
-- null이어야 합니다(둘 다 무료 등급으로 되돌아갈 때 함께 지웁니다) — 이 불변식은 코드에서
-- 지키고 DB 제약으로 강제하지는 않습니다(체크 제약으로 하면 두 컬럼을 함께 갱신하는
-- 순서 문제만 늘어나고, 이 프로젝트의 다른 상태 불변식들도 대부분 애플리케이션 레벨에서
-- 지켜지고 있어 일관성을 맞췄습니다).
alter table public.profiles add column if not exists pro_source text check (pro_source in ('payment', 'code'));

-- profiles.pro_expires_at: 코드로 얻은 Pro가 코드의 expires_at 시점에 자동으로 끝나도록,
-- app/api/cron/cleanup-logs(매일 도는 기존 cron)가 이 값을 보고 만료된 코드 기반 Pro를
-- 강등시킵니다. 결제 기반 Pro는 Polar 구독 상태가 곧 만료 시점이라 이 컬럼을 쓰지 않고
-- 항상 null로 둡니다 — Polar 웹훅(subscription.revoked)이 즉시 is_pro=false로 반영하므로
-- 별도의 만료 시각을 우리 쪽에서 들고 있을 필요가 없습니다.
alter table public.profiles add column if not exists pro_expires_at timestamptz;
