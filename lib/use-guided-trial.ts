'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { QuestionsResult, DigestResult } from '@/lib/lenses';
import { SUPPORTED_CHAT_IMAGE_MIME_TYPES, resizeImageDataUrl } from '@/lib/image-constraints';
import { MAX_ANONYMOUS_UPLOAD_BYTES } from '@/lib/upload-limits';
import { SESSION_UPLOAD_LIMIT } from '@/lib/guest-trial-limits';

export interface GuidedTrialResult {
  questions: QuestionsResult;
  summary: DigestResult;
}

// 💡 [수정] 예전엔 IP당 평생 1회였고 그걸 localStorage에 "영원히 끝났다" 플래그로 미러링해
// 미리 보여줬습니다. 지금은 게스트 세션 예산(세션당 업로드 1건, IP당 하루 3세션, 전체 게스트
// 일일 상한)으로 바뀌면서 "한 번 쓰면 영원히 끝"이 더 이상 사실이 아니게 됐습니다 —
// 세션이 새로 시작되면(예: 다음날, 또는 IP가 바뀌면) 다시 쓸 수 있어야 하는데 예전
// localStorage 플래그는 그걸 표현할 수 없습니다. 그래서 이제 순전히 반응형입니다: 서버가
// 실제로 429(limitReached)를 줄 때만 그 이유(limitType: 'session'|'ip'|'global')를 그대로
// 반영합니다 — 미리 짐작해서 UI를 막지 않고, 항상 서버 응답이 최종 진실입니다.
export type GuidedTrialLimitType = 'session' | 'ip' | 'global';

// 💡 [신규] 게스트 가이드 체험(이미지 업로드 → 회로도 애니메이션 + 예상 문제 + 요약정리)의
// 상태 기계 — 원래 components/guest-guided-trial.tsx(로그인 페이지 체험 패널)에만 있었는데,
// components/welcome-hero-trial.tsx(웰컴 페이지 히어로 인라인 체험)도 완전히 같은 업로드
// 검증·API 호출·결과 상태 로직이 필요해서 훅으로 뺐습니다. 두 컴포넌트는 이 훅의 상태를
// 각자 다른 레이아웃(좁은 패널 vs. 넓은 히어로, 드래그앤드롭 유무 등)으로만 다르게 그립니다.
export function useGuidedTrial() {
  const t = useTranslations();
  const [limitType, setLimitType] = useState<GuidedTrialLimitType | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuidedTrialResult | null>(null);
  // 💡 [신규] 당근 게이지(components/carrot-gauge.tsx)용 — 세션당 업로드 예산(1건, 파일
  // 분석·채팅 첨부와 공유)이 몇 개 남았는지. 새 세션이라고 가정하고 총량으로 시작해뒀다가,
  // 서버가 실제로 알려주는 값(analyzeFile 성공/429 응답의 remainingUploads)으로만 갱신합니다.
  const [uploadRemaining, setUploadRemaining] = useState(SESSION_UPLOAD_LIMIT);

  // 💡 [수정] 예전엔 이미지만 받고 나머지는 전부 "지원하지 않는 형식"으로 되돌려보냈습니다 —
  // 이 훅을 쓰는 /welcome 히어로의 "지금 체험하기"가 랜딩의 유일한 주 CTA라, PDF·PPT 같은
  // 실제 수업 자료를 고른 방문자가 그 자리에서 막혔습니다. 이제 사진이 아닌 파일은 그대로
  // 서버로 보내고(app/api/public-guided-trial이 extractFileText로 텍스트를 뽑습니다),
  // 이미지 전용 처리(비전이 못 읽는 HEIC 거절, 긴 변 다운스케일)는 이미지일 때만 합니다.
  const analyzeFile = async (file: File) => {
    const isImage = file.type.startsWith('image/');
    if (isImage && !SUPPORTED_CHAT_IMAGE_MIME_TYPES.includes(file.type)) {
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
      // 다운스케일은 이미지에만 의미가 있습니다(비전 토큰 비용). 문서는 원본 base64 그대로
      // 보냅니다 — 리사이즈를 시도하면 canvas가 디코딩에 실패해 원본을 그대로 돌려주긴 하지만,
      // 굳이 이미지 디코딩 경로를 태울 이유가 없습니다.
      const payload = isImage ? await resizeImageDataUrl(dataUrl) : dataUrl;
      const commaIndex = payload.indexOf(',');
      const base64Content = commaIndex !== -1 ? payload.substring(commaIndex + 1) : payload;
      const mimeMatch = payload.match(/^data:([^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : file.type;

      const res = await fetch('/api/public-guided-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType, content: base64Content }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.limitReached) {
          setLimitType((data.limitType as GuidedTrialLimitType) || 'session');
          setUploaded(false);
          if (typeof data.remainingUploads === 'number') setUploadRemaining(data.remainingUploads);
          return;
        }
        setError(data.error || t('login.trial.genericError'));
        return;
      }
      setResult({ questions: data.questions, summary: data.summary });
      setUploadRemaining(typeof data.remainingUploads === 'number' ? data.remainingUploads : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.trial.genericError'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 💡 "다시 처음으로" — 이번에 본 결과/에러/업로드 표시만 지웁니다. limitType(서버가 이미
  // 막았다고 판정한 상태)은 지우지 않습니다 — 지워버리면 다시 업로드 UI가 보였다가 서버
  // 429로 튕기는 나쁜 경험이 되므로, 리셋 후에도 막혀 있었다면 계속 안내 배너가 보이는 게
  // 맞습니다.
  const reset = () => {
    setUploaded(false);
    setError(null);
    setResult(null);
  };

  return { limitType, isAnalyzing, uploaded, error, result, uploadRemaining, analyzeFile, reset };
}
