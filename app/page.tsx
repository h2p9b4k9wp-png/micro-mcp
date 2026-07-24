'use client';

import { useState, useEffect, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import {
  type LucideIcon,
  Sparkles,
  Archive,
  AlarmClock,
  Puzzle,
  LineChart,
  ScrollText,
  Search,
  FileText,
  CalendarClock,
  PenLine,
  NotebookPen,
  MessageCircle,
} from 'lucide-react';

interface McpBlock {
  id: string;
  name: string;
  description: string;
  active: boolean;
  icon: LucideIcon;
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

// 💡 [신규] '나의 기록' 대시보드가 기기와 무관하게 일관되게 보이도록, 파일 업로드 이력을 DB(document_uploads)에 누적 기록합니다.
interface DocumentUploadRecord {
  format: string;
  created_at: string;
}

// 파일명/MIME 타입으로 문서 형식을 분류합니다 (/api/chat의 파일 파싱 분기와 동일한 기준).
function getFileFormatKey(name: string, mimeType?: string): string {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv')) return 'excel';
  if (lowerName.endsWith('.hwp') || lowerName.endsWith('.hwpx')) return 'hwp';
  if (lowerName.endsWith('.pptx') || lowerName.endsWith('.ppt')) return 'ppt';
  if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) return 'word';
  if (lowerName.endsWith('.pdf')) return 'pdf';
  if (mimeType && mimeType.startsWith('image/')) return 'image';
  return 'etc';
}

// 브랜드 로고마크 — 귀여운 블록 캐릭터 얼굴. 로그인 화면과 동일한 마크를 사용해 시각적 일관성을 유지합니다.
function Logomark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="11" cy="5" r="2" fill="currentColor" opacity="0.7" />
      <circle cx="21" cy="5" r="2" fill="currentColor" opacity="0.7" />
      <path d="M11 7L13 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <path d="M21 7L19 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <rect x="5" y="10" width="22" height="19" rx="8" fill="currentColor" />
      <circle cx="13" cy="19" r="2.2" fill="white" />
      <circle cx="19" cy="19" r="2.2" fill="white" />
      <path d="M12.5 23.5C13.8 25 18.2 25 19.5 23.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// AI 콘솔이 아직 아무 대화도 시작하지 않았을 때 보여주는 인사말
const IDLE_CONSOLE_MESSAGE = '안녕하세요! 무엇이든 물어보세요!';

// 콘솔이 비어있을 때 채워주는 예시 프롬프트 — 5가지 MCP 블록과 하나씩 매칭됩니다.
const EXAMPLE_PROMPTS = [
  { icon: Search, prompt: '요즘 이 분야 최신 트렌드가 뭔지 검색해서 알려줘' },
  { icon: FileText, prompt: '첨부한 문서 핵심만 요약해줘' },
  { icon: CalendarClock, prompt: '이번 주에 뭐부터 처리해야 하는지 정리해줘' },
  { icon: PenLine, prompt: '기한 연장 요청 메일 초안 써줘' },
  { icon: NotebookPen, prompt: '방금 붙여넣은 회의 노트 정리해줘' },
];

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('connecting');
  const [command, setCommand] = useState('');
  const [streamingLog, setStreamingLog] = useState(IDLE_CONSOLE_MESSAGE);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState('workspace');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  // 💡 [개선] 새로고침해도 블록 활성 상태가 유지되도록 로컬스토리지 연동 구조 적용
  const [blocks, setBlocks] = useState<McpBlock[]>([
    {
      id: 'search',
      name: '최신 정보 검색',
      description: '뉴스, 시세, 최신 트렌드처럼 실시간 정보가 필요한 질문에 웹 검색 결과를 반영해서 답변합니다.',
      active: true,
      icon: Search,
      config: { apiKey: 'Live Web Grounding Ready' }
    },
    {
      id: 'filesystem',
      name: '문서 분석 & 요약',
      description: '업로드한 강의자료, 보고서, 계약서, 엑셀 표를 AI가 읽고 답변에 정확히 반영합니다. (엑셀, HWP, PPT, 워드, PDF 텍스트 지원)',
      active: true,
      icon: FileText,
      config: { statusText: 'Local RAG Engine Active' }
    },
    {
      id: 'deadlines',
      name: '마감일 인식',
      description: '마감일 매니저에 등록한 과제·시험·업무 일정을 AI가 파악해서, "오늘 뭐부터 해야 하지?" 같은 질문에 실제 일정 기준으로 답합니다.',
      active: true,
      icon: CalendarClock,
      config: { statusText: 'Deadline Context Active' }
    },
    {
      id: 'writing',
      name: '글쓰기 도우미',
      description: '이메일, 보고서, 자기소개서 등 상황과 대상에 맞는 톤으로 바로 쓸 수 있는 초안을 작성해드립니다.',
      active: false,
      icon: PenLine,
      config: { statusText: 'Draft Assistant Ready' }
    },
    {
      id: 'meetingNotes',
      name: '회의·강의 노트 정리',
      description: '회의록이나 강의 필기를 붙여넣으면 핵심 요약과 할 일 목록으로 깔끔하게 구조화해드립니다.',
      active: false,
      icon: NotebookPen,
      config: { statusText: 'Note Structuring Ready' }
    },
  ]);

  const [isBlocksLoaded, setIsBlocksLoaded] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isFilesLoaded, setIsFilesLoaded] = useState(false);

  // 💡 [신규] 문서 업로드 이력 (DB 저장 — 기기가 바뀌어도 '나의 기록'에서 동일하게 보임)
  const [documentUploads, setDocumentUploads] = useState<DocumentUploadRecord[]>([]);
  const [isDocumentUploadsLoaded, setIsDocumentUploadsLoaded] = useState(false);

  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

  // 💡 [신규] 마감일 매니저 상태
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [isDeadlinesLoaded, setIsDeadlinesLoaded] = useState(false);
  const [newDeadlineTitle, setNewDeadlineTitle] = useState('');
  const [newDeadlineCourse, setNewDeadlineCourse] = useState('');
  const [newDeadlineDue, setNewDeadlineDue] = useState('');
  const [isImportingDeadlines, setIsImportingDeadlines] = useState(false);

  // 💡 [신규] 회의·강의 노트 정리 블록이 감지한, 날짜가 있는 할 일 목록
  const [detectedActionItems, setDetectedActionItems] = useState<{ title: string; dueAt: string }[]>([]);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // 💡 [신규] PWA 서비스워커 등록 (홈 화면에 앱으로 설치 가능하게 해줍니다)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('서비스워커 등록 실패:', err);
      });
    }
  }, []);

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
        fetchDocumentUploads(retrySession.user.id);
      } else {
        setUser(session.user);
        fetchLogs(session.user.id);
        fetchDocumentUploads(session.user.id);
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

  // 💡 [신규] 문서 업로드 이력 조회 (DB 기준 — 기기 무관하게 '나의 기록'에 동일하게 표시됨)
  const fetchDocumentUploads = async (userId: string) => {
    const { data } = await supabase
      .from('document_uploads')
      .select('format, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    setDocumentUploads(data || []);
    setIsDocumentUploadsLoaded(true);
  };

  // 💡 [신규] 기존에 localStorage에만 있던 첨부 파일 이력을 DB로 1회 이전 (신규 마이그레이션 직후, 기록이 0개인 사용자 한정)
  useEffect(() => {
    if (!user || !isFilesLoaded || !isDocumentUploadsLoaded) return;
    if (documentUploads.length > 0 || files.length === 0) return;

    const backfillDocumentUploads = async () => {
      const rows = files.map((f) => ({
        file_name: f.name,
        format: getFileFormatKey(f.name, f.mimeType),
      }));
      const { data, error } = await supabase
        .from('document_uploads')
        .insert(rows)
        .select('format, created_at');

      if (!error && data) {
        setDocumentUploads(data);
      } else if (error) {
        console.error('문서 업로드 이력 이전 실패:', error);
      }
    };

    backfillDocumentUploads();
  }, [user, isFilesLoaded, isDocumentUploadsLoaded, documentUploads.length, files, supabase]);

  // 💡 [신규] 새 파일이 추가될 때마다 DB에도 이력을 남깁니다 (실패해도 파일 첨부 자체는 막지 않음).
  const recordDocumentUpload = async (name: string, mimeType?: string) => {
    const format = getFileFormatKey(name, mimeType);
    setDocumentUploads((prev) => [{ format, created_at: new Date().toISOString() }, ...prev]);
    try {
      const { error } = await supabase.from('document_uploads').insert({ file_name: name, format });
      if (error) throw error;
    } catch (err) {
      console.error('문서 업로드 기록 실패:', err);
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
    setDetectedActionItems([]);

    const isFileActive = blocks.find(b => b.id === 'filesystem')?.active || false;
    const isSearchActive = blocks.find(b => b.id === 'search')?.active || false;
    const isDeadlineActive = blocks.find(b => b.id === 'deadlines')?.active || false;
    const isWritingActive = blocks.find(b => b.id === 'writing')?.active || false;
    const isMeetingNotesActive = blocks.find(b => b.id === 'meetingNotes')?.active || false;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    let aiAnswer = '';
    const header = `${currentCommand}\n\n`;

    setStreamingLog(`${currentCommand}\n\n답변을 준비하고 있어요...`);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: currentCommand,
          isSearchActive,
          isFileActive,
          isDeadlineActive,
          isWritingActive,
          isMeetingNotesActive,
          files: isFileActive ? files : [],
          deadlines: isDeadlineActive ? deadlines : [],
          token
        }),
      });

      if (!res.ok) {
        // 에러 응답은 이전처럼 JSON 형태로 옵니다.
        const errData = await res.json().catch(() => ({ error: '알 수 없는 오류가 발생했습니다.' }));
        aiAnswer = `죄송해요, 요청을 처리하지 못했어요: ${errData.error}`;
        setStreamingLog(header + aiAnswer);
      } else if (res.body) {
        // 💡 [속도 개선] 답변을 다 기다리지 않고, 도착하는 대로 바로바로 화면에 이어붙입니다.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        setStreamingLog(header);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          aiAnswer += decoder.decode(value, { stream: true });
          setStreamingLog(header + aiAnswer);
        }

        // 💡 [신규] 회의·강의 노트 정리 블록이 덧붙인 할 일(마감일 포함) JSON 블록을 추출합니다.
        const actionItemsMatch = aiAnswer.match(/<!--ACTION_ITEMS_JSON-->([\s\S]*?)<!--END_ACTION_ITEMS_JSON-->/);
        if (actionItemsMatch) {
          try {
            const parsed = JSON.parse(actionItemsMatch[1].trim());
            if (Array.isArray(parsed)) {
              const validItems = parsed.filter(
                (item: any) =>
                  item &&
                  typeof item.title === 'string' &&
                  typeof item.dueAt === 'string' &&
                  !isNaN(new Date(item.dueAt).getTime())
              );
              setDetectedActionItems(validItems);
            }
          } catch (parseErr) {
            console.error('할 일 블록 파싱 실패:', parseErr);
          }
          // 화면(콘솔)에는 이 JSON 블록을 숨기고 깔끔한 텍스트만 보여줍니다.
          const cleanedAnswer = aiAnswer.replace(actionItemsMatch[0], '').trim();
          setStreamingLog(header + cleanedAnswer);
        }
      }
    } catch (err: any) {
      aiAnswer = `죄송해요, 네트워크 오류가 발생했어요: ${err.message || err}`;
      setStreamingLog(header + aiAnswer);
    }

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
    recordDocumentUpload(newFile.name, newFile.mimeType);
    setNewFileName('');
    setNewFileContent('');
  };

  const handleDeleteFile = (id: string) => {
    setFiles(files.filter(f => f.id !== id));
  };

  // 💡 [신규] DB 연동 로그 삭제
  const handleDeleteLog = async (id: string) => {
    try {
      const { error } = await supabase.from('logs').delete().eq('id', id);
      if (error) throw error;
      setLogs(prev => prev.filter(log => log.id !== id));
      if (expandedLogId === id) setExpandedLogId(null);
    } catch (err: any) {
      alert(`로그 삭제 중 오류가 발생했어요: ${err.message || err}`);
    }
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
      recordDocumentUpload(newFile.name, newFile.mimeType);
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

  // 💡 [신규] 회의·강의 노트 정리 블록이 감지한 할 일을 마감일로 등록
  const handleAddDetectedDeadline = (item: { title: string; dueAt: string }) => {
    const newDeadline: Deadline = {
      id: Date.now().toString(),
      title: item.title,
      course: '회의·강의 노트에서 감지됨',
      dueAt: item.dueAt,
    };
    setDeadlines(prev => [...prev, newDeadline]);
    setDetectedActionItems(prev => prev.filter(i => i !== item));
  };

  // 💡 [신규] 어떤 파일이든(이미지, PDF, .ics, 캡처본 등) 업로드하면 AI가 알아서 일정을 찾아 정리해줍니다.
  const handleDeadlineFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('파일 용량이 너무 큽니다 (10MB 초과). 더 작은 파일로 시도해주세요.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result as string;
      const commaIndex = result.indexOf(',');
      const base64Content = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;

      setIsImportingDeadlines(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const res = await fetch('/api/parse-deadlines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            content: base64Content,
            token,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          alert(`가져오기 실패: ${data.error}`);
          return;
        }

        if (!data.events || data.events.length === 0) {
          alert('이 파일에서 일정을 찾지 못했어요. 날짜가 잘 보이는 파일로 다시 시도해보세요.');
          return;
        }

        const imported: Deadline[] = data.events.map((ev: any, idx: number) => ({
          id: `${Date.now()}-${idx}`,
          title: ev.title || '제목 없음',
          course: ev.course || '가져온 일정',
          dueAt: ev.dueAt,
        }));

        setDeadlines(prev => [...prev, ...imported]);
        alert(`${imported.length}개의 일정을 가져왔어요! 필요 없는 항목은 목록에서 삭제해주세요.`);
      } catch (err: any) {
        alert(`가져오기 중 오류가 발생했어요: ${err.message || err}`);
      } finally {
        setIsImportingDeadlines(false);
        e.target.value = '';
      }
    };

    try {
      reader.readAsDataURL(file);
    } catch (err) {
      alert('파일을 읽는 중 문제가 발생했어요.');
      e.target.value = '';
    }
  };

  // 시각은 무시하고 '달력 날짜' 차이로 계산합니다.
  // (ms/day에 Math.ceil을 쓰면 오늘 마감이어도 하루가 덜 지났다는 이유로 1로 반올림되어 "오늘"이 아닌 것처럼 보이는 문제가 있었음)
  const getCalendarDayDiff = (dueAt: string) => {
    const due = new Date(dueAt);
    const now = new Date();
    const startOfDueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((startOfDueDay.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getDDayInfo = (dueAt: string) => {
    const diffMs = new Date(dueAt).getTime() - Date.now();
    if (diffMs < 0) return { label: '마감됨', urgency: 'overdue' as const };

    const diffDays = getCalendarDayDiff(dueAt);
    if (diffDays <= 0) return { label: 'D-DAY', urgency: 'critical' as const };
    if (diffDays <= 3) return { label: `D-${diffDays}`, urgency: 'high' as const };
    if (diffDays <= 7) return { label: `D-${diffDays}`, urgency: 'medium' as const };
    return { label: `D-${diffDays}`, urgency: 'low' as const };
  };

  const urgencyStyles: Record<string, string> = {
    overdue: 'bg-[#262330] text-[#AFA6BD] border-[#322D3B]',
    critical: 'bg-[#35201D] text-[#FF9585] border-[#63392F]',
    high: 'bg-[#362E1A] text-[#FFD97D] border-[#63501F]',
    medium: 'bg-[#331F29] text-[#F4679B] border-[#5C3A4A]',
    low: 'bg-[#15131A] text-[#AFA6BD] border-[#322D3B]',
  };

  const sortedDeadlines = [...deadlines].sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  );

  // 💡 [신규] 마감일 매니저 상단 대시보드 — 등록된 마감일·파일·블록 데이터를 한눈에 요약
  const nowTs = Date.now();
  const upcomingWeekCount = deadlines.filter((d) => {
    const diff = new Date(d.dueAt).getTime() - nowTs;
    return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
  }).length;
  const overdueDeadlinesCount = deadlines.filter((d) => new Date(d.dueAt).getTime() < nowTs).length;
  const activeBlocksCount = blocks.filter((b) => b.active).length;

  const kpiTiles = [
    { label: '전체 마감일', icon: '⏰', value: deadlines.length },
    { label: '이번 주 마감', icon: '📅', value: upcomingWeekCount },
    { label: '지연됨', icon: '⚠️', value: overdueDeadlinesCount, emphasize: overdueDeadlinesCount > 0 },
    { label: '참고 파일', icon: '📁', value: files.length },
    { label: '활성 MCP 블록', icon: '🧩', value: activeBlocksCount },
  ];

  const urgencyBuckets = [
    { key: 'overdue', label: '지연됨', color: '#857C93' },
    { key: 'critical', label: '오늘 마감', color: '#FF7A6B' },
    { key: 'high', label: '임박 (3일 내)', color: '#FFD97D' },
    { key: 'medium', label: '이번 주 (7일 내)', color: '#F4679B' },
    { key: 'low', label: '여유 (7일 후)', color: '#6EE7B7' },
  ];
  const urgencyCounts = deadlines.reduce((acc, d) => {
    const { urgency } = getDDayInfo(d.dueAt);
    acc[urgency] = (acc[urgency] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const maxUrgencyCount = Math.max(0, ...urgencyBuckets.map((b) => urgencyCounts[b.key] || 0));

  const getTimelineBucketLabel = (dueAt: string) => {
    if (new Date(dueAt).getTime() < nowTs) return '지연됨';
    const diffDays = getCalendarDayDiff(dueAt);
    if (diffDays <= 7) return '이번 주';
    if (diffDays <= 14) return '다음 주';
    if (diffDays <= 21) return '2주 후';
    return '3주+';
  };
  const timelineCountMap = deadlines.reduce((acc, d) => {
    const label = getTimelineBucketLabel(d.dueAt);
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const timelineBuckets = ['지연됨', '이번 주', '다음 주', '2주 후', '3주+'].map((label) => ({
    label,
    count: timelineCountMap[label] || 0,
  }));
  const maxTimelineCount = Math.max(0, ...timelineBuckets.map((b) => b.count));

  // 💡 [신규] '나의 기록' 대시보드 — 지금까지 앱에 쌓인 마감일·문서·대화 데이터를 종합 요약
  // 문서 개수는 기기와 무관하게 일관되도록 로컬 files가 아니라 DB(document_uploads) 이력을 기준으로 집계합니다.
  const totalKnownCount = deadlines.length + documentUploads.length + logs.length;

  const daysSinceJoin = user?.created_at
    ? Math.max(1, Math.floor((nowTs - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)) + 1)
    : null;

  const courseBreakdown = Object.entries(
    deadlines.reduce((acc, d) => {
      const key = d.course?.trim() || '카테고리 없음';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  )
    .map(([course, count]) => ({ course, count }))
    .sort((a, b) => b.count - a.count);

  const fileFormatCounts = documentUploads.reduce((acc, d) => {
    acc[d.format] = (acc[d.format] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const fileFormatBreakdown = [
    { key: 'excel', label: '엑셀', icon: '📊' },
    { key: 'hwp', label: 'HWP', icon: '📃' },
    { key: 'ppt', label: 'PPT', icon: '📽️' },
    { key: 'word', label: '워드', icon: '📝' },
    { key: 'pdf', label: 'PDF', icon: '📕' },
    { key: 'image', label: '이미지', icon: '🖼️' },
  ].map((f) => ({ ...f, count: fileFormatCounts[f.key] || 0 }));
  const etcFileCount = fileFormatCounts['etc'] || 0;

  const NAV_ITEMS = [
    { id: 'workspace', label: '워크스페이스', icon: Sparkles },
    { id: 'records', label: '나의 기록', icon: Archive },
    { id: 'deadlines', label: '마감일 매니저', icon: AlarmClock },
    { id: 'mcp', label: 'MCP 블록 매니저', icon: Puzzle },
    { id: 'monitoring', label: '모니터링 & 파일', icon: LineChart },
    { id: 'logs', label: 'DB 연동 로그', icon: ScrollText },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#15131A] flex items-center justify-center">
        <style jsx global>{`
          @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
          * { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
        `}</style>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-[#322D3B] border-t-[#F4679B] rounded-full animate-spin" />
          <span className="text-sm text-[#AFA6BD]">로딩 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#15131A] text-[#F5F2F7] flex flex-col md:flex-row">
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
      <div className="md:hidden flex items-center justify-between bg-[#211E28] border-b border-[#322D3B] px-4 py-3.5">
        <span className="font-extrabold text-[15px] text-[#F5F2F7] tracking-tight">Micro-MCP</span>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="메뉴 열기"
          className="text-[#F5F2F7] text-xl p-1.5 rounded-lg hover:bg-[#15131A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
        >
          {isMobileMenuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* 사이드바 메뉴 */}
      <div className={`
        ${isMobileMenuOpen ? 'flex' : 'hidden'} md:flex
        w-full md:w-64 bg-[#211E28] border-r border-[#322D3B] flex-col shrink-0
        z-50
      `}>
        <div className="hidden md:flex px-6 py-6 items-center gap-2.5 border-b border-[#322D3B] text-[#F4679B]">
          <Logomark className="w-7 h-7" />
          <span className="text-[16px] font-extrabold text-[#F5F2F7] tracking-tight">Micro-MCP</span>
        </div>
        <div className="p-3 flex flex-col gap-1 flex-1">
          {NAV_ITEMS.map(item => (
            <div
              key={item.id}
              onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
              role="button"
              tabIndex={0}
              className={`px-3.5 py-2.5 rounded-lg text-sm font-medium cursor-pointer flex items-center gap-2.5 border-l-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                activeTab === item.id
                  ? 'bg-[#331F29] text-[#F4679B] font-semibold border-[#F4679B]'
                  : 'text-[#AFA6BD] border-transparent hover:bg-[#15131A] hover:text-[#F5F2F7]'
              }`}
            >
              <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {/* 좌측 하단 MCP 연결 상태 배지 UI */}
        <div className="p-4 border-t border-[#322D3B] text-xs bg-[#1C1922]">
          <div className="flex items-center gap-2 mb-2.5">
            <span className={`w-1.5 h-1.5 rounded-full ${dbStatus === 'connected' ? 'bg-[#6EE7B7] animate-pulse' : 'bg-[#FF7A6B]'}`}></span>
            <span className="font-semibold text-[#F5F2F7]">DeepSeek V4 Flash 연동됨</span>
          </div>
          <div className="text-[11px] text-[#857C93] mb-1.5 font-medium uppercase tracking-wide">활성화된 MCP 블록</div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {blocks.filter(b => b.active).length === 0 ? (
              <span className="text-[#857C93] italic">없음</span>
            ) : (
              blocks.filter(b => b.active).map(b => (
                <span key={b.id} className="bg-[#1B3328] text-[#6EE7B7] border border-[#37604D] px-2 py-1 rounded-md text-[10px] font-medium flex items-center gap-1">
                  <b.icon className="w-3 h-3 shrink-0" strokeWidth={2} /> {b.name.replace(' 블록', '')}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="hidden md:flex h-[68px] border-b border-[#322D3B] items-center justify-end px-8 gap-3 bg-[#211E28]/70 backdrop-blur">
          <div className="flex items-center gap-2 bg-[#15131A] px-3.5 py-2 rounded-full border border-[#322D3B]">
            <span className="text-xs text-[#AFA6BD] max-w-[220px] truncate">{user?.email}</span>
          </div>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.push('/login');
            }}
            className="px-4 py-2 rounded-lg border border-[#63392F] bg-[#211E28] text-[#FF7A6B] hover:bg-[#35201D] text-xs font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A6B]"
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
                <p className="text-[#AFA6BD] text-xs sm:text-sm mt-1.5">
                  활성화된 MCP 블록 맥락 및 첨부된 문서 내용을 바탕으로 AI가 실제 답변을 도출합니다.
                </p>
              </div>

              <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-4 sm:p-6 mb-6 shadow-sm">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
                  <div className="text-sm font-semibold text-[#F5F2F7]">
                    AI 프롬프트 전송
                  </div>
                  <div className="flex items-center gap-1.5 bg-[#15131A] px-3 py-1 rounded-full border border-[#322D3B] text-xs text-[#AFA6BD] max-w-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6EE7B7] animate-pulse shrink-0"></span>
                    <span className="truncate">{activeMcpNames}</span>
                  </div>
                </div>

                <form onSubmit={handleExecute} className="flex flex-col sm:flex-row gap-3">
                  <input
                    ref={commandInputRef}
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="예: 첨부된 일정표를 바탕으로 이번 주 계획을 정리해줘..."
                    className="flex-1 bg-[#211E28] border border-[#423B4C] rounded-lg px-4 py-3 text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 transition-colors placeholder:text-[#857C93]"
                  />
                  <button
                    type="submit"
                    disabled={isExecuting}
                    className="bg-[#F4679B] hover:bg-[#D1477F] text-white border-none rounded-lg px-6 py-3 font-semibold text-sm cursor-pointer disabled:opacity-50 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
                  >
                    {isExecuting ? '전송 중...' : '프롬프트 전송'}
                  </button>
                </form>
              </div>

              <div className="bg-[#0D0B11] rounded-2xl border border-[#2A2632] overflow-hidden shadow-sm">
                <div className="bg-[#17141D] px-4 py-3 flex items-center gap-2 border-b border-[#2A2632]">
                  <MessageCircle className="w-4 h-4 text-[#F4679B]" strokeWidth={2} />
                  <span className="text-[13px] font-semibold text-[#F5F2F7]">
                    AI 응답
                  </span>
                </div>

                <div className="p-4 sm:p-5 text-[14px] leading-[1.8] font-medium text-[#FBE4EE] whitespace-pre-wrap min-h-[150px]">
                  {streamingLog}
                  {streamingLog === IDLE_CONSOLE_MESSAGE && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {EXAMPLE_PROMPTS.map((example) => (
                        <button
                          key={example.prompt}
                          type="button"
                          onClick={() => {
                            setCommand(example.prompt);
                            commandInputRef.current?.focus();
                          }}
                          className="inline-flex items-center gap-1.5 bg-[#211E28] hover:bg-[#2A2632] border border-[#322D3B] hover:border-[#F4679B]/50 text-[#C9C0D6] hover:text-[#F5F2F7] text-xs font-medium pl-2.5 pr-3.5 py-2 rounded-full transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                        >
                          <example.icon className="w-3.5 h-3.5 text-[#F4679B] shrink-0" strokeWidth={2} />
                          {example.prompt}
                        </button>
                      ))}
                    </div>
                  )}
                  <div ref={terminalEndRef} />
                </div>
              </div>

              {detectedActionItems.length > 0 && (
                <div className="mt-4 bg-[#211E28] rounded-2xl border border-[#F4679B]/40 p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-[#F4679B] mb-3">✨ 날짜가 있는 할 일을 발견했어요</h3>
                  <div className="flex flex-col gap-2.5">
                    {detectedActionItems.map((item, idx) => (
                      <div
                        key={`${item.title}-${idx}`}
                        className="flex items-center justify-between gap-3 bg-[#15131A] border border-[#322D3B] rounded-lg p-3"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#F5F2F7] truncate">{item.title}</div>
                          <div className="text-xs text-[#857C93] mt-0.5">
                            {new Date(item.dueAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddDetectedDeadline(item)}
                          className="shrink-0 bg-[#F4679B] hover:bg-[#D1477F] text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
                        >
                          마감일로 등록하기
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'records' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  나의 기록
                </h1>
                <p className="text-[#AFA6BD] text-xs sm:text-sm mt-1.5">
                  지금까지 Micro-MCP에 쌓인 내 데이터를 한눈에 확인해보세요.
                </p>
              </div>

              {/* 히어로 숫자 */}
              <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-6 sm:p-8 mb-5 shadow-sm text-center">
                <p className="text-xs sm:text-sm text-[#AFA6BD] mb-3">Micro-MCP가 당신에 대해 알고 있는 것</p>
                <div className="text-5xl sm:text-6xl font-extrabold text-[#F4679B] tracking-tight leading-none">
                  {totalKnownCount}
                  <span className="text-xl sm:text-2xl text-[#F5F2F7] ml-1.5 align-middle">개</span>
                </div>
                {daysSinceJoin !== null && (
                  <p className="text-xs sm:text-sm text-[#857C93] mt-4">
                    가입한 지 <span className="text-[#F5F2F7] font-semibold">{daysSinceJoin}일째</span> 함께하고 있어요
                  </p>
                )}
              </div>

              {/* 카드 3개: 마감일 / 문서 / 대화 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-5 shadow-sm flex flex-col">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">⏰</span>
                    <h3 className="text-sm font-bold text-[#F5F2F7]">등록된 마감일</h3>
                  </div>
                  <div className="text-3xl font-extrabold text-[#F5F2F7] mb-3">
                    {deadlines.length}<span className="text-xs font-medium text-[#857C93] ml-1">개</span>
                  </div>
                  {courseBreakdown.length === 0 ? (
                    <p className="text-xs text-[#857C93]">아직 등록된 마감일이 없어요.</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {courseBreakdown.slice(0, 5).map((c) => (
                        <div key={c.course} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-[#AFA6BD] truncate">{c.course}</span>
                          <span className="shrink-0 text-[#F5F2F7] font-semibold tabular-nums">{c.count}개</span>
                        </div>
                      ))}
                      {courseBreakdown.length > 5 && (
                        <span className="text-[11px] text-[#857C93] mt-0.5">외 {courseBreakdown.length - 5}개 카테고리 더</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-5 shadow-sm flex flex-col">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">📁</span>
                    <h3 className="text-sm font-bold text-[#F5F2F7]">분석한 문서</h3>
                  </div>
                  <div className="text-3xl font-extrabold text-[#F5F2F7] mb-3">
                    {files.length}<span className="text-xs font-medium text-[#857C93] ml-1">개</span>
                  </div>
                  {files.length === 0 ? (
                    <p className="text-xs text-[#857C93]">아직 첨부한 문서가 없어요.</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {fileFormatBreakdown.map((f) => (
                        <div key={f.key} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-[#AFA6BD] flex items-center gap-1.5 truncate">
                            <span>{f.icon}</span>{f.label}
                          </span>
                          <span className="shrink-0 text-[#F5F2F7] font-semibold tabular-nums">{f.count}개</span>
                        </div>
                      ))}
                      {etcFileCount > 0 && (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-[#AFA6BD] flex items-center gap-1.5 truncate"><span>📄</span>기타</span>
                          <span className="shrink-0 text-[#F5F2F7] font-semibold tabular-nums">{etcFileCount}개</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-5 shadow-sm flex flex-col">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">📜</span>
                    <h3 className="text-sm font-bold text-[#F5F2F7]">저장된 대화</h3>
                  </div>
                  <div className="text-3xl font-extrabold text-[#F5F2F7] mb-3">
                    {logs.length}<span className="text-xs font-medium text-[#857C93] ml-1">개</span>
                  </div>
                  {logs.length === 0 ? (
                    <p className="text-xs text-[#857C93]">아직 저장된 대화가 없어요.</p>
                  ) : (
                    <p className="text-xs text-[#857C93]">
                      가장 최근 대화: {new Date(logs[0].created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'deadlines' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  마감일 매니저
                </h1>
                <p className="text-[#AFA6BD] text-xs sm:text-sm mt-1.5">
                  과제와 시험 마감일을 한눈에 모아서, 가장 급한 것부터 자동으로 정렬해드려요.
                </p>
              </div>

              {/* 대시보드 — 마감일 · 첨부 파일 · 활성 블록 데이터를 한눈에 요약 */}
              <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-5 mb-6 shadow-sm">
                <h3 className="text-sm sm:text-base font-bold text-[#F5F2F7] mb-4">📊 대시보드 — 지금까지 알고 있는 것</h3>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
                  {kpiTiles.map((tile) => (
                    <div key={tile.label} className="bg-[#15131A] border border-[#322D3B] rounded-xl p-3.5 flex flex-col gap-1.5">
                      <span className="text-[11px] text-[#857C93] font-medium uppercase tracking-wide flex items-center gap-1">
                        <span>{tile.icon}</span> {tile.label}
                      </span>
                      <span className={`text-xl sm:text-2xl font-extrabold tabular-nums ${tile.emphasize ? 'text-[#FF7A6B]' : 'text-[#F5F2F7]'}`}>
                        {tile.value}
                      </span>
                    </div>
                  ))}
                </div>

                {deadlines.length === 0 ? (
                  <div className="text-sm text-[#857C93] text-center py-6 bg-[#15131A] rounded-xl border border-[#322D3B]">
                    아직 등록된 마감일이 없어요. 아래에서 첫 마감일을 추가하면 여기에 분포와 타임라인이 표시돼요.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 긴급도 분포 */}
                    <div>
                      <h4 className="text-xs font-bold text-[#857C93] uppercase tracking-wide mb-3">긴급도 분포</h4>
                      <div className="flex flex-col gap-2.5">
                        {urgencyBuckets.map((bucket) => {
                          const count = urgencyCounts[bucket.key] || 0;
                          const widthPct = maxUrgencyCount > 0 ? (count / maxUrgencyCount) * 100 : 0;
                          return (
                            <div key={bucket.key} className="flex items-center gap-2.5">
                              <span className="w-[92px] shrink-0 text-xs text-[#AFA6BD] truncate">{bucket.label}</span>
                              <div className="flex-1 h-2.5 bg-[#15131A] border border-[#322D3B] rounded-full overflow-hidden">
                                {count > 0 && (
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${Math.max(widthPct, 6)}%`, backgroundColor: bucket.color }}
                                  />
                                )}
                              </div>
                              <span className="w-5 shrink-0 text-right text-xs font-semibold text-[#F5F2F7] tabular-nums">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* 다가오는 일정 타임라인 */}
                    <div>
                      <h4 className="text-xs font-bold text-[#857C93] uppercase tracking-wide mb-3">다가오는 일정 타임라인</h4>
                      <div className="flex items-end justify-between gap-2 h-[96px] border-b border-[#322D3B]">
                        {timelineBuckets.map((bucket) => {
                          const heightPct = maxTimelineCount > 0 ? (bucket.count / maxTimelineCount) * 100 : 0;
                          return (
                            <div key={bucket.label} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
                              <span className="text-[11px] font-semibold text-[#F5F2F7] tabular-nums h-4">{bucket.count > 0 ? bucket.count : ''}</span>
                              {bucket.count > 0 && (
                                <div
                                  className="w-5 rounded-t-[4px] bg-[#F4679B]"
                                  style={{ height: `${Math.max(heightPct, 6)}%` }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex justify-between gap-2 mt-1.5">
                        {timelineBuckets.map((bucket) => (
                          <span key={bucket.label} className="flex-1 text-center text-[10px] text-[#857C93] truncate">{bucket.label}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-6 pt-5 border-t border-[#322D3B]">
                  <div>
                    <h4 className="text-xs font-bold text-[#857C93] uppercase tracking-wide mb-2.5">활성화된 MCP 블록</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {blocks.filter((b) => b.active).length === 0 ? (
                        <span className="text-xs text-[#857C93] italic">활성화된 블록이 없어요</span>
                      ) : (
                        blocks.filter((b) => b.active).map((b) => (
                          <span key={b.id} className="bg-[#1B3328] text-[#6EE7B7] border border-[#37604D] px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1">
                            <b.icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} /> {b.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-[#857C93] uppercase tracking-wide mb-2.5">최근 첨부 파일</h4>
                    {files.length === 0 ? (
                      <span className="text-xs text-[#857C93] italic">첨부된 파일이 없어요</span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {files.slice(0, 3).map((f) => (
                          <div key={f.id} className="flex items-center justify-between gap-2 text-xs text-[#AFA6BD]">
                            <span className="truncate">📄 {f.name}</span>
                            <span className="shrink-0 text-[#857C93]">{f.date}</span>
                          </div>
                        ))}
                        {files.length > 3 && (
                          <span className="text-[11px] text-[#857C93]">외 {files.length - 3}개 더</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-5 mb-4 shadow-sm">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-[#F5F2F7]">파일 하나로 한 번에 가져오기</h3>
                    <p className="text-xs text-[#AFA6BD] mt-1">캘린더 파일(.ics), 시간표 캡처, 학사일정 PDF 등 무엇이든 올리면 AI가 알아서 일정을 찾아 정리해요.</p>
                  </div>
                  <label className={`inline-flex px-4 py-2.5 rounded-lg text-sm font-semibold items-center gap-2 border transition-colors shrink-0 focus-within:ring-2 focus-within:ring-[#F4679B] ${
                    isImportingDeadlines
                      ? 'bg-[#15131A] text-[#857C93] border-[#322D3B] cursor-not-allowed'
                      : 'bg-[#211E28] hover:bg-[#15131A] text-[#F4679B] border-[#5C3A4A] cursor-pointer'
                  }`}>
                    {isImportingDeadlines ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-[#423B4C] border-t-[#F4679B] rounded-full animate-spin" />
                        <span>AI가 분석 중...</span>
                      </>
                    ) : (
                      <span>파일 업로드</span>
                    )}
                    <input
                      type="file"
                      onChange={handleDeadlineFileUpload}
                      disabled={isImportingDeadlines}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-5 mb-6 shadow-sm">
                <h3 className="text-sm sm:text-base font-bold mb-4 text-[#F5F2F7]">직접 입력해서 추가</h3>
                <form onSubmit={handleAddDeadline} className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr_auto] gap-3">
                  <input
                    type="text"
                    required
                    placeholder="할 일 (예: 데이터베이스 과제 3)"
                    value={newDeadlineTitle}
                    onChange={(e) => setNewDeadlineTitle(e.target.value)}
                    className="px-3.5 py-2.5 rounded-lg border border-[#423B4C] bg-[#211E28] text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[#857C93]"
                  />
                  <input
                    type="text"
                    placeholder="과목/카테고리 (선택)"
                    value={newDeadlineCourse}
                    onChange={(e) => setNewDeadlineCourse(e.target.value)}
                    className="px-3.5 py-2.5 rounded-lg border border-[#423B4C] bg-[#211E28] text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[#857C93]"
                  />
                  <input
                    type="datetime-local"
                    required
                    value={newDeadlineDue}
                    onChange={(e) => setNewDeadlineDue(e.target.value)}
                    className="px-3.5 py-2.5 rounded-lg border border-[#423B4C] bg-[#211E28] text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20"
                  />
                  <button
                    type="submit"
                    className="bg-[#F4679B] hover:bg-[#D1477F] text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
                  >
                    추가
                  </button>
                </form>
              </div>

              <div className="flex flex-col gap-2.5">
                {sortedDeadlines.length === 0 && (
                  <div className="text-sm text-[#857C93] text-center py-8 bg-[#211E28] rounded-2xl border border-[#322D3B]">
                    등록된 마감일이 없습니다. 위에서 첫 마감일을 추가해보세요!
                  </div>
                )}
                {sortedDeadlines.map((deadline) => {
                  const dday = getDDayInfo(deadline.dueAt);
                  return (
                    <div
                      key={deadline.id}
                      className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-4 flex items-center justify-between gap-3 shadow-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-bold border ${urgencyStyles[dday.urgency]}`}>
                          {dday.label}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#F5F2F7] truncate">{deadline.title}</div>
                          <div className="text-xs text-[#857C93] mt-0.5">
                            {deadline.course && <span>{deadline.course} · </span>}
                            {new Date(deadline.dueAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteDeadline(deadline.id)}
                        className="shrink-0 text-[#FF7A6B] hover:text-[#FF9585] text-xs px-2.5 py-1.5 bg-[#35201D] rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A6B]"
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
                <p className="text-[#AFA6BD] text-xs sm:text-sm mt-1.5">
                  AI 파이프라인에 연결할 MCP 블록을 활성화하세요. 설정은 브라우저에 안전하게 영구 저장됩니다.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {blocks.map((block) => (
                  <div
                    key={block.id}
                    className={`rounded-2xl border p-5 flex flex-col justify-between transition-all duration-200 bg-[#211E28] ${
                      block.active
                        ? 'border-[#F4679B]/40 shadow-sm'
                        : 'border-[#322D3B]'
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-sm sm:text-base font-bold flex items-center gap-2 truncate text-[#F5F2F7]">
                          <block.icon className="w-[18px] h-[18px] shrink-0 text-[#F4679B]" strokeWidth={2} /> <span className="truncate">{block.name}</span>
                        </span>

                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0">
                          <span className={`w-1.5 h-1.5 rounded-full ${block.active ? 'bg-[#6EE7B7] animate-pulse' : 'bg-[#423B4C]'}`}></span>
                          <span className={block.active ? 'text-[#6EE7B7]' : 'text-[#857C93]'}>
                            {block.active ? '활성됨' : '비활성'}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs sm:text-sm text-[#AFA6BD] leading-normal">{block.description}</p>
                    </div>

                    <button
                      onClick={() => toggleBlock(block.id)}
                      className={`mt-4 w-full sm:w-auto self-start border rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                        block.active
                          ? 'bg-[#1B3328] text-[#6EE7B7] border-[#37604D] hover:bg-[#234438]'
                          : 'bg-[#F4679B] text-white border-transparent hover:bg-[#D1477F]'
                      }`}
                    >
                      {block.active ? '✓ 블록 작동 중 (클릭시 해제)' : '블록 활성화하기'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'monitoring' && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  모니터링 & 파일 (RAG 컨텍스트)
                </h1>
                <p className="text-[#AFA6BD] text-xs sm:text-sm mt-1.5">
                  AI가 참고할 수 있도록 일정표, 엑셀, 문서, 이미지 등의 파일을 첨부하세요.
                </p>
              </div>

              <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-5 mb-6 shadow-sm">
                <h3 className="text-sm sm:text-base font-bold mb-4 text-[#F5F2F7]">AI 참조용 파일 및 일정표 첨부</h3>

                <div className="mb-5">
                  <label className="inline-flex bg-[#F4679B] hover:bg-[#D1477F] text-white px-5 py-2.5 rounded-lg text-sm font-semibold cursor-pointer items-center gap-2 transition-colors">
                    <span>파일 및 캘린더 일정 첨부하기</span>
                    <input
                      type="file"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="text-xs text-[#857C93] mb-5 flex items-center gap-3">
                  <hr className="flex-1 border-[#322D3B]" />
                  <span>또는 텍스트 직접 입력</span>
                  <hr className="flex-1 border-[#322D3B]" />
                </div>

                <form onSubmit={handleAddFile} className="flex flex-col gap-3">
                  <input
                    type="text"
                    placeholder="문서 제목 (예: 5월_행사일정.txt)"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    className="bg-[#211E28] border border-[#423B4C] rounded-lg px-3.5 py-2.5 text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[#857C93]"
                  />
                  <textarea
                    placeholder="AI가 읽을 일정 내용이나 메모를 입력하세요..."
                    value={newFileContent}
                    onChange={(e) => setNewFileContent(e.target.value)}
                    rows={3}
                    className="bg-[#211E28] border border-[#423B4C] rounded-lg px-3.5 py-2.5 text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 resize-none placeholder:text-[#857C93]"
                  />
                  <button type="submit" className="self-end bg-[#211E28] hover:bg-[#15131A] text-[#F5F2F7] px-5 py-2.5 rounded-lg text-sm font-semibold border border-[#423B4C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]">
                    직접 입력해서 등록
                  </button>
                </form>

                <div className="mt-8 flex flex-col gap-2">
                  <h4 className="text-xs font-bold text-[#857C93] uppercase tracking-wider mb-1">등록된 컨텍스트 파일 목록</h4>
                  {files.length === 0 && (
                    <div className="text-sm text-[#857C93] text-center py-4">등록된 파일이 없습니다.</div>
                  )}
                  {files.map(file => (
                    <div key={file.id} className="flex flex-col bg-[#1C1922] p-3.5 rounded-lg border border-[#322D3B] text-sm gap-1">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-[#F4679B]">📄 {file.name} <span className="text-xs text-[#857C93] font-normal">({file.size})</span></span>
                        <button onClick={() => handleDeleteFile(file.id)} className="text-[#FF7A6B] hover:text-[#FF9585] text-xs px-2 py-1 bg-[#35201D] rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A6B]">삭제</button>
                      </div>
                      <p className="text-xs text-[#AFA6BD] truncate mt-1">타입: {file.mimeType || 'text/plain'}</p>
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
                <p className="text-[#AFA6BD] text-xs sm:text-sm mt-1.5">
                  Supabase 데이터베이스에 기록된 프롬프트 이력과 당시 AI의 답변을 확인할 수 있습니다.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {logs.length === 0 && (
                  <div className="text-sm text-[#857C93] text-center py-8 bg-[#211E28] rounded-2xl border border-[#322D3B]">
                    저장된 로그가 없습니다. 워크스페이스에서 프롬프트를 전송해 보세요!
                  </div>
                )}
                {logs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <div key={log.id} className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-4 flex flex-col gap-3 shadow-sm">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                        <div className="flex items-center gap-2 font-mono-console text-xs text-[#F4679B]">
                          <span className="text-[#857C93]">[{new Date(log.created_at).toLocaleTimeString()}]</span>
                          <span className="font-semibold text-[#F5F2F7]">{log.content}</span>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                          {log.response && (
                            <button
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              className="bg-[#331F29] hover:bg-[#3D2733] text-[#F4679B] border border-[#5C3A4A] text-xs px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                            >
                              {isExpanded ? '▲ 답변 접기' : '▼ AI 답변 보기'}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteLog(log.id)}
                            aria-label="로그 삭제"
                            className="w-7 h-7 flex items-center justify-center bg-[#15131A] hover:bg-[#35201D] text-[#857C93] hover:text-[#FF7A6B] border border-[#322D3B] rounded-lg text-xs transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A6B]"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {isExpanded && log.response && (
                        <div className="bg-[#0D0B11] p-4 rounded-lg border border-[#2A2632] text-[14px] font-medium text-[#FBE4EE] leading-[1.8] whitespace-pre-wrap mt-1">
                          <div className="text-[11px] text-[#8D8499] mb-2">[AI 응답 결과 기록]</div>
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
