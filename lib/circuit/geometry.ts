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

// 💡 [신규] 좁은 화면(모바일)에서는 좌→우 대신 위→아래로 흐르는 세로 파이프라인을 씁니다.
// 기존 가로 배치(CIRCUIT_VIEWBOX/getPipelinePosition/buildCircuitTracePath)는 넓은 화면용으로
// 그대로 두고, 아래 세로 전용 좌표계·경로 함수를 별도로 추가합니다.
export const CIRCUIT_VIEWBOX_VERTICAL = { width: 480, height: 900 };

// 3행 파이프라인의 행(y좌표): source → lens → action 순서로 위에서 아래로 흐릅니다.
const PIPELINE_ROW_Y_VERTICAL: Record<NodeLayer, number> = {
  source: CIRCUIT_VIEWBOX_VERTICAL.height * 0.12,
  lens: CIRCUIT_VIEWBOX_VERTICAL.height * 0.5,
  action: CIRCUIT_VIEWBOX_VERTICAL.height * 0.88,
};

// 같은 행 안에서 노드끼리 가로로 균등 분포시키는 간격 (행당 최대 3개 가정).
const PIPELINE_COLUMN_SPACING_VERTICAL = 140;

// 지정한 행(layer) 안에서 index번째 노드(전체 count개 중)의 좌표를 계산합니다 (세로 배치용).
export function getPipelinePositionVertical(layer: NodeLayer, indexInLayer: number, countInLayer: number) {
  const centerX = CIRCUIT_VIEWBOX_VERTICAL.width / 2;
  const totalSpan = PIPELINE_COLUMN_SPACING_VERTICAL * Math.max(countInLayer - 1, 0);
  const startX = centerX - totalSpan / 2;
  return {
    x: countInLayer > 0 ? startX + PIPELINE_COLUMN_SPACING_VERTICAL * indexInLayer : centerX,
    y: PIPELINE_ROW_Y_VERTICAL[layer],
  };
}

// buildCircuitTracePath의 세로 배치용 버전 — 축을 맞바꿔 수직 → 수평 → 수직 3구간으로 잇습니다.
export function buildCircuitTracePathVertical(x1: number, y1: number, x2: number, y2: number, corner = 20) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (Math.abs(dx) < corner * 2) {
    return `M ${x1},${y1} L ${x2},${y2}`;
  }

  const midY = (y1 + y2) / 2;
  const signX = dx > 0 ? 1 : -1;
  const signY = dy > 0 ? 1 : -1;

  return [
    `M ${x1},${y1}`,
    `L ${x1},${midY - signY * corner}`,
    `Q ${x1},${midY} ${x1 + signX * corner},${midY}`,
    `L ${x2 - signX * corner},${midY}`,
    `Q ${x2},${midY} ${x2},${midY + signY * corner}`,
    `L ${x2},${y2}`,
  ].join(' ');
}
