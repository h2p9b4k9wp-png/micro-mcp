'use client';

import React, { useState } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('workspace');
  const [command, setCommand] = useState('');
  const [streamingLog, setStreamingLog] = useState('');
  const [logs, setLogs] = useState<Array<{ id: string; prompt: string; result: string; time: string }>>([]);
  const [loading, setLoading] = useState(false);

  // MCP 블록 상태
  const [mcpBlocks, setMcpBlocks] = useState([
    { id: 1, name: 'Notion Workspace', desc: '노션 데이터베이스 및 페이지 읽기/쓰기', active: true, category: 'Productivity' },
    { id: 2, name: 'Slack Connector', desc: '슬랙 채널 메시지 전송 및 알림 수신', active: true, category: 'Communication' },
    { id: 3, name: 'PostgreSQL DB', desc: '데이터베이스 쿼리 실행 및 결과 조회', active: true, category: 'Database' },
    { id: 4, name: 'GitHub Integration', desc: '리포지토리 커밋 및 PR 이슈 조회', active: false, category: 'Developer Tools' },
  ]);

  // 참조 파일 목록
  const [files] = useState([
    { name: '2026_프로젝트_기획서.pdf', size: '2.4 MB', date: '2026-07-20' },
    { name: 'Database_Schema.sql', size: '15 KB', date: '2026-07-21' },
  ]);

  const activeMcpNames = mcpBlocks
    .filter((b) => b.active)
    .map((b) => b.name)
    .join(', ') || 'None';

  const toggleMcp = (id: number) => {
    setMcpBlocks((prev) =>
      prev.map((block) => (block.id === id ? { ...block, active: !block.active } : block))
    );
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || loading) return;

    setLoading(true);
    setStreamingLog(`[MCP CORE] Query: "${command}"\n[CONNECTORS] [${activeMcpNames}]\n[ANALYZING] Processing request...`);

    let aiAnswer = '';
    let isSuccess = true;

    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

      if (!apiKey) {
        aiAnswer = '⚠️ Gemini API 키가 설정되지 않았습니다. .env.local 또는 Vercel 환경 변수를 확인하세요.';
        isSuccess = false;
      } else {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const promptWithContext = `[System Context: Active MCP Tools = ${activeMcpNames}]\n\n사용자 질문: ${command}`;

        const result = await model.generateContent(promptWithContext);
        const response = await result.response;
        aiAnswer = response.text();
      }
    } catch (err: any) {
      console.error('Gemini API Error:', err);
      aiAnswer = `[ERROR] AI 요청 실패: ${err.message || '알 수 없는 오류가 발생했습니다.'}`;
      isSuccess = false;
    }

    setStreamingLog(`[MCP CORE] Query: "${command}"\n[CONNECTORS] [${activeMcpNames}]\n[${isSuccess ? 'SUCCESS' : 'FAILED'}] Response generated.`);

    const now = new Date();
    const timeStr = `오후 ${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    setLogs((prev) => [
      { id: Date.now().toString(), prompt: command, result: aiAnswer, time: timeStr },
      ...prev,
    ]);

    setCommand('');
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen bg-[#070a12] text-white font-sans">
      {/* 🚀 사이드바 */}
      <aside className="w-64 bg-[#0d121f] border-r border-[#1e293b] flex flex-col justify-between p-4 flex-shrink-0">
        <div>
          <div className="flex items-center gap-3 px-2 py-4 mb-6">
            <span className="text-2xl">🚀</span>
            <span className="font-bold text-lg tracking-wide text-white">Micro-MCP</span>
          </div>

          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab('workspace')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'workspace'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'text-gray-400 hover:bg-[#161f33] hover:text-gray-200'
              }`}
            >
              <span>📊</span> 워크스페이스
            </button>
            <button
              onClick={() => setActiveTab('manager')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'manager'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'text-gray-400 hover:bg-[#161f33] hover:text-gray-200'
              }`}
            >
              <span>🧩</span> MCP 블록 매니저
            </button>
            <button
              onClick={() => setActiveTab('monitoring')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'monitoring'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'text-gray-400 hover:bg-[#161f33] hover:text-gray-200'
              }`}
            >
              <span>📈</span> 모니터링 & 파일
            </button>
            <button
              onClick={() => setActiveTab('db')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'db'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'text-gray-400 hover:bg-[#161f33] hover:text-gray-200'
              }`}
            >
              <span>🗄️</span> DB 연동 로그
            </button>
          </nav>
        </div>

        <div className="p-3 bg-[#070a12] rounded-lg border border-[#1e293b] text-xs text-gray-400 space-y-1">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Gemini AI Connected
          </div>
          <div>활성 MCP: {mcpBlocks.filter((b) => b.active).length}개 작동 중</div>
        </div>
      </aside>

      {/* 💻 메인 영역 */}
      <main className="flex-1 p-8 space-y-6 overflow-y-auto">
        
        {/* 1. 워크스페이스 탭 */}
        {activeTab === 'workspace' && (
          <div className="space-y-6">
            <div className="bg-[#0d121f] border border-[#1e293b] rounded-xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  ⚡ Live Gemini AI Playground
                </h2>
                <span className="text-xs bg-cyan-950 text-cyan-400 border border-cyan-800 px-3 py-1 rounded-full">
                  ● {mcpBlocks.filter((b) => b.active).length}개 MCP 커넥터 작동 중
                </span>
              </div>

              <form onSubmit={handleExecute} className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="Gemini AI에게 프롬프트를 입력하세요 (예: 노선 정리해줘, 오늘 할일 추천해줘)..."
                    className="w-full bg-[#070a12] border border-[#1e293b] rounded-lg px-4 py-3.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 transition-colors pr-32"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="absolute right-2 top-2 bottom-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium px-5 rounded-md text-sm transition-colors disabled:opacity-50"
                  >
                    {loading ? '전송 중...' : '프롬프트 전송'}
                  </button>
                </div>
              </form>
            </div>

            {/* 터미널 콘솔 */}
            <div className="bg-[#070a12] border border-[#1e293b] rounded-xl p-5 font-mono text-sm shadow-2xl">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#1e293b]">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span className="text-xs text-gray-500 ml-2">💻 GEMINI AI LIVE CONSOLE</span>
              </div>

              {streamingLog && (
                <div className="mb-4 p-3 bg-[#0d121f] border border-[#1e293b] rounded text-cyan-400 text-xs whitespace-pre-wrap">
                  {streamingLog}
                </div>
              )}

              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="text-gray-600 text-xs">명령어를 입력하면 여기에 실시간 실행 결과가 표시됩니다.</p>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="p-3 bg-[#0d121f] rounded border border-[#1e293b] text-xs space-y-1">
                      <div className="text-gray-400">
                        [{log.time}] &gt; <span className="text-white font-semibold">[Prompt] {log.prompt}</span>
                      </div>
                      <div className="text-emerald-400 pl-4 border-l-2 border-emerald-500/50 mt-1 whitespace-pre-wrap">
                        {log.result}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. MCP 블록 매니저 탭 */}
        {activeTab === 'manager' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <span>🧩</span> MCP 블록 매니저
              </h2>
              <button className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-4 py-2 rounded-lg transition-colors font-medium">
                + 새 연동 블록 추가
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mcpBlocks.map((block) => (
                <div
                  key={block.id}
                  className={`p-5 rounded-xl border transition-all ${
                    block.active
                      ? 'bg-[#0d121f] border-cyan-500/50 shadow-lg shadow-cyan-950/20'
                      : 'bg-[#0a0e17] border-[#1e293b] opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <span className="text-[10px] text-cyan-400 uppercase tracking-wider bg-cyan-950 px-2.5 py-1 rounded border border-cyan-800/60 font-mono">
                        {block.category}
                      </span>
                      <h3 className="font-bold text-base mt-2.5 text-white">{block.name}</h3>
                    </div>
                    <button
                      onClick={() => toggleMcp(block.id)}
                      className={`px-3.5 py-1 text-xs rounded-full border transition-all font-medium ${
                        block.active
                          ? 'bg-cyan-500 text-black border-cyan-400 shadow-sm shadow-cyan-500/50'
                          : 'bg-[#1e293b] text-gray-400 border-gray-600 hover:text-white'
                      }`}
                    >
                      {block.active ? 'ON (활성화)' : 'OFF (비활성)'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{block.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. 모니터링 & 파일 탭 */}
        {activeTab === 'monitoring' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span>📈</span> 모니터링 & AI 참조 컨텍스트 파일
            </h2>

            <div className="bg-[#0d121f] border border-[#1e293b] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  📁 등록된 AI 참조 컨텍스트 파일
                </h3>
                <button className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-3 py-1.5 rounded transition-colors">
                  + 파일 추가
                </button>
              </div>

              <div className="space-y-2">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-[#070a12] border border-[#1e293b] rounded-lg text-xs">
                    <div className="flex items-center gap-3">
                      <span>📄</span>
                      <span className="font-medium text-gray-200">{file.name}</span>
                    </div>
                    <div className="text-gray-500 font-mono">
                      {file.size} • {file.date}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 4. DB 연동 로그 탭 */}
        {activeTab === 'db' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span>🗄️</span> PostgreSQL 및 연동 DB 로그
            </h2>

            <div className="bg-[#070a12] border border-[#1e293b] rounded-xl p-5 font-mono text-xs space-y-2 text-gray-400 shadow-2xl">
              <div className="text-emerald-400">[2026-07-21 15:40:01] [DB_POOL] Connected to PostgreSQL instance.</div>
              <div className="text-cyan-400">[2026-07-21 15:41:12] [NOTION_CONNECTOR] Syncing workspace blocks...</div>
              <div className="text-gray-500">[2026-07-21 15:42:05] [MCP_BRIDGE] All connectors healthy. 0 errors.</div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}