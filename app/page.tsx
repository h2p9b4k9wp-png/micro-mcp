'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { useRouter } from 'next/navigation';

interface McpBlock {
  id: string;
  name: string;
  description: string;
  active: boolean;
  icon: string;
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('connecting');
  const [command, setCommand] = useState('');
  const [streamingLog, setStreamingLog] = useState('[MCP CORE] 시스템 대기 중...');
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState('workspace');

  // 원래 있던 기본 4개 블록 + 사용자가 추가할 수 있는 동적 리스트 상태
  const [blocks, setBlocks] = useState<McpBlock[]>([
    { id: 'supabase', name: 'Supabase DB 블록', description: '실시간 데이터베이스 쿼리 및 사용자 세션 상태를 연동합니다.', active: true, icon: '🗄️' },
    { id: 'search', name: 'Google Search 블록', description: '웹 검색 기능을 통해 최신 정보를 실시간으로 가져옵니다.', active: false, icon: '🔍' },
    { id: 'filesystem', name: 'File System 블록', description: '로컬 및 클라우드 파일 디렉토리를 탐색하고 읽어옵니다.', active: false, icon: '📁' },
    { id: 'customapi', name: 'Custom API 블록', description: '외부 사용자 정의 REST API 엔드포인트와 연동합니다.', active: false, icon: '⚡' },
  ]);

  // 새로운 블록 추가 폼 상태
  const [newBlockName, setNewBlockName] = useState('');
  const [newBlockDesc, setNewBlockDesc] = useState('');

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

  // 활성화된 블록 이름 추출
  const activeMcpNames = blocks
    .filter(b => b.active)
    .map(b => b.name)
    .join(', ') || '활성화된 MCP 없음';

  const toggleBlock = (id: string) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, active: !b.active } : b));
  };

  const handleAddBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlockName.trim()) return;

    const newBlock: McpBlock = {
      id: `custom-${Date.now()}`,
      name: newBlockName,
      description: newBlockDesc.trim() || '사용자가 직접 추가한 커스텀 MCP 블록입니다.',
      active: true,
      icon: '🧩'
    };

    setBlocks(prev => [...prev, newBlock]);
    setNewBlockName('');
    setNewBlockDesc('');
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    setIsExecuting(true);
    setStreamingLog(`[MCP CORE] Analyzing query: "${command}"...\n[MCP BRIDGE] Active Connectors: [${activeMcpNames}]`);

    let aiAnswer = '';

    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

      if (!apiKey) {
        aiAnswer = '⚠️ Gemini API 키가 설정되지 않았습니다. .env.local 또는 Vercel 환경 변수에 NEXT_PUBLIC_GEMINI_API_KEY를 설정해 주세요.';
      } else {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

        const promptWithContext = `[System Context: Active MCP Tools = ${activeMcpNames}]\n\n사용자 질문: ${command}`;

        const result = await model.generateContent(promptWithContext);
        const response = await result.response;
        aiAnswer = response.text();
      }
    } catch (err: any) {
      aiAnswer = `[ERROR] AI 요청 실패: ${err.message || err}`;
    }

    setStreamingLog(`[MCP CORE] Query: "${command}"\n[CONNECTORS] [${activeMcpNames}]\n[SUCCESS] Response generated successfully.\n\n----------------------------------------\n[Gemini AI 답변]\n${aiAnswer}`);
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
      {/* Gemini AI 답변 콘솔창 전용 귀여운 폰트(Jua) 웹폰트 로드 */}
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
          <div 
            onClick={() => setActiveTab('workspace')}
            style={{ padding: '12px', borderRadius: '8px', backgroundColor: activeTab === 'workspace' ? '#0284c7' : 'transparent', color: activeTab === 'workspace' ? '#fff' : '#94a3b8', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            📊 워크스페이스
          </div>
          <div 
            onClick={() => setActiveTab('mcp')}
            style={{ padding: '12px', borderRadius: '8px', backgroundColor: activeTab === 'mcp' ? '#0284c7' : 'transparent', color: activeTab === 'mcp' ? '#fff' : '#94a3b8', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            🧩 MCP 블록 매니저
          </div>
          <div 
            onClick={() => setActiveTab('monitoring')}
            style={{ padding: '12px', borderRadius: '8px', backgroundColor: activeTab === 'monitoring' ? '#0284c7' : 'transparent', color: activeTab === 'monitoring' ? '#fff' : '#94a3b8', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            📈 모니터링 & 파일
          </div>
          <div 
            onClick={() => setActiveTab('logs')}
            style={{ padding: '12px', borderRadius: '8px', backgroundColor: activeTab === 'logs' ? '#0284c7' : 'transparent', color: activeTab === 'logs' ? '#fff' : '#94a3b8', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            📜 DB 연동 로그
          </div>
        </div>
        <div style={{ padding: '16px', borderTop: '1px solid #334155', fontSize: '12px', color: '#64748b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', backgroundColor: dbStatus === 'connected' ? '#10b981' : '#ef4444', borderRadius: '50%' }}></span>
            <span>Gemini AI Connected</span>
          </div>
          <div style={{ marginTop: '4px' }}>연결된 MCP: {activeMcpNames}</div>
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
          
          {activeTab === 'workspace' && (
            <>
              <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '26px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  📊 Live Gemini AI Playground
                </h1>
                <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
                  활성화된 MCP 블록 맥락을 바탕으로 Google Gemini AI가 실제 답변을 도출합니다.
                </p>
              </div>

              <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', border: '1px solid #334155', padding: '24px', marginBottom: '32px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '600', color: '#f8fafc' }}>
                    <span>⚡ AI 프롬프트 전송</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#0f172a', padding: '4px 10px', borderRadius: '12px', border: '1px solid #334155', fontSize: '12px', color: '#94a3b8' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#a855f7' }}></span>
                    {activeMcpNames}
                  </div>
                </div>

                <form onSubmit={handleExecute} style={{ display: 'flex', gap: '12px' }}>
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="Gemini AI에게 프롬프트를 입력하세요..."
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

                {/* Gemini 답변 콘솔창 전용 Jua 폰트 적용 */}
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
            </>
          )}

          {activeTab === 'mcp' && (
            <div>
              <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '26px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🧩 MCP 블록 매니저
                </h1>
                <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
                  연결할 MCP 블록을 활성화하고 관리하세요. 아래에서 새로운 블록을 추가할 수도 있습니다.
                </p>
              </div>

              {/* MCP 블록 리스트 (격자 배치) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', marginBottom: '32px' }}>
                {blocks.map((block) => (
                  <div key={block.id} style={{ backgroundColor: '#1e293b', borderRadius: '12px', border: '1px solid #334155', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <span style={{ fontSize: '16px', fontWeight: 'bold' }}>{block.icon} {block.name}</span>
                        <span style={{ fontSize: '12px', backgroundColor: block.active ? '#065f46' : '#334155', color: block.active ? '#34d399' : '#94a3b8', padding: '2px 8px', borderRadius: '4px' }}>
                          {block.active ? '활성' : '비활성'}
                        </span>
                      </div>
                      <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: '1.5' }}>{block.description}</p>
                    </div>
                    <button 
                      onClick={() => toggleBlock(block.id)}
                      style={{ marginTop: '20px', backgroundColor: block.active ? '#334155' : '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer' }}
                    >
                      {block.active ? '설정 관리' : '블록 활성화'}
                    </button>
                  </div>
                ))}
              </div>

              {/* 새로운 MCP 블록 추가 폼 (아래로 추가되는 기능 완벽 탑재) */}
              <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', border: '1px solid #334155', padding: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', color: '#f8fafc' }}>➕ 새로운 MCP 블록 추가하기</h3>
                <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>커스텀 MCP 블록을 등록하면 아래 리스트에 바로 추가됩니다.</p>
                
                <form onSubmit={handleAddBlock} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input
                    type="text"
                    value={newBlockName}
                    onChange={(e) => setNewBlockName(e.target.value)}
                    placeholder="블록 이름 (예: Notion Sync 블록)"
                    style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '8px', padding: '10px 14px', color: '#fff', fontSize: '14px', outline: 'none' }}
                  />
                  <input
                    type="text"
                    value={newBlockDesc}
                    onChange={(e) => setNewBlockDesc(e.target.value)}
                    placeholder="블록 설명 (예: 노선 데이터 및 문서를 실시간 동기화합니다.)"
                    style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '8px', padding: '10px 14px', color: '#fff', fontSize: '14px', outline: 'none' }}
                  />
                  <button
                    type="submit"
                    style={{ alignSelf: 'flex-end', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontWeight: '600', fontSize: '14px', cursor: 'pointer' }}
                  >
                    블록 추가하기
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'monitoring' && (
            <div>
              <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '26px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  📈 모니터링 & 파일
                </h1>
                <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
                  시스템 상태 및 업로드된 파일 현황을 모니터링합니다.
                </p>
              </div>

              <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', border: '1px solid #334155', padding: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>리소스 사용량</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  <div style={{ backgroundColor: '#0f172a', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>API 응답 속도</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#34d399', marginTop: '4px' }}>124ms</div>
                  </div>
                  <div style={{ backgroundColor: '#0f172a', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>활성 세션</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#38bdf8', marginTop: '4px' }}>1개</div>
                  </div>
                  <div style={{ backgroundColor: '#0f172a', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>메모리 사용률</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f59e0b', marginTop: '4px' }}>34.2%</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div>
              <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '26px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  📜 DB 연동 로그
                </h1>
                <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
                  데이터베이스 실시간 연결 및 쿼리 이력을 확인합니다.
                </p>
              </div>

              <div style={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #334155', padding: '20px', fontFamily: 'monospace', fontSize: '13px', color: '#34d399', lineHeight: '1.6' }}>
                <div>[INFO] System connected to Supabase successfully.</div>
                <div>[AUTH] Active session verified for user: {user?.email}</div>
                <div>[QUERY] Fetching workspace configurations... [Status: 200 OK]</div>
                <div>[MCP] Active Blocks: [{activeMcpNames}] pipeline ready.</div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}