'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';

interface LogItem {
  id: string;
  prompt: string;
  result: string;
  time: string;
  mcpName?: string;
}

interface McpServer {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  category: string;
}

interface FileItem {
  id: string;
  name: string;
  size: string;
  type: string;
  date: string;
}

export default function HomePage() {
  const [activeMenu, setActiveMenu] = useState<'dashboard' | 'mcp' | 'database' | 'analytics'>('dashboard');
  const [inputText, setInputText] = useState('');
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([
    { id: '1', name: 'Notion Workspace', description: '노션 데이터베이스 및 페이지 읽기/쓰기', status: 'active', category: 'PRODUCTIVITY' },
    { id: '2', name: 'Slack Connector', description: '슬랙 채널 메시지 전송 및 알림 수신', status: 'active', category: 'COMMUNICATION' },
    { id: '3', name: 'PostgreSQL DB', description: '데이터베이스 쿼리 실행 및 결과 조회', status: 'active', category: 'DATABASE' },
    { id: '4', name: 'GitHub Integration', description: '리포지토리 커밋 및 PR 이슈 조회', status: 'inactive', category: 'DEVELOPER TOOLS' },
  ]);

  // AI 실행 상태
  const [isExecuting, setIsExecuting] = useState(false);
  const [streamingLog, setStreamingLog] = useState<string | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // 스토리지 파일 상태
  const [files, setFiles] = useState<FileItem[]>([
    { id: '1', name: '2026_프로젝트_기획서.pdf', size: '2.4 MB', type: 'PDF', date: '2026-07-20' },
    { id: '2', name: 'Database_Schema.sql', size: '15 KB', type: 'Code', date: '2026-07-21' },
  ]);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const activeMcpNames = mcpServers
    .filter((s) => s.status === 'active')
    .map((s) => s.name)
    .join(', ') || 'No Active MCP';

  const toggleMcpStatus = (id: string) => {
    setMcpServers((prev) =>
      prev.map((server) =>
        server.id === id
          ? { ...server, status: server.status === 'active' ? 'inactive' : 'active' }
          : server
      )
    );
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isExecuting) return;

    setIsExecuting(true);
    const currentPrompt = inputText;
    setInputText('');
    setStreamingLog(`[MCP CORE] Query: "${currentPrompt}"\n[CONNECTORS] [${activeMcpNames}]\n[ANALYZING] Processing via Gemini API...`);

    let aiAnswer = '';
    let isSuccess = true;

    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

      if (!apiKey) {
        aiAnswer = '⚠️ Gemini API 키가 설정되지 않았습니다. .env.local 설정을 확인하세요.';
        isSuccess = false;
      } else {
        const promptWithContext = `[System Context: Active MCP Tools = ${activeMcpNames}]\n\n${currentPrompt}`;

        // 라이브러리 엔드포인트 404 방지를 위해 직접 REST API 타격
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptWithContext }] }],
            }),
          }
        );

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error?.message || `HTTP ${res.status} Error`);
        }

        aiAnswer = data.candidates?.[0]?.content?.parts?.[0]?.text || '답변을 가져올 수 없습니다.';
      }
    } catch (err: any) {
      console.error('Gemini API Error:', err);
      aiAnswer = `[ERROR] AI 요청 실패: ${err.message || '알 수 없는 오류가 발생했습니다.'}`;
      isSuccess = false;
    }

    setStreamingLog(null);

    const now = new Date();
    const timeStr = `오후 ${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    setLogs((prev) => [
      {
        id: Date.now().toString(),
        prompt: currentPrompt,
        result: aiAnswer,
        time: timeStr,
        mcpName: activeMcpNames,
      },
      ...prev,
    ]);

    setIsExecuting(false);
  };

  return (
    <div className="flex h-screen bg-[#07090e] text-slate-100 font-sans overflow-hidden">
      {/* 좌측 사이드바 */}
      <aside className="w-64 bg-[#0c0f17] border-r border-slate-800/80 flex flex-col justify-between p-4 flex-shrink-0">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-500/20">
              🚀
            </div>
            <span className="font-bold text-lg tracking-tight text-white">Micro-MCP</span>
          </div>

          <nav className="space-y-1">
            <button
              onClick={() => setActiveMenu('dashboard')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeMenu === 'dashboard'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <span>📊</span> 워크스페이스
            </button>
            <button
              onClick={() => setActiveMenu('mcp')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeMenu === 'mcp'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <span>🧩</span> MCP 블록 매니저
            </button>
            <button
              onClick={() => setActiveMenu('analytics')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeMenu === 'analytics'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <span>📈</span> 모니터링 & 파일
            </button>
            <button
              onClick={() => setActiveMenu('database')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeMenu === 'database'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <span>🗄️</span> DB 연동 로그
            </button>
          </nav>
        </div>

        <div className="p-3 bg-[#07090e] rounded-xl border border-slate-800 text-xs text-slate-400 space-y-1">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Gemini Connected
          </div>
          <div>활성 MCP: {mcpServers.filter((s) => s.status === 'active').length}개 작동 중</div>
        </div>
      </aside>

      {/* 메인 콘텐트 */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto bg-[#07090e] p-8 space-y-6">
        {/* 1. 워크스페이스 (메인 콘솔) */}
        {activeMenu === 'dashboard' && (
          <div className="space-y-6 max-w-6xl w-full mx-auto">
            <div className="bg-[#0c0f17] border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  ⚡ AI 프롬프트 전송
                </h2>
                <span className="text-xs bg-slate-800/80 text-cyan-400 border border-cyan-500/30 px-3 py-1 rounded-full">
                  {mcpServers.filter((s) => s.status === 'active').length > 0
                    ? `● 활성화된 MCP (${mcpServers.filter((s) => s.status === 'active').length}개)`
                    : '⚪ 활성화된 MCP 없음'}
                </span>
              </div>

              <form onSubmit={handleExecute} className="flex gap-3">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Gemini AI에게 프롬프트를 입력하세요 (예: 노선 정리해줘, 오늘 할일 추천해줘)..."
                  className="flex-1 bg-[#07090e] border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 transition-all"
                />
                <button
                  type="submit"
                  disabled={isExecuting}
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-6 py-3 rounded-xl text-sm transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {isExecuting ? '전송 중...' : '프롬프트 전송'}
                </button>
              </form>
            </div>

            {/* 터미널 콘솔 로그 */}
            <div className="bg-[#0c0f17] border border-slate-800 rounded-2xl p-6 shadow-2xl font-mono text-xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                <span className="text-slate-400 text-[11px] ml-2">💻 GEMINI AI LIVE CONSOLE</span>
              </div>

              {streamingLog && (
                <div className="p-3 bg-[#07090e] border border-cyan-500/30 rounded-xl text-cyan-400 whitespace-pre-wrap">
                  {streamingLog}
                </div>
              )}

              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                {logs.length === 0 ? (
                  <p className="text-slate-500">명령어를 입력하면 여기에 실시간 실행 결과가 표시됩니다.</p>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="p-3.5 bg-[#07090e] border border-slate-800/80 rounded-xl space-y-1.5">
                      <div className="text-slate-400 flex items-center justify-between">
                        <span>[{log.time}] &gt; <strong className="text-slate-200">[Prompt] {log.prompt}</strong></span>
                        <span className="text-[10px] text-cyan-500/70">({log.mcpName})</span>
                      </div>
                      <div className="text-emerald-400 pl-3 border-l-2 border-emerald-500/40 whitespace-pre-wrap leading-relaxed">
                        {log.result}
                      </div>
                    </div>
                  ))
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* 2. MCP 블록 매니저 */}
        {activeMenu === 'mcp' && (
          <div className="space-y-6 max-w-6xl w-full mx-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                🧩 MCP 블록 매니저
              </h2>
              <button className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-cyan-500/20">
                + 새 연동 블록 추가
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mcpServers.map((server) => (
                <div
                  key={server.id}
                  className={`p-5 rounded-2xl border transition-all ${
                    server.status === 'active'
                      ? 'bg-[#0c0f17] border-cyan-500/40 shadow-xl shadow-cyan-950/20'
                      : 'bg-[#080b12] border-slate-800 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 px-2.5 py-1 rounded-md border border-cyan-800/50">
                        {server.category}
                      </span>
                      <h3 className="font-bold text-base mt-2.5 text-white">{server.name}</h3>
                    </div>
                    <button
                      onClick={() => toggleMcpStatus(server.id)}
                      className={`px-3.5 py-1 text-xs font-semibold rounded-full border transition-all ${
                        server.status === 'active'
                          ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {server.status === 'active' ? 'ON (활성화)' : 'OFF (비활성)'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{server.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. 모니터링 & 파일 */}
        {activeMenu === 'analytics' && (
          <div className="space-y-6 max-w-6xl w-full mx-auto">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              📈 모니터링 & AI 참조 컨텍스트 파일
            </h2>

            <div className="bg-[#0c0f17] border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="font-semibold text-sm text-slate-200">
                  📁 등록된 AI 참조 컨텍스트 파일
                </h3>
                <button className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all">
                  + 파일 추가
                </button>
              </div>

              <div className="space-y-2">
                {files.map((file) => (
                  <div key={file.id} className="flex items-center justify-between p-3.5 bg-[#07090e] border border-slate-800/80 rounded-xl text-xs">
                    <div className="flex items-center gap-3">
                      <span>📄</span>
                      <span className="font-medium text-slate-200">{file.name}</span>
                    </div>
                    <div className="text-slate-500 font-mono">
                      {file.size} • {file.date}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 4. DB 연동 로그 */}
        {activeMenu === 'database' && (
          <div className="space-y-6 max-w-6xl w-full mx-auto">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              🗄️ PostgreSQL 및 Supabase 연동 DB 로그
            </h2>

            <div className="bg-[#0c0f17] border border-slate-800 rounded-2xl p-6 font-mono text-xs space-y-2 text-slate-400 shadow-2xl">
              <div className="text-emerald-400">[2026-07-21 15:40:01] [DB_POOL] Connected to Supabase PostgreSQL instance.</div>
              <div className="text-cyan-400">[2026-07-21 15:41:12] [NOTION_CONNECTOR] Syncing workspace blocks...</div>
              <div className="text-slate-500">[2026-07-21 15:42:05] [MCP_BRIDGE] All connectors healthy. 0 errors.</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}