-- 💡 [수정] 20260812_create_society_codes.sql의 redeemSocietyCode()(lib/society-codes.ts)는
-- "정원 확인(count) → insert" 사이에 이론적 경쟁 상태가 있다고 그 파일 주석에서 스스로
-- 명시하고 있었습니다 — 두 사용자가 마지막 한 자리를 동시에 확인하면 둘 다 통과할 수
-- 있습니다. 이 마이그레이션은 그 주석이 제안한 대로 Postgres 함수(SELECT ... FOR UPDATE)로
-- 옮겨 원자적으로 만듭니다. society_codes 행에 FOR UPDATE 잠금을 걸면 같은 코드에 대한
-- 동시 요청이 전부 이 함수 안에서 직렬화되므로(두 번째 요청은 첫 번째 트랜잭션이 커밋할
-- 때까지 잠금 대기), 정원 계산이 항상 최신 상태를 봅니다 — anonymous_trial_usage에서 실제로
-- 겪었던 것과 같은 종류의 TOCTOU 버그를 여기서는 사전에 막습니다.
--
-- profiles 행도 함께 잠급니다 — 같은 사용자가 서로 다른 코드를 동시에 제출하는 경우까지
-- 직렬화하기 위함입니다(순서만 정해질 뿐 데이터 정합성 자체는 society_codes 잠금만으로도
-- 이미 보장되지만, "이미 Pro인지" 판정이 항상 최신 상태를 보게 하려면 이쪽도 잠그는 게
-- 안전합니다).
--
-- 이 함수는 authenticated/anon에게는 EXECUTE를 주지 않고 service_role에게만 부여합니다 —
-- lib/society-codes.ts의 redeemSocietyCode()가 이미 getSupabaseAdmin()(서비스 롤)으로만
-- 이 기능 전체를 처리하는 기존 구조를 그대로 따릅니다. p_user_id를 파라미터로 받지만,
-- 이 함수를 호출할 수 있는 유일한 주체가 서버의 서비스 롤 클라이언트뿐이라(클라이언트가
-- 직접 호출할 수 없음) 다른 사람 계정을 대상으로 조작될 위험이 없습니다.
create or replace function public.redeem_society_code_atomic(p_user_id uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code_row public.society_codes%rowtype;
  v_is_pro boolean;
  v_used_count integer;
begin
  select * into v_code_row
  from public.society_codes
  where code = p_code
  for update;

  if v_code_row.id is null then
    return 'invalid_code';
  end if;

  if v_code_row.revoked_at is not null then
    return 'revoked';
  end if;

  if v_code_row.expires_at <= now() then
    return 'expired';
  end if;

  select is_pro into v_is_pro
  from public.profiles
  where id = p_user_id
  for update;

  if v_is_pro then
    return 'already_pro';
  end if;

  if exists (
    select 1 from public.society_code_redemptions
    where code_id = v_code_row.id and user_id = p_user_id
  ) then
    return 'already_redeemed';
  end if;

  -- society_codes에는 카운터 컬럼이 없어(20260812 마이그레이션 스키마 그대로 유지) 매번
  -- 실측 카운트합니다 — 위 FOR UPDATE로 이미 이 코드에 대한 동시 접근이 직렬화된 뒤라
  -- 이 카운트는 항상 최신값입니다.
  select count(*) into v_used_count
  from public.society_code_redemptions
  where code_id = v_code_row.id;

  if v_used_count >= v_code_row.max_uses then
    return 'full';
  end if;

  insert into public.society_code_redemptions (code_id, user_id)
  values (v_code_row.id, p_user_id);

  update public.profiles
  set is_pro = true, pro_source = 'code', pro_expires_at = v_code_row.expires_at
  where id = p_user_id;

  return 'ok';
end;
$$;

revoke all on function public.redeem_society_code_atomic(uuid, text) from public;
grant execute on function public.redeem_society_code_atomic(uuid, text) to service_role;

-- 💡 [신규/보안 수정] 기존 "사용자는 자신의 프로필만 수정" UPDATE 정책(RLS)은 행 단위
-- 필터만 걸 뿐 컬럼을 제한하지 않습니다 — 즉 로그인한 사용자가 자기 브라우저에서
-- supabase.from('profiles').update({is_pro: true})를 직접 호출하면 결제도 코드도 없이
-- 스스로 Pro가 될 수 있는 구멍이 이미 있었습니다(소사이어티 코드 기능을 만들며 발견,
-- 이 기능과 무관하게 이전부터 있던 문제). Postgres 컬럼 단위 GRANT/REVOKE로 막습니다 —
-- is_pro/pro_source/pro_expires_at은 authenticated 롤의 UPDATE 권한에서 제외하고, 그 외
-- 컬럼(username 등)은 기존처럼 그대로 수정 가능합니다. 이 세 컬럼을 실제로 바꾸는 코드는
-- 전부 이 권한 밖에서 동작합니다: app/api/webhooks/polar(서비스 롤), 위
-- redeem_society_code_atomic()(SECURITY DEFINER, 함수 소유자 권한으로 실행 — 어차피
-- service_role 전용이라 이 REVOKE와 무관하게 항상 통과), app/api/cron/cleanup-logs(서비스 롤).
revoke update (is_pro, pro_source, pro_expires_at) on public.profiles from authenticated;
