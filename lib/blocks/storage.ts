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

// app/page.tsx가 계정이 확정되는 시점(사실상 마운트 시)에 한 번 호출해서, v1 키가 남아있으면 지웁니다.
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
