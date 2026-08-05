'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { pickRandomLoadingMessageIndex } from '@/lib/loading-messages';

// 문구가 바뀌는 간격 — 기존 무작위 모드와 아래 단계 모드가 같은 리듬을 씁니다.
const ROTATE_INTERVAL_MS = 3000;

// 💡 [신규] "예상보다 오래 걸릴 때" 안심 문구로 넘어가는 시점. 단계 문구(3초 × 4단계 = 12초)가
// 다 지나간 직후라, 정상 속도로 끝나는 요청은 이 문구를 아예 보지 않습니다.
const LONG_WAIT_AFTER_MS = 15000;

interface LoadingTextProps {
  className?: string;
  // 💡 [신규] 단계 모드 — messages/*.json의 문자열 배열 키(예: 'login.trial.guided.progress.steps')를
  // 넘기면 무작위 대신 그 배열을 순서대로 보여줍니다("자료를 읽는 중" → "핵심 내용을 정리하는 중"
  // → …). 마지막 단계에 도달하면 거기서 멈춥니다 — 실제 진행률을 알 수 없는 단발 요청이라
  // 되감아 처음부터 다시 돌면 "끝나긴 하는 건가" 싶은 인상을 주기 때문입니다.
  stepsKey?: string;
  // 단계 모드에서 LONG_WAIT_AFTER_MS가 지나면 이 키의 문구로 교체합니다(안심 문구).
  longWaitKey?: string;
}

// 💡 [수정] 로딩 중 보여주는 문구 — 기본 동작은 그대로입니다: messages/*.json의 loading.messages
// 목록(로케일별 30개)에서 3초마다 무작위로 하나씩 골라 바꿔 보여줍니다. AI 호출 없이 전부
// 클라이언트에서만 처리됩니다. t.raw()로 원본 배열을 가져와 lib/loading-messages.ts의 순수
// 인덱스 선택 함수와 조합합니다. 문구 끝의 점(.)은 전역 CSS(app/globals.css의 .loading-dots,
// @keyframes loadingDots)가 순환시키므로 문구 자체에는 말줄임표를 넣지 않습니다.
//
// 💡 [신규] stepsKey를 넘기면 "단계 모드"로 동작합니다 — 게스트 체험(로그인 없이 자료 하나를
// 올려보는 첫인상 화면)처럼 무작위 잡담보다 "지금 어디까지 왔는지"를 보여주는 게 중요한
// 자리를 위한 것입니다. 별도 컴포넌트를 새로 만들지 않고 이 컴포넌트에 모드를 더한 이유는,
// 점 애니메이션·회전 간격·로케일 배열을 읽는 방식이 완전히 같아서 갈라놓으면 두 곳이
// 어긋나기만 하기 때문입니다.
export function LoadingText({ className, stepsKey, longWaitKey }: LoadingTextProps) {
  const t = useTranslations();
  const randomMessages = t.raw('loading.messages') as string[];
  const steps = stepsKey ? (t.raw(stepsKey) as string[]) : null;
  const isStepMode = Boolean(steps && steps.length > 0);

  const [index, setIndex] = useState(() =>
    isStepMode ? 0 : pickRandomLoadingMessageIndex(randomMessages.length)
  );
  const [isLongWait, setIsLongWait] = useState(false);

  const stepCount = steps?.length ?? 0;
  const randomCount = randomMessages.length;

  useEffect(() => {
    const interval = setInterval(() => {
      // 단계 모드는 순서대로 진행하다 마지막 단계에서 멈추고, 기본 모드는 계속 무작위로 바뀝니다.
      setIndex((prev) => (isStepMode ? Math.min(prev + 1, stepCount - 1) : pickRandomLoadingMessageIndex(randomCount)));
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isStepMode, stepCount, randomCount]);

  useEffect(() => {
    if (!isStepMode || !longWaitKey) return;
    const timer = setTimeout(() => setIsLongWait(true), LONG_WAIT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [isStepMode, longWaitKey]);

  const text =
    isStepMode && longWaitKey && isLongWait
      ? t(longWaitKey)
      : isStepMode
        ? steps![Math.min(index, stepCount - 1)]
        : randomMessages[index];

  return (
    <span className={className}>
      {text}
      <span className="loading-dots" aria-hidden="true" />
    </span>
  );
}
