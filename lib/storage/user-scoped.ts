// 💡 [수정] 블록 활성 상태·첨부 파일·마감일은 계정별로 완전히 분리된 localStorage 키에 저장합니다.
// (예전에는 키가 계정 구분 없이 공용이라, 같은 브라우저에서 다른 계정으로 로그인하면 이전 계정의
// 블록/파일/마감일이 그대로 보이는 문제가 있었음.) 예전 공용 키에 데이터가 남아있으면 지금 로그인한
// 계정 몫으로 1회만 이전(migrate)하고 공용 키는 지워서, 그다음 다른 계정이 로그인해도 새지 않게 합니다.
export function loadUserScopedItem<T>(userId: string, legacyKey: string): T | null {
  const scopedKey = `${legacyKey}:${userId}`;
  try {
    const scoped = localStorage.getItem(scopedKey);
    if (scoped !== null) return JSON.parse(scoped) as T;

    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      localStorage.setItem(scopedKey, legacy);
      localStorage.removeItem(legacyKey);
      return JSON.parse(legacy) as T;
    }
  } catch (e) {
    console.error(`로컬 데이터(${legacyKey}) 로딩 실패:`, e);
  }
  return null;
}

export function saveUserScopedItem(userId: string, legacyKey: string, value: unknown) {
  localStorage.setItem(`${legacyKey}:${userId}`, JSON.stringify(value));
}
