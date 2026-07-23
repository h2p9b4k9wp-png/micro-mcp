'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

// 브랜드 로고마크 — 귀여운 블록 캐릭터 얼굴. 대시보드와 동일한 마크를 사용해 시각적 일관성을 유지합니다.
function Logomark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="11" cy="5" r="2" fill="currentColor" opacity="0.7" />
      <circle cx="21" cy="5" r="2" fill="currentColor" opacity="0.7" />
      <path d="M11 7L13 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <path d="M21 7L19 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <rect x="5" y="10" width="22" height="19" rx="8" fill="currentColor" />
      <circle cx="13" cy="19" r="2.2" fill="white" />
      <circle cx="19" cy="19" r="2.2" fill="white" />
      <path d="M12.5 23.5C13.8 25 18.2 25 19.5 23.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

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
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage({ text: '회원가입 확인 이메일을 발송했습니다! 이메일을 확인해 주세요.', type: 'success' });
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
      setMessage({ text: err.message || '인증 과정에서 오류가 발생했습니다.', type: 'error' });
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
      setMessage({ text: err.message || '소셜 로그인 실패', type: 'error' });
    }
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

        {/* 큼직한 캐릭터 마스코트 */}
        <Logomark className="absolute right-8 bottom-24 w-40 h-40 text-[#F4679B] opacity-90" />
        <span className="absolute right-16 bottom-[168px] w-2 h-2 rounded-full bg-[#6EE7B7]" />
        <span className="absolute right-32 bottom-[228px] w-1.5 h-1.5 rounded-full bg-[#FFD97D]" />

        <div className="flex items-center gap-2.5 relative">
          <Logomark className="w-8 h-8 text-[#F4679B]" />
          <span className="text-lg font-extrabold tracking-tight">Micro-MCP</span>
        </div>

        <div className="relative">
          <h1 className="text-3xl lg:text-[34px] font-extrabold leading-tight tracking-tight mb-4">
            블록을 조립하듯,<br />나만의 업무를 자동화하세요.
          </h1>
          <p className="text-white/70 text-sm leading-relaxed mb-10 max-w-sm">
            코딩도, 복잡한 프롬프트 고민도 필요 없습니다. 필요한 기능을 블록으로 연결하면 AI가 나머지를 처리합니다.
          </p>

          <div className="flex flex-col gap-4">
            {[
              { title: '연동 자동화', desc: '데이터베이스·캘린더·검색·파일을 블록으로 연결', dot: '#F4679B' },
              { title: '실행 중심 결과물', desc: '대화로 끝나지 않고, 실제 문서와 일정으로 정리', dot: '#6EE7B7' },
              { title: '하이브리드 AI 엔진', desc: '작업 난이도에 맞춰 최적의 모델을 자동 선택', dot: '#FFD97D' },
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

        <div className="relative text-white/40 text-xs">© {new Date().getFullYear()} Micro-MCP</div>
      </div>

      {/* 우측 로그인 폼 패널 */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-[#1C1922] md:bg-[#211E28]">
        <div className="w-full max-w-[380px]">

          {/* 모바일 전용 브랜드 표기 (좌측 패널이 숨겨지므로) */}
          <div className="flex md:hidden items-center gap-2 text-[#F4679B] mb-8 justify-center">
            <Logomark className="w-6 h-6" />
            <span className="text-base font-extrabold text-[#F5F2F7] tracking-tight">Micro-MCP</span>
          </div>

          <h2 className="text-xl font-extrabold tracking-tight text-center md:text-left mb-1.5">
            {isSignUp ? '새 계정 만들기' : '다시 만나서 반가워요'}
          </h2>
          <p className="text-[#AFA6BD] text-sm text-center md:text-left mb-7">
            {isSignUp ? '새 계정을 생성하여 시작하세요' : '서비스 이용을 위해 로그인해 주세요'}
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
                이메일 주소
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
                비밀번호
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
              {loading ? '처리 중...' : isSignUp ? '회원가입' : '로그인'}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <hr className="flex-1 border-[#322D3B]" />
            <span className="text-xs text-[#857C93]">간편 로그인</span>
            <hr className="flex-1 border-[#322D3B]" />
          </div>

          <button
            onClick={() => handleOAuthLogin('google')}
            className="w-full py-2.5 rounded-lg border border-[#423B4C] bg-[#211E28] text-[#C9C0D6] text-sm font-medium cursor-pointer flex items-center justify-center gap-2.5 hover:bg-[#15131A] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
          >
            <GoogleIcon />
            Google로 계속하기
          </button>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setMessage(null);
              }}
              className="bg-transparent border-none text-[#F4679B] text-[13px] font-medium cursor-pointer hover:underline focus:outline-none"
            >
              {isSignUp ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
