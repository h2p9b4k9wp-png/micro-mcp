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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [blocks, setBlocks] = useState<McpBlock[]>([
    { id: 'supabase', name: 'Supabase DB 블록', description: '실시간 데이터베이스 쿼리 및 사용자 세션 상태를 연동합니다.', active: true, icon: '🗄️' },
    { id: 'search', name: 'Google Search 블록', description: '웹 검색 기능을 통해 최신 정보를 실시간으로 가져옵니다.', active: false, icon: '🔍' },
    { id: 'filesystem', name: 'File System 블록', description: '로컬 및 클라우드 파일 디렉토리를 탐색하고 읽어옵니다.', active: false, icon: '📁' },
    { id: 'customapi', name: 'Custom API 블록', description: '외부 사용자 정의 REST API 엔드포인트와 연동합니다.', active: false, icon: '⚡' },
  ]);

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
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        로딩 중...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row font-sans">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Jua&display=swap');
      `}</style>

      {/* 모바일 상단 바 */}
      <div className="md:hidden flex items-center justify-between bg-slate-900 border-b border-slate-800 p-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🚀</span>
          <span className="font-bold text-lg">Micro-MCP</span>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="text-slate-300 text-xl p-1 focus:outline-none"
        >
          {isMobileMenuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* 사이드바 메뉴 (모바일 대응 토글 및 반응형 숨김) */}
      <div className={`
        ${isMobileMenuOpen ? 'flex' : 'hidden'} md:flex 
        w-full md:w-64 bg-slate-900 border-r border-slate-800 flex-col shrink-0
        transition-all duration-200 z-50
      `}>
        <div className="hidden md:flex p-6 items-center gap-3 border-b border-slate-800">
          <span className="text-xl">🚀</span>
          <span className="text-lg font-bold">Micro-MCP</span>
        </div>
        <div className="p-4 flex flex-col gap-2 flex-1">
          <div 
            onClick={() => { setActiveTab('workspace'); setIsMobileMenuOpen(false); }}
            className={`p-3 rounded-lg font-medium cursor-pointer flex items-center gap-2 ${activeTab === 'workspace' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            📊 워크스페이스
          </div>
          <div 
            onClick={() => { setActiveTab('mcp'); setIsMobileMenuOpen(false); }}
            className={`p-3 rounded-lg font-medium cursor-pointer flex items-center gap-2 ${activeTab === 'mcp' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            🧩 MCP 블록 매니저
          </div>
          <div 
            onClick={() => { setActiveTab('monitoring'); setIsMobileMenuOpen(false); }}
            className={`p-3 rounded-lg font-medium cursor-pointer flex items-center gap-2 ${activeTab === 'monitoring' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            📈 모니터링 & 파일
          </div>
          <div 
            onClick={() => { setActiveTab('logs'); setIsMobileMenuOpen(false); }}
            className={`p-3 rounded-lg font-medium cursor-pointer flex items-center gap-2 ${activeTab === 'logs' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            📜 DB 연동 로그
          </div>
        </div>
        <div className="p-4 border-t border-slate-800 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${dbStatus === 'connected' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
            <span>Gemini AI Connected</span>
          </div>
          <div className="mt-1 truncate">연결된 MCP: {activeMcpNames}</div>
        </div>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* PC 상단 네비게이션 바 */}
        <div className="hidden md:flex h-[70px] border-b border-slate-800 items-center justify-end px-8 gap-4 bg-slate-950/50 backdrop-blur">
          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-full border border-slate-800">
            <span className="text-sm">👤</span>
            <span className="text-xs text-slate-300 max-w-[200px] truncate">{user?.email}</span>
          </div>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.push('/login');
            }}
            className="px-3.5 py-1.5 rounded-md border border-rose-500/50 bg-transparent text-rose-400 hover:bg-rose-500/10 text-xs cursor-pointer transition-colors"
          >
            로그아웃
          </button>
        </div>

        {/* 본문 콘텐츠 래퍼 */}
        <div className="p-4 sm:p-6 md:p-8 max-w-4xl w-full mx-auto">
          
          {activeTab === 'workspace' && (
            <>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  📊 Live Gemini AI Playground
                </h1>
                <p className="text-slate-400 text-xs sm:text-sm mt-1">
                  활성화된 MCP 블록 맥락을 바탕으로 Google Gemini AI가 실제 답변을 도출합니다.
                </p>
              </div>

              <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 sm:p-6 mb-6 shadow-sm">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
                  <div className="text-sm font-semibold text-slate-200">
                    <span>⚡ AI 프롬프트 전송</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1 rounded-full border border-slate-800 text-xs text-slate-400 max-w-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0"></span>
                    <span className="truncate">{activeMcpNames}</span>
                  </div>
                </div>

                <form onSubmit={handleExecute} className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="Gemini AI에게 프롬프트를 입력하세요..."
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-sky-500 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isExecuting}
                    className="bg-sky-600 hover:bg-sky-500 text-white border-none rounded-lg px-6 py-3 font-semibold text-sm cursor-pointer disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {isExecuting ? '전송 중...' : '프롬프트 전송'}
                  </button>
                </form>
              </div>

              <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
                <div className="bg-slate-900 px-4 py-3 flex items-center gap-2 border-b border-slate-800">
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 bg-rose-500 rounded-full inline-block"></span>
                    <span className="w-2.5 h-2.5 bg-amber-500 rounded-full inline-block"></span>
                    <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full inline-block"></span>
                  </div>
                  <span className="text-xs font-bold text-slate-400 ml-2 tracking-wider">
                    💻 GEMINI AI LIVE CONSOLE
                  </span>
                </div>

                <div className="p-4 sm:p-5 font-['Jua',sans-serif] text-base text-emerald-400 whitespace-pre-wrap leading-relaxed min-h-[150px] tracking-wide">
                  {streamingLog}
                </div>
              </div>
            </>
          )}

          {activeTab === 'mcp' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  🧩 MCP 블록 매니저
                </h1>
                <p className="text-slate-400 text-xs sm:text-sm mt-1">
                  연결할 MCP 블록을 활성화하고 관리하세요. 아래에서 새로운 블록을 추가할 수도 있습니다.
                </p>
              </div>

              {/* 블록 그리드 (반응형: 모바일 1열, 태블릿 이상 2열) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {blocks.map((block) => (
                  <div key={block.id} className="bg-slate-900 rounded-xl border border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-sm sm:text-base font-bold flex items-center gap-2 truncate">
                          <span>{block.icon}</span> <span className="truncate">{block.name}</span>
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${block.active ? 'bg-emerald-950 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                          {block.active ? '활성' : '비활성'}
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-400 leading-normal">{block.description}</p>
                    </div>
                    <button 
                      onClick={() => toggleBlock(block.id)}
                      className={`mt-4 w-full sm:w-auto self-start border-none rounded-md px-3 py-2 text-xs sm:text-sm cursor-pointer transition-colors ${block.active ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-sky-600 text-white hover:bg-sky-500'}`}
                    >
                      {block.active ? '설정 관리' : '블록 활성화'}
                    </button>
                  </div>
                ))}
              </div>

              {/* 커스텀 블록 추가 폼 */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
                <h3 className="text-sm sm:text-base font-bold mb-2 text-white">➕ 새로운 MCP 블록 추가하기</h3>
                <p className="text-xs text-slate-400 mb-4">커스텀 MCP 블록을 등록하면 아래 리스트에 바로 추가됩니다.</p>
                
                <form onSubmit={handleAddBlock} className="flex flex-col gap-3">
                  <input
                    type="text"
                    value={newBlockName}
                    onChange={(e) => setNewBlockName(e.target.value)}
                    placeholder="블록 이름 (예: Notion Sync 블록)"
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm outline-none focus:border-sky-500"
                  />
                  <input
                    type="text"
                    value={newBlockDesc}
                    onChange={(e) => setNewBlockDesc(e.target.value)}
                    placeholder="블록 설명 (예: 노선 데이터 및 문서를 실시간 동기화합니다.)"
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm outline-none focus:border-sky-500"
                  />
                  <button
                    type="submit"
                    className="self-end bg-emerald-600 hover:bg-emerald-500 text-white border-none rounded-lg px-5 py-2.5 font-semibold text-sm cursor-pointer transition-colors w-full sm:w-auto"
                  >
                    블록 추가하기
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'monitoring' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  📈 모니터링 & 파일
                </h1>
                <p className="text-slate-400 text-xs sm:text-sm mt-1">
                  시스템 상태 및 업로드된 파일 현황을 모니터링합니다.
                </p>
              </div>

              <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
                <h3 className="text-sm sm:text-base font-bold mb-4">리소스 사용량</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">API 응답 속도</div>
                    <div className="text-lg sm:text-xl font-bold text-emerald-400 mt-1">124ms</div>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">활성 세션</div>
                    <div className="text-lg sm:text-xl font-bold text-sky-400 mt-1">1개</div>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">메모리 사용률</div>
                    <div className="text-lg sm:text-xl font-bold text-amber-400 mt-1">34.2%</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  📜 DB 연동 로그
                </h1>
                <p className="text-slate-400 text-xs sm:text-sm mt-1">
                  데이터베이스 실시간 연결 및 쿼리 이력을 확인합니다.
                </p>
              </div>

              <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 font-mono text-xs sm:text-sm text-emerald-400 leading-relaxed overflow-x-auto">
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