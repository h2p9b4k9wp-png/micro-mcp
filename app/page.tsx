'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

interface LogItem {
  id: string;
  content: string;
  status: string;
  created_at: string;
}

interface McpServer {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  is_active: boolean;
}

interface FileItem {
  id: string;
  name: string;
  size: string;
  type: string;
  date: string;
}

const PRESET_MCP_SERVERS = [
  { name: 'Notion Workspace', category: 'Document', description: '내 노션 페이지 및 문서를 AI 컨텍스트로 불러옵니다.', icon: '📝' },
  { name: 'GitHub Repositories', category: 'Developer', description: '소스코드 검색, 이슈 생성 및 커밋 내역을 분석합니다.', icon: '🐙' },
  { name: 'Google Calendar', category: 'Productivity', description: '일정 확인 및 새로운 스케줄 등록을 지원합니다.', icon: '📅' },
  { name: 'Local File System', category: 'Storage', description: '지정한 내 컴퓨터 폴더 안의 파일들을 직접 읽습니다.', icon: '📁' },
];

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  
  const [activeMenu, setActiveMenu] = useState<'dashboard' | 'mcp' | 'database' | 'analytics'>('dashboard');
  const [inputText, setInputText] = useState('');
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  
  // 3단계 AI 라이브 스트리밍 상태
  const [isExecuting, setIsExecuting] = useState(false);
  const [streamingLog, setStreamingLog] = useState<string | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // 4단계 스토리지 파일 상태
  const [files, setFiles] = useState<FileItem[]>([
    { id: '1', name: '2026_프로젝트_기획서.pdf', size: '2.4 MB', type: 'PDF', date: '2026-07-20' },
    { id: '2', name: 'Database_Schema.sql', size: '15 KB', type: 'Code', date: '2026-07-21' },
  ]);
  const [newFileName, setNewFileName] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const initApp = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push('/login');
        return;
      }
      
      setUser(session.user);
      setLoading(false);
      setDbStatus('connected');

      fetchLogs(session.user.id);
      fetchMcpServers(session.user.id);
    };

    initApp();
  }, [router, supabase]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, streamingLog]);

  const fetchLogs = async (userId: string) => {
    const { data } = await supabase
      .from('logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (data) setLogs(data);
  };

  const fetchMcpServers = async (userId: string) => {
    const { data } = await supabase
      .from('mcp_servers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (data) setMcpServers(data);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  // 💡 제미나이 API 연동 실행 핸들러
  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isExecuting || !user) return;

    setIsExecuting(true);
    const command = inputText;
    setInputText('');

    const activeMcps = mcpServers.filter(s => s.is_active);
    const mcpNames = activeMcps.length > 0 
      ? activeMcps.map(m => m.name).join(', ') 
      : 'No Active MCP';

    // 초기 터미널 애니메이션 단계 출력
    const steps = [
      `[MCP CORE] Analyzing query: "${command}"...`,
      activeMcps.length > 0 
        ? `[MCP BRIDGE] Routing request to connected tools: [${mcpNames}]`
        : `[MCP BRIDGE] No external MCP tools enabled. Running default AI model.`,
      `[PROCESSING] Generating context-aware payload...`
    ];

    let currentText = '';
    for (let i = 0; i < steps.length; i++) {
      await new Promise(res => setTimeout(res, 300));
      currentText += (i === 0 ? '' : '\n') + steps[i];
      setStreamingLog(currentText);
    }

    let aiResultText = '';

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
      
      const systemInstruction = `You are Micro-MCP AI assistant. Active MCP tools: [${mcpNames}].`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: command,
        config: {
          systemInstruction: systemInstruction,
        }
      });

      aiResultText = response.text || 'AI 응답이 완료되었습니다.';
    } catch (err) {
      console.error(err);
      aiResultText = '제미나이 API 호출 중 오류가 발생했습니다.';
    }

    const finalStepLog = `\n[GEMINI AI RESULT]\n${aiResultText}`;
    setStreamingLog(currentText + finalStepLog);

    const fullContent = `[Prompt] ${command}  -->  [Response] ${aiResultText} (${mcpNames})`;

    try {
      const { data, error } = await supabase
        .from('logs')
        .insert([{ user_id: user.id, content: fullContent, status: 'SUCCESS' }])
        .select()
        .single();

      if (!error && data) {
        setLogs((prev) => [data, ...prev]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setStreamingLog(null);
      setIsExecuting(false);
    }
  };

  const handleDeleteLog = async (id: string) => {
    const { error } = await supabase.from('logs').delete().eq('id', id);
    if (!error) setLogs((prev) => prev.filter((log) => log.id !== id));
  };

  const handleAddMcp = async (preset: typeof PRESET_MCP_SERVERS[0]) => {
    if (!user) return;
    if (mcpServers.some(s => s.name === preset.name)) {
      alert('이미 등록된 MCP 블록입니다!');
      return;
    }

    const { data, error } = await supabase
      .from('mcp_servers')
      .insert([{
        user_id: user.id,
        name: preset.name,
        category: preset.category,
        description: preset.description,
        icon: preset.icon,
        is_active: true
      }])
      .select()
      .single();

    if (!error && data) setMcpServers((prev) => [...prev, data]);
  };

  const handleToggleMcp = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('mcp_servers')
      .update({ is_active: !currentStatus })
      .eq('id', id);

    if (!error) {
      setMcpServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, is_active: !currentStatus } : s))
      );
    }
  };

  const handleDeleteMcp = async (id: string) => {
    const { error } = await supabase.from('mcp_servers').delete().eq('id', id);
    if (!error) setMcpServers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleAddFile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    
    const newFile: FileItem = {
      id: Date.now().toString(),
      name: newFileName,
      size: '1.2 MB',
      type: 'DOC',
      date: new Date().toISOString().split('T')[0]
    };

    setFiles([newFile, ...files]);
    setNewFileName('');
  };

  const handleDeleteFile = (id: string) => {
    setFiles(files.filter(f => f.id !== id));
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#090d16', color: '#fff' }}>
        <div style={{ textAlign: 'center' }}>
          <span style={{ display: 'inline-block', fontSize: '40px', animation: 'pulse 1.5s infinite' }}>🚀</span>
          <p style={{ marginTop: '16px', fontSize: '16px', color: '#94a3b8' }}>Micro-MCP 데이터베이스 연결 중...</p>
        </div>
      </div>
    );
  }

  const activeMcpCount = mcpServers.filter(s => s.is_active).length;

  return (
    <div className="app-container">
      {/* 사이드바 */}
      <aside className="sidebar">
        <div className="logo-area">
          <span className="logo-icon">🚀</span>
          <span className="logo-text">Micro-MCP</span>
        </div>

        <nav className="nav-menu">
          <button 
            onClick={() => setActiveMenu('dashboard')}
            className={`nav-item ${activeMenu === 'dashboard' ? 'active' : ''}`}
          >
            <span className="icon">📊</span> 워크스페이스
          </button>
          <button 
            onClick={() => setActiveMenu('mcp')}
            className={`nav-item ${activeMenu === 'mcp' ? 'active' : ''}`}
          >
            <span className="icon">🧩</span> MCP 블록 매니저
            {activeMcpCount > 0 && <span className="badge">{activeMcpCount}</span>}
          </button>
          <button 
            onClick={() => setActiveMenu('analytics')}
            className={`nav-item ${activeMenu === 'analytics' ? 'active' : ''}`}
          >
            <span className="icon">📈</span> 모니터링 & 파일
          </button>
          <button 
            onClick={() => setActiveMenu('database')}
            className={`nav-item ${activeMenu === 'database' ? 'active' : ''}`}
          >
            <span className="icon">🗄️</span> DB 연동 로그
          </button>
        </nav>

        <div className="status-card">
          <div className="status-item">
            <span className={`status-dot ${dbStatus === 'connected' ? 'online' : 'offline'}`}></span>
            <span>DB Realtime: Active</span>
          </div>
          <div style={{ marginTop: '6px', color: '#38bdf8' }}>연결된 MCP: {activeMcpCount}개 활성</div>
        </div>
      </aside>

      {/* 메인 콘텐츠 */}
      <div className="main-content">
        <header className="main-header">
          <div className="user-profile">
            <span className="user-avatar">👤</span>
            <span className="user-email">{user?.email}</span>
            <button onClick={handleSignOut} className="btn-logout">로그아웃</button>
          </div>
        </header>

        <main className="content-body">
          {activeMenu === 'dashboard' && (
            <div className="fade-in">
              <div className="page-title-area">
                <h1 className="page-title">📊 Live Playground Console</h1>
                <p className="page-desc">
                  활성화된 MCP 블록({activeMcpCount}개)이 자동으로 연동되어 AI 프롬프트를 실시간 스트리밍 처리합니다.
                </p>
              </div>

              <div className="work-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 className="card-title" style={{ margin: 0 }}>⚡ AI 프롬프트 실행 및 MCP 테스트</h3>
                  <div className="active-mcp-tag">
                    {activeMcpCount > 0 ? `🟢 ${activeMcpCount}개 MCP 커넥터 작동 중` : '⚪ 활성화된 MCP 없음'}
                  </div>
                </div>
                <form onSubmit={handleExecute} className="input-group">
                  <input 
                    type="text" 
                    placeholder={activeMcpCount > 0 ? "예: 노션 문서 정리해줘, 구글 달력에 오늘 일정 추가해줘..." : "명령어를 입력하세요..."}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    className="console-input"
                    disabled={isExecuting}
                  />
                  <button type="submit" className="btn-execute" disabled={isExecuting}>
                    {isExecuting ? 'AI 실행 중...' : '프롬프트 전송'}
                  </button>
                </form>
              </div>

              <div className="terminal-container">
                <div className="terminal-header">
                  <div className="terminal-dots">
                    <span className="dot red"></span>
                    <span className="dot yellow"></span>
                    <span className="dot green"></span>
                  </div>
                  <span className="terminal-title">📟 LIVE STREAMING CONSOLE</span>
                </div>
                <div className="terminal-body">
                  {streamingLog && (
                    <div className="streaming-box">
                      <pre className="streaming-text">{streamingLog}</pre>
                      <span className="blinking-cursor">▌</span>
                    </div>
                  )}

                  {logs.length === 0 && !streamingLog ? (
                    <div className="empty-log">
                      활성화된 MCP 블록을 사용하여 프롬프트를 전송해보세요. 실시간 실행 로그가 촤르륵 연출됩니다!
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div key={log.id} className="log-line-item">
                        <div className="log-content-box">
                          <span className="log-time">[{new Date(log.created_at).toLocaleTimeString()}]</span>
                          <span className="log-arrow">&gt;</span>
                          <span className="log-text">{log.content}</span>
                        </div>
                        <button onClick={() => handleDeleteLog(log.id)} className="btn-delete-log">✕</button>
                      </div>
                    ))
                  )}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            </div>
          )}

          {/* MCP 블록 매니저 */}
          {activeMenu === 'mcp' && (
            <div className="fade-in">
              <div className="page-title-area">
                <h1 className="page-title">🧩 Visual MCP Block Builder</h1>
                <p className="page-desc">원클릭으로 원하는 도구를 레고 블록처럼 연결하여 AI의 능력을 확장하세요.</p>
              </div>

              <div className="preset-section">
                <h3 className="section-subtitle">⚡ 빠른 MCP 블록 추가하기</h3>
                <div className="preset-grid">
                  {PRESET_MCP_SERVERS.map((preset, idx) => (
                    <div key={idx} className="preset-card">
                      <div className="preset-header">
                        <span className="preset-icon">{preset.icon}</span>
                        <span className="preset-category">{preset.category}</span>
                      </div>
                      <div className="preset-name">{preset.name}</div>
                      <div className="preset-desc">{preset.description}</div>
                      <button onClick={() => handleAddMcp(preset)} className="btn-add-preset">+ 연결 추가</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="active-mcp-section">
                <h3 className="section-subtitle">🔌 현재 내 계정에 연결된 MCP 블록 ({mcpServers.length})</h3>
                {mcpServers.length === 0 ? (
                  <div className="empty-block-box">
                    위에서 원하는 연동 블록의 <strong>[+ 연결 추가]</strong> 버튼을 눌러보세요!
                  </div>
                ) : (
                  <div className="mcp-list-grid">
                    {mcpServers.map((server) => (
                      <div key={server.id} className={`mcp-item-card ${server.is_active ? 'active' : 'disabled'}`}>
                        <div className="mcp-card-top">
                          <div className="mcp-title-group">
                            <span className="mcp-item-icon">{server.icon}</span>
                            <div>
                              <div className="mcp-item-name">{server.name}</div>
                              <span className="mcp-item-cat">{server.category}</span>
                            </div>
                          </div>
                          <button onClick={() => handleDeleteMcp(server.id)} className="btn-delete-mcp">✕</button>
                        </div>
                        <p className="mcp-item-desc">{server.description}</p>
                        <div className="mcp-card-bottom">
                          <span className={`status-badge ${server.is_active ? 'on' : 'off'}`}>
                            {server.is_active ? '● LIVE ACTIVE' : '○ DISABLED'}
                          </span>
                          <button 
                            onClick={() => handleToggleMcp(server.id, server.is_active)}
                            className={`btn-toggle ${server.is_active ? 'btn-off' : 'btn-on'}`}
                          >
                            {server.is_active ? '스위치 OFF' : '스위치 ON'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 트래픽 모니터링 & 스토리지 매니저 */}
          {activeMenu === 'analytics' && (
            <div className="fade-in">
              <div className="page-title-area">
                <h1 className="page-title">📈 트래픽 분석 & AI 데이터 스토리지</h1>
                <p className="page-desc">MCP 트래픽 호출 현황을 분석하고 AI가 참조할 문서를 관리합니다.</p>
              </div>

              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">총 MCP 실행 횟수</div>
                  <div className="stat-value">{logs.length}회</div>
                  <div className="stat-sub text-success">↑ 100% 정상 처리됨</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">활성화된 커넥터</div>
                  <div className="stat-value">{activeMcpCount}개</div>
                  <div className="stat-sub">전체 {mcpServers.length}개 중</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">시스템 요청 성공률</div>
                  <div className="stat-value">99.9%</div>
                  <div className="stat-sub text-success">● Zero Error</div>
                </div>
              </div>

              <div className="work-card">
                <h3 className="card-title">📁 AI 참조용 컨텍스트 파일 등록</h3>
                <form onSubmit={handleAddFile} className="input-group" style={{ marginBottom: '20px' }}>
                  <input 
                    type="text" 
                    placeholder="등록할 문서/파일 제목을 입력하세요 (예: 2026_학회_일정표.pdf)" 
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    className="console-input"
                  />
                  <button type="submit" className="btn-execute">+ 파일 추가</button>
                </form>

                <div className="file-list">
                  <div className="file-list">
                  {files.map((file) => (
                    <div key={file.id} className="file-item">
                      <div className="file-info">
                        <span className="file-icon">📄</span>
                        <div>
                          <div className="file-name">{file.name}</div>
                          <div className="file-meta">{file.size} • {file.date}</div>
                        </div>
                      </div>
                      <button onClick={() => handleDeleteFile(file.id)} className="btn-delete-log">✕</button>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeMenu === 'database' && (
            <div className="fade-in">
              <div className="page-title-area">
                <h1 className="page-title">🗄️ Supabase 데이터베이스 상태</h1>
                <p className="page-desc">백엔드 데이터베이스 코어와 실시간 테이블 연동 상태를 모니터링합니다.</p>
              </div>
              <div className="work-card">
                <table className="status-table">
                  <thead>
                    <tr>
                      <th>테이블 명</th>
                      <th>연동 상태</th>
                      <th>총 레코드 수</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>public.logs (명령어 로그)</td>
                      <td className="text-success">● 정상 연동됨 (Active)</td>
                      <td>{logs.length}개 건</td>
                    </tr>
                    <tr>
                      <td>public.mcp_servers (MCP 서버)</td>
                      <td className="text-success">● 정상 연동됨 (Active)</td>
                      <td>{mcpServers.length}개 등록됨</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

        body { 
          margin: 0; 
          padding: 0; 
          background-color: #090d16; 
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
        }

        .terminal-body, .terminal-title, .streaming-text, .console-input, pre, code {
          font-family: 'JetBrains Mono', monospace !important;
        }

        .app-container { display: flex; min-height: 100vh; background: #090d16; color: #f1f5f9; }
        .sidebar { width: 260px; background: #0f172a; border-right: 1px solid rgba(255, 255, 255, 0.04); display: flex; flex-direction: column; padding: 24px 16px; }
        .logo-area { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; padding-left: 8px; }
        .logo-icon { font-size: 24px; filter: drop-shadow(0 0 8px #38bdf8); }
        .logo-text { font-size: 18px; font-weight: 800; background: linear-gradient(to right, #fff, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .nav-menu { display: flex; flex-direction: column; gap: 6px; flex-grow: 1; }
        .nav-item { width: 100%; padding: 12px 16px; background: transparent; color: #94a3b8; border: none; border-radius: 10px; text-align: left; cursor: pointer; font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 10px; transition: all 0.2s ease; position: relative; }
        .nav-item:hover { background: rgba(255, 255, 255, 0.03); color: #f1f5f9; }
        .nav-item.active { background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%); color: #0f172a; box-shadow: 0 4px 12px rgba(56, 189, 248, 0.25); }
        .badge { background: #0f172a; color: #38bdf8; font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 800; margin-left: auto; }
        .status-card { background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.03); padding: 14px; border-radius: 10px; font-size: 12px; color: #64748b; }
        .status-item { display: flex; align-items: center; gap: 8px; }
        .status-dot.online { width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981; }

        .main-content { flex-grow: 1; display: flex; flex-direction: column; }
        .main-header { height: 70px; background: rgba(15, 23, 42, 0.3); border-bottom: 1px solid rgba(255, 255, 255, 0.04); display: flex; align-items: center; justify-content: flex-end; padding: 0 40px; backdrop-filter: blur(8px); }
        .user-profile { display: flex; align-items: center; gap: 14px; background: rgba(255, 255, 255, 0.03); padding: 6px 14px; border-radius: 30px; border: 1px solid rgba(255, 255, 255, 0.05); }
        .user-email { font-size: 13px; color: #cbd5e1; font-weight: 500; }
        .btn-logout { padding: 6px 12px; background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 20px; cursor: pointer; font-size: 11px; font-weight: 700; }
        .content-body { flex-grow: 1; padding: 40px; max-width: 1100px; width: 100%; margin: 0 auto; }
        .page-title { font-size: 26px; font-weight: 800; color: #fff; margin: 0 0 6px 0; }
        .page-desc { color: #64748b; font-size: 14px; margin: 0 0 24px 0; }
        
        .active-mcp-tag { font-size: 12px; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.1); padding: 4px 12px; border-radius: 20px; border: 1px solid rgba(56, 189, 248, 0.2); }
        .work-card { background: #0f172a; padding: 24px; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.04); margin-bottom: 28px; }
        .card-title { font-size: 15px; font-weight: 700; color: #94a3b8; margin-top: 0; }
        .input-group { display: flex; gap: 12px; }
        .console-input { flex-grow: 1; padding: 14px 18px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.08); background: #070a12; color: #fff; font-size: 14px; outline: none; }
        .btn-execute { padding: 0 28px; background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%); color: #0f172a; border: none; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap; }

        .terminal-container { background: #05070f; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 16px; overflow: hidden; }
        .terminal-header { background: #0b0f19; padding: 14px 20px; display: flex; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.03); }
        .terminal-dots { display: flex; gap: 8px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; }
        .dot.red { background: #ef4444; } .dot.yellow { background: #f59e0b; } .dot.green { background: #10b981; }
        .terminal-title { margin-left: 20px; font-size: 11px; font-weight: 700; color: #38bdf8; }
        .terminal-body { padding: 16px 24px; min-height: 260px; max-height: 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
        .streaming-box { background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); padding: 12px 16px; border-radius: 10px; margin-bottom: 10px; display: flex; align-items: flex-end; }
        .streaming-text { color: #38bdf8; margin: 0; font-size: 13px; white-space: pre-wrap; line-height: 1.6; }
        .blinking-cursor { color: #38bdf8; animation: blink 1s infinite; margin-left: 4px; }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

        .empty-log { color: #475569; font-size: 13px; text-align: center; margin-top: 80px; }
        .log-line-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.015); }
        .log-content-box { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #cbd5e1; }
        .log-time { color: #64748b; font-size: 11px; }
        .log-arrow { color: #38bdf8; font-weight: bold; }
        .log-text { color: #e2e8f0; }
        .btn-delete-log { background: transparent; border: none; color: #64748b; cursor: pointer; font-size: 12px; }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 28px; }
        .stat-card { background: #0f172a; border: 1px solid rgba(255, 255, 255, 0.05); padding: 20px; border-radius: 14px; }
        .stat-label { font-size: 12px; color: #64748b; margin-bottom: 8px; font-weight: 600; }
        .stat-value { font-size: 28px; font-weight: 800; color: #fff; margin-bottom: 4px; }
        .stat-sub { font-size: 11px; color: #94a3b8; }
        .file-list { display: flex; flex-direction: column; gap: 10px; }
        .file-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #070a12; border-radius: 10px; border: 1px solid rgba(255,255,255,0.03); }
        .file-info { display: flex; align-items: center; gap: 12px; }
        .file-icon { font-size: 20px; }
        .file-name { font-size: 14px; font-weight: 600; color: #e2e8f0; }
        .file-meta { font-size: 11px; color: #64748b; }

        .section-subtitle { font-size: 16px; color: #cbd5e1; margin-bottom: 16px; font-weight: 700; }
        .preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 36px; }
        .preset-card { background: #0f172a; border: 1px solid rgba(255,255,255,0.05); padding: 18px; border-radius: 14px; display: flex; flex-direction: column; justify-content: space-between; }
        .preset-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .preset-icon { font-size: 22px; }
        .preset-category { font-size: 11px; background: rgba(56, 189, 248, 0.1); color: #38bdf8; padding: 2px 8px; border-radius: 6px; font-weight: 700; }
        .preset-name { font-size: 15px; font-weight: 700; color: #f1f5f9; margin-bottom: 6px; }
        .preset-desc { font-size: 12px; color: #64748b; line-height: 1.4; margin-bottom: 16px; }
        .btn-add-preset { width: 100%; padding: 8px; background: rgba(255, 255, 255, 0.05); color: #fff; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; }
        .empty-block-box { background: #070a12; border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 40px; text-align: center; color: #64748b; font-size: 14px; }
        .mcp-list-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
        .mcp-item-card { background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.3); padding: 20px; border-radius: 16px; display: flex; flex-direction: column; justify-content: space-between; }
        .mcp-item-card.disabled { border-color: rgba(255, 255, 255, 0.05); opacity: 0.6; }
        .mcp-card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
        .mcp-title-group { display: flex; gap: 12px; align-items: center; }
        .mcp-item-icon { font-size: 24px; }
        .mcp-item-name { font-size: 16px; font-weight: 700; color: #fff; }
        .mcp-item-cat { font-size: 11px; color: #64748b; }
        .btn-delete-mcp { background: transparent; border: none; color: #64748b; cursor: pointer; font-size: 14px; }
        .mcp-item-desc { font-size: 12px; color: #94a3b8; margin-bottom: 20px; line-height: 1.4; }
        .mcp-card-bottom { display: flex; justify-content: space-between; align-items: center; }
        .status-badge { font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 6px; }
        .status-badge.on { background: rgba(16, 185, 129, 0.15); color: #34d399; }
        .status-badge.off { background: rgba(239, 68, 68, 0.15); color: #f87171; }
        .btn-toggle { padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; border: none; cursor: pointer; }
        .btn-on { background: #10b981; color: #fff; }
        .btn-off { background: rgba(255,255,255,0.08); color: #94a3b8; }
        .status-table { width: 100%; border-collapse: collapse; text-align: left; }
        .status-table th { padding: 12px; color: #64748b; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .status-table td { padding: 16px 12px; font-size: 14px; color: #e2e8f0; border-bottom: 1px solid rgba(255,255,255,0.03); }
        .text-success { color: #34d399; font-weight: 600; }
        .fade-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}