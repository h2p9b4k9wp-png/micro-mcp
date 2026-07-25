'use client';

import { Cpu } from 'lucide-react';
import type { McpBlock } from '@/types/blocks';
import { CIRCUIT_VIEWBOX, CIRCUIT_CORE, getCircuitNodePosition, buildCircuitTracePath } from '@/lib/circuit/geometry';
import { Wire } from '@/components/circuit/wire';

interface CircuitBoardProps {
  blocks: McpBlock[];
  onToggle: (block: McpBlock) => void;
  sparkKeys: Record<string, number>;
}

export function CircuitBoard({ blocks, onToggle, sparkKeys }: CircuitBoardProps) {
  const activeCount = blocks.filter((b) => b.active).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
          MCP 블록 매니저
        </h1>
        <p className="text-[#AFA6BD] text-xs sm:text-sm mt-1.5">
          블록을 누르면 AI 코어로 연결된 회로에 전류가 흐르듯 켜집니다. 설정은 브라우저에 안전하게 영구 저장됩니다.
        </p>
      </div>

      {/* 회로도 다이어그램 */}
      <div className="bg-[#0D0B11] rounded-2xl border border-[#2A2632] p-3 sm:p-6 mb-6 shadow-sm overflow-x-auto">
        <div
          className="relative mx-auto w-full max-w-[720px]"
          style={{ aspectRatio: `${CIRCUIT_VIEWBOX.width} / ${CIRCUIT_VIEWBOX.height}`, minWidth: 480 }}
        >
          <svg
            viewBox={`0 0 ${CIRCUIT_VIEWBOX.width} ${CIRCUIT_VIEWBOX.height}`}
            className="absolute inset-0 w-full h-full overflow-visible"
            aria-hidden="true"
          >
            {blocks.map((block, i) => {
              const pos = getCircuitNodePosition(i, blocks.length);
              const d = buildCircuitTracePath(pos.x, pos.y, CIRCUIT_CORE.x, CIRCUIT_CORE.y);
              return <Wire key={block.id} d={d} active={block.active} sparkKey={sparkKeys[block.id] || 0} />;
            })}
          </svg>

          {/* AI 코어 허브 */}
          <div
            className="absolute z-10 flex flex-col items-center justify-center gap-1 rounded-full border-2 transition-shadow duration-700"
            style={{
              left: `${(CIRCUIT_CORE.x / CIRCUIT_VIEWBOX.width) * 100}%`,
              top: `${(CIRCUIT_CORE.y / CIRCUIT_VIEWBOX.height) * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: 'clamp(84px, 15vw, 128px)',
              height: 'clamp(84px, 15vw, 128px)',
              borderColor: activeCount > 0 ? '#F4679B' : '#332C3D',
              background: activeCount > 0
                ? 'radial-gradient(circle, #331F29 0%, #211E28 70%)'
                : '#1C1922',
              boxShadow: activeCount > 0
                ? `0 0 ${18 + activeCount * 10}px ${2 + activeCount}px rgba(244,103,155,${0.28 + activeCount * 0.09})`
                : 'none',
            }}
          >
            {activeCount > 0 && (
              <span
                className="absolute -inset-2 rounded-full border border-dashed border-[#F4679B]/40 animate-[spin_16s_linear_infinite]"
                aria-hidden="true"
              />
            )}
            <Cpu className={`w-6 h-6 sm:w-7 sm:h-7 ${activeCount > 0 ? 'text-[#F4679B]' : 'text-[#5B5566]'}`} strokeWidth={1.75} />
            <span className={`text-[10px] sm:text-[11px] font-bold tracking-wide ${activeCount > 0 ? 'text-[#F5F2F7]' : 'text-[#5B5566]'}`}>
              AI 코어
            </span>
          </div>

          {/* 블록 노드 */}
          {blocks.map((block, i) => {
            const pos = getCircuitNodePosition(i, blocks.length);
            return (
              <button
                key={block.id}
                type="button"
                onClick={() => onToggle(block)}
                className="group absolute z-10 flex flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2.5 transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                style={{
                  left: `${(pos.x / CIRCUIT_VIEWBOX.width) * 100}%`,
                  top: `${(pos.y / CIRCUIT_VIEWBOX.height) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 'clamp(76px, 13vw, 108px)',
                  borderColor: block.active ? '#F4679B' : '#322D3B',
                  background: block.active ? '#2A1520' : '#1C1922',
                  boxShadow: block.active ? '0 0 16px rgba(244,103,155,0.35)' : 'none',
                }}
              >
                {block.active && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#F4679B] animate-pulse" />
                )}
                <block.icon
                  className={`w-5 h-5 sm:w-6 sm:h-6 ${block.active ? 'text-[#F4679B]' : 'text-[#5B5566]'}`}
                  strokeWidth={2}
                />
                <span className={`text-[10px] sm:text-[11px] font-semibold text-center leading-tight ${block.active ? 'text-[#F5F2F7]' : 'text-[#7A7286]'}`}>
                  {block.name}
                </span>

                {/* 설명 툴팁 (호버/포커스 시에만 표시) */}
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg border border-[#322D3B] bg-[#15131A] px-3 py-2 text-[11px] leading-snug text-[#C9C0D6] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 z-20">
                  {block.description}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-center text-[11px] sm:text-xs text-[#857C93] mt-3 sm:mt-4">
          {activeCount === 0
            ? '활성화된 블록이 없어요 — 노드를 눌러 회로를 연결해보세요'
            : `${blocks.length}개 중 ${activeCount}개 블록이 AI 코어에 연결되어 있어요`}
        </p>
      </div>

      {/* 블록 목록 — 상세 설명과 켜기/끄기 버튼 */}
      <div className="flex flex-col gap-2.5">
        {blocks.map((block) => (
          <div
            key={block.id}
            className={`rounded-xl border p-3.5 sm:p-4 flex items-center gap-3 transition-colors ${
              block.active ? 'border-[#F4679B]/30 bg-[#211E28]' : 'border-[#322D3B] bg-[#1C1922]'
            }`}
          >
            <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${block.active ? 'bg-[#331F29] text-[#F4679B]' : 'bg-[#15131A] text-[#5B5566]'}`}>
              <block.icon className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[#F5F2F7] truncate">{block.name}</span>
                <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${block.active ? 'bg-[#F4679B] animate-pulse' : 'bg-[#423B4C]'}`} />
              </div>
              <p className="text-xs text-[#AFA6BD] leading-normal mt-0.5">{block.description}</p>
            </div>
            <button
              onClick={() => onToggle(block)}
              className={`shrink-0 border rounded-lg px-3.5 py-2 text-xs font-semibold cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                block.active
                  ? 'bg-[#1B3328] text-[#6EE7B7] border-[#37604D] hover:bg-[#234438]'
                  : 'bg-[#F4679B] text-white border-transparent hover:bg-[#D1477F]'
              }`}
            >
              {block.active ? '끄기' : '켜기'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
