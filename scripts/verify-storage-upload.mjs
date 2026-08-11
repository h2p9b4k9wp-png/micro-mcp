// 💡 [신규] Storage 직접 업로드 경로를 실제 Supabase 프로젝트에 대고 확인하는 스크립트.
//
// 왜 스크립트인가: 이 검증에는 진짜 Supabase 자격증명이 필요합니다 — 버킷 존재 여부, RLS 정책,
// file_size_limit이 전부 서버 쪽 설정이라 코드만으로는 흉내낼 수 없습니다. 개발 컨테이너의
// .env.local은 더미 값이라 그곳에서는 돌릴 수 없어, 실제 값이 있는 환경에서 한 번 실행해
// 확인하는 용도로 남겨둡니다.
//
// 실행:
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//   TEST_EMAIL=... TEST_PASSWORD=... \
//   node scripts/verify-storage-upload.mjs ./경로/큰파일.pdf
//
// 이 스크립트가 확인하는 것 (Storage 계층):
//   1. 브라우저와 똑같은 방식(anon 키 + 로그인 세션)으로 큰 파일이 업로드되는가
//   2. 남의 폴더에는 못 올리는가 (RLS 정책이 실제로 걸려 있는가)
//   3. 자기 파일은 지울 수 있는가
//   4. 지금 내 폴더에 남아 있는 고아 객체가 있는가
//
// 확인하지 '않는' 것: /api/extract 호출. 그 라우트는 쿠키 세션으로 인증하는데, 브라우저
// 쿠키 형식을 스크립트에서 재현하면 라이브러리 버전에 따라 깨지기 쉬워 잘못된 실패로
// 오해하기 쉽습니다. 그쪽은 앱에서 직접 20MB 이상 파일을 올려보고(교수님 탭 → 자료 올리기),
// 그 다음 이 스크립트를 `--orphans`로 다시 돌려 "원본이 남지 않았는지"로 확인하세요.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'uploads';
const orphansOnly = process.argv.includes('--orphans');
const filePath = process.argv.slice(2).find((a) => !a.startsWith('--'));
const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, TEST_EMAIL, TEST_PASSWORD } = process.env;

if (!url || !anonKey || !TEST_EMAIL || !TEST_PASSWORD || (!orphansOnly && !filePath)) {
  console.error('필요한 값이 빠졌습니다. 파일 상단의 실행 예시를 참고하세요.');
  process.exit(1);
}

const supabase = createClient(url, anonKey);
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: TEST_EMAIL,
  password: TEST_PASSWORD,
});
if (authError) {
  console.error('로그인 실패:', authError.message);
  process.exit(1);
}
const userId = auth.user.id;
console.log(`로그인 OK (user ${userId})\n`);

const bucket = supabase.storage.from(BUCKET);

async function listMine() {
  const { data, error } = await bucket.list(userId, { limit: 1000 });
  if (error) throw new Error(`목록 조회 실패: ${error.message}`);
  return data ?? [];
}

if (orphansOnly) {
  const objects = await listMine();
  if (objects.length === 0) {
    console.log('✅ 남아 있는 원본 없음 — 추출 후 자동 삭제가 동작하고 있습니다.');
  } else {
    console.log(`⚠️  원본 ${objects.length}건이 남아 있습니다:`);
    for (const o of objects) console.log(`   ${o.name}  ${o.created_at ?? ''}`);
    console.log('   (업로드 직후라면 정상입니다. 몇 분 뒤에도 남아 있으면 삭제가 실패한 것입니다.)');
  }
  process.exit(0);
}

const bytes = fs.readFileSync(filePath);
const fileName = path.basename(filePath);
console.log(`대상 파일: ${fileName} (${(bytes.length / 1048576).toFixed(1)}MB)`);

// ── 1. 큰 파일 업로드 ────────────────────────────────────────────────
const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
const objectPath = `${userId}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;
const t0 = Date.now();
const { error: uploadError } = await bucket.upload(objectPath, bytes, {
  contentType: 'application/octet-stream',
  upsert: false,
});
if (uploadError) {
  console.error(`❌ 1. 업로드 실패: ${uploadError.message}`);
  console.error('     버킷이 없거나(마이그레이션 미적용) file_size_limit보다 큰 파일일 수 있습니다.');
  process.exit(1);
}
console.log(`✅ 1. 업로드 성공 (${((Date.now() - t0) / 1000).toFixed(1)}초) → ${objectPath}`);
console.log('     이 바이트는 Vercel 함수를 거치지 않았습니다 — 4.5MB 본문 상한과 무관합니다.');

// ── 2. 남의 폴더에는 못 올리는가 ─────────────────────────────────────
const { error: foreignError } = await bucket.upload(
  `00000000-0000-0000-0000-000000000000/x.pdf`,
  Buffer.from('test'),
  { upsert: false }
);
console.log(
  foreignError
    ? `✅ 2. 남의 폴더 업로드 거절됨 (${foreignError.message})`
    : '❌ 2. 남의 폴더에 업로드가 됐습니다 — RLS 정책을 확인하세요.'
);

// ── 3. 자기 파일 삭제 ────────────────────────────────────────────────
const { error: removeError } = await bucket.remove([objectPath]);
console.log(removeError ? `❌ 3. 삭제 실패: ${removeError.message}` : '✅ 3. 자기 파일 삭제 성공');

// ── 4. 남은 객체 ─────────────────────────────────────────────────────
const left = await listMine();
console.log(
  left.length === 0
    ? '✅ 4. 내 폴더에 남은 원본 없음'
    : `⚠️  4. 내 폴더에 ${left.length}건이 남아 있습니다 (크론이 24시간 뒤 정리합니다)`
);

console.log(
  '\n다음: 앱에서 같은 파일을 교수님 탭 → 자료 올리기로 올린 뒤, ' +
    '`node scripts/verify-storage-upload.mjs --orphans` 로 원본이 지워졌는지 확인하세요.'
);
