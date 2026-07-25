// 💡 [신규] "MCP 블록 매니저" 탭의 회로도 스타일 다이어그램 — 좌표계는 이 viewBox 기준의 고정 단위이며,
// 렌더링 시 %로 환산해 SVG 배선과 HTML 노드(블록 칩·AI 코어)가 같은 좌표를 공유하도록 맞춥니다.
export const CIRCUIT_VIEWBOX = { width: 900, height: 560 };
export const CIRCUIT_CORE = { x: 450, y: 290 };
export const CIRCUIT_RADIUS = 210;

export function getCircuitNodePosition(index: number, total: number) {
  const angle = (-90 + (360 / total) * index) * (Math.PI / 180);
  return {
    x: CIRCUIT_CORE.x + CIRCUIT_RADIUS * Math.cos(angle),
    y: CIRCUIT_CORE.y + CIRCUIT_RADIUS * Math.sin(angle),
  };
}

// 두 점을 회로 기판 트레이스처럼 직각(+둥근 모서리)으로 잇는 SVG path를 만듭니다.
// 두 점이 이미 수평/수직으로 거의 맞아떨어지면 굳이 꺾지 않고 직선으로 잇습니다.
export function buildCircuitTracePath(x1: number, y1: number, x2: number, y2: number, corner = 20) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.min(Math.abs(dx), Math.abs(dy)) < corner * 1.5) {
    return `M ${x1},${y1} L ${x2},${y2}`;
  }
  const signX = dx > 0 ? 1 : -1;
  const signY = dy > 0 ? 1 : -1;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const bendX = x2 - signX * corner;
    const bendY = y1 + signY * corner;
    return `M ${x1},${y1} L ${bendX},${y1} Q ${x2},${y1} ${x2},${bendY} L ${x2},${y2}`;
  }
  const bendY = y2 - signY * corner;
  const bendX = x1 + signX * corner;
  return `M ${x1},${y1} L ${x1},${bendY} Q ${x1},${y2} ${bendX},${y2} L ${x2},${y2}`;
}
