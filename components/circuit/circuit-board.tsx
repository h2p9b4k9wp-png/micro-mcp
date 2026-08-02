'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Cpu, Check } from 'lucide-react';
import type { NodeId, NodeLayer, NodeStatus, GraphEdge, CircuitGraphState } from '@/types/blocks';
import { NODE_REGISTRY } from '@/lib/blocks/defaults';
import {
  CIRCUIT_VIEWBOX,
  CIRCUIT_VIEWBOX_VERTICAL,
  getPipelinePosition,
  getPipelinePositionVertical,
  buildCircuitTracePath,
  buildCircuitTracePathVertical,
} from '@/lib/circuit/geometry';
import { Wire } from '@/components/circuit/wire';
import { PannableCanvas } from '@/components/circuit/pannable-canvas';

interface CircuitBoardProps {
  graph: CircuitGraphState;
  onNodeClick: (nodeId: NodeId) => void;
  // 채팅 입력창 위처럼 좁은 자리에 끼워 넣을 때 쓰는 축소 모드 — 제목/열 구분선/팬·줌 없이
  // source·lens 영역만 크롭해서 세로 200px 정도로 표시합니다. 배선·글로우·스파크 로직은 동일합니다.
  compact?: boolean;
  // 💡 [신규] 게스트 가이드 체험처럼 좁은 고정폭 컬럼(로그인 페이지 체험 패널, ~380px)에
  // 놓일 때 씁니다. 기본 비-compact 레이아웃은 가로 배치에 minWidth:480을 요구하고,
  // compact는 action 레이어 자체를 잘라내서 이 용도엔 맞지 않습니다 — 반면 기존 모바일용
  // 세로 배치(renderDiagram('vertical'))는 minWidth 제약이 없어 좁은 컬럼에도 그대로
  // 맞습니다. 이 플래그는 화면 너비와 무관하게 항상 그 세로 배치만 보여주도록
  // sm:hidden/hidden sm:block 분기를 건너뜁니다 — 렌더링 로직 자체는 100% 재사용입니다.
  forceVertical?: boolean;
  // 💡 [신규] PannableCanvas(핀치 확대/드래그 이동)를 씌울지 여부 — 기본 true. 실제로
  // 노드를 클릭해 뭔가 하는 인터랙티브한 곳(교수님 탭 상세, 채팅 입력창 위 미니와이어)은
  // 계속 팬/핀치가 유용하지만, onNodeClick이 사실상 no-op인 순수 장식용 데모(웰컴 히어로
  // 자동 루프 데모, 교수님 데모, 게스트 이미지 체험 결과)는 false로 꺼서 모바일에서 그
  // 영역을 터치했을 때 전선이 드래그로 움직이는 의도치 않은 동작을 막습니다.
  pannable?: boolean;
}

type Orientation = 'horizontal' | 'vertical' | 'compact';

const LAYERS: NodeLayer[] = ['source', 'lens', 'action'];
const edgeKey = (edge: GraphEdge) => `${edge.from}->${edge.to}`;

// compact 모드는 가로 배치(CIRCUIT_VIEWBOX)와 같은 좌표계를 쓰되, source·lens 열만 보이도록
// SVG viewBox로 화면을 크롭합니다 — 위치 계산 로직을 새로 만들 필요가 없습니다.
const COMPACT_VIEWBOX = { x: 60, y: 160, width: 520, height: 240 };

function getStatusVisual(status: NodeStatus) {
  switch (status) {
    case 'running':
      return { borderColor: '#F4679B', glow: true, pulse: true, badge: 'pulse' as const };
    case 'done':
      return { borderColor: '#6EE7B7', glow: false, pulse: false, badge: 'check' as const };
    case 'error':
      return { borderColor: 'var(--accent-danger)', glow: false, pulse: false, badge: 'none' as const };
    default:
      return { borderColor: 'var(--border-default)', glow: false, pulse: false, badge: 'none' as const };
  }
}

export function CircuitBoard({ graph, onNodeClick, compact = false, forceVertical = false, pannable = true }: CircuitBoardProps) {
  const t = useTranslations();
  const [revealedEdges, setRevealedEdges] = useState<Set<string>>(() => new Set());
  const [sparkGeneration, setSparkGeneration] = useState(0);
  const [gatedTooltipId, setGatedTooltipId] = useState<NodeId | null>(null);

  // pannable=false면 PannableCanvas(터치 팬/핀치)를 아예 씌우지 않고 다이어그램을 그대로 둡니다.
  const wrapPannable = (node: React.ReactNode) => (pannable ? <PannableCanvas>{node}</PannableCanvas> : node);

  // 💡 [신규] NODE_REGISTRY의 label/hint는 한국어 고정값이라(CircuitNode 타입상 필수 필드),
  // 실제 렌더에는 nodes.{id}.label/hint 번역으로 덮어씁니다. app/page.tsx의 getNodeMeta와 동일한 패턴.
  const getNodeMeta = (id: NodeId) => {
    const base = NODE_REGISTRY.find((n) => n.id === id);
    if (!base) return undefined;
    return { ...base, label: t(`nodes.${id}.label`), hint: t(`nodes.${id}.hint`) };
  };
  const LAYER_TITLES: Record<NodeLayer, string> = {
    source: t('circuit.layerTitle.source'),
    lens: t('circuit.layerTitle.lens'),
    action: t('circuit.layerTitle.action'),
  };

  // 노드를 열(layer)별로 묶고, 각 노드의 열 안 인덱스를 기억해 위치 계산에 씁니다 (열당 최대 3개 가정).
  const nodesByLayer: Record<NodeLayer, typeof graph.nodes> = { source: [], lens: [], action: [] };
  graph.nodes.forEach((n) => nodesByLayer[n.layer].push(n));

  // compact는 가로 배치와 같은 좌표계를 쓰므로(크롭만 다름) 'horizontal'과 동일하게 계산합니다.
  const positionOf = (nodeId: NodeId, orientation: Orientation) => {
    for (const layer of LAYERS) {
      const idx = nodesByLayer[layer].findIndex((n) => n.id === nodeId);
      if (idx !== -1) {
        return orientation === 'vertical'
          ? getPipelinePositionVertical(layer, idx, nodesByLayer[layer].length)
          : getPipelinePosition(layer, idx, nodesByLayer[layer].length);
      }
    }
    return null;
  };

  const toPercent = (value: number, axis: 'x' | 'y', orientation: Orientation) => {
    if (orientation === 'compact') {
      const origin = axis === 'x' ? COMPACT_VIEWBOX.x : COMPACT_VIEWBOX.y;
      const size = axis === 'x' ? COMPACT_VIEWBOX.width : COMPACT_VIEWBOX.height;
      return ((value - origin) / size) * 100;
    }
    const vb = orientation === 'vertical' ? CIRCUIT_VIEWBOX_VERTICAL : CIRCUIT_VIEWBOX;
    const size = axis === 'x' ? vb.width : vb.height;
    return (value / size) * 100;
  };

  // 스파크는 실행 중 source → lens → action 순서로 순차 재생됩니다(구간 사이 150ms).
  // prefers-reduced-motion이면 애니메이션 없이 완성 상태로 즉시 표시합니다.
  useEffect(() => {
    const nodeLayerById = new Map(graph.nodes.map((n) => [n.id, n.layer] as const));
    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setRevealedEdges(new Set(graph.edges.map(edgeKey)));
      return;
    }

    setRevealedEdges(new Set());
    setSparkGeneration((g) => g + 1);

    const timers: ReturnType<typeof setTimeout>[] = [];
    (['source', 'lens'] as const).forEach((originLayer, step) => {
      const edgesAtStep = graph.edges.filter((e) => nodeLayerById.get(e.from) === originLayer);
      if (edgesAtStep.length === 0) return;
      const timer = setTimeout(() => {
        setRevealedEdges((prev) => {
          const next = new Set(prev);
          edgesAtStep.forEach((e) => next.add(edgeKey(e)));
          return next;
        });
      }, step * 150);
      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, [graph]);

  // 가로/세로/축소 배치가 공유하는 다이어그램 본체 — viewBox·좌표 계산·경로 생성 함수만 방향별로 갈아 끼웁니다.
  function renderDiagram(orientation: Orientation) {
    const isCompact = orientation === 'compact';
    const isVertical = orientation === 'vertical';
    const viewBox = isVertical ? CIRCUIT_VIEWBOX_VERTICAL : CIRCUIT_VIEWBOX;
    const viewBoxStr = isCompact
      ? `${COMPACT_VIEWBOX.x} ${COMPACT_VIEWBOX.y} ${COMPACT_VIEWBOX.width} ${COMPACT_VIEWBOX.height}`
      : `0 0 ${viewBox.width} ${viewBox.height}`;
    const buildPath = isVertical ? buildCircuitTracePathVertical : buildCircuitTracePath;
    const posOrientation: Orientation = isVertical ? 'vertical' : 'horizontal';

    const containerStyle = isCompact
      ? { height: 200, aspectRatio: `${COMPACT_VIEWBOX.width} / ${COMPACT_VIEWBOX.height}` }
      : {
          aspectRatio: `${viewBox.width} / ${viewBox.height}`,
          ...(isVertical ? { maxWidth: 420 } : { maxWidth: 720, minWidth: 480 }),
        };

    return (
      <div className={`relative mx-auto ${isCompact ? '' : 'w-full'}`} style={containerStyle}>
        <svg
          viewBox={viewBoxStr}
          className="absolute inset-0 w-full h-full overflow-visible"
          aria-hidden="true"
        >
          {graph.edges.map((edge) => {
            const from = positionOf(edge.from, posOrientation);
            const to = positionOf(edge.to, posOrientation);
            if (!from || !to) return null;
            const d = buildPath(from.x, from.y, to.x, to.y);
            return (
              <Wire
                key={edgeKey(edge)}
                d={d}
                active={revealedEdges.has(edgeKey(edge))}
                sparkKey={sparkGeneration}
                label={edge.label}
              />
            );
          })}
        </svg>

        {graph.nodes.map((node) => {
          const meta = getNodeMeta(node.id);
          if (!meta) return null;
          const pos = positionOf(node.id, posOrientation);
          if (!pos) return null;

          const isLens = node.layer === 'lens';
          // 이 단계에는 실제 자료실 문서 개수 신호가 없어서, minLibraryDocs가 걸린 노드는
          // 일단 항상 "조건 미달"로 취급해 비활성 표시합니다 (다음 단계에서 실제 개수와 연결 예정).
          const isGated = meta.minLibraryDocs != null;
          const status = getStatusVisual(node.status);
          const tooltipText = isGated
            ? t('circuit.gatedTooltip', { label: meta.label, count: meta.minLibraryDocs ?? 0 })
            : meta.hint;
          const tooltipPinned = gatedTooltipId === node.id;

          return (
            <button
              key={node.id}
              type="button"
              onClick={() => {
                if (isGated) {
                  setGatedTooltipId((prev) => (prev === node.id ? null : node.id));
                  return;
                }
                onNodeClick(node.id);
              }}
              className={`group absolute z-10 flex flex-col items-center justify-center gap-1 transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                isLens ? 'rounded-full' : 'rounded-2xl'
              }`}
              style={{
                left: `${toPercent(pos.x, 'x', orientation)}%`,
                top: `${toPercent(pos.y, 'y', orientation)}%`,
                transform: 'translate(-50%, -50%)',
                width: isLens ? (isCompact ? '60px' : 'clamp(84px, 15vw, 128px)') : isCompact ? '52px' : 'clamp(76px, 13vw, 108px)',
                height: isLens ? (isCompact ? '60px' : 'clamp(84px, 15vw, 128px)') : undefined,
                padding: isLens ? undefined : isCompact ? '6px 4px' : '10px 8px',
                border: `2px solid ${isGated ? 'var(--border-default)' : status.borderColor}`,
                background: isGated
                  ? 'var(--bg-page-alt)'
                  : isLens
                    ? 'radial-gradient(circle, var(--bg-accent-subtle) 0%, var(--bg-page) 70%)'
                    : node.status === 'idle'
                      ? 'var(--bg-page-alt)'
                      : 'var(--bg-accent-subtle)',
                boxShadow: !isGated && status.glow
                  ? isLens
                    ? '0 0 32px 6px rgba(244,103,155,0.4)'
                    : '0 0 16px rgba(244,103,155,0.35)'
                  : 'none',
              }}
            >
              {/* lens 열 노드는 기존 AI 코어의 시각 처리(크기·글로우·로봇 캐릭터)를 그대로 물려받습니다. */}
              {isLens && !isGated && (
                <span
                  className="absolute -inset-2 rounded-full border border-dashed border-[#F4679B]/40 animate-[spin_16s_linear_infinite]"
                  aria-hidden="true"
                />
              )}

              {status.badge === 'pulse' && !isGated && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#F4679B] animate-pulse" />
              )}
              {status.badge === 'check' && !isGated && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[var(--bg-success-subtle)] border border-[var(--border-success-subtle)] flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-[#6EE7B7]" strokeWidth={3} />
                </span>
              )}

              {/* lens 노드는 어떤 lens든 항상 Cpu(로봇 캐릭터, 기존 AI 코어와 동일)를 보여주고,
                  나머지 노드는 각자 자신의 아이콘(NODE_REGISTRY)을 보여줍니다. */}
              {isLens ? (
                <Cpu
                  className={`${isCompact ? 'w-5 h-5' : 'w-6 h-6 sm:w-7 sm:h-7'} ${isGated ? 'text-[var(--text-faint)]' : 'text-[#F4679B]'}`}
                  strokeWidth={1.75}
                />
              ) : (
                <meta.icon
                  className={`${isCompact ? 'w-4 h-4' : 'w-5 h-5 sm:w-6 sm:h-6'} ${isGated ? 'text-[var(--text-faint)]' : 'text-[var(--text-primary)]'}`}
                  strokeWidth={2}
                />
              )}
              <span
                className={`${isCompact ? 'text-[9px]' : 'text-[10px] sm:text-[11px]'} font-semibold text-center leading-tight ${
                  isGated ? 'text-[var(--text-faint)]' : 'text-[var(--text-primary)]'
                }`}
              >
                {meta.label}
              </span>

              {!isLens && !isCompact && (
                <span className="absolute bottom-1 right-1.5 text-[9px] text-[var(--text-faint)]">
                  {t('circuit.estimatedSeconds', { seconds: meta.estimatedSeconds })}
                </span>
              )}

              {/* 노드 설명(또는 게이트 안내) 툴팁 — 호버/포커스 시, 게이트된 노드는 클릭으로도 고정 표시 */}
              <span
                className={`pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] leading-snug text-[var(--text-secondary)] shadow-lg transition-opacity duration-150 z-20 ${
                  tooltipPinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                }`}
              >
                {tooltipText}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="bg-[var(--bg-deep)] rounded-2xl border border-[var(--surface-chip)] p-2">
        {renderDiagram('compact')}
      </div>
    );
  }

  if (forceVertical) {
    return (
      <div className="bg-[var(--bg-deep)] rounded-2xl border border-[var(--surface-chip)] p-3 shadow-sm">
        {wrapPannable(renderDiagram('vertical'))}
      </div>
    );
  }

  return (
    <div>
      {/* 좁은 화면(모바일): 위→아래로 흐르는 세로 배치 + 핀치 확대/축소·드래그 이동(pannable=false면 생략) */}
      <div className="sm:hidden bg-[var(--bg-deep)] rounded-2xl border border-[var(--surface-chip)] p-3 mb-6 shadow-sm">
        {wrapPannable(renderDiagram('vertical'))}
      </div>

      {/* 넓은 화면: 기존 좌→우 3열 파이프라인 배치를 그대로 유지 */}
      <div className="hidden sm:block bg-[var(--bg-deep)] rounded-2xl border border-[var(--surface-chip)] p-3 sm:p-6 mb-6 shadow-sm overflow-x-auto">
        <div className="grid grid-cols-3 max-w-[720px] mx-auto text-center text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wide mb-2">
          {LAYERS.map((layer) => (
            <span key={layer}>{LAYER_TITLES[layer]}</span>
          ))}
        </div>
        {wrapPannable(renderDiagram('horizontal'))}
      </div>
    </div>
  );
}
