-- 💡 [수정] redeem_society_code_atomic()이 profiles를 0행 갱신하고도 'ok'를 반환하던 문제를
-- 막습니다.
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────
-- 이 함수의 마지막 단계는 `update public.profiles set is_pro = true ... where id = p_user_id`
-- 입니다. 그런데 UPDATE가 아무 행에도 매칭되지 않는 것은 Postgres에서 에러가 아닙니다 —
-- 조용히 0행을 갱신하고 성공합니다. 그래서 해당 사용자의 profiles 행이 없으면:
--   1) society_code_redemptions에는 사용 이력이 남고(코드 정원 한 자리 소모),
--   2) 함수는 'ok'를 반환하고,
--   3) lib/society-codes.ts는 성공으로 처리해 사용자에게 성공 화면을 보여주는데,
--   4) 정작 Pro는 부여되지 않은 상태가 됩니다.
-- 20260816_create_profile_on_signup_trigger.sql의 가입 트리거가 "모든 사용자에게 profiles
-- 행이 있다"는 전제를 보장하지만, 트리거가 어떤 이유로든 실패한 계정이 하나라도 생기면
-- 같은 증상이 재발하므로 함수 자체에서 직접 확인합니다.
--
-- ── 왜 return이 아니라 raise exception인가 ───────────────────────────
-- 이 시점에는 society_code_redemptions INSERT가 이미 실행된 뒤입니다. 상태 문자열만
-- return하면 그 INSERT는 커밋되어, Pro도 못 받은 사용자가 코드 정원 한 자리를 영구히
-- 소모합니다. raise exception은 함수를 호출한 트랜잭션 전체를 롤백시키므로 그 INSERT까지
-- 함께 되돌아갑니다 — 사용자는 실패 안내를 보고, 문제를 고친 뒤 같은 코드를 다시 쓸 수
-- 있습니다. lib/society-codes.ts는 이미 rpcError를 'server_error'로 처리하고 있어(이 파일의
-- 호출부는 그대로 두면 됩니다) 사용자에게는 성공 화면이 절대 나오지 않습니다.
--
-- 아래 두 곳에서 확인합니다:
--   (a) 잠금용 SELECT 직후 — 아직 아무것도 INSERT하지 않은 시점이라 여기서 걸리는 게
--       가장 깔끔합니다(정상적인 "없음" 감지 경로).
--   (b) UPDATE 직후 row_count — (a)를 통과했는데도 0행이면 함수의 가정이 깨진 것이므로
--       마지막 안전망으로 남겨둡니다.
--
-- 함수의 나머지 로직(코드 조회·FOR UPDATE 잠금·정원 계산·반환값)은 20260814
-- 마이그레이션과 완전히 동일합니다 — 이 마이그레이션은 profiles 갱신 방어만 추가합니다.
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
  v_profile_exists boolean;
  v_updated_count integer;
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

  -- (a) 이 사용자의 profiles 행 자체가 없는 경우. 위 SELECT는 행이 없어도 에러가 아니라
  -- v_is_pro에 NULL을 남기고 지나가므로, FOUND로 명시적으로 확인해야 합니다.
  v_profile_exists := found;
  if not v_profile_exists then
    raise exception 'profiles row not found for user % (society code redemption aborted)', p_user_id
      using errcode = 'no_data_found';
  end if;

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

  -- (b) 마지막 안전망 — 여기서 0행이면 위 INSERT까지 함께 롤백됩니다.
  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'society code redemption updated 0 profiles rows for user %', p_user_id
      using errcode = 'no_data_found';
  end if;

  return 'ok';
end;
$$;

revoke all on function public.redeem_society_code_atomic(uuid, text) from public;
grant execute on function public.redeem_society_code_atomic(uuid, text) to service_role;

-- ── 적용 후 검증 ─────────────────────────────────────────────────────
-- 1) profiles 행이 없는 uuid로 호출하면 예외가 나야 합니다(성공 문자열이 아니라):
--    select public.redeem_society_code_atomic('00000000-0000-0000-0000-000000000000', '<코드>');
--    -- ERROR: profiles row not found for user ...
-- 2) 그리고 그 코드의 사용 이력이 남지 않았는지(롤백 확인):
--    select count(*) from public.society_code_redemptions r
--    join public.society_codes c on c.id = r.code_id
--    where c.code = '<코드>';
