'use client';

import { useTranslations } from 'next-intl';
import { useGuidedTrial } from '@/lib/use-guided-trial';
import { SESSION_UPLOAD_LIMIT } from '@/lib/guest-trial-limits';
import { CircuitBoard } from '@/components/circuit/circuit-board';
import { renderTrialResult } from '@/components/trial-result-view';
import { GuestLimitBanner } from '@/components/guest-limit-banner';
import { CarrotGauge } from '@/components/carrot-gauge';
import { LoadingText } from '@/components/loading-text';
import type { CircuitGraphState } from '@/types/blocks';

// 💡 [신규] 로그인 없이 사진/캡처본 한 장을 올려 회로도 애니메이션 + 예상 문제 + 요약정리를
// 미리 체험해보는 컴포넌트. app/login/page.tsx의 파일 분석 체험과 같은 "세션당 업로드
// 1건" 예산을 공유합니다(app/api/public-guided-trial, lib/anonymous-usage.ts의
// checkGuestUploadAllowed 참고) — 실제 업로드 검증·API 호출 로직은 lib/use-guided-trial.ts
// 훅에 있고, 이 컴포넌트는 로그인 페이지의 좁은 체험 패널 레이아웃만 담당합니다(넓은 웰컴
// 히어로용은 components/welcome-hero-trial.tsx가 같은 훅으로 별도 레이아웃을 그립니다).
// 💡 [수정] uploadUsed / suppressLimitBanner를 부모(app/login/page.tsx)에서 받습니다.
//
// 이 컴포넌트는 useGuidedTrial 훅으로 "자기가 보낸 요청"의 결과만 알고 있어서, 같은 게스트
// 세션의 업로드 예산을 로그인 페이지의 파일 분석·채팅 첨부가 이미 소진했다는 사실을 알 수
// 없었습니다. 그래서 예산이 0인데도 게이지가 "1/1 남음"으로 뜨고 업로드 영역도 열려 있어,
// 바로 아래 "무료 체험을 다 쓰셨어요" 카드와 같은 화면에서 서로 모순됐습니다(서버는 이미
// 429로 막고 있어 실제로 쓸 수는 없었고, 표시만 어긋난 상태였습니다).
//   - uploadUsed: 부모가 아는 업로드 예산 소진 여부. 게이지를 0으로, 업로드 영역을 비활성으로.
//   - suppressLimitBanner: 체험 전체가 끝나 부모가 맨 아래에 마무리 카드를 띄우는 상황.
//     같은 안내를 두 번 쌓지 않도록 이 섹션의 한도 배너만 감춥니다(비활성 상태는 유지).
export function GuestGuidedTrial({
  onRequestSignUp,
  uploadUsed = false,
  suppressLimitBanner = false,
}: {
  onRequestSignUp: () => void;
  uploadUsed?: boolean;
  suppressLimitBanner?: boolean;
}) {
  const t = useTranslations();
  const { limitType, isAnalyzing, uploaded, error, result, uploadRemaining, analyzeFile } = useGuidedTrial();

  // 훅이 서버 429로 직접 알게 된 한도 + 부모가 알려준 소진 상태를 합칩니다.
  const effectiveLimitType = limitType ?? (uploadUsed ? 'session' : null);
  const effectiveRemaining = uploadUsed ? 0 : uploadRemaining;

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
      { id: 'digest', layer: 'action', status: result ? 'done' : 'idle' },
      { id: 'questions', layer: 'action', status: result ? 'done' : 'idle' },
    ],
    edges: [
      { from: 'guest_upload', to: 'guest_ai_core' },
      { from: 'guest_ai_core', to: 'digest' },
      { from: 'guest_ai_core', to: 'questions' },
    ],
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
          {t('login.trial.guided.sectionTitle')}
        </p>
        <CarrotGauge
          ratio={effectiveRemaining / SESSION_UPLOAD_LIMIT}
          countText={t('login.trial.usage.uploadRemaining', { remaining: effectiveRemaining, total: SESSION_UPLOAD_LIMIT })}
        />
      </div>

      {effectiveLimitType && !result ? (
        // 마무리 카드가 뜨는 상황이면 배너를 겹쳐 쌓지 않고 조용히 비웁니다.
        suppressLimitBanner ? null : (
          <GuestLimitBanner limitType={effectiveLimitType} context="upload" onRequestSignUp={onRequestSignUp} />
        )
      ) : (
        <>
          {!result && (
            <label
              className={`flex flex-col items-center justify-center gap-2 border border-dashed rounded-xl py-10 px-4 text-center transition-colors ${
                isAnalyzing
                  ? 'border-[var(--border-default)] cursor-wait'
                  : uploadUsed
                    ? 'border-[var(--border-default)] opacity-50 cursor-not-allowed'
                    : 'border-[var(--border-strong)] hover:border-[#F4679B]/50 cursor-pointer'
              }`}
            >
              <span className="text-2xl">📎</span>
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                {/* 분석 중에는 무작위 문구 대신 단계 문구를 보여줍니다 — 이유는
                    components/welcome-hero-trial.tsx의 같은 자리 주석 참고. */}
                {isAnalyzing ? (
                  <LoadingText
                    stepsKey="login.trial.guided.progress.steps"
                    longWaitKey="login.trial.guided.progress.longWait"
                  />
                ) : (
                  t('login.trial.guided.chooseImage')
                )}
              </span>
              <span className="text-xs text-[var(--text-faint)]">{t('login.trial.guided.imageHint')}</span>
              {/* accept를 비워둔 이유는 components/welcome-hero-trial.tsx의 같은 input 주석 참고. */}
              <input
                type="file"
                className="hidden"
                disabled={isAnalyzing || uploadUsed}
                onChange={handleFileChange}
              />
            </label>
          )}

          {error && (
            <div className="px-4 py-3 rounded-lg text-sm mt-4 border bg-[var(--bg-error-subtle)] text-[var(--text-error)] border-[var(--border-error-subtle)]">
              {error}
            </div>
          )}

          {(uploaded || result) && (
            <div className="mt-4">
              <CircuitBoard graph={graph} onNodeClick={() => {}} forceVertical pannable={false} />
            </div>
          )}

          {/* 💡 [수정] 요약정리를 예상 문제보다 먼저 보여줍니다 — 올린 자료가 무엇인지
              먼저 확인한 다음 예상 문제로 넘어가는 순서가 자연스럽습니다. 스태거 애니메이션
              지연(300ms)과 위 회로도 노드 순서도 화면에 보이는 순서를 그대로 따라갑니다. */}
          {result && (
            <div className="flex flex-col gap-3 mt-4">
              <div className="professor-circuit-reveal bg-[var(--bg-page)] border border-[var(--border-default)] rounded-xl p-3.5">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2.5">
                  {t('login.trial.guided.summaryTitle')}
                </p>
                {renderTrialResult('digest', result.summary, t)}
              </div>
              <div
                className="professor-circuit-reveal bg-[var(--bg-page)] border border-[var(--border-default)] rounded-xl p-3.5"
                style={{ animationDelay: '300ms' }}
              >
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2.5">
                  {t('login.trial.guided.questionsTitle')}
                </p>
                {renderTrialResult('questions', result.questions, t)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
