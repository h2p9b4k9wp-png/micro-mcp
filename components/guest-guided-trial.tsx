'use client';

import { useTranslations } from 'next-intl';
import { useGuidedTrial } from '@/lib/use-guided-trial';
import { CircuitBoard } from '@/components/circuit/circuit-board';
import { renderTrialResult } from '@/components/trial-result-view';
import { GuestLimitBanner } from '@/components/guest-limit-banner';
import type { CircuitGraphState } from '@/types/blocks';

// 💡 [신규] 로그인 없이 사진/캡처본 한 장을 올려 회로도 애니메이션 + 예상 문제 + 요약정리를
// 미리 체험해보는 컴포넌트. app/login/page.tsx의 파일 분석 체험과 같은 "세션당 업로드
// 1건" 예산을 공유합니다(app/api/public-guided-trial, lib/anonymous-usage.ts의
// checkGuestUploadAllowed 참고) — 실제 업로드 검증·API 호출 로직은 lib/use-guided-trial.ts
// 훅에 있고, 이 컴포넌트는 로그인 페이지의 좁은 체험 패널 레이아웃만 담당합니다(넓은 웰컴
// 히어로용은 components/welcome-hero-trial.tsx가 같은 훅으로 별도 레이아웃을 그립니다).
export function GuestGuidedTrial({ onRequestSignUp }: { onRequestSignUp: () => void }) {
  const t = useTranslations();
  const { limitType, isAnalyzing, uploaded, error, result, analyzeFile } = useGuidedTrial();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await analyzeFile(file);
  };

  const graph: CircuitGraphState = {
    nodes: [
      { id: 'guest_upload', layer: 'source', status: uploaded ? 'done' : 'idle' },
      { id: 'guest_ai_core', layer: 'lens', status: isAnalyzing ? 'running' : result ? 'done' : 'idle' },
      { id: 'questions', layer: 'action', status: result ? 'done' : 'idle' },
      { id: 'digest', layer: 'action', status: result ? 'done' : 'idle' },
    ],
    edges: [
      { from: 'guest_upload', to: 'guest_ai_core' },
      { from: 'guest_ai_core', to: 'questions' },
      { from: 'guest_ai_core', to: 'digest' },
    ],
  };

  return (
    <div>
      <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-2.5">
        {t('login.trial.guided.sectionTitle')}
      </p>

      {limitType && !result ? (
        <GuestLimitBanner limitType={limitType} context="upload" onRequestSignUp={onRequestSignUp} />
      ) : (
        <>
          {!result && (
            <label
              className={`flex flex-col items-center justify-center gap-2 border border-dashed rounded-xl py-10 px-4 text-center transition-colors ${
                isAnalyzing ? 'border-[#322D3B] cursor-wait' : 'border-[#423B4C] hover:border-[#F4679B]/50 cursor-pointer'
              }`}
            >
              <span className="text-2xl">📸</span>
              <span className="text-sm font-medium text-[#C9C0D6]">
                {isAnalyzing ? t('login.trial.guided.analyzing') : t('login.trial.guided.chooseImage')}
              </span>
              <span className="text-xs text-[#5B5566]">{t('login.trial.guided.imageHint')}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={isAnalyzing}
                onChange={handleFileChange}
              />
            </label>
          )}

          {error && (
            <div className="px-4 py-3 rounded-lg text-sm mt-4 border bg-[#35201D] text-[#FF9585] border-[#63392F]">
              {error}
            </div>
          )}

          {(uploaded || result) && (
            <div className="mt-4">
              <CircuitBoard graph={graph} onNodeClick={() => {}} forceVertical />
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-3 mt-4">
              <div className="professor-circuit-reveal bg-[#211E28] border border-[#322D3B] rounded-xl p-3.5">
                <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-2.5">
                  {t('login.trial.guided.questionsTitle')}
                </p>
                {renderTrialResult('questions', result.questions, t)}
              </div>
              <div
                className="professor-circuit-reveal bg-[#211E28] border border-[#322D3B] rounded-xl p-3.5"
                style={{ animationDelay: '300ms' }}
              >
                <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-2.5">
                  {t('login.trial.guided.summaryTitle')}
                </p>
                {renderTrialResult('digest', result.summary, t)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
