'use client';

import type { useTranslations } from 'next-intl';
import { AnswerDisclosure } from '@/components/answer-disclosure';
import { useTypewriter } from '@/components/use-typewriter';
import type {
  LensId,
  DeadlinesResult,
  QuestionsResult,
  DigestResult,
  ExamQuestionsResult,
} from '@/lib/lenses';

// 💡 [신규] 로그인 없이 체험해본 분석 결과를 보여주는 간단한 렌더러 — app/page.tsx의
// renderLensResult()와 달리 "등록" 같은 저장 액션은 없습니다(로그인 전이라 저장할 계정이
// 없음). 결과를 읽어볼 수만 있고, 실제로 저장하려면 "로그인하고 저장하기" 버튼을 눌러야
// 합니다. 원래 app/login/page.tsx에만 있었는데, 게스트 가이드 체험
// (components/guest-guided-trial.tsx)도 questions/digest 렌즈 결과를 똑같은 모양으로
// 렌더링해야 해서 공용 파일로 뺐습니다.
// 💡 [신규] 출처·확신도 표시. "AI가 지어낸 거 아냐?"에 답하기 위한 UI입니다.
//
// 세 가지를 보여줍니다:
//  - 출처: 어느 파일 어디에서 나왔는지("3주차_강의노트.pdf · 12페이지"). 위치는 추출
//    단계에서 본문에 심어둔 실제 표시를 모델이 옮겨 적은 값이라, 모델이 지어낸 페이지
//    번호가 아닙니다(lib/file-text-extract.ts 참고).
//  - 자료 밖 내용 표시: grounded가 false면 "일반 지식" 배지를 답니다.
//  - 확신도: 값과 함께 "왜 그렇게 봤는지"를 자료 근거로 한 줄 붙입니다. 숫자만 있으면
//    그 숫자 자체를 못 믿기 때문에, 이유가 없는 확신도는 아예 표시하지 않습니다.
function SourceBadges({
  item,
  t,
}: {
  item: { sourceFile?: string; sourceLocation?: string; grounded?: boolean; confidence?: number; confidenceReason?: string };
  t: ReturnType<typeof useTranslations>;
}) {
  const where = [item.sourceFile, item.sourceLocation].filter((v) => v && v.trim()).join(' · ');
  const showConfidence = typeof item.confidence === 'number' && !!item.confidenceReason?.trim();
  if (!where && item.grounded !== false && !showConfidence) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {where && (
        <span className="text-[10px] text-[var(--text-muted)] bg-[var(--surface-chip)] px-1.5 py-0.5 rounded">
          📄 {t('workspace.lens.sourceFrom', { where })}
        </span>
      )}
      {item.grounded === false && (
        <span className="text-[10px] font-semibold text-[var(--text-warn)] bg-[var(--bg-warn-subtle)] border border-[var(--border-warn-subtle)] px-1.5 py-0.5 rounded">
          {t('workspace.lens.notFromMaterial')}
        </span>
      )}
      {showConfidence && (
        <span className="text-[10px] text-[var(--text-muted)]">
          {t(
            item.confidence! >= 0.7
              ? 'workspace.lens.confidenceHigh'
              : item.confidence! >= 0.4
                ? 'workspace.lens.confidenceMedium'
                : 'workspace.lens.confidenceLow'
          )}
          {' · '}
          {item.confidenceReason}
        </span>
      )}
    </div>
  );
}

export function renderTrialResult(
  lens: LensId,
  result: DeadlinesResult | QuestionsResult | DigestResult | ExamQuestionsResult,
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
            <p className="text-sm font-semibold text-[var(--text-primary)]">Q. {item.question}</p>
            <AnswerDisclosure
              answer={item.draftAnswer}
              showLabel={t('workspace.lens.showDraftAnswer')}
              hideLabel={t('workspace.lens.hideDraftAnswer')}
            />
          </li>
        ))}
      </ul>
    );
  }
  
  // 💡 [신규] 예상 시험 문제 — questions와 비슷한 카드지만 문항 유형 배지와 모범답안을
  // 함께 보여줍니다("A."가 답변 초안이 아니라 모범답안이라는 점이 다릅니다).
  if (lens === 'examQuestions') {
    const r = result as ExamQuestionsResult;
    if (r.items.length === 0) {
      return <p className="text-sm text-[var(--text-secondary)]">{t('workspace.lens.noExamQuestionsFound')}</p>;
    }
    return (
      <ul className="flex flex-col gap-2.5">
        {r.items.map((item, i) => (
          <li key={i} className="border border-[var(--border-chip-hover)] rounded-lg p-3">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Q{i + 1}. {item.question}</p>
              <span className="shrink-0 text-[11px] font-semibold text-[#F4679B] bg-[var(--bg-accent-subtle)] px-2 py-0.5 rounded-full">
                {item.questionType}
              </span>
            </div>
            <AnswerDisclosure
              answer={item.modelAnswer}
              showLabel={t('workspace.lens.showModelAnswer')}
              hideLabel={t('workspace.lens.hideModelAnswer')}
            />
            <SourceBadges item={item} t={t} />
          </li>
        ))}
      </ul>
    );
  }
  const r = result as DigestResult;
  // 💡 key로 새 결과마다 다시 마운트시켜야 타이핑이 처음부터 다시 시작합니다
  // (useTypewriter가 effect 안에서 상태를 되돌리지 않는 대신 두는 조건 — 그 파일 참고).
  // 요약 문장만으로는 다시 만들었을 때 우연히 같을 수 있어 항목 수까지 함께 넣습니다.
  return <DigestTypewriterView key={`${r.summary}|${r.keyPoints.length}`} result={r} t={t} />;
}

// 💡 [신규] 요약을 한 번에 띄우지 않고 한 글자씩 타자 치듯 드러냅니다. 요약 한 줄이 끝나면
// 이어서 핵심 항목이 하나씩 타이핑됩니다 — 타이머 하나로 순서대로 이어지도록 segments
// 배열을 그대로 넘깁니다.
function DigestTypewriterView({
  result,
  t,
}: {
  result: DigestResult;
  t: ReturnType<typeof useTranslations>;
}) {
  const segments = [result.summary, ...result.keyPoints.map((p) => p.text)];
  const { parts, isTyping, skip } = useTypewriter(segments);

  // 지금 타이핑 중인 조각(= 아직 다 안 나온 첫 조각)에만 커서를 붙입니다.
  const typingIndex = isTyping ? parts.findIndex((part, i) => part.length < segments[i].length) : -1;
  const caret = <span className="typewriter-caret" aria-hidden="true" />;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-semibold text-[var(--text-primary)]">
        {parts[0]}
        {typingIndex === 0 && caret}
      </p>
      {result.keyPoints.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {result.keyPoints.map((p, i) => {
            // 아직 차례가 오지 않은 항목은 자리조차 만들지 않습니다 — 빈 불릿이 미리
            // 줄줄이 떠 있으면 "한 글자씩 나온다"는 느낌이 사라집니다.
            if (parts[i + 1].length === 0) return null;
            return (
              <li key={i} className="text-xs text-[var(--text-oncard)] list-disc list-inside ml-1">
                {parts[i + 1]}
                {typingIndex === i + 1 && caret}
                {/* 타이핑이 끝난 항목에만 출처를 답니다 — 타이핑 중에 배지가 먼저 뜨면 산만합니다. */}
                {typingIndex > i + 1 && <SourceBadges item={p} t={t} />}
              </li>
            );
          })}
        </ul>
      )}
      {isTyping && (
        <button
          type="button"
          onClick={skip}
          className="self-start text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] underline underline-offset-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
        >
          {t('workspace.lens.skipTyping')}
        </button>
      )}
    </div>
  );
}
