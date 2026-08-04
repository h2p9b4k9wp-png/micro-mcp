'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useGuidedTrial } from '@/lib/use-guided-trial';
import { SESSION_UPLOAD_LIMIT } from '@/lib/guest-trial-limits';
import { CircuitBoard } from '@/components/circuit/circuit-board';
import { renderTrialResult } from '@/components/trial-result-view';
import { CarrotGauge } from '@/components/carrot-gauge';
import { trackFunnelEvent } from '@/lib/funnel-tracking';
import type { CircuitGraphState } from '@/types/blocks';

type DemoPhase = 'idle' | 'running' | 'done';

// 💡 [신규] idle 상태(아직 아무것도 업로드 안 한 방문자)에서 보여주는 "미리보기" 데모 —
// 실제 업로드/분석과는 무관하게 idle→running→done을 계속 순환시켜서, 실제 컴포넌트
// (정적 이미지 아님)로 "이렇게 동작해요"를 보여줍니다. prefers-reduced-motion이면 계속
// 순환시키지 않고 done 상태로 고정합니다 — CircuitBoard 자체의 리빌 애니메이션은 이미 이
// 설정을 존중하지만, 그것과 별개로 "계속 반복 재생"하는 것 자체도 모션이라 여기서도 존중합니다.
function useDemoCircuitPhase(): DemoPhase {
  const [phase, setPhase] = useState<DemoPhase>('idle');

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setPhase('done');
      return;
    }

    const sequence: Array<{ phase: DemoPhase; delay: number }> = [
      { phase: 'running', delay: 600 },
      { phase: 'done', delay: 1800 },
      { phase: 'idle', delay: 4000 },
    ];
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const step = sequence[i];
      timer = setTimeout(() => {
        setPhase(step.phase);
        i = (i + 1) % sequence.length;
        tick();
      }, step.delay);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);

  return phase;
}

function WelcomeCircuitDemo() {
  const phase = useDemoCircuitPhase();
  const graph: CircuitGraphState = {
    nodes: [
      { id: 'guest_upload', layer: 'source', status: phase === 'idle' ? 'idle' : 'done' },
      { id: 'guest_ai_core', layer: 'lens', status: phase === 'running' ? 'running' : phase === 'done' ? 'done' : 'idle' },
      { id: 'questions', layer: 'action', status: phase === 'done' ? 'done' : 'idle' },
      { id: 'digest', layer: 'action', status: phase === 'done' ? 'done' : 'idle' },
    ],
    edges: [
      { from: 'guest_upload', to: 'guest_ai_core' },
      { from: 'guest_ai_core', to: 'questions' },
      { from: 'guest_ai_core', to: 'digest' },
    ],
  };

  return (
    <div className="w-full bg-[#15131A] rounded-[28px] border border-[#2A2632] p-4 sm:p-8" aria-hidden="true">
      <CircuitBoard graph={graph} onNodeClick={() => {}} pannable={false} />
    </div>
  );
}

// 💡 [신규] /welcome 히어로 영역을 그 자리에서 바로 체험할 수 있게 만든 인라인 버전 —
// "지금 체험하기"를 눌러도 페이지 이동 없이 파일 선택창이 뜨고, 히어로 전체가 드래그앤드롭
// 영역이며, 업로드 즉시 URL 변경 없이 회로도 애니메이션 → 결과로 전환됩니다. 실제 업로드
// 검증·API 호출·결과 상태는 components/guest-guided-trial.tsx(로그인 페이지 체험 패널)와
// 완전히 같은 lib/use-guided-trial.ts 훅을 공유합니다 — 그래서 게스트 세션 예산(업로드
// 1건)도 두 진입점 사이에서 자연스럽게 공유됩니다(같은 브라우저의 httpOnly 세션 쿠키 +
// 같은 서버 IP 판정, lib/anonymous-usage.ts).
//
// 결과 카드(renderTrialResult)는 로그인 페이지 버전과 동일한 다크 테마 색상을 그대로 씁니다
// — /welcome은 유일하게 라이트 테마인 페이지라, 다크 배경 위가 아니면 그 색상 조합이 거의
// 안 보입니다. CircuitBoard 자체도 항상 다크로 고정 렌더링되므로, 회로도+결과 카드를 하나의
// 다크 패널(제품 스크린샷처럼) 안에 넣어서 라이트 히어로 위에 자연스럽게 얹었습니다.
export function WelcomeHeroTrial() {
  const t = useTranslations();
  const { limitType, isAnalyzing, uploaded, error, result, uploadRemaining, analyzeFile, reset } = useGuidedTrial();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 업로드가 시작된 뒤(uploaded)나 결과가 있으면 더 이상 마케팅 히어로가 아니라 회로도/결과
  // 화면입니다 — 이 시점부터는 드래그앤드롭도 더 이상 받지 않습니다(다시 하려면 "다시
  // 처음으로"로 리셋).
  const isInteracting = uploaded || result;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      trackFunnelEvent('file_upload');
      void analyzeFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (isInteracting) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      trackFunnelEvent('file_upload');
      void analyzeFile(file);
    }
  };

  // 💡 [신규] 전환 퍼널의 "결과 확인" 단계 — result가 null→값으로 바뀌는 순간(체험 결과가
  // 실제로 화면에 뜨는 시점)에만 기록합니다. 로그인 페이지의 게스트 체험 패널
  // (components/guest-guided-trial.tsx)은 같은 useGuidedTrial 훅을 공유하지만 이
  // useEffect는 여기(컴포넌트 레벨)에만 있어서, 그쪽 트래픽은 이 퍼널에 섞이지 않습니다.
  useEffect(() => {
    if (result) trackFunnelEvent('result_view');
  }, [result]);

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
    <div
      className={`w-full max-w-2xl mx-auto flex flex-col items-center px-6 py-8 sm:py-12 rounded-[32px] transition-colors duration-200 ${
        isDragging ? 'bg-[#FFF0F5] outline-dashed outline-2 outline-[#F4679B] -outline-offset-8' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!isInteracting) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {!isInteracting ? (
        <div key="idle" className="professor-circuit-reveal w-full flex flex-col items-center text-center">
          <h1 className="break-keep text-3xl sm:text-[44px] font-extrabold tracking-tight leading-tight text-[#1C1922] mb-4 max-w-xl">
            {t('landing.headline')}
          </h1>
          <p className="break-keep text-base sm:text-lg text-[#5B5566] leading-relaxed mb-4 max-w-xl">
            {t('landing.subheadline')}
          </p>

          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F4679B] bg-[#FFF0F5] px-3 py-1.5 rounded-full mb-6">
            <span aria-hidden="true">🎓</span>
            <span className="break-keep">{t('landing.professorAppeal')}</span>
          </div>

          {limitType ? (
            <div className="bg-[#FFF0F5] border border-[#F4679B]/30 rounded-2xl px-6 py-5 max-w-sm">
              <div className="flex justify-center mb-2">
                <CarrotGauge
                  ratio={uploadRemaining / SESSION_UPLOAD_LIMIT}
                  countText={t('login.trial.usage.uploadRemaining', { remaining: uploadRemaining, total: SESSION_UPLOAD_LIMIT })}
                />
              </div>
              <p className="break-keep text-sm font-semibold text-[#1C1922] mb-1">
                {t(`login.trial.limit.${limitType === 'session' ? 'uploadSession' : limitType}Title`)}
              </p>
              <p className="break-keep text-xs text-[#5B5566] mb-4">
                {t(`login.trial.limit.${limitType === 'session' ? 'uploadSession' : limitType}Desc`)}
              </p>
              <Link
                href="/login?trial=1"
                className="inline-flex items-center justify-center bg-[#F4679B] hover:bg-[#D1477F] text-white font-semibold text-sm px-6 py-2.5 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
              >
                {t('login.trial.signUpCta')}
              </Link>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center bg-[#F4679B] hover:bg-[#D1477F] text-white font-semibold text-base px-8 py-3.5 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
              >
                {t('landing.ctaButton')}
              </button>
              <p className="text-xs text-[#AFA6BD] mt-3">{t('landing.ctaHint')}</p>
            </>
          )}

          {error && (
            <div className="mt-5 px-4 py-3 rounded-lg text-sm border bg-[#FDEBEA] text-[#B3261E] border-[#F3C6C2] max-w-sm">
              {error}
            </div>
          )}

          <div className="w-full max-w-2xl mt-10">
            <WelcomeCircuitDemo />
          </div>
        </div>
      ) : (
        <div key="result" className="professor-circuit-reveal w-full flex flex-col items-center">
          <div className="w-full bg-[#15131A] rounded-[28px] border border-[#2A2632] p-4 sm:p-8">
            <CircuitBoard graph={graph} onNodeClick={() => {}} pannable={false} />

            {result && (
              <div className="w-full max-w-xl mx-auto flex flex-col gap-3 mt-2 text-left">
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
          </div>

          {error && (
            <div className="mt-5 px-4 py-3 rounded-lg text-sm border bg-[#FDEBEA] text-[#B3261E] border-[#F3C6C2] max-w-sm text-center">
              {error}
            </div>
          )}

          {result && (
            <button
              type="button"
              onClick={reset}
              className="mt-6 text-sm font-semibold text-[#857C93] hover:text-[#F4679B] underline underline-offset-2 transition-colors focus:outline-none"
            >
              {t('landing.startOver')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
