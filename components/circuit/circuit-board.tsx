'use client';

import { useState, useEffect } from 'react';
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
}

type Orientation = 'horizontal' | 'vertical';

const LAYERS: NodeLayer[] = ['source', 'lens', 'action'];
const LAYER_TITLES: Record<NodeLayer, string> = { source: '파일', lens: '분석', action: '결과' };
const edgeKey = (edge: GraphEdge) => `${edge.from}->${edge.to}`;

function getNodeMeta(id: NodeId) {
  return NODE_REGISTRY.find((n) => n.id === id);
}

function getStatusVisual(status: NodeStatus) {
  switch (status) {
    case 'running':
      return { borderColor: '#F4679B', glow: true, pulse: true, badge: 'pulse' as const };
    case 'done':
      return { borderColor: '#6EE7B7', glow: false, pulse: false, badge: 'check' as const };
    case 'error':
      return { borderColor: '#FF7A6B', glow: false, pulse: false, badge: 'none' as const };
    default:
      return { borderColor: '#322D3B', glow: false, pulse: false, badge: 'none' as const };
  }
}

export function CircuitBoard({ graph, onNodeClick }: CircuitBoardProps) {
  const [revealedEdges, setRevealedEdges] = useState<Set<string>>(() => new Set());
  const [sparkGeneration, setSparkGeneration] = useState(0);
  const [gatedTooltipId, setGatedTooltipId] = useState<NodeId | null>(null);

  // 노드를 열(layer)별로 묶고, 각 노드의 열 안 인덱스를 기억해 위치 계산에 씁니다 (열당 최대 3개 가정).
  const nodesByLayer: Record<NodeLayer, typeof graph.nodes> = { source: [], lens: [], action: [] };
  graph.nodes.forEach((n) => nodesByLayer[n.layer].push(n));

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

  // 가로/세로 배치가 공유하는 다이어그램 본체 — viewBox·좌표 계산·경로 생성 함수만 방향별로 갈아 끼웁니다.
  function renderDiagram(orientation: Orientation) {
    const viewBox = orientation === 'vertical' ? CIRCUIT_VIEWBOX_VERTICAL : CIRCUIT_VIEWBOX;
    const buildPath = orientation === 'vertical' ? buildCircuitTracePathVertical : buildCircuitTracePath;

    return (
      <div
        className="relative mx-auto w-full"
        style={{
          aspectRatio: `${viewBox.width} / ${viewBox.height}`,
          ...(orientation === 'vertical' ? { maxWidth: 420 } : { maxWidth: 720, minWidth: 480 }),
        }}
      >
        <svg
          viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
          className="absolute inset-0 w-full h-full overflow-visible"
          aria-hidden="true"
        >
          {graph.edges.map((edge) => {
            const from = positionOf(edge.from, orientation);
            const to = positionOf(edge.to, orientation);
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
          const pos = positionOf(node.id, orientation);
          if (!pos) return null;

          const isLens = node.layer === 'lens';
          // 이 단계에는 실제 자료실 문서 개수 신호가 없어서, minLibraryDocs가 걸린 노드는
          // 일단 항상 "조건 미달"로 취급해 비활성 표시합니다 (다음 단계에서 실제 개수와 연결 예정).
          const isGated = meta.minLibraryDocs != null;
          const status = getStatusVisual(node.status);
          const tooltipText = isGated
            ? `${meta.label}은(는) 내 자료실에 문서가 ${meta.minLibraryDocs}개 이상 있어야 써볼 수 있어요`
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
                left: `${(pos.x / viewBox.width) * 100}%`,
                top: `${(pos.y / viewBox.height) * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: isLens ? 'clamp(84px, 15vw, 128px)' : 'clamp(76px, 13vw, 108px)',
                height: isLens ? 'clamp(84px, 15vw, 128px)' : undefined,
                padding: isLens ? undefined : '10px 8px',
                border: `2px solid ${isGated ? '#322D3B' : status.borderColor}`,
                background: isGated
                  ? '#1C1922'
                  : isLens
                    ? 'radial-gradient(circle, #331F29 0%, #211E28 70%)'
                    : node.status === 'idle'
                      ? '#1C1922'
                      : '#2A1520',
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
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[#1B3328] border border-[#37604D] flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-[#6EE7B7]" strokeWidth={3} />
                </span>
              )}

              {/* lens 노드는 어떤 lens든 항상 Cpu(로봇 캐릭터, 기존 AI 코어와 동일)를 보여주고,
                  나머지 노드는 각자 자신의 아이콘(NODE_REGISTRY)을 보여줍니다. */}
              {isLens ? (
                <Cpu className={`w-6 h-6 sm:w-7 sm:h-7 ${isGated ? 'text-[#5B5566]' : 'text-[#F4679B]'}`} strokeWidth={1.75} />
              ) : (
                <meta.icon
                  className={`w-5 h-5 sm:w-6 sm:h-6 ${isGated ? 'text-[#5B5566]' : 'text-[#F5F2F7]'}`}
                  strokeWidth={2}
                />
              )}
              <span
                className={`text-[10px] sm:text-[11px] font-semibold text-center leading-tight ${
                  isGated ? 'text-[#5B5566]' : 'text-[#F5F2F7]'
                }`}
              >
                {meta.label}
              </span>

              {!isLens && (
                <span className="absolute bottom-1 right-1.5 text-[9px] text-[#5B5566]">
                  ~{meta.estimatedSeconds}초
                </span>
              )}

              {/* 노드 설명(또는 게이트 안내) 툴팁 — 호버/포커스 시, 게이트된 노드는 클릭으로도 고정 표시 */}
              <span
                className={`pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg border border-[#322D3B] bg-[#15131A] px-3 py-2 text-[11px] leading-snug text-[#C9C0D6] shadow-lg transition-opacity duration-150 z-20 ${
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

  return (
    <div>
      {/* 좁은 화면(모바일): 위→아래로 흐르는 세로 배치 + 핀치 확대/축소·드래그 이동 */}
      <div className="sm:hidden bg-[#0D0B11] rounded-2xl border border-[#2A2632] p-3 mb-6 shadow-sm">
        <PannableCanvas>{renderDiagram('vertical')}</PannableCanvas>
      </div>

      {/* 넓은 화면: 기존 좌→우 3열 파이프라인 배치를 그대로 유지 */}
      <div className="hidden sm:block bg-[#0D0B11] rounded-2xl border border-[#2A2632] p-3 sm:p-6 mb-6 shadow-sm overflow-x-auto">
        <div className="grid grid-cols-3 max-w-[720px] mx-auto text-center text-[11px] font-semibold text-[#5B5566] uppercase tracking-wide mb-2">
          {LAYERS.map((layer) => (
            <span key={layer}>{LAYER_TITLES[layer]}</span>
          ))}
        </div>
        <PannableCanvas>{renderDiagram('horizontal')}</PannableCanvas>
      </div>
    </div>
  );
}
