-- 💡 [신규] 파일 업로드를 "요청 본문(base64)"에서 "Storage 직접 업로드"로 옮기기 위한 버킷.
--
-- 배경: Vercel 서버리스 함수는 요청 본문이 약 4.5MB를 넘으면 우리 코드가 실행되기도 전에
-- 플랫폼이 413을 반환합니다. 파일을 base64로 감싸 JSON에 실어 보내던 구조에서는 base64
-- 팽창(4/3) 때문에 실제 통과 크기가 3.2MB 남짓이었고, 등급별 상한(무료 5MB / Pro 20MB)은
-- 도달할 수 없는 숫자였습니다.
--
-- 이제 브라우저가 파일을 이 버킷에 직접 올리고(Vercel 함수를 지나지 않음), 서버에는 경로
-- 문자열만 보냅니다. 서버는 그 경로로 파일을 내려받아 텍스트를 뽑고, 곧바로 객체를 지웁니다.
--
-- ⚠️ 이 마이그레이션은 자동 적용되지 않습니다 — Supabase SQL Editor에서 직접 실행해주세요.
--    (앱은 anon/service-role 키만 갖고 있고 스키마 변경 권한이 없습니다.)

-- ── 버킷 ─────────────────────────────────────────────────────────────
-- public = false: 서명 없는 공개 URL이 생기지 않습니다. 강의자료·시험지가 올라오는 곳이라
-- 링크만 알면 누구나 받을 수 있는 상태가 되면 안 됩니다.
--
-- file_size_limit(100MB)은 앱 코드와 별개로 Storage 자체가 강제하는 마지막 방어선입니다.
-- lib/plan-limits.ts의 PRO_LIMITS.maxUploadBytes와 같은 값이며, 둘 중 하나만 바꾸면
-- "앱은 허용하는데 Storage가 거부"하는 혼란이 생기므로 같이 바꿔야 합니다.
--
-- allowed_mime_types는 지정하지 않습니다 — 모바일 공유 시트/클라우드 피커가 올바른 파일에도
-- 엉뚱하거나 빈 MIME을 붙이는 경우가 많아(그래서 앱에도 resolveFileExtension 폴백이 있습니다)
-- 여기서 MIME으로 거르면 정상 파일이 조용히 막힙니다. 형식 판별은 앱이 담당합니다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 104857600)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- ── 접근 정책 ────────────────────────────────────────────────────────
-- 경로 규칙은 `{auth.uid()}/{임의키}.{확장자}` 입니다(lib/storage-upload.ts).
-- storage.foldername(name)[1]이 첫 폴더 이름이므로, 그게 자기 uid일 때만 허용하면
-- 다른 사용자의 파일은 목록에도 잡히지 않고 내려받히지도 않습니다.
--
-- 이 앱의 다른 테이블들과 같은 "자기 행만" 패턴이고, 서비스 롤은 정책과 무관하게 통과하므로
-- 고아 객체를 치우는 크론(app/api/cron/cleanup-uploads)은 그대로 동작합니다.
--
-- 정책 이름이 이미 있으면 create policy가 에러를 내므로, 다시 실행해도 안전하도록 먼저 지웁니다.
drop policy if exists "uploads_insert_own" on storage.objects;
create policy "uploads_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "uploads_select_own" on storage.objects;
create policy "uploads_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- 삭제는 보통 서버가 추출 직후에 하지만(서비스 롤 아님 — 세션 클라이언트로 지웁니다),
-- 업로드만 하고 추출 요청이 실패한 경우 클라이언트가 곧바로 치울 수 있어야 합니다.
drop policy if exists "uploads_delete_own" on storage.objects;
create policy "uploads_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- update 정책은 만들지 않습니다 — 올린 객체를 나중에 바꿀 일이 없고(추출 후 바로 삭제),
-- lib/storage-upload.ts도 upsert: false로 올립니다.
