'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('connecting');
  const [command, setCommand] = useState('');
  const [streamingLog, setStreamingLog] = useState('[MCP CORE] 시스템 대기 중...');
  const [isExecuting, setIsExecuting] = useState(false);
  const [mcpNames, setMcpNames] = useState<string>('활성화된 MCP 없음');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const initApp = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (!session || error) {
        const { data: { session: retrySession } } = await supabase.auth.getSession();
        if (!retrySession) {
          router.push('/login');
          return;
        }
        setUser(retrySession.user);
      } else {
        setUser(session.user);
      }
      
      setLoading(false);
      setDbStatus('connected');
    };

    initApp();
  }, [router, supabase]);

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    setIsExecuting(true);
    setStreamingLog(`[MCP CORE] Analyzing query: "${command}"...\n[MCP BRIDGE] Active Connectors: [${mcpNames}]`);

    let aiAnswer = '';

    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

      if (!apiKey) {
        aiAnswer = '⚠️ Gemini API 키가 설정되지 않았습니다. .env.local 또는 Vercel 환경 변수에 NEXT_PUBLIC_GEMINI_API_KEY를 설정해 주세요.';
      } else {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

        const promptWithContext = `[System Context: Active MCP Tools = ${mcpNames}]\n\n사용자 질문: ${command}`;

        const result = await model.generateContent(promptWithContext);
        const response = await result.response;
        aiAnswer = response.text();
      }
    } catch (err: any) {
      aiAnswer = `[ERROR] AI 요청 실패: ${err.message || err}`;
    }

    setStreamingLog(`[MCP CORE] Query: "${command}"\n[CONNECTORS] [${mcpNames}]\n[SUCCESS] Response generated successfully.\n\n----------------------------------------\n[Gemini AI 답변]\n${aiAnswer}`);
    setIsExecuting(false);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        로딩 중...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', color: '#f8fafc', display: 'flex', fontFamily: 'sans-serif' }}>
      {/* 귀여운 폰트(Jua) 웹폰트 로드용 스타일 링크 주입 */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Jua&display=swap');
      `}</style>

      {/* 사이드바 메뉴 */}
      <div style={{ width: '260px', backgroundColor: '#1e293b', borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid #334155' }}>
          <span style={{ fontSize: '20px' }}>🚀</span>
          <span style={{ fontSize: '18px', fontWeight: 'bold' }}>Micro-MCP</span>
        </div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: '#0284c7', color: '#fff', fontWeight: '500', cursor: 'pointer' }}>
            📊 워크스페이스
          </div>
          <div style={{ padding: '12px', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer' }}>
            🧩 MCP 블록 매니저
          </div>
          <div style={{ padding: '12px', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer' }}>
            📈 모니터링 & 파일
          </div>
          <div style={{ padding: '12px', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer' }}>
            📜 DB 연동 로그
          </div>
        </div>
        <div style={{ padding: '16px', borderTop: '1px solid #334155', fontSize: '12px', color: '#64748b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', backgroundColor: dbStatus === 'connected' ? '#10b981' : '#ef4444', borderRadius: '50%' }}></span>
            <span>Gemini AI Connected</span>
          </div>
          <div style={{ marginTop: '4px' }}>연결된 MCP: 0개 활성</div>
        </div>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* 상단 네비게이션 바 */}
        <div style={{ height: '70px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 32px', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#1e293b', padding: '6px 12px', borderRadius: '20px', border: '1px solid #334155' }}>
            <span style={{ fontSize: '14px' }}>👤</span>
            <span style={{ fontSize: '13px', color: '#cbd5e1' }}>{user?.email}</span>
          </div>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.push('/login');
            }}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #ef4444', backgroundColor: 'transparent', color: '#ef4444', fontSize: '13px', cursor: 'pointer' }}
          >
            로그아웃
          </button>
        </div>

        {/* 본문 콘텐츠 */}
        <div style={{ padding: '32px', maxWidth: '1000px', width: '100%', margin: '0 auto' }}>
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ fontSize: '26px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📊 Live Gemini AI Playground
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
              활성화된 MCP 블록(0개) 맥락을 바탕으로 Google Gemini AI가 실제 답변을 도출합니다.
            </p>
          </div>

          {/* 프롬프트 전송 카드 */}
          <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', border: '1px solid #334155', padding: '24px', marginBottom: '32px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '600', color: '#f8fafc' }}>
                <span>⚡ AI 프롬프트 전송</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#0f172a', padding: '4px 10px', borderRadius: '12px', border: '1px solid #334155', fontSize: '12px', color: '#94a3b8' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#a855f7' }}></span>
                활성화된 MCP 없음
              </div>
            </div>

            <form onSubmit={handleExecute} style={{ display: 'flex', gap: '12px' }}>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Gemini AI에게 프롬프트를 입력하세요 (예: 노선 정리해줘, 오늘 할일 추천해줘)..."
                style={{ flex: 1, backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '8px', padding: '12px 16px', color: '#fff', fontSize: '14px', outline: 'none' }}
              />
              <button
                type="submit"
                disabled={isExecuting}
                style={{ backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', padding: '0 24px', fontWeight: '600', fontSize: '14px', cursor: isExecuting ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
              >
                {isExecuting ? '전송 중...' : '프롬프트 전송'}
              </button>
            </form>
          </div>

          {/* GEMINI AI LIVE CONSOLE (여기 답변 출력 영역에만 귀여운 폰트 적용!) */}
          <div style={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #334155', overflow: 'hidden', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)' }}>
            <div style={{ backgroundColor: '#1e293b', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #334155' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', backgroundColor: '#ef4444', borderRadius: '50%', display: 'inline-block' }}></span>
                <span style={{ width: '10px', height: '10px', backgroundColor: '#f59e0b', borderRadius: '50%', display: 'inline-block' }}></span>
                <span style={{ width: '10px', height: '10px', backgroundColor: '#10b981', borderRadius: '50%', display: 'inline-block' }}></span>
              </div>
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#94a3b8', marginLeft: '8px', letterSpacing: '1px' }}>
                💻 GEMINI AI LIVE CONSOLE
              </span>
            </div>

            {/* 답변 출력 콘솔 박스: font-family에 'Jua' 적용 */}
            <div style={{ 
              padding: '20px', 
              fontFamily: "'Jua', sans-serif", 
              fontSize: '16px', 
              color: '#34d399', 
              whiteSpace: 'pre-wrap', 
              lineHeight: '1.6', 
              minHeight: '150px',
              letterSpacing: '0.5px'
            }}>
              {streamingLog}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}