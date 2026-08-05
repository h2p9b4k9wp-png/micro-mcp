-- 💡 [보안] public.rls_auto_enable() 실행 권한을 service_role로만 제한합니다.
--
-- ── 왜 위험한가 ──────────────────────────────────────────────────────
-- 이 함수는 public 스키마에 있고 SECURITY DEFINER입니다. 이 조합이 위험한 이유:
--
-- 1) public 스키마의 함수는 PostgREST가 자동으로 REST 엔드포인트로 노출합니다 —
--    즉 POST /rest/v1/rpc/rls_auto_enable 로 호출할 수 있습니다.
-- 2) 그 호출에 필요한 anon 키는 비밀이 아닙니다. 이 앱은 NEXT_PUBLIC_SUPABASE_ANON_KEY로
--    브라우저 번들에 그대로 실어 보냅니다(app/page.tsx, app/login/page.tsx의
--    createBrowserClient). 즉 사이트 소스만 보면 누구나 키를 얻습니다.
-- 3) SECURITY DEFINER는 호출자가 아니라 "함수 소유자"의 권한으로 실행됩니다. 소유자가
--    postgres면 RLS를 통째로 무시하는 권한으로 함수 본문이 돌아갑니다.
--
-- 세 개를 합치면: 인터넷의 아무나 → 공개된 anon 키로 → DB 최고 권한으로 도는 함수를
-- 호출할 수 있는 상태입니다. 함수가 무해한 일만 한다면 실질 피해는 없지만, 그건 함수
-- 본문에 전적으로 달린 문제이지 접근 통제로 막고 있는 게 아닙니다. 이 마이그레이션은
-- 본문이 무엇이든 상관없도록 접근 자체를 닫습니다.
--
-- ── PUBLIC 롤을 반드시 함께 REVOKE 해야 하는 이유 ────────────────────
-- PostgreSQL은 함수를 만들 때 EXECUTE를 자동으로 PUBLIC(모든 롤)에 부여합니다.
-- 그래서 anon/authenticated만 REVOKE하면 두 롤이 PUBLIC을 통해 권한을 그대로
-- 상속받아 아무것도 막히지 않습니다 — PUBLIC을 먼저 걷어내야 실제로 닫힙니다.
--
-- ── 함수를 삭제하지 않고 REVOKE만 하는 이유 ──────────────────────────
-- 이 저장소의 앱 코드에는 이 함수를 호출하는 곳이 없습니다(.rpc() 호출은
-- lib/society-codes.ts의 redeem_society_code_atomic 하나뿐). 하지만 "앱이 호출하지
-- 않음"과 "삭제해도 안전함"은 다릅니다 — DB 함수는 트리거·이벤트 트리거·다른 함수·
-- RLS 정책·pg_cron에서 앱 코드 없이도 호출될 수 있고, 이름(rls_auto_enable)으로 보면
-- 오히려 "새 테이블에 RLS를 자동으로 켜주는 이벤트 트리거"일 가능성이 있습니다.
-- 그렇다면 이건 보안 구멍이 아니라 보안 장치이고, 지우면 앞으로 만드는 테이블이
-- RLS 없이 생성됩니다. REVOKE는 어느 쪽이든 안전하지만 DROP은 아닙니다.
-- 본문을 확인한 뒤 정말 불필요하다고 판단되면 이 파일 맨 아래 DROP 문의 주석을 푸세요.
--
-- 실행 전에 아래 조회로 본문을 반드시 먼저 확인하세요(특히 ENABLE만 하는지, DISABLE도
-- 할 수 있는지):
--   select p.oid::regprocedure as signature,
--          p.prosecdef        as is_security_definer,
--          p.proconfig        as settings,
--          pg_get_functiondef(p.oid) as body
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'rls_auto_enable';

-- 오버로드(같은 이름, 다른 인자)가 여러 개일 수 있으므로 전부 순회합니다.
do $$
declare
  fn record;
  found_count int := 0;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
  loop
    -- PUBLIC을 먼저 걷어내야 anon/authenticated가 상속으로 우회하지 못합니다.
    execute format('revoke all on function %s from public', fn.sig);
    execute format('revoke all on function %s from anon', fn.sig);
    execute format('revoke all on function %s from authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);

    found_count := found_count + 1;
    raise notice '[보안] 실행 권한 제한 완료: %', fn.sig;
  end loop;

  if found_count = 0 then
    raise notice '[보안] public.rls_auto_enable 함수를 찾지 못했습니다 — 이미 삭제되었거나 다른 스키마에 있습니다.';
  end if;
end;
$$;

-- 검증: anon/authenticated에 EXECUTE가 남아있지 않아야 합니다(0행이면 정상).
--   select p.oid::regprocedure as signature, r.rolname
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   cross join (values ('anon'),('authenticated')) as r(rolname)
--   where n.nspname = 'public' and p.proname = 'rls_auto_enable'
--     and has_function_privilege(r.rolname, p.oid, 'EXECUTE');

-- ── 선택: 본문 확인 후 정말 불필요할 때만 ────────────────────────────
-- 위 조회로 본문을 보고 (1) 이벤트 트리거에 연결돼 있지 않고 (2) 다른 함수/트리거가
-- 쓰지 않는다는 걸 확인한 뒤에만 주석을 푸세요. 의존 객체가 있으면 이 문장은 그냥
-- 에러로 실패합니다(cascade를 붙이지 않았으므로 조용히 뭔가를 지우지 않습니다).
--
-- drop function if exists public.rls_auto_enable();
