'use client';

import type { useTranslations } from 'next-intl';
import { GraduationCap, Upload, Sparkles } from 'lucide-react';

// 💡 [신규] 가입 직후 딱 한 번 보여주는 3단계 안내.
//
// 지금까지 신규 사용자와 100번째 방문자가 완전히 같은 화면을 봤습니다. 물어보기 탭의
// 예시 프롬프트가 유일한 안내였는데, 그건 "채팅에 뭘 물어볼까"만 알려주고 이 앱의 핵심인
// 교수님 탭의 존재 자체를 알려주지 않습니다. 그 공백을 메웁니다.
//
// 각 단계는 읽고 넘기는 문구가 아니라 버튼입니다 — 누르면 해당 탭으로 바로 이동하고
// 모달이 닫힙니다. 읽기 전용으로 두면 "알겠다"고 닫은 뒤 결국 어디로 가야 하는지 다시
// 찾아야 합니다.
//
// 표시 여부·기록은 이 컴포넌트가 관여하지 않습니다(app/page.tsx가 판단) — 이 파일은
// 화면만 그립니다.

export type OnboardingStepTarget = 'workspace';

const STEPS: { key: '1' | '2' | '3'; target: OnboardingStepTarget; icon: typeof GraduationCap }[] = [
  { key: '1', target: 'workspace', icon: GraduationCap },
  { key: '2', target: 'workspace', icon: Upload },
  { key: '3', target: 'workspace', icon: Sparkles },
];

export function OnboardingModal({
  onSelectStep,
  onClose,
  t,
}: {
  /** 단계를 누르면 그 탭으로 이동시킵니다. 호출부가 닫기 처리도 함께 합니다. */
  onSelectStep: (target: OnboardingStepTarget) => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('onboarding.title')}
    >
      <div
        className="bg-[var(--bg-page)] border border-[var(--border-default)] rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-extrabold text-[var(--text-primary)] text-center">
          {t('onboarding.title')}
        </h2>

        <div className="flex flex-col gap-2.5 mt-5">
          {STEPS.map((step, i) => (
            <button
              key={step.key}
              type="button"
              onClick={() => onSelectStep(step.target)}
              className="flex items-start gap-3 text-left rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[#F4679B] hover:bg-[var(--bg-accent-subtle)] px-4 py-3 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
            >
              <span className="shrink-0 w-7 h-7 rounded-full bg-[var(--bg-accent-subtle)] text-[#F4679B] flex items-center justify-center">
                <step.icon className="w-4 h-4" strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-[var(--text-primary)]">
                  {i + 1}. {t(`onboarding.steps.${step.key}.title`)}
                </span>
                <span className="block text-xs text-[var(--text-tertiary)] mt-0.5 leading-relaxed">
                  {t(`onboarding.steps.${step.key}.desc`)}
                </span>
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full bg-[#F4679B] hover:bg-[#D1477F] text-white px-5 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
        >
          {t('onboarding.start')}
        </button>
      </div>
    </div>
  );
}
