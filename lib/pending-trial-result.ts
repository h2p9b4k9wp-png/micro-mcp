import type { LensId, DeadlinesResult, QuestionsResult, DigestResult } from './lenses';

// 💡 [신규] 로그인 없이 체험한 파일 분석 결과를 로그인 성공 시점까지 브라우저에 들고
// 있기 위한 공유 타입/키 — app/login/page.tsx(저장)와 app/page.tsx(로그인 후 자동 저장)가
// 같은 키·모양을 씁니다. 원본 파일이 아니라 이미 추출된 텍스트 + 분석 결과만 담아서
// localStorage 용량 문제를 피합니다(로그인 후 파일을 다시 올릴 필요가 없게 하는 목적).
export const PENDING_TRIAL_RESULT_KEY = 'mcp_pending_trial_result';

export interface PendingTrialResult {
  fileName: string;
  text: string;
  lens: LensId;
  result: DeadlinesResult | QuestionsResult | DigestResult;
  savedAt: string;
}
