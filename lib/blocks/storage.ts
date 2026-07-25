import { loadUserScopedItem, saveUserScopedItem } from '@/lib/storage/user-scoped';
import type { NodeId } from '@/types/blocks';

// v1(mcp_blocks_state)은 5개 블록을 켜고 끄는 flat 모델 전용 키였습니다. 3계층 노드 그래프 모델은
// 저장 형태 자체가 달라서 마이그레이션 대상이 아니며, 남아있으면 조용히 지웁니다(무시 후 삭제).
const LEGACY_V1_KEY = 'mcp_blocks_state';

// 그래프 자체(노드 배치·연결)는 문서를 열 때마다 새로 구성되므로 저장하지 않습니다.
// 저장하는 건 다음 그래프를 빠르게 구성할 때 참고할 최소한의 힌트뿐입니다.
const GRAPH_STATE_KEY = 'micro_graph_state:v2';

export interface GraphPreferences {
  lastLens: NodeId | null;
  preferredAction: NodeId | null;
}

// 아직 어디서도 호출하지 않습니다 — 3단계에서 loadGraphPreferences가 이걸 호출하도록 연결할 예정입니다.
// (지금 바로 연결하면 app/page.tsx가 여전히 의존하는 loadBlockState/saveBlockState의 mcp_blocks_state
// 키를 이 함수가 지워버려서, 아직 마이그레이션되지 않은 UI의 블록 상태가 날아갑니다.)
export function clearLegacyBlockState(userId: string) {
  try {
    localStorage.removeItem(LEGACY_V1_KEY);
    localStorage.removeItem(`${LEGACY_V1_KEY}:${userId}`);
  } catch {
    // localStorage를 쓸 수 없는 환경에서는 조용히 무시합니다.
  }
}

export function loadGraphPreferences(userId: string): GraphPreferences | null {
  return loadUserScopedItem<GraphPreferences>(userId, GRAPH_STATE_KEY);
}

export function saveGraphPreferences(userId: string, prefs: GraphPreferences): void {
  saveUserScopedItem(userId, GRAPH_STATE_KEY, prefs);
}

// @deprecated 3단계에서 제거 예정 — McpBlock on/off 토글 모델 전용 저장소. app/page.tsx가 아직 이
// 형태를 그대로 쓰고 있어서, 예전 시그니처·예전 키(mcp_blocks_state) 그대로 복원합니다.
export function loadBlockState(userId: string) {
  return loadUserScopedItem<{ id: string; active: boolean }[]>(userId, LEGACY_V1_KEY);
}

// @deprecated 3단계에서 제거 예정
export function saveBlockState(userId: string, blocks: { id: string; active: boolean }[]) {
  saveUserScopedItem(userId, LEGACY_V1_KEY, blocks);
}
