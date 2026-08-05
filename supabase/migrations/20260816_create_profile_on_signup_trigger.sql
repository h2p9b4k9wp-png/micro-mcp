-- 💡 [신규] auth.users에 사용자가 생기면 public.profiles에 대응 행을 자동으로 만드는 트리거,
-- 그리고 지금까지 행이 없는 기존 사용자 백필.
--
-- ── 왜 필요한가 ──────────────────────────────────────────────────────
-- 20260701_create_logs_profiles_prompts_and_rls.sql은 profiles를 문서화하면서 "id는
-- auth.users.id를 그대로 사용합니다(가입 시 채워짐, 트리거 등 이 테이블을 실제로 채우는
-- 로직은 이 저장소 밖에 있어 여기서는 스키마만 기록)"라고 적어뒀습니다. 그런데 실제로는
-- 그 "저장소 밖 로직"이 존재하지 않았습니다 — 이 저장소의 앱 코드 어디에도 profiles에
-- INSERT하는 곳이 없고(전부 select/update뿐), DB에도 트리거가 없어서 가입한 사용자에게
-- profiles 행이 아예 생기지 않았습니다.
--
-- profiles 행이 없어도 조회 경로는 대부분 무료 등급 기본값으로 조용히 넘어가지만(아래
-- "행이 없을 때의 앱 동작" 참고), 쓰기 경로 두 곳은 조용히 실패합니다 — UPDATE ... WHERE
-- id = <user>가 0행을 갱신하고도 에러를 내지 않기 때문입니다:
--   1) app/api/webhooks/polar — 결제해도 is_pro가 켜지지 않습니다(실제 돈이 걸린 경로).
--   2) redeem_society_code_atomic() — 코드 사용 이력만 쌓이고 Pro는 부여되지 않습니다.
-- 이 마이그레이션은 그 전제(모든 사용자에게 profiles 행이 있다)를 실제로 보장합니다.
--
-- ── 실행 순서 ────────────────────────────────────────────────────────
-- (1) profiles.id ↔ auth.users.id 참조 구조 확인/보정 → (2) username 생성 함수 →
-- (3) 트리거 → (4) 기존 사용자 백필. 전부 여러 번 실행해도 안전합니다(멱등).
-- 다른 마이그레이션과 마찬가지로 자동 적용되지 않으므로 Supabase SQL Editor에서
-- 직접 실행해야 합니다.

-- ── (1) profiles.id가 auth.users.id를 참조하는 구조인지 확인 ──────────
-- 20260701 마이그레이션의 CREATE TABLE에는 `id uuid primary key references auth.users(id)
-- on delete cascade`가 적혀 있지만, 그건 create table IF NOT EXISTS라 profiles가 이미
-- 있던 실제 운영 DB에서는 한 번도 적용된 적이 없습니다 — 즉 "문서상 그렇다"일 뿐 실제
-- 제약이 걸려 있다는 보장이 없습니다. 여기서 실제로 확인하고, 없으면 붙입니다.
--
-- FK가 없으면 (a) 사용자가 지워져도 profiles 행이 고아로 남고, (b) 존재하지 않는 uuid로
-- profiles 행을 만들 수 있게 됩니다. on delete cascade까지 함께 걸어야 계정 삭제
-- (app/api/account/delete)가 auth.users 행을 지울 때 profiles도 같이 정리됩니다.
do $$
declare
  v_id_attnum smallint;
  v_has_fk boolean;
begin
  select a.attnum into v_id_attnum
  from pg_attribute a
  where a.attrelid = 'public.profiles'::regclass and a.attname = 'id' and not a.attisdropped;

  if v_id_attnum is null then
    raise exception 'public.profiles에 id 컬럼이 없습니다 — 스키마를 먼저 확인하세요.';
  end if;

  select exists (
    select 1
    from pg_constraint c
    where c.contype = 'f'
      and c.conrelid = 'public.profiles'::regclass
      and c.confrelid = 'auth.users'::regclass
      and c.conkey = array[v_id_attnum]
  ) into v_has_fk;

  if v_has_fk then
    raise notice 'profiles.id → auth.users.id 외래키가 이미 있습니다.';
  else
    raise notice 'profiles.id → auth.users.id 외래키가 없어 새로 추가합니다.';
    -- 고아 행(대응하는 auth.users가 없는 profiles)이 남아 있으면 FK 추가 자체가 실패합니다.
    -- 그런 행은 로그인할 수 없는 유령 데이터이므로 먼저 정리합니다. (질문에서 언급된
    -- 'testuser' 행도 실제 계정과 무관하다면 여기서 함께 정리됩니다 — 실제 auth.users에
    -- 대응 행이 있다면 그대로 남습니다.)
    delete from public.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id);

    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- ── (2) username 생성 함수 ───────────────────────────────────────────
-- profiles.username은 `text not null unique`입니다(20260701 마이그레이션 기준 — 운영
-- DB의 실제 컬럼 구성을 조회해서 기록한 값). 즉 트리거가 값을 반드시 만들어내야 하고,
-- 그 값이 기존 행과 겹치면 INSERT가 실패합니다.
--
-- 이 앱의 코드는 username을 어디에서도 읽지 않습니다(app/·lib/·components/ 전체 검색
-- 결과 참조 0건) — 사람이 보는 이름이 아니라 그냥 채워져 있어야 하는 컬럼입니다. 그래서
-- "예쁜 이름"보다 "절대 실패하지 않는 값"을 우선합니다: 이메일 앞부분을 정리해서 쓰되,
-- 비어 있거나 이미 쓰이고 있으면 숫자 접미사를 붙이고, 그래도 안 되면 uuid 기반 이름으로
-- 떨어집니다(uuid는 그 자체로 유일하므로 이 마지막 단계는 반드시 성공합니다).
create or replace function public.generate_profile_username(p_email text, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_candidate text;
  v_suffix integer := 0;
begin
  v_base := lower(regexp_replace(split_part(coalesce(p_email, ''), '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
  if v_base is null or v_base = '' then
    return 'user_' || replace(p_user_id::text, '-', '');
  end if;
  v_base := left(v_base, 24);

  v_candidate := v_base;
  while exists (select 1 from public.profiles where username = v_candidate) loop
    v_suffix := v_suffix + 1;
    if v_suffix > 50 then
      -- 같은 이메일 앞부분이 50개 넘게 몰린 극단적인 경우 — uuid 기반으로 확정합니다.
      return 'user_' || replace(p_user_id::text, '-', '');
    end if;
    v_candidate := left(v_base, 20) || '_' || v_suffix::text;
  end loop;

  return v_candidate;
end;
$$;

-- 20260815_harden_rls_auto_enable_grants.sql과 같은 이유로 접근을 닫아둡니다: public 스키마의
-- 함수는 PostgREST가 자동으로 /rest/v1/rpc/... 로 노출하고, PostgreSQL은 함수 생성 시 EXECUTE를
-- PUBLIC에 자동 부여합니다. 이 함수는 SECURITY DEFINER라 더더욱 아무나 부를 수 있으면 안 됩니다
-- (본문이 하는 일은 이름 하나 만들어 돌려주는 게 전부지만, 노출 자체를 남겨둘 이유가 없습니다).
-- PUBLIC을 걷어내면 anon/authenticated도 상속 경로가 끊기지만, 과거에 직접 부여된 권한이 남아
-- 있을 가능성까지 감안해 두 롤도 명시적으로 REVOKE합니다(롤이 있는 환경에서만).
revoke all on function public.generate_profile_username(text, uuid) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.generate_profile_username(text, uuid) from %I', v_role);
    end if;
  end loop;
end $$;

-- ── (3) auth.users INSERT 트리거 ─────────────────────────────────────
-- SECURITY DEFINER인 이유: 이 트리거는 Supabase Auth가 사용자를 만드는 트랜잭션 안에서
-- 돌기 때문에 실행 롤이 앱의 authenticated 롤이 아닙니다. 함수 소유자(postgres) 권한으로
-- 실행해야 profiles의 RLS(본인 행만 INSERT 허용 — 이 시점엔 auth.uid()가 없습니다)에
-- 막히지 않습니다.
--
-- 예외를 전부 삼키는 이유: 이 트리거가 에러를 던지면 auth.users INSERT 트랜잭션 전체가
-- 롤백되어 "Database error saving new user"로 가입 자체가 실패합니다. 프로필 행은
-- 없어도 앱이 무료 등급으로 동작하지만(아래 참고), 가입이 막히는 건 훨씬 큰 장애입니다 —
-- 그래서 실패하더라도 warning만 남기고 가입은 통과시킵니다. 남은 행은 아래 (4)의 백필
-- 블록을 다시 돌려 언제든 메울 수 있습니다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.profiles (id, username)
    values (new.id, public.generate_profile_username(new.email, new.id))
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- username이 동시 가입 등으로 겹친 경우 — uuid 기반 이름으로 한 번 더 시도합니다.
      begin
        insert into public.profiles (id, username)
        values (new.id, 'user_' || replace(new.id::text, '-', ''))
        on conflict (id) do nothing;
      exception when others then
        raise warning '[handle_new_user] profiles 행 생성 실패 (재시도, user %): %', new.id, sqlerrm;
      end;
    when others then
      raise warning '[handle_new_user] profiles 행 생성 실패 (user %): %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── (4) 기존 사용자 백필 ─────────────────────────────────────────────
-- INSERT ... SELECT 한 방이 아니라 행 단위 루프인 이유: generate_profile_username()이
-- "이미 쓰인 username인지"를 profiles에서 조회하는데, 하나의 INSERT ... SELECT 안에서
-- 방금 만들어진 행들은 그 조회에 보이지 않습니다. 그래서 kim@a.com과 kim@b.com처럼 앞부분이
-- 같은 사용자가 둘 있으면 둘 다 'kim'을 받아 unique 위반으로 백필 전체가 실패합니다.
-- 루프로 한 행씩 넣으면 직전에 넣은 행이 다음 호출에 보이므로 이 문제가 없습니다.
do $$
declare
  r record;
  v_created integer := 0;
begin
  for r in
    select u.id, u.email
    from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
    order by u.created_at
  loop
    begin
      insert into public.profiles (id, username)
      values (r.id, public.generate_profile_username(r.email, r.id))
      on conflict (id) do nothing;
      v_created := v_created + 1;
    exception when unique_violation then
      insert into public.profiles (id, username)
      values (r.id, 'user_' || replace(r.id::text, '-', ''))
      on conflict (id) do nothing;
      v_created := v_created + 1;
    end;
  end loop;

  raise notice '[backfill] profiles 행 %건 생성', v_created;
end $$;

-- ── 적용 후 검증 ─────────────────────────────────────────────────────
-- 1) 트리거가 실제로 붙었는지
--    select t.tgname, c.relname, p.proname
--    from pg_trigger t
--    join pg_class c on c.oid = t.tgrelid
--    join pg_proc  p on p.oid = t.tgfoid
--    where t.tgname = 'on_auth_user_created' and not t.tgisinternal;
--
-- 2) 프로필이 없는 사용자가 0명인지 (백필이 끝나면 0이어야 합니다)
--    select count(*) as users_without_profile
--    from auth.users u
--    where not exists (select 1 from public.profiles p where p.id = u.id);
--
-- 3) 외래키 확인
--    select conname, confrelid::regclass as references, confdeltype
--    from pg_constraint
--    where conrelid = 'public.profiles'::regclass and contype = 'f';
--    -- confdeltype이 'c'(cascade)여야 계정 삭제 시 profiles도 함께 정리됩니다.
--
-- 4) 실제로 새 계정을 하나 만들어보고(앱의 회원가입 또는 Auth 대시보드) profiles에 행이
--    바로 생기는지 확인:
--    select id, username, is_pro, pro_source from public.profiles order by updated_at desc limit 5;
