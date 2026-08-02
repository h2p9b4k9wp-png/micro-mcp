'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

const MIN_SCALE = 0.6;
const MAX_SCALE = 3;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function touchDistance(a: React.Touch | Touch, b: React.Touch | Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

interface Gesture {
  mode: 'pan' | 'pinch';
  startDistance: number;
  startScale: number;
  startClientX: number;
  startClientY: number;
  startTranslateX: number;
  startTranslateY: number;
}

// 💡 [신규] 손가락 핀치 확대/축소 + 드래그 이동을 지원하는 회로도 캔버스 래퍼.
// React의 합성 터치 이벤트는 touchmove를 passive로 등록해 preventDefault가 먹지 않을 수 있어,
// ref에 네이티브 리스너를 직접 { passive: false }로 붙입니다.
export function PannableCanvas({ children }: { children: React.ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const transformRef = useRef(transform);
  const gestureRef = useRef<Gesture | null>(null);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        gestureRef.current = {
          mode: 'pinch',
          startDistance: touchDistance(e.touches[0], e.touches[1]),
          startScale: transformRef.current.scale,
          startClientX: 0,
          startClientY: 0,
          startTranslateX: transformRef.current.x,
          startTranslateY: transformRef.current.y,
        };
      } else if (e.touches.length === 1) {
        gestureRef.current = {
          mode: 'pan',
          startDistance: 0,
          startScale: transformRef.current.scale,
          startClientX: e.touches[0].clientX,
          startClientY: e.touches[0].clientY,
          startTranslateX: transformRef.current.x,
          startTranslateY: transformRef.current.y,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;

      if (gesture.mode === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        const distance = touchDistance(e.touches[0], e.touches[1]);
        const nextScale = clamp(gesture.startScale * (distance / gesture.startDistance), MIN_SCALE, MAX_SCALE);
        setTransform((prev) => ({ ...prev, scale: nextScale }));
      } else if (gesture.mode === 'pan' && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - gesture.startClientX;
        const dy = e.touches[0].clientY - gesture.startClientY;
        setTransform((prev) => ({
          ...prev,
          x: gesture.startTranslateX + dx,
          y: gesture.startTranslateY + dy,
        }));
      }
    };

    const handleTouchEnd = () => {
      gestureRef.current = null;
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  const isTransformed = transform.scale !== 1 || transform.x !== 0 || transform.y !== 0;

  return (
    <div ref={viewportRef} className="relative overflow-hidden" style={{ touchAction: 'none' }}>
      <div
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>

      {isTransformed && (
        <button
          type="button"
          onClick={() => setTransform({ scale: 1, x: 0, y: 0 })}
          aria-label="확대/이동 초기화"
          className="absolute bottom-2 right-2 z-20 flex items-center gap-1 bg-[var(--bg-page)]/90 hover:bg-[var(--surface-chip)] border border-[var(--border-default)] text-[var(--text-secondary)] text-[11px] font-medium px-2.5 py-1.5 rounded-full backdrop-blur cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
        >
          <RotateCcw className="w-3 h-3" strokeWidth={2} />
          초기화
        </button>
      )}
    </div>
  );
}
