'use client';

import { useState, useRef, useLayoutEffect } from 'react';

// 블록 하나 ↔ AI 코어를 잇는 배선 한 가닥. 꺼져있으면 어두운 기본 트레이스만 보이고,
// 켜지는 순간 블록 → 코어 방향으로 빛(스파크)이 한 번 흐른 뒤 배선 전체가 계속 밝게 빛납니다.
export function Wire({ d, active, sparkKey }: { d: string; active: boolean; sparkKey: number }) {
  const pathRef = useRef<SVGPathElement>(null);
  const [length, setLength] = useState(0);

  useLayoutEffect(() => {
    if (pathRef.current) {
      setLength(pathRef.current.getTotalLength());
    }
  }, [d]);

  const dashStyle = {
    strokeDasharray: length,
    strokeDashoffset: active ? 0 : length,
    transition: active
      ? 'stroke-dashoffset 0.7s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease-out'
      : 'opacity 0.5s ease-in',
  };

  return (
    <g>
      {/* 항상 보이는 기본 배선 (꺼져있을 때의 어둡고 흐릿한 회로 트레이스) */}
      <path d={d} stroke="#332C3D" strokeWidth={2.5} fill="none" strokeLinecap="round" />

      {/* 활성화 시 빛나는 배선 — 블러 처리된 은은한 글로우 레이어 */}
      <path
        ref={pathRef}
        d={d}
        stroke="#F4679B"
        strokeWidth={7}
        fill="none"
        strokeLinecap="round"
        opacity={active ? 0.45 : 0}
        style={{ ...dashStyle, filter: 'blur(5px)' }}
      />
      {/* 활성화 시 빛나는 배선 — 선명한 코어 라인 */}
      <path
        d={d}
        stroke="#FCD9E7"
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        opacity={active ? 1 : 0}
        style={dashStyle}
      />

      {/* 전류가 흐르는 듯한 스파크 — 블록이 켜질 때 블록→코어 방향으로 한 번 재생 */}
      {active && length > 0 && (
        <circle key={sparkKey} r={4.5} fill="#FFF0F6">
          <animateMotion dur="0.7s" fill="freeze" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.05;0.85;1" dur="0.7s" fill="freeze" />
        </circle>
      )}
    </g>
  );
}
