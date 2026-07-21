'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// Supabase 클라이언트 설정 (환경 변수)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

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
        // 로그인 성공 시 메인 대시보드로 이동
        window.location.href = '/';
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
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0f172a',
      color: '#f8fafc',
      fontFamily: 'sans-serif',
      padding: '20px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        backgroundColor: '#1e293b',
        borderRadius: '12px',
        padding: '32px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
        border: '1px solid #334155'
      }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', textAlign: 'center', marginBottom: '8px' }}>
          Micro-MCP
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', marginBottom: '24px' }}>
          {isSignUp ? '새 계정을 생성하여 시작하세요' : '서비스 이용을 위해 로그인해 주세요'}
        </p>

        {message && (
          <div style={{
            padding: '12px',
            borderRadius: '6px',
            fontSize: '14px',
            marginBottom: '16px',
            backgroundColor: message.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
            color: message.type === 'error' ? '#f87171' : '#34d399',
            border: `1px solid ${message.type === 'error' ? '#ef4444' : '#10b981'}`
          }}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', color: '#cbd5e1', marginBottom: '6px' }}>
              이메일 주소
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid #475569',
                backgroundColor: '#0f172a',
                color: '#fff',
                fontSize: '14px',
                outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', color: '#cbd5e1', marginBottom: '6px' }}>
              비밀번호
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid #475569',
                backgroundColor: '#0f172a',
                color: '#fff',
                fontSize: '14px',
                outline: 'none'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#0284c7',
              color: '#fff',
              fontWeight: '600',
              fontSize: '14px',
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: '8px',
              transition: 'background 0.2s'
            }}
          >
            {loading ? '처리 중...' : isSignUp ? '회원가입' : '로그인'}
          </button>
        </form>

        <div style={{ margin: '20px 0', textAlign: 'center', position: 'relative' }}>
          <hr style={{ borderColor: '#334155' }} />
          <span style={{
            position: 'absolute',
            top: '-10px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#1e293b',
            padding: '0 8px',
            color: '#64748b',
            fontSize: '12px'
          }}>
            간편 로그인
          </span>
        </div>

        <button
          onClick={() => handleOAuthLogin('google')}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '6px',
            border: '1px solid #475569',
            backgroundColor: '#0f172a',
            color: '#fff',
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          Google로 계속하기
        </button>

        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setMessage(null);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#38bdf8',
              fontSize: '13px',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            {isSignUp ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
          </button>
        </div>
      </div>
    </div>
  );
}