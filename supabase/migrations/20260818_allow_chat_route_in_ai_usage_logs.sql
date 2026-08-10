-- 💡 [수정] ai_usage_logs.route의 허용값에 'chat'을 추가합니다.
--
-- 20260811_create_ai_usage_logs.sql은 route를 ('analyze', 'analyze-professor') 두 개로만
-- 제한했습니다. 그래서 지금까지 /admin/ai-usage에는 렌즈 분석 비용만 보이고, 정작 호출량이
-- 가장 많은 /api/chat의 토큰은 한 건도 기록되지 않았습니다 — "채팅 1회당 입력 토큰"을
-- 확인할 수 없었던 이유입니다.
--
-- /api/chat은 스트리밍 응답이라 usage가 응답 본문에 바로 실려오지 않고, OpenAI에
-- stream_options: { include_usage: true }를 줘야 마지막 청크에 실려옵니다. 그 값을 받아
-- 기존 recordAiUsage()로 기록하도록 라우트도 함께 수정했습니다.
--
-- 제약 조건 이름은 Postgres가 자동 생성한 기본 이름(ai_usage_logs_route_check)을 씁니다.
-- 혹시 다른 이름으로 만들어져 있을 수 있으므로, 이름으로 찾지 않고 이 컬럼에 걸린 check
-- 제약을 전부 훑어서 지운 뒤 새로 겁니다(재실행해도 안전).
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = any (con.conkey)
    where con.conrelid = 'public.ai_usage_logs'::regclass
      and con.contype = 'c'
      and att.attname = 'route'
  loop
    execute format('alter table public.ai_usage_logs drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.ai_usage_logs
  add constraint ai_usage_logs_route_check
  check (route in ('analyze', 'analyze-professor', 'chat'));

-- ── 적용 후 검증 ─────────────────────────────────────────────────────
-- 1) 제약이 새 값을 포함하는지
--    select conname, pg_get_constraintdef(oid)
--    from pg_constraint
--    where conrelid = 'public.ai_usage_logs'::regclass and contype = 'c';
--
-- 2) 배포 후 채팅을 몇 번 해보고, 실제로 기록되는지 + 요청당 입력 토큰이 얼마인지
--    select route,
--           count(*)                         as calls,
--           round(avg(prompt_tokens))        as avg_input_tokens,
--           max(prompt_tokens)               as max_input_tokens
--    from public.ai_usage_logs
--    where created_at >= now() - interval '1 day'
--    group by route;
