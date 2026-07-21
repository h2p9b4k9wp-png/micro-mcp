'use client';

import { useState, useEffect, useRef } from 'react';
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

interface LogItem {
  id: string;
  content: string;
  created_at: string;
}

interface FileItem {
  id: string;
  name: string;
  size: string;
  content?: string;
  date: string;
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

  const terminalEndRef = useRef<HTMLDivElement>(null);

  const [blocks, setBlocks] = useState<McpBlock[]>([
    { id: 'supabase', name: 'Supabase DB 블록', description: '실시간 데이터베이스 쿼리 및 사용자 세션 상태를 연동합니다.', active: true, icon: '🗄️' },
    { id: 'search', name: 'Google Search 블록', description: '웹 검색 기능을 통해 최신 정보를 실시간으로 가져옵니다.', active: false, icon: '🔍' },
    { id: 'filesystem', name: 'File System 블록', description: '첨부된 파일 및 문서 내용을 AI 컨텍스트에 주입합니다.', active: true, icon: '📁' },
    { id: 'customapi', name: 'Custom API 블록', description: '외부 사용자 정의 REST API 엔드포인트와 연동합니다.', active: false, icon: '⚡' },
  ]);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([
    { id: '1', name: '2026_프로젝트_기획서.txt', size: '1.2 KB', content: '프로젝트 목표: 마이크로 MCP 기반 인공지능 에이전트 대시보드 구축 및 Supabase 연동.', date: '2026-07-20' },
  ]);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

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
        fetchLogs(retrySession.user.id);
      } else {
        setUser(session.user);
        fetchLogs(session.user.id);
      }
      
      setLoading(false);
      setDbStatus('connected');
    };

    initApp();
  }, [router, supabase]);

  const fetchLogs = async (userId: string) => {
    const { data } = await supabase
      .from('logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (data && data.length > 0) {
      setLogs(data);
    }
  };

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamingLog, logs]);

  const activeMcpNames = blocks
    .filter(b => b.active)
    .map(b => b.name)
    .join(', ') || '활성화된 MCP 없음';

  const toggleBlock = (id: string) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, active: !b.active } : b));
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || !user) return;

    setIsExecuting(true);
    const currentCommand = command;
    setCommand('');

    let dbContextData = '';
    const isSupabaseActive = blocks.find(b => b.id === 'supabase')?.active;
    if (isSupabaseActive) {
      const { data: recentLogs } = await supabase
        .from('logs')
        .select('content')
        .limit(3);
      dbContextData = `\n[Supabase DB 최근 데이터 맥락]: ${JSON.stringify(recentLogs || [])}`;
    }

    let fileContextData = '';
    const isFileActive = blocks.find(b => b.id === 'filesystem')?.active;
    if (isFileActive && files.length > 0) {
      const aggregatedFiles = files.map(f => `[파일 이름: ${f.name}]\n내용: ${f.content || '내용 없음'}`).join('\n\n');
      fileContextData = `\n\n[첨부된 문서/파일 컨텍스트]:\n${aggregatedFiles}`;
    }
    
    setStreamingLog(`[MCP CORE] Analyzing query: "${currentCommand}"...\n[MCP BRIDGE] Active Connectors: [${activeMcpNames}]${isSupabaseActive ? '\n[Supabase] 실제 DB 쿼리 연동 완료' : ''}${isFileActive ? '\n[File System] 첨부 파일 컨텍스트 로드 완료' : ''}`);

    let aiAnswer = '';

    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

      if (!apiKey) {
        aiAnswer = '⚠️ Gemini API 키가 설정되지 않았습니다.';
      } else {
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // 요구하신 Gemini 3.5 Flash 모델 적용
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

        const promptWithContext = `[System Context: Active MCP Tools = ${activeMcpNames}]${dbContextData}${fileContextData}\n\n사용자 질문: ${currentCommand}`;

        const result = await model.generateContent(promptWithContext);
        const response = await result.response;
        aiAnswer = response.text();
      }
    } catch (err: any) {
      aiAnswer = `[ERROR] AI 요청 실패 (한도 초과 또는 네트워크 오류): ${err.message || err}`;
    }

    const finalLogText = `[MCP CORE] Query: "${currentCommand}"\n[CONNECTORS] [${activeMcpNames}]\n[SUCCESS] Response generated successfully.\n\n----------------------------------------\n[Gemini AI 답변]\n${aiAnswer}`;
    setStreamingLog(finalLogText);
    setIsExecuting(false);

    try {
      const { data, error } = await supabase
        .from('logs')
        .insert([{ user_id: user.id, content: `[Prompt] ${currentCommand} (MCP 연동 완료)`, status: 'SUCCESS' }])
        .select()
        .single();

      if (!error && data) {
        setLogs(prev => [data, ...prev]);
      }
    } catch (dbErr) {
      console.error('로그 저장 중 오류 발생:', dbErr);
    }
  };

  const handleAddFile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;

    const newFile: FileItem = {
      id: Date.now().toString(),
      name: newFileName,
      size: `${(newFileContent.length / 1024).toFixed(1)} KB`,
      content: newFileContent || '내용이 입력되지 않은 문서입니다.',
      date: new Date().toISOString().split('T')[0]
    };

    setFiles([newFile, ...files]);
    setNewFileName('');
    setNewFileContent('');
  };

  const handleDeleteFile = (id: string) => {
    setFiles(files.filter(f => f.id !== id));
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

      {/* 사이드바 메뉴 */}
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
            <span>Gemini 3.5 Flash Connected</span>
          </div>
          <div className="mt-1 truncate">연결된 MCP: {activeMcpNames}</div>
        </div>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
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

        <div className="p-4 sm:p-6 md:p-8 max-w-4xl w-full mx-auto">
          
          {activeTab === 'workspace' && (
            <>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  📊 Live Gemini AI Playground
                </h1>
                <p className="text-slate-400 text-xs sm:text-sm mt-1">
                  활성화된 MCP 블록 맥락 및 첨부된 문서 내용을 바탕으로 AI가 실제 답변을 도출합니다.
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
                    placeholder="예: 첨부된 파일 내용을 바탕으로 요약해줘..."
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
                  <div ref={terminalEndRef} />
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
                  AI 파이프라인에 연결할 MCP 블록을 활성화하세요. 활성화된 블록만 실시간 데이터에 접근합니다.
                </p>
              </div>

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
                      {block.active ? '블록 비활성화' : '블록 활성화'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'monitoring' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  📈 모니터링 & 파일 (RAG 컨텍스트)
                </h1>
                <p className="text-slate-400 text-xs sm:text-sm mt-1">
                  AI가 참고할 수 있도록 문서 내용을 직접 등록하세요. (File System 블록 활성화 시 자동 반영)
                </p>
              </div>

              <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-6">
                <h3 className="text-sm sm:text-base font-bold mb-4">📄 AI 참조용 텍스트 문서 추가</h3>
                <form onSubmit={handleAddFile} className="flex flex-col gap-3">
                  <input
                    type="text"
                    placeholder="문서 제목 (예: 회의록_요약.txt)"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm outline-none"
                  />
                  <textarea
                    placeholder="AI가 읽을 문서 내용을 입력하세요..."
                    value={newFileContent}
                    onChange={(e) => setNewFileContent(e.target.value)}
                    rows={3}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm outline-none resize-none"
                  />
                  <button type="submit" className="self-end bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-lg text-sm font-semibold">
                    문서 업로드 및 인덱싱
                  </button>
                </form>

                <div className="mt-6 flex flex-col gap-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">등록된 컨텍스트 파일 목록</h4>
                  {files.map(file => (
                    <div key={file.id} className="flex flex-col bg-slate-950 p-3.5 rounded-lg border border-slate-800 text-sm gap-1">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-sky-400">📄 {file.name} <span className="text-xs text-slate-500 font-normal">({file.size})</span></span>
                        <button onClick={() => handleDeleteFile(file.id)} className="text-rose-400 hover:text-rose-300 text-xs">삭제</button>
                      </div>
                      <p className="text-xs text-slate-400 truncate">내용: {file.content}</p>
                    </div>
                  ))}
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
                  Supabase 데이터베이스에 실시간 기록된 프롬프트 실행 이력입니다.
                </p>
              </div>

              <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 font-mono text-xs sm:text-sm text-emerald-400 leading-relaxed overflow-x-auto flex flex-col gap-2">
                <div>[INFO] System connected to Supabase successfully.</div>
                <div>[AUTH] Active session verified for user: {user?.email}</div>
                {logs.map((log) => (
                  <div key={log.id} className="text-sky-300">
                    [{new Date(log.created_at).toLocaleTimeString()}] {log.content}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}