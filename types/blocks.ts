import type { LucideIcon } from 'lucide-react';

export interface McpBlock {
  id: string;
  name: string;
  description: string;
  active: boolean;
  icon: LucideIcon;
  config?: {
    apiKey?: string;
    endpoint?: string;
    statusText?: string;
  };
}

// 💡 [신규] 3계층 노드 그래프 모델 (source → lens → action). 기존 McpBlock(on/off 토글) 모델을 대체할
// 새 데이터 모델로, 지금은 레지스트리/검증 로직만 추가된 상태이며 UI(app/page.tsx, circuit-board 등)는
// 아직 McpBlock 기반 그대로입니다.
export type NodeLayer = 'source' | 'lens' | 'action';

export type NodeId =
  | 'this_doc' | 'my_library' | 'web_search'
  | 'deadlines' | 'questions' | 'digest'
  | 'save_deadline' | 'sync_calendar' | 'export_hwp';

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
