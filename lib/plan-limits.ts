// 💡 [신규] 유료 전환 준비 — 결제 시스템은 아직 없고, profiles.is_pro 플래그(지금은
// Supabase 대시보드에서 수동으로 켜는 것)만으로 무료/Pro 한도를 가릅니다. 파일/채팅
// 월간 한도는 서버(app/api/chat, app/api/extract)에서, 교수님 개수/자료 개수 한도는
// 클라이언트(app/page.tsx)에서 검사합니다 — 후자는 professors/documents 테이블에 클라
// 이언트가 직접(Supabase RLS로) insert하는 구조라 서버 라우트를 거치지 않기 때문입니다.
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
