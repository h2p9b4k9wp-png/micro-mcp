// 💡 [신규] 코드 기반 Pro의 남은 기간 계산. components/pro-expiry-notice.tsx가 화면을
// 그리고, 날짜 계산만 여기 순수 함수로 뺐습니다 — 경계값(오늘 끝남 / 내일 끝남 / 이미
// 지났는데 아직 강등 전)이 정확한지 실제로 돌려서 확인해야 하는데, .tsx는 그대로 실행할
// 수 없기 때문입니다.

/** 이 일수 이하로 남으면 화면에서 경고 톤으로 바뀝니다. */
export const PRO_EXPIRY_WARN_WITHIN_DAYS = 7;

/**
 * 남은 일수를 달력 기준으로 셉니다.
 *
 * 💡 밀리초 차이를 그대로 나누면 "0.4일 남음" 같은 값이 나와 D-0과 D-1의 경계가
 * 애매해집니다. 양쪽을 자정 기준으로 내림한 뒤 날짜 수만 비교해서, 사용자가 달력을 보고
 * 세는 것과 같은 결과가 나오게 합니다(오늘 끝나면 0, 내일이면 1).
 *
 * 브라우저 로컬 시간대를 씁니다 — 실제 강등은 UTC 03:00에 도는 cron
 * (app/api/cron/cleanup-logs)이 하므로 사용자 시간대에 따라 최대 하루 차이가 날 수
 * 있지만, 이 안내의 목적은 "슬슬 끝나간다"를 알리는 것이라 그 정도 오차는 로컬 날짜와
 * 어긋나 보이는 것보다 낫습니다.
 *
 * 날짜로 해석할 수 없는 값이면 null을 돌려주고, 호출부는 아무것도 그리지 않습니다.
 */
export function getDaysLeft(expiresAt: string, now: Date = new Date()): number | null {
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return null;
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((endDay.getTime() - today.getTime()) / 86_400_000);
}
