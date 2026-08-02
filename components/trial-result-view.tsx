import type { useTranslations } from 'next-intl';
import type { LensId, DeadlinesResult, QuestionsResult, DigestResult } from '@/lib/lenses';

// 💡 [신규] 로그인 없이 체험해본 분석 결과를 보여주는 간단한 렌더러 — app/page.tsx의
// renderLensResult()와 달리 "등록" 같은 저장 액션은 없습니다(로그인 전이라 저장할 계정이
// 없음). 결과를 읽어볼 수만 있고, 실제로 저장하려면 "로그인하고 저장하기" 버튼을 눌러야
// 합니다. 원래 app/login/page.tsx에만 있었는데, 게스트 가이드 체험
// (components/guest-guided-trial.tsx)도 questions/digest 렌즈 결과를 똑같은 모양으로
// 렌더링해야 해서 공용 파일로 뺐습니다.
export function renderTrialResult(
  lens: LensId,
  result: DeadlinesResult | QuestionsResult | DigestResult,
  t: ReturnType<typeof useTranslations>
) {
  if (lens === 'deadlines') {
    const r = result as DeadlinesResult;
    if (r.items.length === 0) {
      return <p className="text-sm text-[var(--text-secondary)]">{t('workspace.lens.noDeadlinesFound')}</p>;
    }
    return (
      <ul className="flex flex-col gap-2.5">
        {r.items.map((item, i) => (
          <li key={i} className="border border-[var(--border-chip-hover)] rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-semibold text-[var(--text-primary)]">{item.title}</span>
              <span className="text-xs font-semibold text-[#F4679B] shrink-0">{item.date}</span>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] italic">&quot;{item.evidence}&quot;</p>
          </li>
        ))}
      </ul>
    );
  }
  if (lens === 'questions') {
    const r = result as QuestionsResult;
    if (r.items.length === 0) {
      return <p className="text-sm text-[var(--text-secondary)]">{t('workspace.lens.noQuestionsFound')}</p>;
    }
    return (
      <ul className="flex flex-col gap-2.5">
        {r.items.map((item, i) => (
          <li key={i} className="border border-[var(--border-chip-hover)] rounded-lg p-3">
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Q. {item.question}</p>
            <p className="text-xs text-[var(--text-oncard)]">A. {item.draftAnswer}</p>
          </li>
        ))}
      </ul>
    );
  }
  const r = result as DigestResult;
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-semibold text-[var(--text-primary)]">{r.summary}</p>
      {r.keyPoints.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {r.keyPoints.map((p, i) => (
            <li key={i} className="text-xs text-[var(--text-oncard)] list-disc list-inside ml-1">{p.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
