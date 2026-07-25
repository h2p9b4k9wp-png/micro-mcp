import type { NodeLayer } from '@/types/blocks';

// 💡 [신규] "MCP 블록 매니저" 탭의 회로도 스타일 다이어그램 — 좌표계는 이 viewBox 기준의 고정 단위이며,
// 렌더링 시 %로 환산해 SVG 배선과 HTML 노드(파이프라인 카드·AI 코어)가 같은 좌표를 공유하도록 맞춥니다.
export const CIRCUIT_VIEWBOX = { width: 900, height: 560 };

// 3열 파이프라인의 열(x좌표): source → lens → action 순서로 좌에서 우로 흐릅니다.
const PIPELINE_COLUMN_X: Record<NodeLayer, number> = {
  source: CIRCUIT_VIEWBOX.width * 0.18,
  lens: CIRCUIT_VIEWBOX.width * 0.50, // 기존 CIRCUIT_CORE 자리
  action: CIRCUIT_VIEWBOX.width * 0.82,
};

// 같은 열 안에서 노드끼리 세로로 균등 분포시키는 간격 (열당 최대 3개 가정).
const PIPELINE_ROW_SPACING = 180;

// 지정한 열(layer) 안에서 index번째 노드(전체 count개 중)의 좌표를 계산합니다.
// 같은 열의 노드들은 열 중앙(세로)을 기준으로 균등 분포·정렬됩니다.
export function getPipelinePosition(layer: NodeLayer, indexInLayer: number, countInLayer: number) {
  const centerY = CIRCUIT_VIEWBOX.height / 2;
  const totalSpan = PIPELINE_ROW_SPACING * Math.max(countInLayer - 1, 0);
  const startY = centerY - totalSpan / 2;
  return {
    x: PIPELINE_COLUMN_X[layer],
    y: countInLayer > 0 ? startY + PIPELINE_ROW_SPACING * indexInLayer : centerY,
  };
}

// 두 점을 좌→우 3구간(수평 → 수직 → 수평)으로 잇는 SVG path를 만듭니다: 출발점에서 수평으로 나간 뒤
// 두 노드 중간 x에서 수직 이동하고, 도착점으로 다시 수평 진입합니다. 코너는 둥글게 처리합니다.
// 세로 낙차가 코너 두 개를 그리기엔 너무 작으면(같은 행) 그냥 직선으로 잇습니다.
export function buildCircuitTracePath(x1: number, y1: number, x2: number, y2: number, corner = 20) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (Math.abs(dy) < corner * 2) {
    return `M ${x1},${y1} L ${x2},${y2}`;
  }

  const midX = (x1 + x2) / 2;
  const signX = dx > 0 ? 1 : -1;
  const signY = dy > 0 ? 1 : -1;

  return [
    `M ${x1},${y1}`,
    `L ${midX - signX * corner},${y1}`,
    `Q ${midX},${y1} ${midX},${y1 + signY * corner}`,
    `L ${midX},${y2 - signY * corner}`,
    `Q ${midX},${y2} ${midX + signX * corner},${y2}`,
    `L ${x2},${y2}`,
  ].join(' ');
}
