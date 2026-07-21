'use client';

import React, { useState } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface ExecutionLog {
  id: string;
  command: string;
  connectors: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  timestamp: string;
  result: string;
}

export default function Dashboard() {
  const [command, setCommand] = useState('');
  const [streamingLog, setStreamingLog] = useState('시스템 대기 중... 명령어를 입력하세요.');
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [files, setFiles] = useState<{ name: string; size: string; date: string }[]>([
    { name: '2026_프로젝트_기획서.pdf', size: '2.4 MB', date: '2026-07-20' },
    { name: 'Database_Schema.sql', size: '15 KB', date: '2026-07-21' },
  ]);

  const mcpNames = 'Notion, Slack, PostgreSQL';

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    setStreamingLog(`[MCP CORE] Analyzing query: "${command}"...\n[MCP BRIDGE] Active Connectors: ${mcpNames}`);
    let aiAnswer = '';
    let isSuccess = true;

    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

      if (!apiKey) {
        aiAnswer = '⚠️ Gemini API 키가 설정되지 않았습니다. 환경 변수(NEXT_PUBLIC_GEMINI_API_KEY)를 확인해 주세요.';
        isSuccess = false;
      } else {
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // Google AI Studio 계정에 단독 활성화된 Gemini 2.5 Flash 모델 호출
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

    setStreamingLog(
      `[MCP CORE] Query: "${command}"\n[CONNECTORS] [${mcpNames}]\n[${isSuccess ? 'SUCCESS' : 'FAILED'}] Response generated.`
    );

    const newLog: ExecutionLog = {
      id: Date.now().toString(),
      command,
      connectors: mcpNames,
      status: isSuccess ? 'SUCCESS' : 'FAILED',
      timestamp: new Date().toLocaleTimeString(),
      result: aiAnswer,
    };

    setLogs((prev) => [newLog, ...prev]);
    setCommand('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      const newFile = {
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        date: new Date().toISOString().split('T')[0],
      };
      setFiles((prev) => [newFile, ...prev]);
    }
  };

  return (
    <div style={{ padding: '24px', color: '#fff', backgroundColor: '#0b0f19', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <header style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>📈 트래픽 분석 & AI 데이터 스토리지</h1>
        <p style={{ color: '#9ca3af' }}>MCP 트래픽 호출 현황을 분석하고 AI가 참조할 문서를 관리합니다.</p>
      </header>

      {/* 대시보드 카드 영역 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div style={{ background: '#111827', padding: '20px', borderRadius: '12px', border: '1px solid #1f2937' }}>
          <div style={{ color: '#9ca3af', fontSize: '14px' }}>총 MCP 실행 횟수</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', margin: '8px 0' }}>{logs.length}회</div>
          <div style={{ color: '#10b981', fontSize: '12px' }}>↑ 100% 정상 처리됨</div>
        </div>

        <div style={{ background: '#111827', padding: '20px', borderRadius: '12px', border: '1px solid #1f2937' }}>
          <div style={{ color: '#9ca3af', fontSize: '14px' }}>활성화된 커넥터</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', margin: '8px 0' }}>3개</div>
          <div style={{ color: '#9ca3af', fontSize: '12px' }}>Notion, Slack, PostgreSQL</div>
        </div>

        <div style={{ background: '#111827', padding: '20px', borderRadius: '12px', border: '1px solid #1f2937' }}>
          <div style={{ color: '#9ca3af', fontSize: '14px' }}>AI Engine</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', margin: '8px 0' }}>Gemini 2.5 Flash</div>
          <div style={{ color: '#10b981', fontSize: '12px' }}>● API Live Connected</div>
        </div>
      </div>

      {/* AI 실행 폼 */}
      <div style={{ background: '#111827', padding: '24px', borderRadius: '12px', border: '1px solid #1f2937', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>⚡ MCP 명령어 실행 및 Gemini 호출</h2>
        <form onSubmit={handleExecute} style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Gemini 2.5 Flash 모델에 전달할 명령어를 입력하세요..."
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid #374151',
              backgroundColor: '#1f2937',
              color: '#fff',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '12px 24px',
              borderRadius: '8px',
              backgroundColor: '#3b82f6',
              color: '#fff',
              fontWeight: 'bold',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            실행하기
          </button>
        </form>
        <pre
          style={{
            background: '#030712',
            padding: '16px',
            borderRadius: '8px',
            color: '#10b981',
            fontSize: '14px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {streamingLog}
        </pre>
      </div>

      {/* 참조 문서 관리 */}
      <div style={{ background: '#111827', padding: '24px', borderRadius: '12px', border: '1px solid #1f2937', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>📁 AI 참조용 컨텍스트 파일 등록</h2>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
          <input
            type="file"
            id="fileInput"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <label
            htmlFor="fileInput"
            style={{
              padding: '12px 24px',
              borderRadius: '8px',
              backgroundColor: '#0284c7',
              color: '#fff',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            + 파일 추가
          </label>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {files.map((file, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '12px 16px',
                backgroundColor: '#1f2937',
                borderRadius: '8px',
              }}
            >
              <span>📄 {file.name}</span>
              <span style={{ color: '#9ca3af', fontSize: '14px' }}>
                {file.size} • {file.date}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 실행 로그 테이블 */}
      <div style={{ background: '#111827', padding: '24px', borderRadius: '12px', border: '1px solid #1f2937' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>📋 히스토리 및 AI 답변 결과</h2>
        {logs.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>아직 실행된 기록이 없습니다.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {logs.map((log) => (
              <div
                key={log.id}
                style={{
                  padding: '16px',
                  backgroundColor: '#1f2937',
                  borderRadius: '8px',
                  borderLeft: log.status === 'SUCCESS' ? '4px solid #10b981' : '4px solid #ef4444',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 'bold' }}>Q: {log.command}</span>
                  <span style={{ color: '#9ca3af', fontSize: '12px' }}>{log.timestamp}</span>
                </div>
                <div style={{ color: '#d1d5db', fontSize: '14px', whiteSpace: 'pre-wrap' }}>
                  A: {log.result}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}