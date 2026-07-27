'use client';

import { useState, useEffect } from 'react';
import { pickRandomLoadingMessage } from '@/lib/loading-messages';

// 로딩 중 보여주는 문구 — lib/loading-messages.ts의 목록에서 3초마다 무작위로 하나씩 골라
// 바꿔 보여줍니다. AI 호출 없이 전부 클라이언트에서만 처리됩니다. 문구 끝의 점(.)은
// app/page.tsx의 전역 CSS(.loading-dots, @keyframes loadingDots)가 0.5초 간격으로 순환시킵니다.
export function LoadingText({ className }: { className?: string }) {
  const [message, setMessage] = useState(() => pickRandomLoadingMessage());

  useEffect(() => {
    const interval = setInterval(() => {
      setMessage(pickRandomLoadingMessage());
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className={className}>
      {message}
      <span className="loading-dots" aria-hidden="true" />
    </span>
  );
}
