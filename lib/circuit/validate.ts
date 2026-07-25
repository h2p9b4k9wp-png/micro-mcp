import type { CircuitNode, NodeLayer } from '@/types/blocks';

export interface CircuitEdge {
  from: CircuitNode['id'];
  to: CircuitNode['id'];
}

export interface CircuitGraphState {
  nodes: CircuitNode[];
  edges: CircuitEdge[];
}

const LAYER_ORDER: Record<NodeLayer, number> = { source: 0, lens: 1, action: 2 };

// source → lens, lens → action 방향으로만 연결을 허용합니다.
// (source → action 직결, 역방향, 같은 계층끼리는 전부 불가)
export function canConnect(from: CircuitNode, to: CircuitNode): boolean {
  return LAYER_ORDER[to.layer] === LAYER_ORDER[from.layer] + 1;
}

// 그래프에는 lens가 항상 정확히 1개만 존재합니다. 새 lens 노드를 놓으면 기존 lens 노드와
// 거기 연결돼 있던 edge를 함께 교체합니다.
export function placeLensNode(graph: CircuitGraphState, node: CircuitNode): CircuitGraphState {
  if (node.layer !== 'lens') {
    throw new Error(`placeLensNode에는 lens 노드만 전달할 수 있습니다: ${node.id}`);
  }

  const existingLens = graph.nodes.find((n) => n.layer === 'lens');
  if (!existingLens) {
    return { nodes: [...graph.nodes, node], edges: graph.edges };
  }

  return {
    nodes: graph.nodes.map((n) => (n.id === existingLens.id ? node : n)),
    edges: graph.edges.filter((e) => e.from !== existingLens.id && e.to !== existingLens.id),
  };
}

// source 노드가 하나도 없으면 실행할 수 없습니다. action 노드가 0개인 것은 허용됩니다.
export function canExecuteGraph(graph: CircuitGraphState): boolean {
  return graph.nodes.some((n) => n.layer === 'source');
}

export interface GraphValidationResult {
  valid: boolean;
  errors: string[];
}

// 그래프 전체를 한 번에 검증합니다: 연결 방향/계층 규칙, lens 단일성, source 존재 여부.
export function validateGraph(graph: CircuitGraphState): GraphValidationResult {
  const errors: string[] = [];
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n] as const));

  for (const edge of graph.edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) {
      errors.push(`존재하지 않는 노드를 연결하려고 했습니다: ${edge.from} → ${edge.to}`);
      continue;
    }
    if (from.layer === to.layer) {
      errors.push(`같은 계층(${from.layer}) 노드끼리는 연결할 수 없습니다: ${from.id} → ${to.id}`);
      continue;
    }
    if (!canConnect(from, to)) {
      errors.push(`${from.layer} → ${to.layer} 방향으로는 연결할 수 없습니다: ${from.id} → ${to.id}`);
    }
  }

  const lensCount = graph.nodes.filter((n) => n.layer === 'lens').length;
  if (lensCount > 1) {
    errors.push(`lens 노드는 그래프에 정확히 1개만 있어야 합니다 (현재 ${lensCount}개).`);
  }

  if (!canExecuteGraph(graph)) {
    errors.push('source 노드가 하나도 없어서 실행할 수 없습니다.');
  }

  return { valid: errors.length === 0, errors };
}
