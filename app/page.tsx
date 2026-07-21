'use client';

import React, { useState } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default function HomePage() {
  const [command, setCommand] = useState('');
  const [streamingLog, setStreamingLog] = useState('');
  const [logs, setLogs] = useState<Array<{ id: string; prompt: string; result: string; time: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('workspace');

  const mcpNames = 'Notion Workspace';

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || loading) return;

    setLoading(true);
    setStreamingLog(`[MCP CORE] Analyzing query: "${command}"...\n[MCP BRIDGE] Active Connector: ${mcpNames}`);
    
    let aiAnswer = '';
    let isSuccess = true;

    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

      if (!apiKey) {
        aiAnswer = '⚠️ Gemini API 키가 설정되지 않았습니다. .env.local 또는 Vercel 환경 변수를 확인하세요.';
        isSuccess = false;
      } else {
        const genAI = new GoogleGenerativeAI(apiKey);
        // SDK 엔드포인트 호환성을 위해 gemini-1.5-flash-latest 사용
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });

        const promptWithContext = `[System Context: Active MCP Tools = ${mcpNames}]\n\n사용자 질문: ${command}`;

        const result = await model.generateContent(promptWithContext);
        const response = await result.response;
        aiAnswer = response.text();
      }
    } catch (err: any) {
      console.error('Gemini API Error:', err);
      aiAnswer = `[ERROR] AI 요청 실패: ${err.message || '알 수 없는 오류가 발생했습니다.'}`;
      isSuccess = false;
    }

    setStreamingLog(`[Prompt] ${command} --> [Execution] [${isSuccess ? 'SUCCESS' : 'FAILED'}] Task completed.`);

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
      {/* 사이드바 */}
      <aside className="w-64 bg-[#0d121f] border-r border-[#1e293b] flex flex-col justify-between p-4">
        <div>
          {/* 로고 영역 */}
          <div className="flex items-center gap-3 px-2 py-4 mb-6">
            <span className="text-2xl">🚀</span>
            <span className="font-bold text-lg tracking-wide text-white">Micro-MCP</span>
          </div>

          {/* 좌측 메뉴 선택창 */}
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

        {/* 하단 상태 표시 */}
        <div className="p-3 bg-[#070a12] rounded-lg border border-[#1e293b] text-xs text-gray-400 space-y-1">
          <div className="flex items-center gap-2 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Gemini AI Connected
          </div>
          <div>연동된 MCP: 1개 활성</div>
        </div>
      </aside>

      {/* 메인 콘텐츠 영역 */}
      <main className="flex-1 p-8 space-y-6 overflow-y-auto">
        {/* 프롬프트 입력창 */}
        <div className="bg-[#0d121f] border border-[#1e293b] rounded-xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              ⚡ Live Gemini AI Playground
            </h2>
            <span className="text-xs bg-cyan-950 text-cyan-400 border border-cyan-800 px-3 py-1 rounded-full">
              ● 1개 MCP 커넥터 작동 중
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

          <div className="space-y-3 max-h-[450px] overflow-y-auto">
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
      </main>
    </div>
  );
}