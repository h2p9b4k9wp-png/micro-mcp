// 💡 [신규] /api/analyze, /api/analyze-professor, /api/extract처럼 DB를 전혀 쓰지 않는
// 라우트에 새 테이블 없이 최소한의 속도 제한을 걸기 위한 메모리 기반 카운터입니다.
// 서버리스 인스턴스 하나의 메모리에만 유지되므로(콜드 스타트·다중 인스턴스 시 리셋될 수
// 있음) 완벽한 보장은 아니지만, 이 앱 규모(개인 계정 소수)에서는 단일 계정의 짧은 폭주성
// 호출을 실질적으로 막아주기에 충분합니다. 더 강한 보장이 필요해지면 DB 테이블 기반으로
// 옮겨야 합니다(예: /api/chat이 logs 테이블 카운트로 하는 것처럼).
const buckets = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    buckets.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  buckets.set(key, timestamps);
  return true;
}
