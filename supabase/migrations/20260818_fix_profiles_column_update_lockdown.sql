-- 💡 [보안 수정] 20260814_atomic_society_code_redemption_and_profile_lockdown.sql의 마지막 줄
--
--     revoke update (is_pro, pro_source, pro_expires_at) on public.profiles from authenticated;
--
-- 은 의도한 일을 하지 못했습니다. PostgreSQL에서 컬럼 단위 권한은 테이블 단위 권한에
-- "더해지는" 것이지 그것을 깎아내지 못합니다 — 테이블 단위로 UPDATE가 부여돼 있으면 그
-- 권한이 모든 컬럼을 그대로 덮으므로, 컬럼 단위 REVOKE는 (해당 컬럼에 컬럼 단위 GRANT가
-- 따로 없는 한) 경고만 내고 아무것도 회수하지 않습니다. Supabase는 public 스키마의 테이블에
-- anon/authenticated 롤로 테이블 단위 권한을 기본 부여하므로, 정확히 이 상황이었습니다.
--
-- 실제 확인 결과(운영 DB, SQL Editor):
--   select has_column_privilege('authenticated','public.profiles','is_pro','UPDATE');  -- true
--
-- 즉 20260814를 적용한 뒤에도 그 파일 주석이 스스로 지적한 구멍 — 로그인한 사용자가 자기
-- 브라우저에서 supabase.from('profiles').update({is_pro: true}).eq('id', <자기 id>)를 호출해
-- 결제도 코드도 없이 스스로 Pro가 되는 것 — 이 그대로 열려 있었습니다. RLS의 "사용자는 자신의
-- 프로필만 수정" 정책은 행만 제한할 뿐 컬럼을 제한하지 않으므로 이걸 막지 못합니다.
--
-- 올바른 방법은 테이블 단위 UPDATE를 먼저 회수하고, 허용할 컬럼만 컬럼 단위로 다시
-- 부여하는 것입니다. 이렇게 하면 authenticated에게 남는 UPDATE 권한은 아래 두 컬럼뿐이고,
-- is_pro/pro_source/pro_expires_at은 SET 절에 등장하는 순간 권한 오류로 거부됩니다.
--
-- 허용 컬럼을 username/updated_at으로 잡은 근거: profiles의 컬럼은 id, username, updated_at,
-- is_pro, pro_source, pro_expires_at 여섯 개이고, id는 auth.users를 참조하는 기본키라 사용자가
-- 바꿀 대상이 아닙니다. 나머지 둘은 20260814가 "그 외 컬럼(username 등)은 기존처럼 그대로
-- 수정 가능합니다"라고 명시한 원래 의도를 그대로 보존한 것입니다 — 현재 앱 코드에는 이
-- 테이블을 클라이언트에서 UPDATE하는 경로가 하나도 없지만(전부 .select()), 향후 프로필 편집
-- 기능이 생겼을 때 이 마이그레이션을 다시 건드리지 않아도 되도록 열어둡니다.
--
-- is_pro/pro_source/pro_expires_at을 실제로 쓰는 경로는 전부 이 권한 밖에서 동작하므로
-- 영향받지 않습니다:
--   - app/api/webhooks/polar          → 서비스 롤 키
--   - app/api/cron/cleanup-logs       → 서비스 롤 키
--   - redeem_society_code_atomic()    → SECURITY DEFINER (소유자 권한으로 실행)
--   - handle_new_user()               → SECURITY DEFINER (INSERT만, UPDATE 아님)
-- 조회 경로(lib/plan-limits.ts, app/page.tsx 등)는 전부 SELECT라 무관합니다.

do $$
declare
  v_role text;
begin
  foreach v_role in array array['authenticated', 'anon'] loop
    if not exists (select 1 from pg_roles where rolname = v_role) then
      raise notice '[보안] 롤 %가 없어 건너뜁니다.', v_role;
      continue;
    end if;

    -- 테이블 단위 UPDATE를 먼저 회수합니다. 이것이 없으면 아래 컬럼 단위 GRANT는 무의미하고,
    -- 20260814와 똑같이 아무것도 막지 못하는 상태가 됩니다.
    execute format('revoke update on public.profiles from %I', v_role);

    -- 20260814가 남긴 컬럼 단위 REVOKE의 잔재를 정리합니다. 위 테이블 단위 회수로 이미
    -- 실효는 없지만, 컬럼 단위 GRANT가 남아 있으면 아래 grant와 겹쳐 헷갈리므로 명시적으로
    -- 비웁니다(권한이 없으면 no-op).
    execute format(
      'revoke update (id, username, updated_at, is_pro, pro_source, pro_expires_at) on public.profiles from %I',
      v_role
    );
  end loop;
end $$;

-- authenticated에게만 사용자 소유 컬럼을 되돌려줍니다. anon은 로그인하지 않은 방문자이므로
-- profiles를 수정할 이유가 전혀 없어 아무것도 부여하지 않습니다(위에서 회수한 상태로 끝).
-- 행 단위 제한은 기존 RLS 정책("사용자는 자신의 프로필만 수정")이 계속 담당합니다 — 이
-- 마이그레이션은 그 정책을 대체하는 게 아니라, 정책이 다루지 못하는 컬럼 축을 보완합니다.
grant update (username, updated_at) on public.profiles to authenticated;

-- ── 적용 후 확인 ──────────────────────────────────────────────────────
-- 아래 세 줄이 모두 false, 뒤 두 줄이 모두 true여야 정상입니다.
--
--   select has_column_privilege('authenticated','public.profiles','is_pro','UPDATE');          -- false
--   select has_column_privilege('authenticated','public.profiles','pro_source','UPDATE');      -- false
--   select has_column_privilege('authenticated','public.profiles','pro_expires_at','UPDATE');  -- false
--   select has_column_privilege('authenticated','public.profiles','username','UPDATE');        -- true
--   select has_table_privilege('service_role','public.profiles','UPDATE');                     -- true
--
-- 서비스 롤 쪽이 false로 나오면 Polar 결제와 소사이어티 코드 만료 강등이 동시에 멎으므로,
-- 마지막 줄은 반드시 함께 확인하세요.
