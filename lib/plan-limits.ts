import type { SupabaseClient } from '@supabase/supabase-js';

// 💡 [신규] 유료 전환 준비 — 결제 시스템은 아직 없고, profiles.is_pro 플래그(지금은
// Supabase 대시보드에서 수동으로 켜는 것)만으로 무료/Pro 한도를 가릅니다. 파일/채팅
// 월간 한도는 서버(app/api/chat, app/api/extract, app/api/upload-quota)에서, 교수님
// 개수/자료 개수 한도는 클라이언트(app/page.tsx)에서 검사합니다 — 후자는
// professors/documents 테이블에 클라이언트가 직접(Supabase RLS로) insert하는 구조라
// 서버 라우트를 거치지 않기 때문입니다.
export const FREE_LIMITS = {
  filesPerMonth: 10,
  chatsPerMonth: 50,
  maxProfessors: 1,
  maxDocumentsPerProfessor: 10,
};

export const PRO_LIMITS = {
  filesPerMonth: 200,
  chatsPerMonth: 1000,
  maxProfessors: Infinity,
  maxDocumentsPerProfessor: Infinity,
};

export function getPlanLimits(isPro: boolean) {
  return isPro ? PRO_LIMITS : FREE_LIMITS;
}

// 월간 한도 집계 기준 시점(UTC 월 1일 00:00). 정산 정밀도가 필요한 결제 연동 전 단계라
// KST 기준으로 정교하게 맞추지 않고 단순하게 UTC 월 경계를 씁니다.
export function getMonthStartISOString(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export interface FileQuotaResult {
  ok: boolean;
  error?: string;
  limit?: number;
}

// 💡 [신규] "이번 달 파일 처리 한도" 검사를 한 곳에 모아둡니다 — /api/extract(텍스트 파일)와
// /api/upload-quota(채팅 이미지 첨부처럼 /api/extract를 거치지 않는 경로가 첨부 시점에
// 확인용으로 부르는 조회 전용 라우트)가 이 함수를 공유합니다. document_uploads는 성공한
// 파일/이미지 첨부마다 한 행씩 쌓이는 이력이라(recordDocumentUpload), 이번 달 행 수를 세는
// 것이 곧 "이번 달 몇 번 파일을 올렸는지"와 같습니다.
export async function checkFileQuota(supabase: SupabaseClient, userId: string): Promise<FileQuotaResult> {
  const [{ data: profile }, { count: monthlyCount }] = await Promise.all([
    supabase.from('profiles').select('is_pro').eq('id', userId).single(),
    supabase
      .from('document_uploads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', getMonthStartISOString()),
  ]);
  const limits = getPlanLimits(Boolean(profile?.is_pro));
  if (monthlyCount !== null && monthlyCount >= limits.filesPerMonth) {
    return {
      ok: false,
      error: `이번 달 파일 처리 한도(${limits.filesPerMonth}회)에 도달했어요.`,
      limit: limits.filesPerMonth,
    };
  }
  return { ok: true };
}
