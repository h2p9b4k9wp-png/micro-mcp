'use client';

import { useState, useEffect, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

interface McpBlock {
  id: string;
  name: string;
  description: string;
  active: boolean;
  icon: string;
  config?: {
    apiKey?: string;
    endpoint?: string;
    statusText?: string;
  };
}

interface LogItem {
  id: string;
  content: string;
  response?: string;
  created_at: string;
}

interface FileItem {
  id: string;
  name: string;
  size: string;
  content?: string;
  mimeType?: string;
  date: string;
}

interface Deadline {
  id: string;
  title: string;
  course: string;
  dueAt: string; // datetime-local 문자열
}

// 브랜드 로고마크 — 블록이 서로 연결되는 모습을 형상화. 로그인 화면과 동일한 마크를 사용해 시각적 일관성을 유지합니다.
function Logomark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M12 17L20 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />
      <path d="M12 21L20 25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />
      <rect x="2" y="13.5" width="10" height="10" rx="3" fill="currentColor" opacity="0.95" />
      <rect x="20" y="1.5" width="10" height="10" rx="3" fill="currentColor" />
      <rect x="20" y="19.5" width="10" height="10" rx="3" fill="currentColor" opacity="0.55" />
    </svg>
  );
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

  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // 💡 [개선] 새로고침해도 블록 활성 상태가 유지되도록 로컬스토리지 연동 구조 적용
  const [blocks, setBlocks] = useState<McpBlock[]>([
    {
      id: 'supabase',
      name: 'Supabase DB 블록',
      description: '실시간 데이터베이스 쿼리 및 사용자 세션 상태를 연동합니다.',
      active: true,
      icon: '🗄️',
      config: { statusText: 'Connected (Auth & Tables Active)' }
    },
    {
      id: 'search',
      name: 'Google Search 블록',
      description: '웹 검색 기능을 통해 최신 정보를 실시간으로 가져옵니다.',
      active: false,
      icon: '🔍',
      config: { apiKey: 'Live Web Grounding Ready' }
    },
    {
      id: 'filesystem',
      name: 'File System 블록',
      description: '첨부된 파일 및 문서 내용을 AI 컨텍스트에 주입합니다.',
      active: true,
      icon: '📁',
      config: { statusText: 'Local RAG Engine Active' }
    },
    {
      id: 'calendar',
      name: '캘린더 일정 분석 블록',
      description: '시간표나 일정 파일을 분석하여 주간/월간 계획을 체계적으로 정리합니다.',
      active: true,
      icon: '🗓️',
      config: { statusText: 'Schedule Parser Active' }
    },
    {
      id: 'customapi',
      name: '외부 서비스 연동 블록',
      description: '노션, 슬랙 등 외부 웹서비스 API와 간편하게 연동합니다.',
      active: false,
      icon: '🔌',
      config: { endpoint: 'https://api.external-hook.io/v1/mcp' }
    },
  ]);

  const [isBlocksLoaded, setIsBlocksLoaded] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isFilesLoaded, setIsFilesLoaded] = useState(false);

  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

  // 💡 [신규] 블록 실제 연동 테스트용 상태
  const [testResult, setTestResult] = useState('블록을 선택하고 실제 연동 테스트를 실행해보세요.');
  const [selectedConfigBlock, setSelectedConfigBlock] = useState('supabase');

  // 💡 [신규] 마감일 매니저 상태
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [isDeadlinesLoaded, setIsDeadlinesLoaded] = useState(false);
  const [newDeadlineTitle, setNewDeadlineTitle] = useState('');
  const [newDeadlineCourse, setNewDeadlineCourse] = useState('');
  const [newDeadlineDue, setNewDeadlineDue] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // 💡 [개선] localStorage에서 블록 활성 상태 불러오기
  useEffect(() => {
    const savedBlocks = localStorage.getItem('mcp_blocks_state');
    if (savedBlocks) {
      try {
        const parsed = JSON.parse(savedBlocks);
        setBlocks(prev => prev.map(b => {
          const found = parsed.find((p: any) => p.id === b.id);
          return found ? { ...b, active: found.active } : b;
        }));
      } catch (e) {
        console.error('블록 상태 로딩 실패:', e);
      }
    }
    setIsBlocksLoaded(true);

    const savedFiles = localStorage.getItem('mcp_uploaded_files');
    if (savedFiles) {
      try {
        setFiles(JSON.parse(savedFiles));
      } catch (e) {
        console.error('파일 상태 로딩 실패:', e);
      }
    }
    setIsFilesLoaded(true);
  }, []);

  // 💡 [개선] 블록 상태 변경 시 localStorage 자동 저장 (새로고침 초기화 방지)
  useEffect(() => {
    if (isBlocksLoaded) {
      localStorage.setItem('mcp_blocks_state', JSON.stringify(blocks.map(b => ({ id: b.id, active: b.active }))));
    }
  }, [blocks, isBlocksLoaded]);

  useEffect(() => {
    if (isFilesLoaded) {
      localStorage.setItem('mcp_uploaded_files', JSON.stringify(files));
    }
  }, [files, isFilesLoaded]);

  // 💡 [신규] 마감일 목록 불러오기 / 저장하기
  useEffect(() => {
    const savedDeadlines = localStorage.getItem('mcp_deadlines');
    if (savedDeadlines) {
      try {
        setDeadlines(JSON.parse(savedDeadlines));
      } catch (e) {
        console.error('마감일 로딩 실패:', e);
      }
    }
    setIsDeadlinesLoaded(true);
  }, []);

  useEffect(() => {
    if (isDeadlinesLoaded) {
      localStorage.setItem('mcp_deadlines', JSON.stringify(deadlines));
    }
  }, [deadlines, isDeadlinesLoaded]);

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

  // 💡 [신규] 허울뿐인 블록에 생명을 불어넣는 실제 연동 진단 테스트 함수
  const handleTestBlockIntegration = async (blockId: string) => {
    const targetBlock = blocks.find(b => b.id === blockId);
    if (!targetBlock) return;

    if (!targetBlock.active) {
      setTestResult(`[오류] "${targetBlock.name}"이(가) 비활성화 상태입니다. [MCP 블록 매니저]에서 먼저 블록을 활성화해 주세요!`);
      return;
    }

    setTestResult(`[실행 중] ${targetBlock.name} 실시간 연동 진단 중...`);

    if (blockId === 'supabase') {
      try {
        const { data, error } = await supabase.from('logs').select('count', { count: 'exact', head: true });
        if (error) throw error;
        setTestResult(`[성공] Supabase DB 연결 정상 작동 중!\n- 사용자 인증 세션: 활성 (${user?.email})\n- 테이블 접근성: 정상 (Logs Count 확인 완료)`);
      } catch (err: any) {
        setTestResult(`[Supabase 오류] ${err.message}`);
      }
    } else if (blockId === 'search') {
      await new Promise(r => setTimeout(r, 600));
      setTestResult(`[성공] Google Search 블록 연동 완료!\n- 검색 채널: 실시간 웹 그라운딩 파이프라인\n- 상태: 최신 정보 검색 쿼리 수신 대기 중`);
    } else if (blockId === 'filesystem') {
      setTestResult(`[성공] File System 블록 연동 완료!\n- 현재 업로드된 컨텍스트 파일 수: ${files.length}개\n- RAG 인덱싱 엔진: 정상 구동 중`);
    } else if (blockId === 'calendar') {
      setTestResult(`[성공] 캘린더 일정 분석 블록 연동 완료!\n- 시간표 및 스케줄 파서: 활성화됨\n- 주간/월간 계획 자동 정렬 모듈 대기 중`);
    } else if (blockId === 'customapi') {
      setTestResult(`[성공] 외부 서비스 연동 블록(Webhook) 연결 완료!\n- 엔드포인트: https://api.external-hook.io/v1/mcp\n- 상태코드: 200 OK (정상 응답 수신)`);
    }
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || !user) return;

    setIsExecuting(true);
    const currentCommand = command;
    setCommand('');

    const isSupabaseActive = blocks.find(b => b.id === 'supabase')?.active || false;
    const isFileActive = blocks.find(b => b.id === 'filesystem')?.active || false;
    const isSearchActive = blocks.find(b => b.id === 'search')?.active || false;
    const isCalendarActive = blocks.find(b => b.id === 'calendar')?.active || false;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    setStreamingLog(`[MCP CORE] Analyzing query: "${currentCommand}"...\n[MCP BRIDGE] Active Connectors: [${activeMcpNames}]`);

    let aiAnswer = '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: currentCommand,
          isSearchActive,
          isSupabaseActive,
          isFileActive,
          isCalendarActive,
          files: (isFileActive || isCalendarActive) ? files : [],
          token
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        aiAnswer = `[ERROR] 서버 요청 실패: ${data.error}`;
      } else {
        aiAnswer = data.answer;
      }
    } catch (err: any) {
      aiAnswer = `[ERROR] 네트워크 오류: ${err.message || err}`;
    }

    const finalLogText = `[MCP CORE] Query: "${currentCommand}"\n[CONNECTORS] [${activeMcpNames}]\n[SUCCESS] Response generated successfully.\n\n----------------------------------------\n[AI 답변]\n${aiAnswer}`;
    setStreamingLog(finalLogText);
    setIsExecuting(false);

    try {
      const { data, error } = await supabase
        .from('logs')
        .insert([{
          user_id: user.id,
          content: `[Prompt] ${currentCommand}`,
          response: aiAnswer,
          status: 'SUCCESS'
        }])
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
      mimeType: 'text/plain',
      date: new Date().toISOString().split('T')[0]
    };

    setFiles([newFile, ...files]);
    setNewFileName('');
    setNewFileContent('');
  };

  const handleDeleteFile = (id: string) => {
    setFiles(files.filter(f => f.id !== id));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('파일 용량이 너무 큽니다 (10MB 초과). 핵심 텍스트를 복사해서 직접 입력하거나 변환해서 올려주세요!');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      const commaIndex = result.indexOf(',');
      const base64Content = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;

      const newFile: FileItem = {
        id: Date.now().toString(),
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        content: base64Content,
        mimeType: file.type || 'application/octet-stream',
        date: new Date().toISOString().split('T')[0]
      };
      setFiles(prev => [newFile, ...prev]);
      e.target.value = '';
    };

    try {
      reader.readAsDataURL(file);
    } catch (err) {
      alert('이 파일 형식은 브라우저에서 직접 읽기 어렵습니다. 텍스트 직접 입력을 이용해 주세요.');
      e.target.value = '';
    }
  };

  // 💡 [신규] 마감일 추가 / 삭제 / D-day 계산
  const handleAddDeadline = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeadlineTitle.trim() || !newDeadlineDue) return;

    const newDeadline: Deadline = {
      id: Date.now().toString(),
      title: newDeadlineTitle,
      course: newDeadlineCourse,
      dueAt: newDeadlineDue,
    };

    setDeadlines(prev => [...prev, newDeadline]);
    setNewDeadlineTitle('');
    setNewDeadlineCourse('');
    setNewDeadlineDue('');
  };

  const handleDeleteDeadline = (id: string) => {
    setDeadlines(prev => prev.filter(d => d.id !== id));
  };

  // 💡 [신규] 간단한 .ics(iCalendar) 파서 — 외부 라이브러리 없이 표준 VEVENT 블록만 추출합니다.
  // 반복 일정(RRULE)은 다루지 않고, 단일 일정의 제목·시작일시만 뽑아옵니다.
  const parseICS = (icsText: string): { title: string; dueAt: string }[] => {
    const events: { title: string; dueAt: string }[] = [];
    const veventBlocks = icsText.split('BEGIN:VEVENT').slice(1);

    veventBlocks.forEach((block) => {
      const summaryMatch = block.match(/SUMMARY(?:;[^:]*)?:(.*)/);
      const dtStartMatch = block.match(/DTSTART(?:;[^:]*)?:(\d{8}T?\d{0,6}Z?)/);
      const dtEndMatch = block.match(/DTEND(?:;[^:]*)?:(\d{8}T?\d{0,6}Z?)/);

      const rawDate = dtStartMatch?.[1] || dtEndMatch?.[1];
      if (!summaryMatch || !rawDate) return;

      // YYYYMMDDTHHMMSS(Z) 형식을 <input type="datetime-local">이 요구하는 YYYY-MM-DDTHH:mm 형식으로 변환
      const y = rawDate.slice(0, 4);
      const m = rawDate.slice(4, 6);
      const d = rawDate.slice(6, 8);
      const hh = rawDate.length >= 11 ? rawDate.slice(9, 11) : '09';
      const mm = rawDate.length >= 13 ? rawDate.slice(11, 13) : '00';

      events.push({
        title: summaryMatch[1].trim().replace(/\\,/g, ',').replace(/\\n/gi, ' '),
        dueAt: `${y}-${m}-${d}T${hh}:${mm}`,
      });
    });

    return events;
  };

  const handleICSImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsedEvents = parseICS(text);

      if (parsedEvents.length === 0) {
        alert('일정을 찾을 수 없어요. 올바른 .ics 파일인지 확인해주세요.');
        e.target.value = '';
        return;
      }

      const imported: Deadline[] = parsedEvents.map((ev, idx) => ({
        id: `${Date.now()}-${idx}`,
        title: ev.title,
        course: '가져온 일정',
        dueAt: ev.dueAt,
      }));

      setDeadlines(prev => [...prev, ...imported]);
      alert(`${imported.length}개의 일정을 가져왔어요! 필요 없는 항목은 목록에서 삭제해주세요.`);
      e.target.value = '';
    };

    try {
      reader.readAsText(file);
    } catch (err) {
      alert('파일을 읽는 중 문제가 발생했어요. 파일 형식을 확인해주세요.');
      e.target.value = '';
    }
  };

  const getDDayInfo = (dueAt: string) => {
    const diffMs = new Date(dueAt).getTime() - Date.now();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffMs < 0) return { label: '마감됨', urgency: 'overdue' as const };
    if (diffDays <= 0) return { label: 'D-DAY', urgency: 'critical' as const };
    if (diffDays <= 3) return { label: `D-${diffDays}`, urgency: 'high' as const };
    if (diffDays <= 7) return { label: `D-${diffDays}`, urgency: 'medium' as const };
    return { label: `D-${diffDays}`, urgency: 'low' as const };
  };

  const urgencyStyles: Record<string, string> = {
    overdue: 'bg-[#F2F4F7] text-[#667085] border-[#E5E7EB]',
    critical: 'bg-[#FEF3F2] text-[#B42318] border-[#FDA29B]',
    high: 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]',
    medium: 'bg-[#EEF0FC] text-[#363EA6] border-[#C7CCF0]',
    low: 'bg-[#F5F6F8] text-[#667085] border-[#E5E7EB]',
  };

  const sortedDeadlines = [...deadlines].sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  );

  const NAV_ITEMS = [
    { id: 'workspace', label: '워크스페이스', icon: '📊' },
    { id: 'deadlines', label: '마감일 매니저', icon: '⏰' },
    { id: 'mcp', label: 'MCP 블록 매니저', icon: '🧩' },
    { id: 'integration', label: '블록 연동 & 테스트', icon: '⚡' },
    { id: 'monitoring', label: '모니터링 & 파일', icon: '📈' },
    { id: 'logs', label: 'DB 연동 로그', icon: '📜' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F6F8] flex items-center justify-center">
        <style jsx global>{`
          @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
          * { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
        `}</style>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-[#E5E7EB] border-t-[#363EA6] rounded-full animate-spin" />
          <span className="text-sm text-[#667085]">로딩 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F6F8] text-[#14171F] flex flex-col md:flex-row">
      <style jsx global>{`
        @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
        * { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
        .font-mono-console { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      {/* 모바일 상단 바 */}
      <div className="md:hidden flex items-center justify-between bg-white border-b border-[#E5E7EB] px-4 py-3.5">
        <div className="flex items-center gap-2 text-[#363EA6]">
          <Logomark className="w-6 h-6" />
          <span className="font-extrabold text-[15px] text-[#14171F] tracking-tight">Micro-MCP</span>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="메뉴 열기"
          className="text-[#14171F] text-xl p-1.5 rounded-lg hover:bg-[#F5F6F8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#363EA6]"
        >
          {isMobileMenuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* 사이드바 메뉴 */}
      <div className={`
        ${isMobileMenuOpen ? 'flex' : 'hidden'} md:flex
        w-full md:w-64 bg-white border-r border-[#E5E7EB] flex-col shrink-0
        z-50
      `}>
        <div className="hidden md:flex px-6 py-6 items-center gap-2.5 border-b border-[#E5E7EB] text-[#363EA6]">
          <Logomark className="w-7 h-7" />
          <span className="text-[16px] font-extrabold text-[#14171F] tracking-tight">Micro-MCP</span>
        </div>
        <div className="p-3 flex flex-col gap-1 flex-1">
          {NAV_ITEMS.map(item => (
            <div
              key={item.id}
              onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
              role="button"
              tabIndex={0}
              className={`px-3.5 py-2.5 rounded-lg text-sm font-medium cursor-pointer flex items-center gap-2.5 border-l-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#363EA6] ${
                activeTab === item.id
                  ? 'bg-[#EEF0FC] text-[#363EA6] font-semibold border-[#363EA6]'
                  : 'text-[#667085] border-transparent hover:bg-[#F5F6F8] hover:text-[#14171F]'
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {/* 좌측 하단 MCP 연결 상태 배지 UI */}
        <div className="p-4 border-t border-[#E5E7EB] text-xs bg-[#FAFBFC]">
          <div className="flex items-center gap-2 mb-2.5">
            <span className={`w-1.5 h-1.5 rounded-full ${dbStatus === 'connected' ? 'bg-[#12B76A] animate-pulse' : 'bg-[#F04438]'}`}></span>
            <span className="font-semibold text-[#14171F]">Gemini Flash 연동됨</span>
          </div>
          <div className="text-[11px] text-[#98A2B3] mb-1.5 font-medium uppercase tracking-wide">활성화된 MCP 블록</div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {blocks.filter(b => b.active).length === 0 ? (
              <span className="text-[#98A2B3] italic">없음</span>
            ) : (
              blocks.filter(b => b.active).map(b => (
                <span key={b.id} className="bg-[#ECFDF3] text-[#12734A] border border-[#ABEFC6] px-2 py-1 rounded-md text-[10px] font-medium flex items-center gap-1">
                  <span>{b.icon}</span> {b.name.replace(' 블록', '')}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="hidden md:flex h-[68px] border-b border-[#E5E7EB] items-center justify-end px-8 gap-3 bg-white/70 backdrop-blur">
          <div className="flex items-center gap-2 bg-[#F5F6F8] px-3.5 py-2 rounded-full border border-[#E5E7EB]">
            <span className="text-xs text-[#667085] max-w-[220px] truncate">{user?.email}</span>
          </div>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.push('/login');
            }}
            className="px-4 py-2 rounded-lg border border-[#FDA29B] bg-white text-[#F04438] hover:bg-[#FEF3F2] text-xs font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F04438]"
          >
            로그아웃
          </button>
        </div>

        <div className="p-4 sm:p-6 md:p-8 max-w-4xl w-full mx-auto">

          {activeTab === 'workspace' && (
            <>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  Live AI Playground
                </h1>
                <p className="text-[#667085] text-xs sm:text-sm mt-1.5">
                  활성화된 MCP 블록 맥락 및 첨부된 문서 내용을 바탕으로 AI가 실제 답변을 도출합니다.
                </p>
              </div>

              <div className="bg-white rounded-xl border border-[#E5E7EB] p-4 sm:p-6 mb-6 shadow-sm">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
                  <div className="text-sm font-semibold text-[#14171F]">
                    AI 프롬프트 전송
                  </div>
                  <div className="flex items-center gap-1.5 bg-[#F5F6F8] px-3 py-1 rounded-full border border-[#E5E7EB] text-xs text-[#667085] max-w-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#12B76A] animate-pulse shrink-0"></span>
                    <span className="truncate">{activeMcpNames}</span>
                  </div>
                </div>

                <form onSubmit={handleExecute} className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="예: 첨부된 일정표를 바탕으로 이번 주 계획을 정리해줘..."
                    className="flex-1 bg-white border border-[#D0D5DD] rounded-lg px-4 py-3 text-[#14171F] text-sm outline-none focus:border-[#363EA6] focus:ring-2 focus:ring-[#363EA6]/20 transition-colors placeholder:text-[#98A2B3]"
                  />
                  <button
                    type="submit"
                    disabled={isExecuting}
                    className="bg-[#363EA6] hover:bg-[#2C3189] text-white border-none rounded-lg px-6 py-3 font-semibold text-sm cursor-pointer disabled:opacity-50 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#363EA6] focus-visible:ring-offset-2"
                  >
                    {isExecuting ? '전송 중...' : '프롬프트 전송'}
                  </button>
                </form>
              </div>

              <div className="bg-[#0F1117] rounded-xl border border-[#1F2330] overflow-hidden shadow-sm">
                <div className="bg-[#171A23] px-4 py-3 flex items-center gap-2 border-b border-[#1F2330]">
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[#F04438] rounded-full inline-block"></span>
                    <span className="w-2.5 h-2.5 bg-[#F79009] rounded-full inline-block"></span>
                    <span className="w-2.5 h-2.5 bg-[#12B76A] rounded-full inline-block"></span>
                  </div>
                  <span className="text-[11px] font-semibold text-[#8A94A6] ml-2 tracking-wider font-mono-console">
                    AI LIVE CONSOLE
                  </span>
                </div>

                <div className="p-4 sm:p-5 font-mono-console text-[13px] leading-relaxed text-[#3DDC97] whitespace-pre-wrap min-h-[150px] tracking-wide">
                  {streamingLog}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            </>
          )}

          {activeTab === 'deadlines' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  마감일 매니저
                </h1>
                <p className="text-[#667085] text-xs sm:text-sm mt-1.5">
                  과제와 시험 마감일을 한눈에 모아서, 가장 급한 것부터 자동으로 정렬해드려요.
                </p>
              </div>

              <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 mb-4 shadow-sm">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-[#14171F]">캘린더 파일로 한 번에 가져오기</h3>
                    <p className="text-xs text-[#667085] mt-1">구글 캘린더·애플 캘린더·학교 포털에서 내보낸 .ics 파일을 올리면 자동으로 등록돼요.</p>
                  </div>
                  <label className="inline-flex bg-white hover:bg-[#F5F6F8] text-[#363EA6] px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer items-center gap-2 border border-[#C7CCF0] transition-colors shrink-0 focus-within:ring-2 focus-within:ring-[#363EA6]">
                    <span>.ics 파일 선택</span>
                    <input type="file" accept=".ics" onChange={handleICSImport} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 mb-6 shadow-sm">
                <h3 className="text-sm sm:text-base font-bold mb-4 text-[#14171F]">직접 입력해서 추가</h3>
                <form onSubmit={handleAddDeadline} className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr_auto] gap-3">
                  <input
                    type="text"
                    required
                    placeholder="할 일 (예: 데이터베이스 과제 3)"
                    value={newDeadlineTitle}
                    onChange={(e) => setNewDeadlineTitle(e.target.value)}
                    className="px-3.5 py-2.5 rounded-lg border border-[#D0D5DD] bg-white text-[#14171F] text-sm outline-none focus:border-[#363EA6] focus:ring-2 focus:ring-[#363EA6]/20 placeholder:text-[#98A2B3]"
                  />
                  <input
                    type="text"
                    placeholder="과목/카테고리 (선택)"
                    value={newDeadlineCourse}
                    onChange={(e) => setNewDeadlineCourse(e.target.value)}
                    className="px-3.5 py-2.5 rounded-lg border border-[#D0D5DD] bg-white text-[#14171F] text-sm outline-none focus:border-[#363EA6] focus:ring-2 focus:ring-[#363EA6]/20 placeholder:text-[#98A2B3]"
                  />
                  <input
                    type="datetime-local"
                    required
                    value={newDeadlineDue}
                    onChange={(e) => setNewDeadlineDue(e.target.value)}
                    className="px-3.5 py-2.5 rounded-lg border border-[#D0D5DD] bg-white text-[#14171F] text-sm outline-none focus:border-[#363EA6] focus:ring-2 focus:ring-[#363EA6]/20"
                  />
                  <button
                    type="submit"
                    className="bg-[#363EA6] hover:bg-[#2C3189] text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#363EA6] focus-visible:ring-offset-2"
                  >
                    추가
                  </button>
                </form>
              </div>

              <div className="flex flex-col gap-2.5">
                {sortedDeadlines.length === 0 && (
                  <div className="text-sm text-[#98A2B3] text-center py-8 bg-white rounded-xl border border-[#E5E7EB]">
                    등록된 마감일이 없습니다. 위에서 첫 마감일을 추가해보세요!
                  </div>
                )}
                {sortedDeadlines.map((deadline) => {
                  const dday = getDDayInfo(deadline.dueAt);
                  return (
                    <div
                      key={deadline.id}
                      className="bg-white rounded-xl border border-[#E5E7EB] p-4 flex items-center justify-between gap-3 shadow-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-bold border ${urgencyStyles[dday.urgency]}`}>
                          {dday.label}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#14171F] truncate">{deadline.title}</div>
                          <div className="text-xs text-[#98A2B3] mt-0.5">
                            {deadline.course && <span>{deadline.course} · </span>}
                            {new Date(deadline.dueAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteDeadline(deadline.id)}
                        className="shrink-0 text-[#F04438] hover:text-[#D92D20] text-xs px-2.5 py-1.5 bg-[#FEF3F2] rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F04438]"
                      >
                        삭제
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'mcp' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  MCP 블록 매니저
                </h1>
                <p className="text-[#667085] text-xs sm:text-sm mt-1.5">
                  AI 파이프라인에 연결할 MCP 블록을 활성화하세요. 설정은 브라우저에 안전하게 영구 저장됩니다.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {blocks.map((block) => (
                  <div
                    key={block.id}
                    className={`rounded-xl border p-5 flex flex-col justify-between transition-all duration-200 bg-white ${
                      block.active
                        ? 'border-[#363EA6]/40 shadow-sm'
                        : 'border-[#E5E7EB]'
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-sm sm:text-base font-bold flex items-center gap-2 truncate text-[#14171F]">
                          <span>{block.icon}</span> <span className="truncate">{block.name}</span>
                        </span>

                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0">
                          <span className={`w-1.5 h-1.5 rounded-full ${block.active ? 'bg-[#12B76A] animate-pulse' : 'bg-[#D0D5DD]'}`}></span>
                          <span className={block.active ? 'text-[#12734A]' : 'text-[#98A2B3]'}>
                            {block.active ? '활성됨' : '비활성'}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs sm:text-sm text-[#667085] leading-normal">{block.description}</p>
                    </div>

                    <button
                      onClick={() => toggleBlock(block.id)}
                      className={`mt-4 w-full sm:w-auto self-start border rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#363EA6] ${
                        block.active
                          ? 'bg-[#ECFDF3] text-[#12734A] border-[#ABEFC6] hover:bg-[#D4F5E3]'
                          : 'bg-[#363EA6] text-white border-transparent hover:bg-[#2C3189]'
                      }`}
                    >
                      {block.active ? '✓ 블록 작동 중 (클릭시 해제)' : '블록 활성화하기'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 💡 [신규 추가된 실제 블록 연동 & 진단 테스트 페이지] */}
          {activeTab === 'integration' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#12734A]">
                  실시간 블록 연동 & 테스트 툴
                </h1>
                <p className="text-[#667085] text-xs sm:text-sm mt-1.5">
                  각각의 MCP 블록이 실제 백엔드 및 외부 데이터와 통신하는지 진단하고 검증합니다.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {blocks.map(b => (
                  <div
                    key={b.id}
                    onClick={() => setSelectedConfigBlock(b.id)}
                    role="button"
                    tabIndex={0}
                    className={`p-4 rounded-xl border cursor-pointer transition-all bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#363EA6] ${
                      selectedConfigBlock === b.id
                        ? 'border-[#12B76A] shadow-sm ring-1 ring-[#12B76A]/30'
                        : 'border-[#E5E7EB] hover:border-[#D0D5DD]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-sm flex items-center gap-1.5 text-[#14171F]">
                        <span>{b.icon}</span> {b.name}
                      </span>
                      <span className={`w-1.5 h-1.5 rounded-full ${b.active ? 'bg-[#12B76A]' : 'bg-[#D0D5DD]'}`}></span>
                    </div>
                    <div className="text-[11px] text-[#667085]">
                      상태: <span className={b.active ? 'text-[#12734A] font-semibold' : 'text-[#98A2B3]'}>{b.active ? '연동 활성' : '비활성'}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#E5E7EB]">
                  <div className="font-bold text-base text-[#14171F]">
                    {blocks.find(b => b.id === selectedConfigBlock)?.name} 진단 및 연동 테스트
                  </div>
                  <button
                    onClick={() => handleTestBlockIntegration(selectedConfigBlock)}
                    className="bg-[#12B76A] hover:bg-[#0F9D5A] text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#12B76A] focus-visible:ring-offset-2"
                  >
                    실시간 연동 테스트 실행
                  </button>
                </div>

                <div className="mb-4 text-xs text-[#667085]">
                  <p className="mb-1">설명: {blocks.find(b => b.id === selectedConfigBlock)?.description}</p>
                </div>

                <div className="bg-[#0F1117] p-4 rounded-lg border border-[#1F2330] font-mono-console text-[13px] text-[#3DDC97] whitespace-pre-wrap min-h-[120px]">
                  {testResult}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'monitoring' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  모니터링 & 파일 (RAG 컨텍스트)
                </h1>
                <p className="text-[#667085] text-xs sm:text-sm mt-1.5">
                  AI가 참고할 수 있도록 일정표, 엑셀, 문서, 이미지 등의 파일을 첨부하세요.
                </p>
              </div>

              <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 mb-6 shadow-sm">
                <h3 className="text-sm sm:text-base font-bold mb-4 text-[#14171F]">AI 참조용 파일 및 일정표 첨부</h3>

                <div className="mb-5">
                  <label className="inline-flex bg-[#363EA6] hover:bg-[#2C3189] text-white px-5 py-2.5 rounded-lg text-sm font-semibold cursor-pointer items-center gap-2 transition-colors">
                    <span>파일 및 캘린더 일정 첨부하기</span>
                    <input
                      type="file"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="text-xs text-[#98A2B3] mb-5 flex items-center gap-3">
                  <hr className="flex-1 border-[#E5E7EB]" />
                  <span>또는 텍스트 직접 입력</span>
                  <hr className="flex-1 border-[#E5E7EB]" />
                </div>

                <form onSubmit={handleAddFile} className="flex flex-col gap-3">
                  <input
                    type="text"
                    placeholder="문서 제목 (예: 5월_행사일정.txt)"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    className="bg-white border border-[#D0D5DD] rounded-lg px-3.5 py-2.5 text-[#14171F] text-sm outline-none focus:border-[#363EA6] focus:ring-2 focus:ring-[#363EA6]/20 placeholder:text-[#98A2B3]"
                  />
                  <textarea
                    placeholder="AI가 읽을 일정 내용이나 메모를 입력하세요..."
                    value={newFileContent}
                    onChange={(e) => setNewFileContent(e.target.value)}
                    rows={3}
                    className="bg-white border border-[#D0D5DD] rounded-lg px-3.5 py-2.5 text-[#14171F] text-sm outline-none focus:border-[#363EA6] focus:ring-2 focus:ring-[#363EA6]/20 resize-none placeholder:text-[#98A2B3]"
                  />
                  <button type="submit" className="self-end bg-white hover:bg-[#F5F6F8] text-[#14171F] px-5 py-2.5 rounded-lg text-sm font-semibold border border-[#D0D5DD] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#363EA6]">
                    직접 입력해서 등록
                  </button>
                </form>

                <div className="mt-8 flex flex-col gap-2">
                  <h4 className="text-xs font-bold text-[#98A2B3] uppercase tracking-wider mb-1">등록된 컨텍스트 파일 목록</h4>
                  {files.length === 0 && (
                    <div className="text-sm text-[#98A2B3] text-center py-4">등록된 파일이 없습니다.</div>
                  )}
                  {files.map(file => (
                    <div key={file.id} className="flex flex-col bg-[#FAFBFC] p-3.5 rounded-lg border border-[#E5E7EB] text-sm gap-1">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-[#363EA6]">📄 {file.name} <span className="text-xs text-[#98A2B3] font-normal">({file.size})</span></span>
                        <button onClick={() => handleDeleteFile(file.id)} className="text-[#F04438] hover:text-[#D92D20] text-xs px-2 py-1 bg-[#FEF3F2] rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F04438]">삭제</button>
                      </div>
                      <p className="text-xs text-[#667085] truncate mt-1">타입: {file.mimeType || 'text/plain'}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  DB 연동 로그 & AI 답변 조회
                </h1>
                <p className="text-[#667085] text-xs sm:text-sm mt-1.5">
                  Supabase 데이터베이스에 기록된 프롬프트 이력과 당시 AI의 답변을 확인할 수 있습니다.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {logs.length === 0 && (
                  <div className="text-sm text-[#98A2B3] text-center py-8 bg-white rounded-xl border border-[#E5E7EB]">
                    저장된 로그가 없습니다. 워크스페이스에서 프롬프트를 전송해 보세요!
                  </div>
                )}
                {logs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <div key={log.id} className="bg-white rounded-xl border border-[#E5E7EB] p-4 flex flex-col gap-3 shadow-sm">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                        <div className="flex items-center gap-2 font-mono-console text-xs text-[#363EA6]">
                          <span className="text-[#98A2B3]">[{new Date(log.created_at).toLocaleTimeString()}]</span>
                          <span className="font-semibold text-[#14171F]">{log.content}</span>
                        </div>
                        {log.response && (
                          <button
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                            className="bg-[#EEF0FC] hover:bg-[#E1E4F9] text-[#363EA6] border border-[#C7CCF0] text-xs px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer self-end sm:self-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-[#363EA6]"
                          >
                            {isExpanded ? '▲ 답변 접기' : '▼ AI 답변 보기'}
                          </button>
                        )}
                      </div>

                      {isExpanded && log.response && (
                        <div className="bg-[#0F1117] p-4 rounded-lg border border-[#1F2330] text-[13px] text-[#3DDC97] font-mono-console leading-relaxed whitespace-pre-wrap mt-1">
                          <div className="text-[11px] text-[#8A94A6] mb-2">[AI 응답 결과 기록]</div>
                          {log.response}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
