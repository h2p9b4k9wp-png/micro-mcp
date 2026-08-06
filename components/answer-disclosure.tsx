'use client';

import { useState } from 'react';

// 💡 [신규] 예상 질문·예상 시험 문제의 답을 처음엔 가려두고, 버튼을 눌러야 보이게 합니다.
// 문제와 답이 함께 떠 있으면 스스로 풀어볼 기회가 사라져서, 결과물이 "공부 도구"가 아니라
// 그냥 읽을거리가 됩니다.
//
// 컴포넌트로 뺀 이유는 재사용 말고도 하나 더 있습니다: app/page.tsx의 renderLensResult()는
// 중간에 return이 여러 번 있는 평범한 함수라 그 안에서 훅을 부를 수 없습니다. 열림 상태를
// 각 항목이 직접 들고 있는 컴포넌트로 만들면, 그 함수는 JSX만 반환하면 되므로 훅 규칙을
// 건드리지 않고 그대로 쓸 수 있습니다.
export function AnswerDisclosure({
  answer,
  showLabel,
  hideLabel,
  answerClassName = 'text-xs text-[var(--text-oncard)]',
}: {
  answer: string;
  showLabel: string;
  hideLabel: string;
  answerClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-[var(--border-accent-subtle)] bg-[var(--surface-chip)] text-[#F4679B] hover:bg-[var(--border-chip-hover)] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
      >
        {isOpen ? hideLabel : showLabel}
      </button>
      {isOpen && <p className={`${answerClassName} mt-2`}>{answer}</p>}
    </div>
  );
}
