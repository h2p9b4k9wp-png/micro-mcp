'use client';

import { useEffect, useState } from 'react';

// 💡 [신규] 이미 다 받아온 텍스트를 "타자 치듯" 한 글자씩 드러내는 훅.
//
// /api/chat의 스트리밍 답변과는 성격이 완전히 다릅니다 — 그쪽은 실제로 글자가 도착하는
// 중이라 아무 장치가 없어도 조금씩 늘어나지만, 렌즈 분석(/api/analyze)은 Structured
// Outputs라 JSON 하나가 통째로 도착합니다. 그래서 결과가 한 번에 툭 나타나는데, 이걸
// 시간축에 펼쳐 보여주기 위한 순수 표현 장치입니다(네트워크 동작은 그대로).
//
// segments를 배열로 받는 이유: 요약 한 줄과 핵심 항목 여러 개처럼 마크업이 서로 다른
// 조각들을 하나의 타이머로 순서대로 이어서 드러내야 하기 때문입니다. 조각마다 훅을
// 따로 걸면 타이머가 개수만큼 늘고 순서를 맞추기도 어렵습니다.

const TICK_MS = 16;
// 짧은 글에서 너무 빨라 보이지 않도록 하는 최소 속도(틱당 글자 수) — 초당 약 70자.
const MIN_CHARS_PER_TICK = 1.1;
// 긴 글이라고 무한정 기다리게 하지 않기 위한 전체 상한. 글이 길면 틱당 글자 수를 늘려
// 총 소요 시간을 이 값 안쪽으로 맞춥니다.
const MAX_DURATION_MS = 4500;

export interface TypewriterState {
  /** segments와 같은 길이·순서로, 지금까지 드러난 만큼만 잘린 문자열들 */
  parts: string[];
  /** 아직 타이핑 중인지 (건너뛰기 버튼·커서 표시 여부 판단용) */
  isTyping: boolean;
  /** 남은 글자를 즉시 전부 드러냅니다 */
  skip: () => void;
}

/**
 * 💡 이 훅은 마운트 시점의 segments를 기준으로 시작합니다. 새 결과가 왔을 때 다시
 * 타이핑시키려면 호출하는 쪽에서 key를 바꿔 컴포넌트를 새로 마운트하세요
 * (그렇게 하지 않으면 이전 진행도가 남습니다). effect 본문에서 setState를 하지 않으려는
 * 의도적인 설계입니다 — 이 저장소의 ESLint 설정이 그걸 에러로 잡습니다.
 */
export function useTypewriter(segments: string[], enabled = true): TypewriterState {
  const total = segments.reduce((sum, s) => sum + s.length, 0);

  // 접근성: 동작 줄이기를 켠 사용자에겐 애니메이션 없이 처음부터 전부 보여줍니다.
  // 초기값 계산 함수 안에서 한 번만 읽어 렌더 중 window 접근이 반복되지 않게 합니다.
  const [reducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [revealed, setRevealed] = useState(() => (enabled && !reducedMotion ? 0 : total));

  useEffect(() => {
    if (!enabled || reducedMotion || total === 0) return;
    let shown = 0;
    const charsPerTick = Math.max(MIN_CHARS_PER_TICK, total / (MAX_DURATION_MS / TICK_MS));
    const id = setInterval(() => {
      shown = Math.min(total, shown + charsPerTick);
      setRevealed(Math.floor(shown));
      if (shown >= total) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [enabled, reducedMotion, total]);

  const parts: string[] = [];
  let offset = 0;
  for (const segment of segments) {
    parts.push(segment.slice(0, Math.max(0, Math.min(segment.length, revealed - offset))));
    offset += segment.length;
  }

  return { parts, isTyping: revealed < total, skip: () => setRevealed(total) };
}
