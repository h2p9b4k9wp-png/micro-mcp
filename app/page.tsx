'use client';

import React, { useState } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default function HomePage() {
  const [command, setCommand] = useState('');
  const [streamingLog, setStreamingLog] = useState('');
  const [logs, setLogs] = useState<Array<{ id: string; prompt: string; result: string; time: string }>>([]);
  const [loading, setLoading] = useState(false);

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
        // 구글 공식 지원 모델: gemini-1.5-flash
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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
    <div className="min-h-screen bg-[#0b0f19] text-white p-6 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* 상단 폼 */}
        <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              ⚡ Live Gemini AI Playground
            </h2>
            <span className="text-xs bg-cyan-900/50 text-cyan-400 border border-cyan-700/50 px-3 py-1 rounded-full">
              ● 1개 MCP 커넥터 작동 중
            </span>
          </div>

          <form onSubmit={handleExecute} className="space-y-4">
            <div className="relative">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Gemini AI에게 프롬프트를 입력하세요..."
                className="w-full bg-[#030712] border border-[#374151] rounded-lg px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 transition-colors"
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

        {/* 터미널 콘솔 스타일 결과창 */}
        <div className="bg-[#030712] border border-[#1f2937] rounded-xl p-5 font-mono text-sm shadow-2xl">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#1f2937]">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span className="text-xs text-gray-500 ml-2">💻 GEMINI AI LIVE CONSOLE</span>
          </div>

          {/* 스트리밍 로그 / 에러 출력 */}
          {streamingLog && (
            <div className="mb-4 p-3 bg-[#111827] border border-[#374151] rounded text-cyan-400 text-xs whitespace-pre-wrap">
              {streamingLog}
            </div>
          )}

          {/* 히스토리 목록 */}
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-gray-600 text-xs">명령어를 입력하면 여기에 실시간 실행 결과가 표시됩니다.</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="p-3 bg-[#090d16] rounded border border-[#1e293b] text-xs space-y-1">
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
    </div>
  );
}