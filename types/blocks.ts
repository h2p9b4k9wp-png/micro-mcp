import type { LucideIcon } from 'lucide-react';

// 💡 [신규] 3계층 노드 그래프 모델 (source → lens → action). 예전 McpBlock(on/off 토글) 모델은
// 이번 단계로 완전히 대체되어 삭제되었습니다.
export type NodeLayer = 'source' | 'lens' | 'action';

export type NodeId =
  | 'this_doc' | 'my_library' | 'web_search'
  | 'deadlines' | 'questions' | 'digest'
  | 'save_deadline' | 'sync_calendar' | 'export_hwp'
  // 💡 [신규] "교수님" 상세 화면 회로도 전용 노드 — 위 9개(물어보기 미니 전선용)와는 별개 그래프에서만 씁니다.
  | 'professor_docs' | 'professor_ai_core'
  | 'expected_questions' | 'assignment_direction' | 'study_method';

// 노드 레지스트리 항목 — "어떤 노드가 존재하는지"에 대한 정적 메타데이터입니다 (lib/blocks/defaults.ts).
export interface CircuitNode {
  id: NodeId;
  layer: NodeLayer;
  label: string;          // 5자 이내
  hint: string;           // 한 줄
  icon: LucideIcon;
  estimatedSeconds: number;
  minLibraryDocs?: number; // 이 개수 이상일 때만 활성 (my_library: 5)
  defaultForLens?: NodeId; // action 노드가 어떤 lens의 기본값인지
}

// 그래프 자료구조 — "지금 이 그래프에 실제로 어떤 노드가 놓여있고 어떻게 연결돼 있는지"에 대한
// 런타임 상태입니다. CircuitNode(정적 메타데이터)와 달리 상태(status)를 가지며, 노드 자체의
// label/hint/icon 등은 갖지 않고 id로 NODE_REGISTRY를 조회해서 얻습니다.
export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

export interface GraphNode {
  id: NodeId;
  layer: NodeLayer;
  status: NodeStatus;
}

export interface GraphEdge {
  from: NodeId;
  to: NodeId;
  label?: string;
}

export interface CircuitGraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
