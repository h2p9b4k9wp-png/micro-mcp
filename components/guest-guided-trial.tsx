'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { QuestionsResult, DigestResult } from '@/lib/lenses';
import { SUPPORTED_CHAT_IMAGE_MIME_TYPES, resizeImageDataUrl } from '@/lib/image-constraints';
import { MAX_ANONYMOUS_UPLOAD_BYTES } from '@/lib/upload-limits';
import { CircuitBoard } from '@/components/circuit/circuit-board';
import { renderTrialResult } from '@/components/trial-result-view';
import type { CircuitGraphState } from '@/types/blocks';

// 💡 [신규] 서버(app/api/public-guided-trial)가 IP당 평생 1회로 최종 판정하지만, 같은
// 브라우저에서 재시도했을 때 업로드 다이얼로그를 다시 보여줬다가 429로 튕기는 것보다,
// 로컬에 "이미 썼다"를 남겨서 처음부터 안내 배너를 보여주는 게 낫습니다 — 서버가 항상
// 최종 권한을 가지므로(private 모드 등으로 이 값이 사라져도 서버가 다시 막습니다), 이건
// 순전히 UX 개선용입니다.
const GUIDED_TRIAL_DONE_KEY = 'cramly_guest_guided_trial_done';

interface GuidedTrialResult {
  questions: QuestionsResult;
  summary: DigestResult;
}

// 💡 [신규] 로그인 없이 사진/캡처본 한 장을 올려 회로도 애니메이션 + 예상 문제 + 요약정리를
// 미리 체험해보는 컴포넌트. app/login/page.tsx의 기존 파일 분석·AI 채팅 체험과는 남용 방지
// 예산이 완전히 분리돼 있습니다(세션당/IP당 평생 1회, app/api/public-guided-trial 참고) —
// 그래서 기존 guestLimitInfo(시간당/일일 공유 예산)와 엮지 않고 이 컴포넌트가 자기 상태를
// 스스로 관리합니다.
export function GuestGuidedTrial({ onRequestSignUp }: { onRequestSignUp: () => void }) {
  const t = useTranslations();
  const [isDone, setIsDone] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuidedTrialResult | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(GUIDED_TRIAL_DONE_KEY) === '1') {
        setIsDone(true);
      }
    } catch {
      // localStorage 접근 불가(프라이빗 모드 등) — 서버가 최종적으로 막아주므로 그냥 무시합니다.
    }
  }, []);

  const markDone = () => {
    setIsDone(true);
    try {
      localStorage.setItem(GUIDED_TRIAL_DONE_KEY, '1');
    } catch {
      // ignore
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!SUPPORTED_CHAT_IMAGE_MIME_TYPES.includes(file.type)) {
      setError(t('login.trial.guided.unsupportedFormat'));
      return;
    }
    if (file.size > MAX_ANONYMOUS_UPLOAD_BYTES) {
      setError(t('login.trial.guided.tooLarge'));
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setUploaded(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error(t('login.trial.readError')));
        reader.readAsDataURL(file);
      });
      const resized = await resizeImageDataUrl(dataUrl);
      const commaIndex = resized.indexOf(',');
      const base64Content = commaIndex !== -1 ? resized.substring(commaIndex + 1) : resized;
      const mimeMatch = resized.match(/^data:([^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : file.type;

      const res = await fetch('/api/public-guided-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType, content: base64Content }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.limitReached) {
          markDone();
          return;
        }
        setError(data.error || t('login.trial.genericError'));
        return;
      }
      setResult({ questions: data.questions, summary: data.summary });
      markDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.trial.genericError'));
    } finally {
      setIsAnalyzing(false);
    }
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

  const limitBanner = (
    <div className="bg-[#331F29] border border-[#F4679B]/40 rounded-xl p-4 text-center">
      <p className="text-sm text-[#F5F2F7] font-semibold mb-1">{t('login.trial.guided.limitReachedTitle')}</p>
      <p className="text-xs text-[#C9C0D6] mb-3">{t('login.trial.guided.limitReachedDesc')}</p>
      <button
        onClick={onRequestSignUp}
        className="w-full py-2 rounded-lg border-none bg-[#F4679B] text-white font-semibold text-sm cursor-pointer hover:bg-[#D1477F] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
      >
        {t('login.trial.signUpCta')}
      </button>
    </div>
  );

  return (
    <div>
      <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-2.5">
        {t('login.trial.guided.sectionTitle')}
      </p>

      {isDone && !result ? (
        limitBanner
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

              <div className="mt-1">{limitBanner}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
