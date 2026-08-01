'use client';

import { useState, useEffect, Suspense } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { LensId, DeadlinesResult, QuestionsResult, DigestResult } from '@/lib/lenses';
import { PENDING_TRIAL_RESULT_KEY, type PendingTrialResult } from '@/lib/pending-trial-result';
import { detectBrowserLanguageName } from '@/lib/detect-browser-language';
import type { GuidedTrialLimitType } from '@/lib/use-guided-trial';
import { SUPPORTED_CHAT_IMAGE_MIME_TYPES, resizeImageDataUrl } from '@/lib/image-constraints';
import { Logomark } from '@/components/logomark';
import { renderTrialResult } from '@/components/trial-result-view';
import { GuestGuidedTrial } from '@/components/guest-guided-trial';
import { GuestLimitBanner } from '@/components/guest-limit-banner';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.6 35 26.9 36 24 36c-5.2 0-9.6-3.4-11.2-8.1l-6.6 5.1C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.6 5.6C41.6 36 44 30.5 44 24c0-1.3-.1-2.7-.4-3.5z"/>
    </svg>
  );
}


function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  // 💡 [신규] "로그인 없이 체험하기" — 로그인/회원가입 폼 대신 이 패널을 보여줍니다.
  // app/welcome/page.tsx의 "지금 체험하기" CTA가 /login?trial=1로 링크하면, 로그인 폼이
  // 잠깐 보였다가 전환되는 깜빡임 없이 처음부터 체험 패널이 바로 열리도록 useState
  // 초기값에서 바로 읽습니다(useEffect로 나중에 켜면 첫 렌더에 로그인 폼이 스쳐 지나갑니다).
  const [showTrial, setShowTrial] = useState(() => searchParams.get('trial') === '1');
  const [isTrialAnalyzing, setIsTrialAnalyzing] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [trialResult, setTrialResult] = useState<{
    fileName: string;
    text: string;
    lens: LensId;
    result: DeadlinesResult | QuestionsResult | DigestResult;
  } | null>(null);

  // 💡 [신규] "AI에게 바로 질문하기" — 자유 질문 하나를 던져보는 두 번째 체험.
  const [guestChatPrompt, setGuestChatPrompt] = useState('');
  const [isGuestChatLoading, setIsGuestChatLoading] = useState(false);
  const [guestChatAnswer, setGuestChatAnswer] = useState('');

  // 💡 [신규] 로그인 후 실제 채팅창에서 첨부 가능한 파일/사진(문서는 lib/file-text-extract.ts가
  // 지원하는 형식, 사진은 SUPPORTED_CHAT_IMAGE_MIME_TYPES)을 이 체험 채팅에도 그대로 첨부할
  // 수 있게 합니다. 게스트 세션은 업로드 예산이 세션당 1건뿐이라(파일 분석·사진 체험과 공유),
  // 로그인 후처럼 여러 개(MAX_CHAT_ATTACHMENTS)가 아니라 딱 1개만 첨부할 수 있습니다.
  const [guestChatAttachment, setGuestChatAttachment] = useState<{
    fileName: string;
    mimeType: string;
    content: string; // base64
  } | null>(null);
  const [isReadingGuestChatAttachment, setIsReadingGuestChatAttachment] = useState(false);
  const [guestChatAttachError, setGuestChatAttachError] = useState<string | null>(null);

  // 💡 [신규] 게스트 세션 예산(lib/anonymous-usage.ts) — 1세션 = 업로드 1건(파일 분석 또는
  // 이미지 체험) + 채팅 최대 3턴. ip/global 한도는 그 시점에 이 세션이 아직 아무것도 안 썼을
  // 때만 발생하므로(세션이 이미 뭔가 썼다면 IP 일일 검사 자체를 건너뜀 — lib/anonymous-usage.ts의
  // isNewSession 참고) 파일·채팅 두 섹션을 통째로 막아도 됩니다. 반면 session 한도(업로드
  // 이미 씀 / 채팅 3턴 다 씀)는 리소스별로 따로 발생해서 각 섹션을 독립적으로 막습니다 —
  // 업로드를 이미 썼어도 채팅은 여전히 쓸 수 있어야 하고, 그 반대도 마찬가지입니다.
  const [guestSuspended, setGuestSuspended] = useState<{ type: 'ip' | 'global' } | null>(null);
  const [uploadSessionUsed, setUploadSessionUsed] = useState(false);
  const [chatSessionUsed, setChatSessionUsed] = useState(false);

  // 💡 [신규] PWA 서비스워커 등록 (홈 화면에 앱으로 설치 가능하게 해줍니다)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('서비스워커 등록 실패:', err);
      });
    }
  }, []);

  // SSR 환경에 맞는 브라우저 Supabase 클라이언트 생성 (쿠키 자동 연동)
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // 이메일 로그인 / 회원가입 처리
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;

        // 💡 [신규] "이메일 인증은 나중에, 가입 즉시 쓸 수 있게" — Supabase 프로젝트의
        // Authentication 설정에서 "Confirm email"이 꺼져 있으면 signUp()이 바로 세션을
        // 돌려줍니다. 그 경우 "이메일을 확인해주세요" 안내로 붙잡아두지 않고 곧장 앱으로
        // 들여보내고, 확인 메일 자체는 Supabase가 백그라운드로 계속 보냅니다. 반대로
        // "Confirm email"이 켜져 있으면 Supabase가 세션을 주지 않으므로(이건 앱 코드가
        // 아니라 Supabase 프로젝트 설정이라 여기서 우회할 수 없음) 기존처럼 안내만 하고
        // 기다립니다.
        if (data.session) {
          router.push('/');
          router.refresh();
        } else {
          setMessage({ text: t('login.messages.signUpConfirmEmail'), type: 'success' });
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;

        // 로그인 성공 시 쿠키가 확실히 저장되도록 router.push 및 refresh 사용
        router.push('/');
        router.refresh();
      }
    } catch (err: any) {
      setMessage({ text: err.message || t('login.messages.authErrorFallback'), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // 소셜 로그인 처리 (OAuth)
  const handleOAuthLogin = async (provider: 'google' | 'github' | 'kakao') => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setMessage({ text: err.message || t('login.messages.oauthErrorFallback'), type: 'error' });
    }
  };

  // 💡 [신규] 로그인 없이 파일 1개를 분석해보는 체험. 서버(app/api/public-analyze)가
  // IP당 시간당/일일 호출 횟수·3MB 상한을 강제하므로, 여기서는 사용자에게 보여줄 에러
  // 메시지 처리와 결과 상태 관리만 담당합니다.
  const handleTrialFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      setTrialError(t('login.trial.fileTooLarge'));
      return;
    }

    setIsTrialAnalyzing(true);
    setTrialError(null);
    setTrialResult(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error(t('login.trial.readError')));
        reader.readAsDataURL(file);
      });
      const commaIndex = dataUrl.indexOf(',');
      const base64Content = commaIndex !== -1 ? dataUrl.substring(commaIndex + 1) : dataUrl;

      const res = await fetch('/api/public-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          content: base64Content,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.limitReached) {
          const limitType = data.limitType as GuidedTrialLimitType | undefined;
          if (limitType === 'session') {
            setUploadSessionUsed(true);
          } else {
            setGuestSuspended({ type: (limitType as 'ip' | 'global') || 'ip' });
          }
          return;
        }
        setTrialError(data.error || t('login.trial.analyzeError'));
        return;
      }
      setTrialResult({ fileName: data.fileName, text: data.text, lens: data.lens, result: data.result });
    } catch (err) {
      setTrialError(err instanceof Error ? err.message : t('login.trial.genericError'));
    } finally {
      setIsTrialAnalyzing(false);
    }
  };

  // 💡 [신규] 게스트 채팅에 파일/사진 1개를 첨부합니다. app/page.tsx의
  // handleChatAttachmentFiles와 같은 검증(이미지 형식·용량)을 하되, 텍스트 추출은
  // 서버(app/api/public-chat)가 하므로 여기서는 base64로 읽어서 들고만 있습니다 — 로그인
  // 사용자와 달리 /api/extract를 미리 호출하지 않는 이유는 그 라우트가 세션 인증이 필요해
  // 게스트가 호출할 수 없기 때문입니다.
  const handleGuestChatAttachmentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setGuestChatAttachError(null);

    if (file.size > 3 * 1024 * 1024) {
      setGuestChatAttachError(t('login.trial.attach.tooLarge'));
      return;
    }

    const isImage = file.type.startsWith('image/');
    if (isImage && !SUPPORTED_CHAT_IMAGE_MIME_TYPES.includes(file.type)) {
      setGuestChatAttachError(t('login.trial.attach.unsupportedImage'));
      return;
    }

    setIsReadingGuestChatAttachment(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error(t('login.trial.readError')));
        reader.readAsDataURL(file);
      });

      // 큰 사진(폰 카메라 등)은 로그인 후 채팅 첨부와 동일하게 다운스케일해 용량을 줄입니다.
      const finalDataUrl = isImage ? await resizeImageDataUrl(dataUrl) : dataUrl;
      const commaIndex = finalDataUrl.indexOf(',');
      const base64Content = commaIndex !== -1 ? finalDataUrl.substring(commaIndex + 1) : finalDataUrl;
      const mimeMatch = finalDataUrl.match(/^data:([^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : file.type || 'application/octet-stream';

      setGuestChatAttachment({ fileName: file.name, mimeType, content: base64Content });
    } catch (err) {
      setGuestChatAttachError(err instanceof Error ? err.message : t('login.trial.genericError'));
    } finally {
      setIsReadingGuestChatAttachment(false);
    }
  };

  // 💡 [신규] "AI에게 바로 질문하기" — 질문(+선택적으로 파일/사진 1개)을 서버(app/api/public-chat)에
  // 보내고 답변을 스트리밍으로 받습니다. app/page.tsx의 handleExecute가 쓰는 것과 같은
  // reader.read() 루프를 그대로 재사용하되, 렌즈·할 일 파싱 없이 텍스트만 이어붙입니다.
  const handleGuestAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = guestChatPrompt.trim();
    if (!prompt || isGuestChatLoading) return;

    setIsGuestChatLoading(true);
    setGuestChatAnswer('');
    try {
      const res = await fetch('/api/public-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          responseLanguage: detectBrowserLanguageName(),
          attachment: guestChatAttachment || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.limitReached) {
          const limitType = data.limitType as GuidedTrialLimitType | undefined;
          // 💡 [신규] limitScope로 소진된 예산이 채팅 턴인지 업로드 슬롯인지 구분합니다.
          // 업로드 슬롯이 막힌 경우 uploadSessionUsed를 켜서 "파일 분석"/"사진 체험"
          // 섹션도 함께 회색 처리되도록 합니다(세 기능이 같은 예산을 공유하므로).
          if (data.limitScope === 'upload') {
            if (limitType === 'session') {
              setUploadSessionUsed(true);
            } else {
              setGuestSuspended({ type: (limitType as 'ip' | 'global') || 'ip' });
            }
            return;
          }
          if (limitType === 'session') {
            setChatSessionUsed(true);
          } else {
            setGuestSuspended({ type: (limitType as 'ip' | 'global') || 'ip' });
          }
        } else {
          setGuestChatAnswer(data.error || t('login.trial.genericError'));
        }
        return;
      }
      if (!res.body) return;

      // 첨부가 있었다면 이 요청으로 업로드 예산을 이미 소모했으므로, 파일 분석/사진 체험
      // 섹션도 즉시 회색 처리합니다 — 다음 요청의 429를 기다리지 않고 바로 반영합니다.
      if (guestChatAttachment) {
        setUploadSessionUsed(true);
      }
      setGuestChatAttachment(null);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setGuestChatAnswer(answer);
      }
    } catch (err) {
      setGuestChatAnswer(err instanceof Error ? err.message : t('login.trial.genericError'));
    } finally {
      setIsGuestChatLoading(false);
    }
  };

  // 💡 [신규] "다시 올리게 하면 안 돼" — 이미 뽑아둔 텍스트+분석 결과를 localStorage에
  // 잠깐 담아두고 로그인 폼으로 전환합니다. app/page.tsx가 로그인 성공 직후 이 값을 읽어
  // 파일을 다시 요청하지 않고 그대로 저장합니다.
  const handleSaveTrialResult = () => {
    if (!trialResult) return;
    const payload: PendingTrialResult = { ...trialResult, savedAt: new Date().toISOString() };
    try {
      localStorage.setItem(PENDING_TRIAL_RESULT_KEY, JSON.stringify(payload));
    } catch (err) {
      console.error('체험 결과 임시 저장 실패:', err);
    }
    setShowTrial(false);
    setIsSignUp(false);
    setMessage({ text: t('login.messages.trialSavedPrompt'), type: 'success' });
  };

  return (
    <div className="min-h-screen flex bg-[#211E28] text-[#F5F2F7]">
      <style jsx global>{`
        @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
        * { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      {/* 좌측 브랜드 패널 (데스크톱 전용) */}
      <div className="hidden md:flex md:w-[44%] lg:w-[40%] relative overflow-hidden bg-[#17141D] text-white flex-col justify-between p-12 lg:p-16">
        {/* 은은한 색색 조명 효과 (귀여운 분위기용, 단색 그라데이션 대신 부드러운 블러 블롭) */}
        <div className="absolute w-72 h-72 bg-[#F4679B] rounded-full blur-3xl opacity-[0.18] -top-10 -left-16 pointer-events-none" />
        <div className="absolute w-72 h-72 bg-[#6EE7B7] rounded-full blur-3xl opacity-[0.12] -bottom-16 -right-10 pointer-events-none" />

        {/* 💡 [수정] 큼직한 캐릭터 마스코트 — <img>를 배경 위에 바로 놓으면 브라우저 강제
            다크 모드가 밝은 영역을 "사진"으로 오판해 재반전시키는 경우가 있어(color-scheme
            선언 세 겹으로도 일부 브라우저에서 재현됨), 이 카드처럼 어두운 배경(다른 카드
            UI와 동일한 bg-[#15131A]/border-[#322D3B]/rounded-xl)으로 감싸 "이미 다크 UI
            요소"로 보이게 합니다. 효과가 확인되면 다른 위치의 작은 로고에도 같은 패턴을
            적용합니다. 바깥 박스 크기(w-40 h-40)는 기존과 동일하게 유지하고, 안쪽 이미지를
            패딩만큼 줄여(w-32 h-32) 전체 자리 차지는 그대로입니다. */}
        <div className="absolute right-8 bottom-24 w-40 h-40 rounded-xl bg-[#15131A] border border-[#322D3B] p-4 flex items-center justify-center opacity-90">
          <Logomark className="w-32 h-32" />
        </div>
        <span className="absolute right-16 bottom-[168px] w-2 h-2 rounded-full bg-[#6EE7B7]" />
        <span className="absolute right-32 bottom-[228px] w-1.5 h-1.5 rounded-full bg-[#FFD97D]" />

        <div className="flex items-center gap-2.5 relative">
          <Logomark className="w-8 h-8 text-[#F4679B]" />
          <span className="text-lg font-extrabold tracking-tight">Carrotly</span>
        </div>

        <div className="relative">
          <h1 className="text-3xl lg:text-[34px] font-extrabold leading-tight tracking-tight mb-4">
            {t('login.brand.headlineLine1')}<br />{t('login.brand.headlineLine2')}
          </h1>
          <p className="text-white/70 text-sm leading-relaxed mb-10 max-w-sm">
            {t('login.brand.subheadline')}
          </p>

          <div className="flex flex-col gap-4">
            {[
              { title: t('login.brand.features.automation.title'), desc: t('login.brand.features.automation.desc'), dot: '#F4679B' },
              { title: t('login.brand.features.outputs.title'), desc: t('login.brand.features.outputs.desc'), dot: '#6EE7B7' },
              { title: t('login.brand.features.hybridEngine.title'), desc: t('login.brand.features.hybridEngine.desc'), dot: '#FFD97D' },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: item.dot }} />
                <div>
                  <div className="text-sm font-semibold">{item.title}</div>
                  <div className="text-white/60 text-xs mt-0.5">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-white/40 text-xs">{t('login.brand.copyright', { year: new Date().getFullYear() })}</div>
      </div>

      {/* 우측 로그인 폼 패널 */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-[#1C1922] md:bg-[#211E28]">
        <div className="w-full max-w-[380px]">

          {/* 모바일 전용 브랜드 표기 (좌측 패널이 숨겨지므로) — 스크롤 없이 폼이 보이도록 최대한 짧게 구성 */}
          <div className="flex md:hidden flex-col items-center mb-7">
            <span className="text-base font-extrabold text-[#F5F2F7] tracking-tight mb-3">Carrotly</span>
            <Logomark className="w-14 h-14" />
            <p className="text-[#C9C0D6] text-sm text-center mt-3 max-w-[280px] leading-snug">
              {t('login.brand.shortTagline')}
            </p>
          </div>

          {!showTrial ? (
            <>
              <h2 className="text-xl font-extrabold tracking-tight text-center md:text-left mb-1.5">
                {isSignUp ? t('login.form.signUpTitle') : t('login.form.signInTitle')}
              </h2>
              <p className="text-[#AFA6BD] text-sm text-center md:text-left mb-7">
                {isSignUp ? t('login.form.signUpSubtitle') : t('login.form.signInSubtitle')}
              </p>

              {message && (
                <div
                  className={`px-4 py-3 rounded-lg text-sm mb-5 border ${
                    message.type === 'error'
                      ? 'bg-[#35201D] text-[#FF9585] border-[#63392F]'
                      : 'bg-[#1B3328] text-[#6EE7B7] border-[#37604D]'
                  }`}
                >
                  {message.text}
                </div>
              )}

              <form onSubmit={handleAuth} className="flex flex-col gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#C9C0D6] mb-1.5">
                    {t('login.form.emailLabel')}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#423B4C] bg-[#211E28] text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[#857C93] transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#C9C0D6] mb-1.5">
                    {t('login.form.passwordLabel')}
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#423B4C] bg-[#211E28] text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[#857C93] transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 mt-1 rounded-lg border-none bg-[#F4679B] text-white font-semibold text-sm cursor-pointer hover:bg-[#D1477F] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
                >
                  {loading ? t('login.form.processing') : isSignUp ? t('login.form.signUpButton') : t('login.form.signInButton')}
                </button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <hr className="flex-1 border-[#322D3B]" />
                <span className="text-xs text-[#857C93]">{t('login.form.orDivider')}</span>
                <hr className="flex-1 border-[#322D3B]" />
              </div>

              <button
                onClick={() => handleOAuthLogin('google')}
                className="w-full py-2.5 rounded-lg border border-[#423B4C] bg-[#211E28] text-[#C9C0D6] text-sm font-medium cursor-pointer flex items-center justify-center gap-2.5 hover:bg-[#15131A] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
              >
                <GoogleIcon />
                {t('login.form.continueWithGoogle')}
              </button>

              <div className="mt-6 flex flex-col items-center gap-3">
                <button
                  onClick={() => {
                    setIsSignUp(!isSignUp);
                    setMessage(null);
                  }}
                  className="bg-transparent border-none text-[#F4679B] text-[13px] font-medium cursor-pointer hover:underline focus:outline-none"
                >
                  {isSignUp ? t('login.form.toggleToSignIn') : t('login.form.toggleToSignUp')}
                </button>
                <button
                  onClick={() => {
                    setShowTrial(true);
                    setMessage(null);
                  }}
                  className="bg-transparent border-none text-[#857C93] text-[13px] font-medium cursor-pointer hover:text-[#C9C0D6] hover:underline focus:outline-none"
                >
                  {t('login.form.tryWithoutAccount')}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-extrabold tracking-tight text-center md:text-left mb-1.5">
                {t('login.trial.title')}
              </h2>
              <p className="text-[#AFA6BD] text-sm text-center md:text-left mb-7">
                {t('login.trial.subtitle')}
              </p>

              {/* 💡 [신규] guestSuspended(ip/global)만 이 상단 배너로 안내하고 아래 두 섹션을
                  전부 막습니다 — 이 한도는 이 세션이 아직 아무것도 안 썼을 때만 발생하므로
                  (lib/anonymous-usage.ts의 isNewSession 참고), 통째로 막아도 문제 없습니다. */}
              {guestSuspended && (
                <div className="mb-5">
                  <GuestLimitBanner
                    limitType={guestSuspended.type}
                    onRequestSignUp={() => {
                      setShowTrial(false);
                      setIsSignUp(true);
                      setMessage(null);
                    }}
                  />
                </div>
              )}

              <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-2.5">
                {t('login.trial.fileSectionTitle')}
              </p>

              {/* 💡 세션당 업로드 1건 — 이미 썼으면(uploadSessionUsed) 채팅 섹션은 그대로 두고
                  이 섹션만 안내 배너로 바꿉니다(파일 분석과 이미지 체험이 같은 업로드 예산을
                  공유하므로, 아래 GuestGuidedTrial에서 먼저 썼어도 여기서 똑같이 나타납니다). */}
              {uploadSessionUsed && !guestSuspended ? (
                <GuestLimitBanner
                  limitType="session"
                  context="upload"
                  onRequestSignUp={() => {
                    setShowTrial(false);
                    setIsSignUp(true);
                    setMessage(null);
                  }}
                />
              ) : (
                !trialResult && (
                  <label
                    className={`flex flex-col items-center justify-center gap-2 border border-dashed rounded-xl py-10 px-4 text-center transition-colors ${
                      isTrialAnalyzing || Boolean(guestSuspended)
                        ? 'border-[#322D3B] cursor-wait'
                        : 'border-[#423B4C] hover:border-[#F4679B]/50 cursor-pointer'
                    }`}
                  >
                    <span className="text-2xl">📄</span>
                    <span className="text-sm font-medium text-[#C9C0D6]">
                      {isTrialAnalyzing ? t('login.trial.analyzing') : t('login.trial.chooseFile')}
                    </span>
                    <span className="text-xs text-[#5B5566]">{t('login.trial.fileHint')}</span>
                    <input
                      type="file"
                      className="hidden"
                      disabled={isTrialAnalyzing || Boolean(guestSuspended)}
                      onChange={handleTrialFileChange}
                    />
                  </label>
                )
              )}

              {trialError && (
                <div className="px-4 py-3 rounded-lg text-sm mt-4 border bg-[#35201D] text-[#FF9585] border-[#63392F]">
                  {trialError}
                </div>
              )}

              {trialResult && (
                <div className="flex flex-col gap-4">
                  <div className="bg-[#15131A] border border-[#322D3B] rounded-xl p-4">
                    <p className="text-xs text-[#857C93] mb-3 truncate">{trialResult.fileName}</p>
                    {renderTrialResult(trialResult.lens, trialResult.result, t)}
                  </div>

                  <div className="bg-[#331F29] border border-[#F4679B]/40 rounded-xl p-4 text-center">
                    <p className="text-sm text-[#F5F2F7] font-semibold mb-3">
                      {t('login.trial.saveResultTitle')}
                    </p>
                    <button
                      onClick={handleSaveTrialResult}
                      className="w-full py-2.5 rounded-lg border-none bg-[#F4679B] text-white font-semibold text-sm cursor-pointer hover:bg-[#D1477F] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
                    >
                      {t('login.trial.saveResultButton')}
                    </button>
                  </div>
                </div>
              )}

              <div className="my-6 flex items-center gap-3">
                <hr className="flex-1 border-[#322D3B]" />
                <span className="text-xs text-[#857C93]">{t('login.trial.orDivider')}</span>
                <hr className="flex-1 border-[#322D3B]" />
              </div>

              {/* 💡 [신규] "AI에게 바로 질문하기" — 파일 없이 자유 질문 하나를 던져보는 체험.
                  세션당 최대 3턴 — 업로드를 안 해도 이것부터 시작할 수 있고, 그 경우 이 세션은
                  채팅 예산만 쓰고 업로드 예산은 그대로 남습니다. */}
              <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-2.5">
                {t('login.trial.chatSectionTitle')}
              </p>
              {chatSessionUsed && !guestSuspended ? (
                <GuestLimitBanner
                  limitType="session"
                  context="chat"
                  onRequestSignUp={() => {
                    setShowTrial(false);
                    setIsSignUp(true);
                    setMessage(null);
                  }}
                />
              ) : (
                <form onSubmit={handleGuestAsk} className="flex flex-col gap-2.5">
                  <textarea
                    value={guestChatPrompt}
                    onChange={(e) => setGuestChatPrompt(e.target.value)}
                    placeholder={t('login.trial.chatPlaceholder')}
                    rows={3}
                    disabled={isGuestChatLoading || Boolean(guestSuspended)}
                    className="w-full bg-[#15131A] border border-[#423B4C] rounded-lg px-3.5 py-2.5 text-sm text-[#F5F2F7] outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 transition-colors placeholder:text-[#5B5566] resize-none disabled:opacity-50"
                  />

                  {/* 💡 [신규] 파일/사진 첨부 — 로그인 후 실제 채팅과 같은 형식을 지원하되, 게스트
                      업로드 예산이 세션당 1건뿐이라 uploadSessionUsed가 이미 켜져 있으면(파일
                      분석·사진 체험 중 하나를 이미 썼으면) 이 첨부도 함께 막습니다. */}
                  {guestChatAttachment ? (
                    <div className="flex items-center justify-between gap-2 bg-[#15131A] border border-[#423B4C] rounded-lg px-3 py-2">
                      <span className="text-xs text-[#C9C0D6] truncate">📎 {guestChatAttachment.fileName}</span>
                      <button
                        type="button"
                        onClick={() => setGuestChatAttachment(null)}
                        disabled={isGuestChatLoading}
                        className="bg-transparent border-none text-[#857C93] text-xs cursor-pointer hover:text-[#FF9585] disabled:opacity-50 focus:outline-none shrink-0"
                      >
                        {t('login.trial.attach.remove')}
                      </button>
                    </div>
                  ) : (
                    <label
                      className={`flex items-center gap-1.5 text-xs font-medium w-fit ${
                        uploadSessionUsed || guestSuspended || isGuestChatLoading || isReadingGuestChatAttachment
                          ? 'text-[#5B5566] cursor-wait'
                          : 'text-[#857C93] hover:text-[#C9C0D6] cursor-pointer'
                      }`}
                    >
                      <span>📎 {isReadingGuestChatAttachment ? t('login.trial.attach.reading') : t('login.trial.attach.label')}</span>
                      <input
                        type="file"
                        className="hidden"
                        disabled={uploadSessionUsed || Boolean(guestSuspended) || isGuestChatLoading || isReadingGuestChatAttachment}
                        onChange={handleGuestChatAttachmentChange}
                      />
                    </label>
                  )}
                  {!guestChatAttachment && !uploadSessionUsed && (
                    <p className="text-[11px] text-[#5B5566] -mt-1.5">{t('login.trial.attach.hint')}</p>
                  )}
                  {guestChatAttachError && (
                    <p className="text-[11px] text-[#FF9585] -mt-1.5">{guestChatAttachError}</p>
                  )}

                  <button
                    type="submit"
                    disabled={isGuestChatLoading || isReadingGuestChatAttachment || Boolean(guestSuspended) || !guestChatPrompt.trim()}
                    className="w-full py-2.5 rounded-lg border border-[#423B4C] bg-[#211E28] text-[#C9C0D6] text-sm font-semibold cursor-pointer hover:bg-[#15131A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                  >
                    {isGuestChatLoading ? t('login.trial.chatLoading') : t('login.trial.chatButton')}
                  </button>
                </form>
              )}

              {guestChatAnswer && (
                <div className="bg-[#15131A] border border-[#322D3B] rounded-xl p-4 mt-3 text-sm text-[#E4DEEA] leading-relaxed whitespace-pre-wrap">
                  {guestChatAnswer}
                </div>
              )}

              <div className="my-6 flex items-center gap-3">
                <hr className="flex-1 border-[#322D3B]" />
                <span className="text-xs text-[#857C93]">{t('login.trial.orDivider')}</span>
                <hr className="flex-1 border-[#322D3B]" />
              </div>

              {/* 💡 [신규] "사진으로 체험하기" — 이미지 1장 → 회로도 애니메이션 + 예상 문제 + 요약정리.
                  파일 분석과 같은 "세션당 업로드 1건" 예산을 공유합니다(app/api/public-guided-trial) —
                  둘 중 하나만 세션당 한 번 쓸 수 있습니다. 컴포넌트가 lib/use-guided-trial.ts 훅으로
                  자기 상태를 관리하고, 여기 guestSuspended와는 별도로 자체 배너를 보여줍니다. */}
              <GuestGuidedTrial
                onRequestSignUp={() => {
                  setShowTrial(false);
                  setIsSignUp(true);
                  setMessage(null);
                }}
              />

              <div className="mt-6 text-center">
                <button
                  onClick={() => {
                    setShowTrial(false);
                    setTrialError(null);
                    setTrialResult(null);
                    setGuestChatPrompt('');
                    setGuestChatAnswer('');
                    setGuestChatAttachment(null);
                    setGuestChatAttachError(null);
                    setGuestSuspended(null);
                    setUploadSessionUsed(false);
                    setChatSessionUsed(false);
                  }}
                  className="bg-transparent border-none text-[#857C93] text-[13px] font-medium cursor-pointer hover:text-[#C9C0D6] hover:underline focus:outline-none"
                >
                  {t('login.trial.backToLogin')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 💡 useSearchParams()는 Next.js가 정적 분석 시 가장 가까운 Suspense 경계까지 클라이언트
// 렌더링을 요구합니다 — 이 페이지는 어차피 항상 동적으로 렌더링되지만(app/layout.tsx가
// 쿠키를 읽어 async라 전체가 dynamic), 빌드 시 경고를 피하려면 이 경계가 필요합니다.
// fallback은 거의 보이지 않습니다(서버가 이미 결정된 쿼리 파라미터로 스트리밍하므로).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
