'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { QuestionsResult, DigestResult } from '@/lib/lenses';
import { SUPPORTED_CHAT_IMAGE_MIME_TYPES, resizeImageDataUrl } from '@/lib/image-constraints';
import { MAX_ANONYMOUS_UPLOAD_BYTES } from '@/lib/upload-limits';

// 💡 [신규] 서버(app/api/public-guided-trial)가 IP당 평생 1회로 최종 판정하지만, 같은
// 브라우저에서 재시도했을 때 업로드 다이얼로그를 다시 보여줬다가 429로 튕기는 것보다,
// 로컬에 "이미 썼다"를 남겨서 처음부터 안내 배너를 보여주는 게 낫습니다 — 서버가 항상
// 최종 권한을 가지므로(private 모드 등으로 이 값이 사라져도 서버가 다시 막습니다), 이건
// 순전히 UX 개선용입니다. /welcome(히어로 영역)과 /login?trial=1(체험 패널) 둘 다 같은 키를
// 쓰기 때문에, 한쪽에서 이미 썼으면 다른 쪽에서도 곧바로 막힌 상태로 보입니다(같은 오리진의
// localStorage + 같은 서버 IP 기준 판정이라 자연스럽게 공유됩니다).
const GUIDED_TRIAL_DONE_KEY = 'carrotly_guest_guided_trial_done';

export interface GuidedTrialResult {
  questions: QuestionsResult;
  summary: DigestResult;
}

// 💡 [신규] 게스트 가이드 체험(이미지 업로드 → 회로도 애니메이션 + 예상 문제 + 요약정리)의
// 상태 기계 — 원래 components/guest-guided-trial.tsx(로그인 페이지 체험 패널)에만 있었는데,
// components/welcome-hero-trial.tsx(웰컴 페이지 히어로 인라인 체험)도 완전히 같은 업로드
// 검증·API 호출·결과 상태 로직이 필요해서 훅으로 뺐습니다. 두 컴포넌트는 이 훅의 상태를
// 각자 다른 레이아웃(좁은 패널 vs. 넓은 히어로, 드래그앤드롭 유무 등)으로만 다르게 그립니다.
export function useGuidedTrial() {
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

  const analyzeFile = async (file: File) => {
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

  // 💡 "다시 처음으로" — 이번 세션에서 본 결과/에러/업로드 표시만 지웁니다. isDone(서버가
  // 이미 1회를 소진했다고 판정한 상태)은 지우지 않습니다 — 지워버리면 다시 업로드 UI가
  // 보였다가 서버 429로 튕기는 나쁜 경험이 되므로, 리셋 후에도 이미 썼다면 계속 안내
  // 배너가 보이는 게 맞습니다.
  const reset = () => {
    setUploaded(false);
    setError(null);
    setResult(null);
  };

  return { isDone, isAnalyzing, uploaded, error, result, analyzeFile, reset };
}
