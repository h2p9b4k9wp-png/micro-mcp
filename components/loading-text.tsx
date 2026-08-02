'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { pickRandomLoadingMessageIndex } from '@/lib/loading-messages';

// 💡 [수정] 로딩 중 보여주는 문구 — messages/*.json의 loading.messages 목록(로케일별 30개)에서
// 3초마다 무작위로 하나씩 골라 바꿔 보여줍니다. AI 호출 없이 전부 클라이언트에서만
// 처리됩니다. t.raw()로 원본 배열을 가져와 lib/loading-messages.ts의 순수 인덱스 선택
// 함수와 조합합니다. 문구 끝의 점(.)은 app/page.tsx의 전역 CSS(.loading-dots,
// @keyframes loadingDots)가 0.5초 간격으로 순환시킵니다.
export function LoadingText({ className }: { className?: string }) {
  const t = useTranslations();
  const messages = t.raw('loading.messages') as string[];
  const [index, setIndex] = useState(() => pickRandomLoadingMessageIndex(messages.length));

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex(pickRandomLoadingMessageIndex(messages.length));
    }, 3000);
    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <span className={className}>
      {messages[index]}
      <span className="loading-dots" aria-hidden="true" />
    </span>
  );
}
