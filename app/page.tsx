'use client';

import { useState, useEffect, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Archive,
  AlarmClock,
  LineChart,
  ScrollText,
  Search,
  FileText,
  CalendarClock,
  PenLine,
  NotebookPen,
  MessageCircle,
  UploadCloud,
  Loader2,
  AlertTriangle,
  Paperclip,
  ImageIcon,
  X,
  GraduationCap,
  ArrowLeft,
} from 'lucide-react';
import type { NodeId, CircuitGraphState, GraphNode } from '@/types/blocks';
import { NODE_REGISTRY } from '@/lib/blocks/defaults';
import { loadGraphPreferences, saveGraphPreferences, clearLegacyBlockState, type GraphPreferences } from '@/lib/blocks/storage';
import { loadUserScopedItem, saveUserScopedItem } from '@/lib/storage/user-scoped';
import { CircuitBoard } from '@/components/circuit/circuit-board';
import {
  detectLens,
  type LensId,
  type DeadlinesResult,
  type DeadlineItem,
  type QuestionsResult,
  type DigestResult,
} from '@/lib/lenses';

function getNodeMeta(id: NodeId) {
  return NODE_REGISTRY.find((n) => n.id === id);
}

// 💡 [신규] 이번 단계는 UI를 9노드 3열 파이프라인으로 전환하는 게 목표라, 그래프 자체를 만들고
// 편집하는 로직은 아직 없습니다. 눈으로 확인할 수 있도록 더미 그래프를 하드코딩해서 렌더합니다.
const DUMMY_GRAPH: CircuitGraphState = {
  nodes: [
    { id: 'this_doc', layer: 'source', status: 'done' },
    { id: 'digest', layer: 'lens', status: 'running' },
  ],
  edges: [
    { from: 'this_doc', to: 'digest' },
  ],
};

interface LogItem {
  id: string;
  content: string;
  response?: string;
  created_at: string;
  folder_id: string | null;
}

// 💡 [신규] "지난 대화"를 분류하는 폴더 — conversation_folders 테이블과 1:1 대응.
interface ConversationFolder {
  id: string;
  name: string;
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

// 💡 [신규] "물어보기" 채팅창에서 첨부한 파일/사진 — 대화(세션) 동안 계속 참조되도록 상태로 들고 있습니다.
// 텍스트 파일은 /api/extract로 미리 뽑아둔 글자(text)를, 사진은 GPT-4.1 mini 비전에 바로 보낼
// base64 데이터 URL(dataUrl)을 들고 있습니다.
interface ChatAttachment {
  id: string;
  name: string;
  kind: 'text' | 'image';
  text?: string;
  mimeType?: string;
  dataUrl?: string;
}

// 💡 [신규] '나의 기록' 대시보드가 기기와 무관하게 일관되게 보이도록, 파일 업로드 이력을 DB(document_uploads)에 누적 기록합니다.
interface DocumentUploadRecord {
  format: string;
  created_at: string;
}

// 💡 [신규] 교수님 단위로 자료를 모아 분석하는 기능 — professors/documents 테이블과 1:1 대응.
// documents는 추출된 텍스트(content)까지 들고 있어서, 분석할 때마다 파일을 다시 올릴 필요가 없습니다.
interface Professor {
  id: string;
  name: string;
  school: string | null;
  department: string | null;
  created_at: string;
}

interface ProfessorDocument {
  id: string;
  professor_id: string | null;
  file_name: string;
  format: string;
  content: string;
  doc_type: string;
  created_at: string;
}

// 카테고리별로 "이 자료만으로 확신 있게 판단했는지(confident)"와 "판단 내용(items)"을 나눠서 받습니다.
// confident가 false인 카테고리는 화면에서 "더 올리면 알 수 있는 것"으로 회색 표시됩니다.
interface ProfessorAnalysisCategory {
  confident: boolean;
  items: string[];
}

interface ProfessorAnalysisResult {
  topics: ProfessorAnalysisCategory;
  examStyle: ProfessorAnalysisCategory;
  assignmentStyle: ProfessorAnalysisCategory;
  examQuestionTypes: ProfessorAnalysisCategory;
  gradingStrictness: ProfessorAnalysisCategory;
  researchInterests: ProfessorAnalysisCategory;
}

// professor_analysis 테이블 한 행 — 교수님 1명당 최신 분석 결과 하나(upsert).
interface ProfessorAnalysisRow {
  professor_id: string;
  result: ProfessorAnalysisResult;
  document_count: number;
  updated_at: string;
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

// getFileFormatKey가 뱉는 키에 대응하는 표시용 이모지 — '나의 기록' 탭 표기와 통일.
const FORMAT_ICONS: Record<string, string> = {
  excel: '📊',
  hwp: '📃',
  ppt: '📽️',
  word: '📝',
  pdf: '📕',
  image: '🖼️',
  etc: '📄',
};

// 💡 교수님 자료의 "종류" — 파일 형식(FORMAT_ICONS)과는 다른 축입니다. 논문(paper)은
// /api/analyze-professor가 "이 교수님의 연구 관심사" 카테고리의 유일한 근거로 삼습니다.
const DOC_TYPE_DEFS: { key: string; label: string }[] = [
  { key: 'lecture', label: '강의자료' },
  { key: 'exam', label: '시험지' },
  { key: 'assignment', label: '과제' },
  { key: 'paper', label: '논문' },
];
const DOC_TYPE_LABELS: Record<string, string> = Object.fromEntries(DOC_TYPE_DEFS.map((d) => [d.key, d.label]));

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

// 채팅 입력창 위 미니 전선에서 고를 수 있는 답변 종류. 'none' = 그냥 대화(관점 분석 없이 평소처럼).
const CHAT_LENS_CHOICES: { id: LensId | 'none'; label: string }[] = [
  { id: 'deadlines', label: '마감 뽑기' },
  { id: 'questions', label: '예상 질문' },
  { id: 'digest', label: '핵심 정리' },
  { id: 'none', label: '그냥 대화' },
];

// 💡 교수님 분석 결과의 5개 카테고리 — ProfessorAnalysisResult의 키와 1:1 대응.
// 각 카테고리는 AI가 반환한 confident 값에 따라 화면에서 실제 결과(위)로 올라가거나
// "더 올리면 알 수 있는 것"(아래, 회색)으로 내려갑니다 — 고정된 목록이 아니라 매 분석마다 갈립니다.
const PROFESSOR_CATEGORY_DEFS: { key: keyof ProfessorAnalysisResult; label: string }[] = [
  { key: 'topics', label: '자주 강조하는 주제' },
  { key: 'examStyle', label: '문제 내는 방식' },
  { key: 'assignmentStyle', label: '과제 요구 스타일' },
  { key: 'examQuestionTypes', label: '시험 문제 유형' },
  { key: 'gradingStrictness', label: '채점 기준의 엄격함' },
  { key: 'researchInterests', label: '연구 관심사' },
];

// 💡 [신규] 교수님 상세 화면 회로도의 action 노드 3개 — 이미 계산된 6개 카테고리 결과를 재활용해서
// 매핑합니다(별도 API 호출 없음). "공부 방식"은 어느 카테고리와도 정확히 대응되지 않아서, 자주
// 강조되는 주제(topics)를 "무엇을 중점적으로 공부해야 하는지"로 재해석해서 씁니다.
const PROFESSOR_CIRCUIT_DEFS: { nodeId: Extract<NodeId, 'expected_questions' | 'assignment_direction' | 'study_method'>; label: string; keys: (keyof ProfessorAnalysisResult)[] }[] = [
  { nodeId: 'expected_questions', label: '예상 문제', keys: ['examStyle', 'examQuestionTypes'] },
  { nodeId: 'assignment_direction', label: '과제 방향', keys: ['assignmentStyle'] },
  { nodeId: 'study_method', label: '공부 방식', keys: ['topics'] },
];

function getProfessorCircuitCardData(result: ProfessorAnalysisResult | undefined, keys: (keyof ProfessorAnalysisResult)[]) {
  if (!result) return { confident: false, items: [] as string[] };
  const confidentKeys = keys.filter((k) => result[k].confident);
  return {
    confident: confidentKeys.length > 0,
    items: confidentKeys.flatMap((k) => result[k].items),
  };
}

// 문서를 일정 길이로 쪼갭니다(doc_chunks 저장용). 지금은 분석에서 안 쓰이지만, 업로드 시점에
// 미리 쪼개 둬서 나중에 청크 단위 검색/임베딩으로 확장할 때 다시 손댈 필요가 없게 합니다.
function chunkText(text: string, maxChars = 1500): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks: string[] = [];
  for (let start = 0; start < trimmed.length; start += maxChars) {
    chunks.push(trimmed.slice(start, start + maxChars));
  }
  return chunks;
}

const CHAT_IMAGE_MAX_EDGE = 1568; // GPT-4.1 mini 비전이 내부적으로 다운스케일하는 기준과 맞춰, 그 이상은 보내봐야 비용만 늘고 품질 이득이 없습니다.

// OpenAI 비전이 실제로 받는 이미지 형식. 아이폰 기본 사진 형식인 HEIC/HEIF는 목록에 없음 —
// 브라우저가 대신 변환해주지 않는 경우, 그대로 보내면 비전 모델이 못 읽어서 "분석이 안 되는데
// 이유를 알 수 없는" 상황이 됩니다. 업로드 시점에 걸러서 바로 안내합니다.
const SUPPORTED_CHAT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];

// 💡 [신규] 폰으로 찍은 사진처럼 큰 이미지를 GPT-4.1 mini에 보내기 전에 긴 변 기준
// CHAT_IMAGE_MAX_EDGE로 줄여서 base64 용량(=토큰 비용)을 낮춥니다. 이미 그보다 작으면(대부분의
// 스크린샷) 원본 포맷을 그대로 유지 — 리사이즈 과정에서 JPEG로 다시 인코딩되면 투명 배경이 깨질
// 수 있어서, 정말 큰 이미지만 다시 인코딩합니다. 디코딩 자체가 실패하면 원본을 그대로 씁니다.
function resizeImageDataUrl(dataUrl: string, maxEdge = CHAT_IMAGE_MAX_EDGE): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const longEdge = Math.max(img.width, img.height);
      if (longEdge <= maxEdge) {
        resolve(dataUrl);
        return;
      }
      const scale = maxEdge / longEdge;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// 자료 개수에 따라 분석 결과 위에 붙는 한 줄 — 개수가 많아질수록 신뢰도가 올라간다는 걸 보여줍니다.
function getProfessorAnalysisFramingLine(count: number): string {
  if (count <= 1) return '자료 1개로 본 첫인상이에요';
  if (count <= 3) return `자료 ${count}개 기준 — 꽤 잡히기 시작했어요`;
  return `자료 ${count}개 기준 — 패턴이 뚜렷해요`;
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('connecting');
  const [command, setCommand] = useState('');
  const [streamingLog, setStreamingLog] = useState(IDLE_CONSOLE_MESSAGE);
  const [isExecuting, setIsExecuting] = useState(false);

  // 💡 [신규] 물어보기 채팅창 첨부 — 이 대화(세션) 동안 계속 참조되고, 매번 다시 올릴 필요 없음.
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [isAttachingChatFile, setIsAttachingChatFile] = useState(false);
  const [isDraggingOverChat, setIsDraggingOverChat] = useState(false);
  // 💡 [신규] 웹 검색은 느리고 비용도 드니 기본은 꺼두고, 필요할 때만 사용자가 직접 켭니다
  // (첨부 파일·마감일 같은 "읽기 능력"과 달리 유일하게 토글 가능한 기능 — handleExecute 참고).
  const [isSearchActive, setIsSearchActive] = useState(false);

  const [activeTab, setActiveTab] = useState('workspace');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // 💡 [신규] 교수님 단위 자료 모음 — professors 목록과 그 아래 모든 자료(documents)를 한 번에 들고
  // 있다가 화면에서 professor_id로 걸러서 씁니다. 다른 사용자와 공유하지 않는, 이 계정 전용 데이터입니다.
  const [professors, setProfessors] = useState<Professor[]>([]);
  const [professorDocuments, setProfessorDocuments] = useState<ProfessorDocument[]>([]);
  const [isProfessorsLoaded, setIsProfessorsLoaded] = useState(false);
  const [selectedProfessorId, setSelectedProfessorId] = useState<string | null>(null);

  const [isUploadingProfessorDoc, setIsUploadingProfessorDoc] = useState(false);
  const [uploadProfessorChoice, setUploadProfessorChoice] = useState('');
  const [newProfessorName, setNewProfessorName] = useState('');
  const [newProfessorSchool, setNewProfessorSchool] = useState('');
  const [newProfessorDepartment, setNewProfessorDepartment] = useState('');
  // 💡 [신규] 직전에 등록한 교수님의 학교/학과를 기억해뒀다가, 다음 교수님 등록 폼에 기본값으로
  // 채워줍니다(같은 학교 학생이 여러 교수님을 등록하는 경우를 가정) — 물론 그 자리에서 수정 가능합니다.
  const [professorFormDefaults, setProfessorFormDefaults] = useState<{ school: string; department: string } | null>(null);
  // 💡 [신규] 자료 업로드 시 함께 지정하는 자료 종류(강의자료/시험지/과제/논문) — 목록 화면 패널과
  // 교수님 상세 화면의 두 업로드 버튼이 공유하는 단일 선택 상태입니다.
  const [uploadDocType, setUploadDocType] = useState('lecture');

  // 💡 [수정] 교수님별 최신 분석 결과(professor_analysis 테이블과 동기화) — professor_id로 찾아 씁니다.
  // 로컬 전용 단일 상태가 아니라 서버에 upsert된 값을 그대로 반영하므로, 자료 추가/삭제 후
  // 다시 계산하면 여기 배열이 갱신되고 이전 결과가 남아있는 문제가 생기지 않습니다.
  const [professorAnalyses, setProfessorAnalyses] = useState<ProfessorAnalysisRow[]>([]);
  const [isAnalyzingProfessor, setIsAnalyzingProfessor] = useState(false);
  const [professorAnalysisError, setProfessorAnalysisError] = useState<string | null>(null);

  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  // 💡 [신규] 9노드 3열(source→lens→action) 파이프라인 그래프 상태. 그래프 자체(노드 배치·연결)는
  // 매 문서/세션마다 새로 구성되는 걸 전제로 하고 있어 저장하지 않습니다 — 지금은 더미 그래프 고정.
  const [graph] = useState<CircuitGraphState>(DUMMY_GRAPH);

  // 💡 [신규] 그래프 자체는 저장하지 않지만, 다음 그래프를 빠르게 구성할 때 참고할 최소한의 힌트
  // (마지막에 쓴 렌즈, 선호 action)는 계정별로 저장합니다.
  const [graphPreferences, setGraphPreferences] = useState<GraphPreferences>({ lastLens: null, preferredAction: null });
  const [isGraphPreferencesLoaded, setIsGraphPreferencesLoaded] = useState(false);

  const [logs, setLogs] = useState<LogItem[]>([]);
  // 💡 [신규] 대화 폴더 — "전체"/"미분류"/각 폴더 이름으로 지난 대화를 걸러 봅니다.
  const [conversationFolders, setConversationFolders] = useState<ConversationFolder[]>([]);
  const [logFolderFilter, setLogFolderFilter] = useState<'all' | 'unfiled' | string>('all');
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isFilesLoaded, setIsFilesLoaded] = useState(false);

  // 💡 [신규] 채팅에 첨부한 문서(chatAttachments)를 물어보기 입력창 위 미니 전선에서 바로 분석합니다.
  // /api/extract로 글자를 뽑는 건 첨부 시점(handleChatAttachmentFiles)에 이미 끝나 있고, 여기서는
  // 그 결과(latestTextAttachment)로 detectLens → /api/analyze만 담당합니다.
  const [lensId, setLensId] = useState<LensId | null>(null);
  const [lensStage, setLensStage] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle');
  const [lensResult, setLensResult] = useState<DeadlinesResult | QuestionsResult | DigestResult | null>(null);
  const [lensError, setLensError] = useState<string | null>(null);

  // 채팅 입력창 위 미니 전선에서 직접 고른 관점. null = 아직 안 골랐으니 detectLens 자동 판단을 씁니다.
  const [chatLensChoice, setChatLensChoice] = useState<LensId | 'none' | null>(null);

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

  // 💡 [신규] 회로도("마감 뽑기" 관점) 결과에서 [등록]한 항목의 인덱스 — 새로 분석할 때마다 초기화됩니다.
  const [registeredDeadlineIndexes, setRegisteredDeadlineIndexes] = useState<Set<number>>(new Set());

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

  // 💡 [수정] localStorage에서 첨부 파일 불러오기 — 로그인한 계정(user.id)이 확정된 뒤에만 실행하고,
  // 반드시 그 계정 전용 키에서 읽습니다.
  useEffect(() => {
    if (!user) return;

    const savedFiles = loadUserScopedItem<FileItem[]>(user.id, 'mcp_uploaded_files');
    setFiles(savedFiles || []);
    setIsFilesLoaded(true);
  }, [user]);

  // 💡 [신규] 그래프 선호 설정 불러오기 + 예전 블록 모델(v1, mcp_blocks_state) 정리.
  // "마운트 시"는 실제로는 user.id를 알아야 계정별 키를 다룰 수 있어서, 계정이 확정된 시점을 뜻합니다.
  useEffect(() => {
    if (!user) return;
    clearLegacyBlockState(user.id);
    const savedPreferences = loadGraphPreferences(user.id);
    setGraphPreferences(savedPreferences || { lastLens: null, preferredAction: null });
    setIsGraphPreferencesLoaded(true);
  }, [user]);

  useEffect(() => {
    if (isGraphPreferencesLoaded && user) {
      saveGraphPreferences(user.id, graphPreferences);
    }
  }, [graphPreferences, isGraphPreferencesLoaded, user]);

  useEffect(() => {
    if (isFilesLoaded && user) {
      saveUserScopedItem(user.id, 'mcp_uploaded_files', files);
    }
  }, [files, isFilesLoaded, user]);

  // 💡 [수정] 마감일 목록 불러오기 / 저장하기 — 위와 동일하게 계정별로 분리합니다.
  useEffect(() => {
    if (!user) return;
    const savedDeadlines = loadUserScopedItem<Deadline[]>(user.id, 'mcp_deadlines');
    setDeadlines(savedDeadlines || []);
    setIsDeadlinesLoaded(true);
  }, [user]);

  useEffect(() => {
    if (isDeadlinesLoaded && user) {
      saveUserScopedItem(user.id, 'mcp_deadlines', deadlines);
    }
  }, [deadlines, isDeadlinesLoaded, user]);

  // 💡 [신규] 직전에 등록한 교수님의 학교/학과 기본값 불러오기 — "새 교수님 등록" 폼을 열 때 미리 채워줍니다.
  useEffect(() => {
    if (!user) return;
    setProfessorFormDefaults(loadUserScopedItem<{ school: string; department: string }>(user.id, 'mcp_professor_defaults'));
  }, [user]);

  // 텍스트 첨부가 하나도 안 남으면 미니 전선/관점 선택 자체가 의미 없으니 초기화합니다.
  useEffect(() => {
    if (!chatAttachments.some((a) => a.kind === 'text')) {
      setChatLensChoice(null);
      setLensId(null);
      setLensStage('idle');
      setLensResult(null);
      setLensError(null);
    }
  }, [chatAttachments]);

  // 교수님을 바꿔서 볼 때마다 이전 교수님에서 나던 에러 메시지가 남아있지 않도록 초기화합니다.
  // (분석 결과 자체는 professorAnalyses 배열에서 professor_id로 바로 찾으므로 별도 초기화가 필요 없습니다.)
  useEffect(() => {
    setProfessorAnalysisError(null);
  }, [selectedProfessorId]);

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
        fetchProfessorsAndDocuments(retrySession.user.id);
        fetchConversationFolders(retrySession.user.id);
      } else {
        setUser(session.user);
        fetchLogs(session.user.id);
        fetchDocumentUploads(session.user.id);
        fetchProfessorsAndDocuments(session.user.id);
        fetchConversationFolders(session.user.id);
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

  // 💡 [신규] 대화 폴더 목록 조회.
  const fetchConversationFolders = async (userId: string) => {
    const { data } = await supabase
      .from('conversation_folders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    setConversationFolders(data || []);
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

  // 💡 [수정] 교수님 목록 + 그 아래 모든 자료 + 교수님별 최신 분석 결과를 함께 조회합니다
  // (자료/분석 결과는 professor_id로 화면에서 걸러 씁니다).
  const fetchProfessorsAndDocuments = async (userId: string) => {
    const [{ data: professorsData }, { data: documentsData }, { data: analysesData }] = await Promise.all([
      supabase.from('professors').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase
        .from('documents')
        .select('id, professor_id, file_name, format, content, doc_type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('professor_analysis')
        .select('professor_id, result, document_count, updated_at')
        .eq('user_id', userId),
    ]);
    setProfessors(professorsData || []);
    setProfessorDocuments(documentsData || []);
    setProfessorAnalyses(analysesData || []);
    setIsProfessorsLoaded(true);
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

  const activeMcpNames = graph.nodes
    .map(n => getNodeMeta(n.id)?.label)
    .filter((label): label is string => Boolean(label))
    .join(', ') || '연결된 노드 없음';

  // 💡 [신규] 노드 클릭 시 그래프 자체를 편집하지는 않습니다(더미 그래프 고정 단계). 대신 lens/action
  // 노드를 클릭하면 "마지막에 쓴 렌즈"/"선호 action" 힌트를 갱신합니다 — 실행 로직과는 무관합니다.
  const handleNodeClick = (nodeId: NodeId) => {
    const meta = getNodeMeta(nodeId);
    if (!meta) return;
    if (meta.layer === 'lens') {
      setGraphPreferences(prev => ({ ...prev, lastLens: nodeId }));
    } else if (meta.layer === 'action') {
      setGraphPreferences(prev => ({ ...prev, preferredAction: nodeId }));
    }
  };

  // 💡 [신규] 채팅에 첨부한 문서 중 가장 최근 텍스트 첨부 하나를 미니 전선의 대상으로 삼습니다
  // (기존 "파일 분석" 탭과 같은 단일 문서 모델). 직접 관점을 안 골랐으면 detectLens가 자동으로 고릅니다.
  const latestTextAttachment = [...chatAttachments].reverse().find((a) => a.kind === 'text');
  const effectiveChatLens: LensId | 'none' = chatLensChoice
    ?? (latestTextAttachment ? detectLens(latestTextAttachment.text || '', latestTextAttachment.name) : 'none');

  // this_doc(source) → 고른 관점(lens) 두 노드뿐인 최소 그래프. 아직 실행 전이면 lens는 idle,
  // 실행 중/후엔 lensStage를 그대로 반영합니다(이 관점으로 실제로 돌린 결과일 때만).
  const chatLensGraph: CircuitGraphState | null = !latestTextAttachment
    ? null
    : effectiveChatLens === 'none'
      ? { nodes: [{ id: 'this_doc', layer: 'source', status: 'done' }], edges: [] }
      : {
          nodes: [
            { id: 'this_doc', layer: 'source', status: 'done' },
            {
              id: effectiveChatLens,
              layer: 'lens',
              status: lensId !== effectiveChatLens
                ? 'idle'
                : lensStage === 'analyzing' ? 'running' : lensStage === 'error' ? 'error' : lensStage === 'done' ? 'done' : 'idle',
            },
          ],
          edges: [{ from: 'this_doc', to: effectiveChatLens }],
        };

  const handleSelectChatLens = (choice: LensId | 'none') => {
    setChatLensChoice((prev) => (prev === choice ? null : choice));
    if (choice === 'none') {
      setLensStage('idle');
      setLensResult(null);
      setLensError(null);
    }
  };

  // 💡 [신규] 고른 관점(lensId)에 맞춰 /api/analyze 결과(lensResult)를 렌더링합니다.
  // 💡 결과 카드 글자 크기·여백은 모바일 기준을 기본값으로 하고(폰에서 컴퓨터 기준 크기가 답답했음),
  // sm: 이상에서만 기존 데스크톱 크기로 다시 줄입니다.
  const renderLensResult = () => {
    if (!lensId || !lensResult) return null;

    if (lensId === 'deadlines') {
      const result = lensResult as DeadlinesResult;
      if (result.items.length === 0) {
        return <p className="text-base sm:text-sm text-[#C9C0D6] leading-relaxed">기한이 있는 항목을 찾지 못했어요.</p>;
      }
      const allRegistered = result.items.every((_, i) => registeredDeadlineIndexes.has(i));
      return (
        <div className="flex flex-col gap-4 sm:gap-3">
          <div className="flex justify-end">
            <button
              type="button"
              disabled={allRegistered}
              onClick={() => registerAllDeadlineItems(result.items)}
              className="inline-flex items-center gap-1.5 bg-[#2A2632] hover:bg-[#332D3B] border border-[#5C3A4A] text-[#F4679B] text-sm sm:text-xs font-semibold px-4 sm:px-3.5 py-2.5 sm:py-2 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:border-[#332D3B] disabled:text-[#857C93] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
            >
              {allRegistered ? '전체 등록됨' : '전체 등록'}
            </button>
          </div>
          <ul className="flex flex-col gap-4 sm:gap-3">
            {result.items.map((item, i) => {
              const isRegistered = registeredDeadlineIndexes.has(i);
              return (
                <li key={i} className="border border-[#332D3B] rounded-xl p-4 sm:p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5 sm:mb-1">
                    <span className="text-base sm:text-sm font-semibold text-[#F5F2F7] leading-snug">{item.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm sm:text-xs font-semibold text-[#F4679B]">{item.date}</span>
                      <button
                        type="button"
                        disabled={isRegistered}
                        onClick={() => registerDeadlineItem(item, i)}
                        className={`text-xs sm:text-[11px] font-semibold px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                          isRegistered
                            ? 'bg-[#1B3328] text-[#6EE7B7] border-[#37604D] cursor-default'
                            : 'bg-[#2A2632] hover:bg-[#332D3B] text-[#F4679B] border-[#5C3A4A] cursor-pointer'
                        }`}
                      >
                        {isRegistered ? '등록됨' : '등록'}
                      </button>
                    </div>
                  </div>
                  <p className="text-sm sm:text-xs text-[#E4DEEA] italic leading-loose">&quot;{item.evidence}&quot;</p>
                  <div className="mt-2.5 sm:mt-2 h-1.5 sm:h-1 rounded-full bg-[#2A2632] overflow-hidden">
                    <div
                      className="h-full bg-[#6EE7B7]"
                      style={{ width: `${Math.round(Math.max(0, Math.min(1, item.confidence)) * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }

    if (lensId === 'questions') {
      const result = lensResult as QuestionsResult;
      if (result.items.length === 0) {
        return <p className="text-base sm:text-sm text-[#C9C0D6] leading-relaxed">예상 질문을 뽑지 못했어요.</p>;
      }
      return (
        <ul className="flex flex-col gap-4 sm:gap-3">
          {result.items.map((item, i) => (
            <li key={i} className="border border-[#332D3B] rounded-xl p-4 sm:p-3.5">
              <p className="text-base sm:text-sm font-semibold text-[#F5F2F7] mb-2 sm:mb-1.5 leading-relaxed">Q. {item.question}</p>
              <p className="text-sm sm:text-xs text-[#F4679B] mb-2 sm:mb-1.5 leading-loose">약점: {item.targetWeakness}</p>
              <p className="text-sm sm:text-xs text-[#E4DEEA] leading-loose">A. {item.draftAnswer}</p>
              {item.source_quote && (
                <p className="text-xs sm:text-[11px] text-[#857C93] italic leading-loose mt-1.5">근거: &quot;{item.source_quote}&quot;</p>
              )}
            </li>
          ))}
        </ul>
      );
    }

    const result = lensResult as DigestResult;
    return (
      <div className="flex flex-col gap-5 sm:gap-4">
        <p className="text-base sm:text-sm font-semibold text-[#F5F2F7] leading-relaxed">{result.summary}</p>
        {result.keyPoints.length > 0 && (
          <ul className="flex flex-col gap-2 sm:gap-1.5">
            {result.keyPoints.map((point, i) => (
              <li key={i} className="text-sm sm:text-xs text-[#E4DEEA] leading-loose list-disc list-inside">
                {point.text}
                {point.evidence && (
                  <span className="block text-xs sm:text-[11px] text-[#857C93] italic mt-0.5 pl-4">&quot;{point.evidence}&quot;</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {result.terms.length > 0 && (
          <div className="flex flex-wrap gap-2 sm:gap-1.5">
            {result.terms.map((term, i) => (
              <span
                key={i}
                title={term.evidence}
                className="bg-[#2A2632] border border-[#332D3B] text-[#E4DEEA] text-xs sm:text-[11px] px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full"
              >
                {term.text}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 💡 [신규] 물어보기 채팅창에 파일/사진 첨부. 사진은 GPT-4.1 mini 비전에 바로 넘길 base64를
  // 들고 있고, 그 외 파일은 /api/extract로 글자만 미리 뽑아서 들고 있습니다(chatAttachments는
  // 세션 동안 계속 남아 매 프롬프트에 같이 실려갑니다 — handleExecute 참고).
  const handleChatAttachmentFiles = async (fileList: FileList | File[]) => {
    const filesToAttach = Array.from(fileList);
    if (filesToAttach.length === 0) return;

    setIsAttachingChatFile(true);
    try {
      for (const file of filesToAttach) {
        if (file.size > 10 * 1024 * 1024) {
          alert(`"${file.name}"의 용량이 너무 큽니다 (10MB 초과). 더 작은 파일로 시도해주세요.`);
          continue;
        }

        const isImage = file.type.startsWith('image/');
        if (isImage && !SUPPORTED_CHAT_IMAGE_MIME_TYPES.includes(file.type)) {
          alert(`"${file.name}"은(는) AI가 읽을 수 없는 이미지 형식이에요(${file.type || '알 수 없음'}). 아이폰 사진이라면 설정에서 "호환성 우선(JPEG)"으로 바꾸거나, JPG/PNG로 다시 저장해서 올려주세요.`);
          continue;
        }

        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('파일을 읽는 중 문제가 발생했어요.'));
          reader.readAsDataURL(file);
        });

        const commaIndex = dataUrl.indexOf(',');
        const base64Content = commaIndex !== -1 ? dataUrl.substring(commaIndex + 1) : dataUrl;

        if (isImage) {
          const resizedDataUrl = await resizeImageDataUrl(dataUrl);
          const resizedMimeType = resizedDataUrl === dataUrl ? file.type : 'image/jpeg';
          setChatAttachments(prev => [
            ...prev,
            { id: `${Date.now()}-${file.name}`, name: file.name, kind: 'image', mimeType: resizedMimeType, dataUrl: resizedDataUrl },
          ]);
          recordDocumentUpload(file.name, resizedMimeType);
          continue;
        }

        try {
          const res = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              content: base64Content,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            alert(`"${file.name}"에서 글자를 뽑지 못했어요: ${data.error}`);
            continue;
          }
          setChatAttachments(prev => [
            ...prev,
            { id: `${Date.now()}-${file.name}`, name: file.name, kind: 'text', text: data.text || '' },
          ]);
          recordDocumentUpload(file.name, file.type);
        } catch (err: any) {
          alert(`"${file.name}" 처리 중 오류가 발생했어요: ${err.message || err}`);
        }
      }
    } finally {
      setIsAttachingChatFile(false);
    }
  };

  const handleChatAttachInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleChatAttachmentFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleChatDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOverChat(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleChatAttachmentFiles(e.dataTransfer.files);
    }
  };

  const removeChatAttachment = (id: string) => {
    setChatAttachments(prev => prev.filter(a => a.id !== id));
  };

  // 💡 [신규] 교수님 새로 등록. 학교/학과는 필수이고, 성공하면 다음 등록 폼의 기본값으로 기억해둡니다
  // (전공 용어·출제 관행 해석에 학교/학과 맥락이 꼭 필요해서 — recomputeProfessorAnalysis 참고).
  // 성공하면 새 교수님의 id를 반환합니다(같은 흐름에서 바로 파일을 올릴 수 있게).
  const handleCreateProfessor = async (name: string, school: string, department: string): Promise<string | null> => {
    if (!user || !name.trim()) return null;
    const trimmedSchool = school.trim();
    const trimmedDepartment = department.trim();
    if (!trimmedSchool || !trimmedDepartment) {
      alert('학교와 학과를 입력해주세요.');
      return null;
    }

    const { data, error } = await supabase
      .from('professors')
      .insert({ user_id: user.id, name: name.trim(), school: trimmedSchool, department: trimmedDepartment })
      .select()
      .single();
    if (error || !data) {
      alert(`교수님을 등록하지 못했어요: ${error?.message || '알 수 없는 오류'}`);
      return null;
    }
    setProfessors(prev => [data, ...prev]);

    const defaults = { school: trimmedSchool, department: trimmedDepartment };
    setProfessorFormDefaults(defaults);
    saveUserScopedItem(user.id, 'mcp_professor_defaults', defaults);

    return data.id;
  };

  // 💡 [신규] 이 교수님에게 쌓인 자료 전체를 모아 /api/analyze-professor로 다시 분석하고,
  // professor_analysis에 upsert합니다 — 자료가 추가/삭제될 때마다 자동으로 호출되어(handleUploadProfessorFiles,
  // handleDeleteProfessorDocument 참고) 예전 결과가 그대로 남아있지 않게 합니다.
  // docsOverride는 삭제 직후처럼 professorDocuments state가 아직 최신 반영 전일 때 정확한 자료 목록을 넘기기 위함입니다.
  const recomputeProfessorAnalysis = async (professorId: string, docsOverride?: ProfessorDocument[]) => {
    const docs = docsOverride ?? professorDocuments.filter(d => d.professor_id === professorId);
    if (!user || docs.length === 0) return;
    const professor = professors.find(p => p.id === professorId);

    setIsAnalyzingProfessor(true);
    setProfessorAnalysisError(null);
    try {
      const res = await fetch('/api/analyze-professor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: docs.map(d => ({ fileName: d.file_name, text: d.content, docType: d.doc_type })),
          professor: professor ? { school: professor.school, department: professor.department } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfessorAnalysisError(data.error || '분석에 실패했어요.');
        return;
      }

      const { data: upserted, error } = await supabase
        .from('professor_analysis')
        .upsert(
          { user_id: user.id, professor_id: professorId, result: data.result, document_count: docs.length, updated_at: new Date().toISOString() },
          { onConflict: 'professor_id' }
        )
        .select('professor_id, result, document_count, updated_at')
        .single();
      if (error || !upserted) {
        setProfessorAnalysisError(error?.message || '분석 결과를 저장하지 못했어요.');
        return;
      }
      setProfessorAnalyses(prev => [upserted, ...prev.filter(a => a.professor_id !== professorId)]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProfessorAnalysisError(message);
    } finally {
      setIsAnalyzingProfessor(false);
    }
  };

  // 💡 [신규] 파일에서 글자를 뽑아(/api/extract) documents 테이블에 저장하고, doc_chunks로도 쪼개
  // 저장합니다. 텍스트를 못 뽑는 형식(예: 이미지)은 안내만 하고 건너뜁니다. 하나라도 성공하면
  // 이 교수님 분석을 자동으로 다시 계산해 예전 결과가 남아있지 않게 합니다.
  const handleUploadProfessorFiles = async (fileList: FileList | File[], professorId: string, docType: string) => {
    const filesToUpload = Array.from(fileList);
    if (filesToUpload.length === 0 || !user) return;

    setIsUploadingProfessorDoc(true);
    const newlyInserted: ProfessorDocument[] = [];
    try {
      for (const file of filesToUpload) {
        if (file.size > 10 * 1024 * 1024) {
          alert(`"${file.name}"의 용량이 너무 큽니다 (10MB 초과). 더 작은 파일로 시도해주세요.`);
          continue;
        }

        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('파일을 읽는 중 문제가 발생했어요.'));
          reader.readAsDataURL(file);
        });
        const commaIndex = dataUrl.indexOf(',');
        const base64Content = commaIndex !== -1 ? dataUrl.substring(commaIndex + 1) : dataUrl;

        try {
          const res = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              content: base64Content,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            alert(`"${file.name}"에서 글자를 뽑지 못했어요: ${data.error}`);
            continue;
          }

          const format = getFileFormatKey(file.name, file.type);
          const text = data.text || '';
          const { data: inserted, error } = await supabase
            .from('documents')
            .insert({ user_id: user.id, professor_id: professorId, file_name: file.name, format, content: text, doc_type: docType })
            .select()
            .single();
          if (error || !inserted) {
            alert(`"${file.name}"을 저장하지 못했어요: ${error?.message || '알 수 없는 오류'}`);
            continue;
          }
          setProfessorDocuments(prev => [inserted, ...prev]);
          newlyInserted.push(inserted);
          recordDocumentUpload(file.name, file.type);

          const chunks = chunkText(text);
          if (chunks.length > 0) {
            const { error: chunkError } = await supabase.from('doc_chunks').insert(
              chunks.map((content, index) => ({
                user_id: user.id,
                document_id: inserted.id,
                chunk_index: index,
                content,
              }))
            );
            if (chunkError) console.error('doc_chunks 저장 실패:', chunkError);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          alert(`"${file.name}" 처리 중 오류가 발생했어요: ${message}`);
        }
      }
    } finally {
      setIsUploadingProfessorDoc(false);
    }

    if (newlyInserted.length > 0) {
      const existing = professorDocuments.filter(d => d.professor_id === professorId);
      await recomputeProfessorAnalysis(professorId, [...newlyInserted, ...existing]);
    }
  };

  // 💡 [신규] 교수님 목록 화면의 "자료 올리기" 패널 전용 — 기존 교수님을 고르거나, "새 교수님 등록"을
  // 고른 뒤 이름을 입력하면 그 자리에서 등록하고 바로 그 교수님에게 파일을 올립니다.
  const handleProfessorUploadPanelFiles = async (fileList: FileList) => {
    if (fileList.length === 0) return;

    let professorId = uploadProfessorChoice;
    if (professorId === '__new__') {
      if (!newProfessorName.trim()) {
        alert('교수님 이름을 입력해주세요.');
        return;
      }
      const createdId = await handleCreateProfessor(newProfessorName, newProfessorSchool, newProfessorDepartment);
      if (!createdId) return;
      professorId = createdId;
      setUploadProfessorChoice(createdId);
      setNewProfessorName('');
      setNewProfessorSchool('');
      setNewProfessorDepartment('');
    }
    if (!professorId) {
      alert('먼저 교수님을 선택하거나 새로 등록해주세요.');
      return;
    }
    await handleUploadProfessorFiles(fileList, professorId, uploadDocType);
  };

  // 💡 [신규] 자료 삭제 — documents에서 지우면 doc_chunks는 on delete cascade로 함께 지워집니다.
  // 남은 자료가 있으면 분석을 다시 계산하고, 하나도 안 남으면 분석 결과 자체를 지웁니다.
  const handleDeleteProfessorDocument = async (docId: string, professorId: string) => {
    const { error } = await supabase.from('documents').delete().eq('id', docId);
    if (error) {
      alert(`자료를 삭제하지 못했어요: ${error.message}`);
      return;
    }

    const remaining = professorDocuments.filter(d => d.id !== docId && d.professor_id === professorId);
    setProfessorDocuments(prev => prev.filter(d => d.id !== docId));

    if (remaining.length === 0) {
      await supabase.from('professor_analysis').delete().eq('professor_id', professorId);
      setProfessorAnalyses(prev => prev.filter(a => a.professor_id !== professorId));
      setProfessorAnalysisError(null);
      return;
    }
    await recomputeProfessorAnalysis(professorId, remaining);
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    // 💡 [신규] 미니 전선에서 관점을 골라둔 상태(그냥 대화가 아님)면 프롬프트가 비어 있어도 보낼 수
    // 있습니다 — "이 문서 마감 뽑아줘"라고 굳이 안 적어도 전선이 이미 그 의도를 표현하고 있어서요.
    const hasActiveChatLens = Boolean(latestTextAttachment) && effectiveChatLens !== 'none';
    if ((!command.trim() && !hasActiveChatLens) || !user) return;

    // 💡 [신규] 관점이 활성화돼 있으면 자유 채팅(/api/chat) 대신 구조화된 분석(/api/analyze)으로
    // 보냅니다. 결과는 기존 "파일 분석" 탭에서 쓰던 renderLensResult()를 그대로 재사용해서 보여줍니다.
    if (hasActiveChatLens && latestTextAttachment) {
      setCommand('');
      await runLensAnalyze(latestTextAttachment.text || '', effectiveChatLens as LensId, latestTextAttachment.name);
      return;
    }

    setIsExecuting(true);
    const currentCommand = command;
    setCommand('');
    setDetectedActionItems([]);

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
          // 💡 [원칙] 첨부 파일·마감일은 읽기 능력이라 토글하지 않고 항상 보냅니다.
          // 웹 검색만 비용·지연이 커서 명시적 opt-in — 입력창 옆 토글(isSearchActive)로 켭니다.
          useWebSearch: isSearchActive,
          files,
          deadlines,
          chatAttachments,
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

  // 💡 [신규] 대화 폴더 만들기 — 개수 제한 없음.
  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !user) return;
    setIsCreatingFolder(true);
    try {
      const { data, error } = await supabase
        .from('conversation_folders')
        .insert({ user_id: user.id, name })
        .select()
        .single();
      if (error || !data) {
        alert(`폴더를 만들지 못했어요: ${error?.message || '알 수 없는 오류'}`);
        return;
      }
      setConversationFolders(prev => [data, ...prev]);
      setNewFolderName('');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // 💡 [신규] 대화를 폴더로 옮기기(또는 미분류로 되돌리기, folderId === null).
  const handleMoveLogToFolder = async (logId: string, folderId: string | null) => {
    const { error } = await supabase.from('logs').update({ folder_id: folderId }).eq('id', logId);
    if (error) {
      alert(`대화를 폴더로 옮기지 못했어요: ${error.message}`);
      return;
    }
    setLogs(prev => prev.map(log => (log.id === logId ? { ...log, folder_id: folderId } : log)));
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

  // 💡 [신규] 채팅에 첨부된 문서(latestTextAttachment)의 글자로 지정한 관점(lens)을 분석합니다.
  // 관점 전환 버튼과 "전송" 버튼(handleExecute)이 공유하는 경로입니다.
  const runLensAnalyze = async (text: string, lens: LensId, fileName?: string) => {
    setLensId(lens);
    setLensStage('analyzing');
    setLensError(null);
    setRegisteredDeadlineIndexes(new Set());

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, fileName, lens }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '분석에 실패했어요.');

      setLensResult(data.result);
      setLensStage('done');
    } catch (err: any) {
      setLensError(err.message || '분석 중 오류가 발생했어요.');
      setLensStage('error');
    }
  };

  // 💡 [신규] 관점 전환 버튼 — 이미 분석한 문서를 재추출 없이 다른 관점으로 다시 봅니다.
  const chatLensActionsRow = lensId && lensStage !== 'idle' && (
    <div className="flex flex-wrap items-center gap-2">
      {(['deadlines', 'questions', 'digest'] as LensId[])
        .filter((id) => id !== lensId)
        .map((id) => {
          const meta = getNodeMeta(id);
          return (
            <button
              key={id}
              type="button"
              disabled={lensStage === 'analyzing' || !latestTextAttachment}
              onClick={() => {
                setChatLensChoice(id);
                if (latestTextAttachment) runLensAnalyze(latestTextAttachment.text || '', id, latestTextAttachment.name);
              }}
              className="inline-flex items-center gap-1.5 bg-[#211E28] hover:bg-[#2A2632] border border-[#322D3B] hover:border-[#F4679B]/50 text-[#C9C0D6] hover:text-[#F5F2F7] text-[13px] sm:text-xs font-medium px-3.5 py-2.5 sm:py-2 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
            >
              {meta && <meta.icon className="w-3.5 h-3.5 text-[#F4679B] shrink-0" strokeWidth={2} />}
              {meta?.label}(으)로 보기
            </button>
          );
        })}
    </div>
  );

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

  // 💡 [수정] 원문 날짜 문구(item.date)를 datetime-local 값으로 변환 시도 — 실패하면 null.
  // "마감 뽑기" lens는 날짜를 문서에 적힌 표기 그대로("3월 15일", "5/21", "20260315T090000Z" 같은
  // 한글/ICS 형식) 돌려주는데, 이런 형식은 new Date(raw)로 바로 파싱하면 대부분 Invalid Date가 되거나
  // (→ 항상 "오늘"로 대체되어 전부 D-DAY로 보임) "3/15"처럼 조용히 엉뚱한 연도(2001년 등)로 파싱되는
  // 문제가 있었습니다. 흔한 한글/ICS 표기를 정규식으로 먼저 직접 해석하고, 마지막에만 네이티브
  // Date 파서로 넘깁니다. 연도가 없는 표기는 "오늘보다 이미 지난 날짜면 내년"으로 추정합니다
  // (마감일은 보통 앞으로 다가올 날짜를 가리키므로).
  const tryParseDeadlineDate = (raw: string): string | null => {
    const text = raw.trim();
    const pad = (n: number) => String(n).padStart(2, '0');

    const timeMatch = text.match(/(\d{1,2})\s*[:시]\s*(\d{2})/);
    let hour = 23;
    let minute = 59;
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      minute = parseInt(timeMatch[2], 10);
    }

    const fromParts = (month: number, day: number, explicitYear?: number): string | null => {
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      const now = new Date();
      let year = explicitYear ?? now.getFullYear();
      let candidate = new Date(year, month - 1, day, hour, minute);
      if (explicitYear === undefined) {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (candidate.getTime() < startOfToday.getTime()) {
          year += 1;
          candidate = new Date(year, month - 1, day, hour, minute);
        }
      }
      if (isNaN(candidate.getTime())) return null;
      return `${candidate.getFullYear()}-${pad(candidate.getMonth() + 1)}-${pad(candidate.getDate())}T${pad(candidate.getHours())}:${pad(candidate.getMinutes())}`;
    };

    // "2026년 3월 15일"
    let m = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (m) return fromParts(parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[1], 10));

    // "3월 15일" (연도 없음)
    m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (m) return fromParts(parseInt(m[1], 10), parseInt(m[2], 10));

    // "2026.3.15" / "2026-3-15" / "2026/3/15"
    m = text.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
    if (m) return fromParts(parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[1], 10));

    // ICS 형식: "20260315" 또는 "20260315T090000Z"
    m = text.match(/\b(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[3], 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        if (m[4] && m[5]) {
          hour = parseInt(m[4], 10);
          minute = parseInt(m[5], 10);
        }
        return fromParts(month, day, year);
      }
    }

    // "3/15" / "03.15" (연도 없음, new Date()에 그대로 넘기면 조용히 2001년 등으로 잘못 파싱됨)
    m = text.match(/(?<!\d)(\d{1,2})\s*[./]\s*(\d{1,2})(?!\d)/);
    if (m) {
      const first = parseInt(m[1], 10);
      const second = parseInt(m[2], 10);
      if (first >= 1 && first <= 12) return fromParts(first, second);
    }

    // 마지막 수단: 네이티브 Date 파서 (예: "March 15, 2026")
    const parsed = new Date(text);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
    }

    return null;
  };

  // 원문 날짜를 못 알아들었을 때의 대체값(오늘 23:59) — 목록에서 바로 확인할 수 있도록 course에 원문을 남깁니다.
  const fallbackDeadlineDueAt = (): string => {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const deadlineItemToDeadline = (item: DeadlineItem, index: number): Deadline => ({
    id: `${Date.now()}-${index}`,
    title: item.title,
    course: `마감 뽑기 · 원문: "${item.date}"`,
    dueAt: tryParseDeadlineDate(item.date) ?? fallbackDeadlineDueAt(),
  });

  // 💡 [신규] 회로도 "마감 뽑기" 결과에서 항목 하나를 마감일 매니저에 등록 — 기존 마감일 저장 방식(setDeadlines)을 그대로 씁니다.
  const registerDeadlineItem = (item: DeadlineItem, index: number) => {
    if (registeredDeadlineIndexes.has(index)) return;
    setDeadlines(prev => [...prev, deadlineItemToDeadline(item, index)]);
    setRegisteredDeadlineIndexes(prev => new Set(prev).add(index));
  };

  const registerAllDeadlineItems = (items: DeadlineItem[]) => {
    const toRegister = items
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => !registeredDeadlineIndexes.has(index));
    if (toRegister.length === 0) return;

    setDeadlines(prev => [...prev, ...toRegister.map(({ item, index }) => deadlineItemToDeadline(item, index))]);
    setRegisteredDeadlineIndexes(prev => {
      const next = new Set(prev);
      toRegister.forEach(({ index }) => next.add(index));
      return next;
    });
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
  const activeBlocksCount = graph.nodes.length;

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
    { id: 'workspace', label: '물어보기', icon: Sparkles },
    { id: 'records', label: '나의 기록', icon: Archive },
    { id: 'deadlines', label: '마감일', icon: AlarmClock },
    { id: 'professors', label: '교수님', icon: GraduationCap },
    { id: 'monitoring', label: '내 파일', icon: LineChart },
    { id: 'logs', label: '지난 대화', icon: ScrollText },
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

        /* 교수님 상세 회로도 — AI 코어에서 나온 결과 3장이 순서대로(각 카드 300ms씩 지연) 나타납니다. */
        @keyframes professorCircuitReveal {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .professor-circuit-reveal {
          animation: professorCircuitReveal 0.4s ease-out both;
        }

        /* 로딩 중 점 애니메이션 — "." → ".." → "..." → "."을 0.5초마다 반복합니다. */
        @keyframes loadingDots {
          0% { content: '.'; }
          33% { content: '..'; }
          66% { content: '...'; }
          100% { content: '.'; }
        }
        .loading-dots::after {
          content: '.';
          animation: loadingDots 1.5s steps(1) infinite;
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
            <span className="font-semibold text-[#F5F2F7]">OpenAI GPT-4.1 mini 연동됨</span>
          </div>
          <div className="text-[11px] text-[#857C93] mb-1.5 font-medium uppercase tracking-wide">활성화된 MCP 블록</div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {graph.nodes.length === 0 ? (
              <span className="text-[#857C93] italic">없음</span>
            ) : (
              graph.nodes.map(n => {
                const meta = getNodeMeta(n.id);
                if (!meta) return null;
                return (
                  <span key={n.id} className="bg-[#1B3328] text-[#6EE7B7] border border-[#37604D] px-2 py-1 rounded-md text-[10px] font-medium flex items-center gap-1">
                    <meta.icon className="w-3 h-3 shrink-0" strokeWidth={2} /> {meta.label}
                  </span>
                );
              })
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

              <div
                onDragOver={(e) => { e.preventDefault(); setIsDraggingOverChat(true); }}
                onDragLeave={() => setIsDraggingOverChat(false)}
                onDrop={handleChatDrop}
                className={`bg-[#211E28] rounded-2xl border p-4 sm:p-6 mb-6 shadow-sm transition-colors ${
                  isDraggingOverChat ? 'border-[#F4679B] bg-[#2A1F26]' : 'border-[#322D3B]'
                }`}
              >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
                  <div className="text-sm font-semibold text-[#F5F2F7]">
                    AI 프롬프트 전송
                  </div>
                  <div className="flex items-center gap-1.5 bg-[#15131A] px-3 py-1 rounded-full border border-[#322D3B] text-xs text-[#AFA6BD] max-w-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6EE7B7] animate-pulse shrink-0"></span>
                    <span className="truncate">{activeMcpNames}</span>
                  </div>
                </div>

                {chatAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {chatAttachments.map((a) => (
                      <span
                        key={a.id}
                        className="inline-flex items-center gap-1.5 bg-[#15131A] border border-[#322D3B] text-[#C9C0D6] text-xs pl-2.5 pr-1.5 py-1.5 rounded-full max-w-[220px]"
                      >
                        {a.kind === 'image' ? (
                          <ImageIcon className="w-3.5 h-3.5 text-[#F4679B] shrink-0" strokeWidth={2} />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-[#F4679B] shrink-0" strokeWidth={2} />
                        )}
                        <span className="truncate">{a.name}</span>
                        <button
                          type="button"
                          onClick={() => removeChatAttachment(a.id)}
                          aria-label={`${a.name} 첨부 삭제`}
                          className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full hover:bg-[#2A2632] text-[#857C93] hover:text-[#FF7A6B] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A6B]"
                        >
                          <X className="w-3 h-3" strokeWidth={2.5} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {chatLensGraph && (
                  <div className="bg-[#0D0B11] rounded-xl border border-[#2A2632] p-2 mb-3">
                    <CircuitBoard graph={chatLensGraph} onNodeClick={handleNodeClick} compact />
                    <div className="flex flex-wrap gap-1.5 justify-center mt-1.5">
                      {CHAT_LENS_CHOICES.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => handleSelectChatLens(choice.id)}
                          className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                            effectiveChatLens === choice.id
                              ? 'bg-[#331F29] text-[#F4679B] border-[#F4679B]'
                              : 'bg-[#15131A] text-[#AFA6BD] border-[#322D3B] hover:text-[#F5F2F7]'
                          }`}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <form onSubmit={handleExecute} className="flex flex-col sm:flex-row gap-3">
                  <label
                    className={`shrink-0 flex items-center justify-center w-11 sm:w-auto sm:px-3.5 h-11 sm:h-auto rounded-lg border transition-colors ${
                      isAttachingChatFile
                        ? 'bg-[#15131A] border-[#322D3B] text-[#857C93] cursor-wait'
                        : 'bg-[#211E28] hover:bg-[#2A2632] border-[#423B4C] text-[#C9C0D6] hover:text-[#F5F2F7] cursor-pointer'
                    }`}
                    aria-label="파일/사진 첨부"
                  >
                    {isAttachingChatFile ? (
                      <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                    ) : (
                      <Paperclip className="w-4 h-4" strokeWidth={2} />
                    )}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleChatAttachInputChange}
                      disabled={isAttachingChatFile}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsSearchActive((prev) => !prev)}
                    aria-pressed={isSearchActive}
                    aria-label="웹 검색 켜기/끄기"
                    title={isSearchActive ? '웹 검색 켜짐 — 느리고 비용이 들어요' : '웹 검색 꺼짐 — 최신 정보가 필요할 때 켜세요'}
                    className={`shrink-0 flex items-center justify-center gap-1.5 w-11 sm:w-auto sm:px-3.5 h-11 sm:h-auto rounded-lg border transition-colors cursor-pointer ${
                      isSearchActive
                        ? 'bg-[#331F29] hover:bg-[#3D2733] border-[#F4679B] text-[#F4679B]'
                        : 'bg-[#211E28] hover:bg-[#2A2632] border-[#423B4C] text-[#C9C0D6] hover:text-[#F5F2F7]'
                    }`}
                  >
                    <Search className="w-4 h-4" strokeWidth={2} />
                    <span className="hidden sm:inline text-xs font-semibold">
                      웹 검색 {isSearchActive ? 'ON' : 'OFF'}
                    </span>
                  </button>
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
                <p className="text-[11px] text-[#857C93] mt-2">
                  파일이나 사진을 여기로 끌어다 놓아도 첨부돼요. 첨부한 내용은 이 대화 동안 계속 참조돼요.
                </p>
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

              {lensStage !== 'idle' && (
                <div className="mt-4 bg-[#1C1922] rounded-2xl border border-[#332D3B] p-5 sm:p-6">
                  {lensStage === 'analyzing' && (
                    <div className="flex items-center gap-2 text-sm text-[#C9C0D6]">
                      <Loader2 className="w-4 h-4 animate-spin text-[#F4679B]" strokeWidth={2} />
                      분석하는 중이에요...
                    </div>
                  )}
                  {lensStage === 'error' && (
                    <p className="flex items-center gap-1.5 text-sm text-[#FF7A6B]">
                      <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2} />
                      {lensError}
                    </p>
                  )}
                  {lensStage === 'done' && (
                    <>
                      {renderLensResult()}
                      {chatLensActionsRow && <div className="mt-4">{chatLensActionsRow}</div>}
                    </>
                  )}
                </div>
              )}

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
                  <div className="text-sm text-[#857C93] text-center py-8 bg-[#15131A] rounded-xl border border-[#322D3B] flex flex-col items-center gap-3">
                    <span>파일을 올려서 일정을 뽑아보세요</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('workspace')}
                      className="inline-flex items-center gap-1.5 bg-[#211E28] hover:bg-[#2A2632] border border-[#5C3A4A] text-[#F4679B] text-xs font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                    >
                      채팅 탭으로 가기
                    </button>
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
                      {graph.nodes.length === 0 ? (
                        <span className="text-xs text-[#857C93] italic">활성화된 블록이 없어요</span>
                      ) : (
                        graph.nodes.map((n) => {
                          const meta = getNodeMeta(n.id);
                          if (!meta) return null;
                          return (
                            <span key={n.id} className="bg-[#1B3328] text-[#6EE7B7] border border-[#37604D] px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1">
                              <meta.icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} /> {meta.label}
                            </span>
                          );
                        })
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

          {activeTab === 'professors' && !selectedProfessorId && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  교수님
                </h1>
                <p className="text-[#AFA6BD] text-xs sm:text-sm mt-1.5">
                  교수님별로 자료를 모아두면, 자주 강조하는 주제나 문제 내는 방식을 한눈에 볼 수 있어요.
                </p>
              </div>

              <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-5 mb-6 shadow-sm">
                <h3 className="text-sm sm:text-base font-bold text-[#F5F2F7] mb-4">자료 올리기</h3>

                <div className="flex flex-col gap-3">
                  <select
                    value={uploadProfessorChoice}
                    onChange={(e) => {
                      const value = e.target.value;
                      setUploadProfessorChoice(value);
                      if (value === '__new__' && professorFormDefaults) {
                        setNewProfessorSchool(professorFormDefaults.school);
                        setNewProfessorDepartment(professorFormDefaults.department);
                      }
                    }}
                    className="bg-[#15131A] border border-[#423B4C] rounded-lg px-3.5 py-2.5 text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20"
                  >
                    <option value="">교수님 선택</option>
                    {professors.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    <option value="__new__">+ 새 교수님 등록</option>
                  </select>

                  {uploadProfessorChoice === '__new__' && (
                    <div className="flex flex-col gap-2 bg-[#15131A] border border-[#322D3B] rounded-lg p-3.5">
                      <input
                        type="text"
                        placeholder="이름 (필수)"
                        value={newProfessorName}
                        onChange={(e) => setNewProfessorName(e.target.value)}
                        className="bg-[#211E28] border border-[#423B4C] rounded-lg px-3.5 py-2.5 text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[#857C93]"
                      />
                      <input
                        type="text"
                        placeholder="학교 (필수)"
                        value={newProfessorSchool}
                        onChange={(e) => setNewProfessorSchool(e.target.value)}
                        className="bg-[#211E28] border border-[#423B4C] rounded-lg px-3.5 py-2.5 text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[#857C93]"
                      />
                      <input
                        type="text"
                        placeholder="학과 (필수)"
                        value={newProfessorDepartment}
                        onChange={(e) => setNewProfessorDepartment(e.target.value)}
                        className="bg-[#211E28] border border-[#423B4C] rounded-lg px-3.5 py-2.5 text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[#857C93]"
                      />
                      <p className="text-[11px] text-[#857C93]">학교·학과 정보는 전공 용어와 출제 관행을 더 정확히 해석하는 데 쓰여요.</p>
                    </div>
                  )}

                  <select
                    value={uploadDocType}
                    onChange={(e) => setUploadDocType(e.target.value)}
                    className="bg-[#15131A] border border-[#423B4C] rounded-lg px-3.5 py-2.5 text-[#F5F2F7] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20"
                  >
                    {DOC_TYPE_DEFS.map((def) => (
                      <option key={def.key} value={def.key}>{def.label}</option>
                    ))}
                  </select>

                  <label
                    className={`inline-flex self-start items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                      isUploadingProfessorDoc || !uploadProfessorChoice
                        ? 'bg-[#2A2632] text-[#857C93] cursor-wait'
                        : 'bg-[#F4679B] hover:bg-[#D1477F] text-white cursor-pointer'
                    }`}
                  >
                    {isUploadingProfessorDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>파일 선택</span>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      disabled={isUploadingProfessorDoc || !uploadProfessorChoice}
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleProfessorUploadPanelFiles(e.target.files);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <p className="text-xs text-[#857C93]">교수님 논문을 올리면 관심 분야와 강조하는 관점을 훨씬 정확히 파악해요.</p>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                {!isProfessorsLoaded ? (
                  <div className="text-sm text-[#857C93] text-center py-8 bg-[#211E28] rounded-2xl border border-[#322D3B]">
                    불러오는 중...
                  </div>
                ) : professors.length === 0 ? (
                  <div className="text-sm text-[#857C93] text-center py-8 bg-[#211E28] rounded-2xl border border-[#322D3B]">
                    아직 등록된 교수님이 없어요. 위에서 자료를 올리며 등록해보세요.
                  </div>
                ) : (
                  professors.map((p) => {
                    const count = professorDocuments.filter((d) => d.professor_id === p.id).length;
                    const subtitle = [p.school, p.department].filter(Boolean).join(' · ');
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedProfessorId(p.id)}
                        className="bg-[#211E28] hover:bg-[#2A2632] rounded-2xl border border-[#322D3B] p-4 flex items-center justify-between gap-3 shadow-sm transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="shrink-0 w-9 h-9 rounded-full bg-[#331F29] border border-[#5C3A4A] flex items-center justify-center text-[#F4679B]">
                            <GraduationCap className="w-4 h-4" strokeWidth={2} />
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#F5F2F7] truncate">{p.name}</div>
                            {subtitle && <div className="text-xs text-[#857C93] mt-0.5 truncate">{subtitle}</div>}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-[#AFA6BD] bg-[#15131A] border border-[#322D3B] px-2.5 py-1 rounded-full tabular-nums">
                          자료 {count}개
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'professors' && selectedProfessorId && (() => {
            const professor = professors.find((p) => p.id === selectedProfessorId);
            if (!professor) return null;
            const docs = professorDocuments.filter((d) => d.professor_id === selectedProfessorId);
            const subtitle = [professor.school, professor.department].filter(Boolean).join(' · ');
            const analysisRow = professorAnalyses.find((a) => a.professor_id === selectedProfessorId);
            const result = analysisRow?.result;
            const confidentDefs = result ? PROFESSOR_CATEGORY_DEFS.filter((def) => result[def.key].confident) : [];
            const unconfidentDefs = result ? PROFESSOR_CATEGORY_DEFS.filter((def) => !result[def.key].confident) : [];

            // 💡 [신규] 왼쪽 "이 교수님 자료" → 중앙 AI 코어 → 오른쪽 예상 문제/과제 방향/공부 방식
            // 3갈래. 기존 물어보기 미니 전선(chatLensGraph)과 같은 방식으로 매 렌더마다 새로 계산해서
            // CircuitBoard에 새 그래프 객체를 넘기고, 그 참조가 바뀔 때마다 전선 애니메이션이 재생됩니다.
            const professorCircuitGraph: CircuitGraphState = {
              nodes: [
                { id: 'professor_docs', layer: 'source', status: docs.length > 0 ? 'done' : 'idle' },
                {
                  id: 'professor_ai_core',
                  layer: 'lens',
                  status: isAnalyzingProfessor ? 'running' : analysisRow ? 'done' : 'idle',
                },
                ...PROFESSOR_CIRCUIT_DEFS.map((def) => ({
                  id: def.nodeId,
                  layer: 'action' as const,
                  status: (getProfessorCircuitCardData(result, def.keys).confident ? 'done' : 'idle') as GraphNode['status'],
                })),
              ],
              edges: [
                { from: 'professor_docs', to: 'professor_ai_core' },
                ...PROFESSOR_CIRCUIT_DEFS.map((def) => ({ from: 'professor_ai_core' as NodeId, to: def.nodeId as NodeId })),
              ],
            };

            const handleProfessorCircuitNodeClick = (nodeId: NodeId) => {
              if (nodeId === 'professor_docs' || nodeId === 'professor_ai_core') {
                if (docs.length === 0 || isAnalyzingProfessor) return;
                recomputeProfessorAnalysis(professor.id);
              }
            };

            return (
              <div>
                <button
                  type="button"
                  onClick={() => setSelectedProfessorId(null)}
                  className="inline-flex items-center gap-1.5 text-xs text-[#AFA6BD] hover:text-[#F5F2F7] mb-4 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
                >
                  <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2.5} />
                  교수님 목록으로
                </button>

                <div className="mb-6">
                  <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">{professor.name}</h1>
                  <p className="text-[#AFA6BD] text-xs sm:text-sm mt-1.5">
                    {subtitle || '학교/학과 정보 없음'}
                  </p>
                </div>

                <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-5 mb-6 shadow-sm">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                    <h3 className="text-sm sm:text-base font-bold text-[#F5F2F7]">자료 목록 ({docs.length}개)</h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={uploadDocType}
                        onChange={(e) => setUploadDocType(e.target.value)}
                        className="bg-[#15131A] border border-[#423B4C] rounded-lg px-2.5 py-2 text-[#F5F2F7] text-xs outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20"
                      >
                        {DOC_TYPE_DEFS.map((def) => (
                          <option key={def.key} value={def.key}>{def.label}</option>
                        ))}
                      </select>
                      <label
                        className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                          isUploadingProfessorDoc
                            ? 'bg-[#15131A] border border-[#322D3B] text-[#857C93] cursor-wait'
                            : 'bg-[#2A2632] hover:bg-[#332D3B] border border-[#423B4C] text-[#F5F2F7] cursor-pointer'
                        }`}
                      >
                        {isUploadingProfessorDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                        자료 올리기
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          disabled={isUploadingProfessorDoc}
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              handleUploadProfessorFiles(e.target.files, professor.id, uploadDocType);
                            }
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#857C93] mb-4">교수님 논문을 올리면 관심 분야와 강조하는 관점을 훨씬 정확히 파악해요.</p>

                  {docs.length === 0 ? (
                    <p className="text-sm text-[#857C93] text-center py-4">아직 올린 자료가 없어요.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {docs.map((d) => (
                        <div key={d.id} className="flex items-center justify-between gap-3 bg-[#15131A] p-3 rounded-lg border border-[#322D3B] text-sm">
                          <span className="text-[#F5F2F7] truncate flex items-center gap-2 min-w-0">
                            <span className="shrink-0">{FORMAT_ICONS[d.format] || '📄'}</span>
                            <span className="truncate">{d.file_name}</span>
                            <span className="shrink-0 text-[10px] font-semibold text-[#AFA6BD] bg-[#2A2632] border border-[#332D3B] px-2 py-0.5 rounded-full">
                              {DOC_TYPE_LABELS[d.doc_type] || d.doc_type}
                            </span>
                          </span>
                          <div className="shrink-0 flex items-center gap-2.5">
                            <span className="text-xs text-[#857C93]">
                              {new Date(d.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteProfessorDocument(d.id, professor.id)}
                              aria-label={`${d.file_name} 삭제`}
                              className="w-6 h-6 flex items-center justify-center rounded-full text-[#857C93] hover:text-[#FF7A6B] hover:bg-[#2A2632] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A6B]"
                            >
                              <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-[#0D0B11] rounded-2xl border border-[#2A2632] p-3 sm:p-6 mb-6 shadow-sm">
                  <p className="text-xs text-[#857C93] text-center mb-3">AI 코어를 클릭하면 이 교수님 자료를 분석해요</p>
                  <CircuitBoard graph={professorCircuitGraph} onNodeClick={handleProfessorCircuitNodeClick} />
                  {result && (
                    <div key={analysisRow?.updated_at} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                      {PROFESSOR_CIRCUIT_DEFS.map((def, i) => {
                        const card = getProfessorCircuitCardData(result, def.keys);
                        return (
                          <div
                            key={def.nodeId}
                            className="professor-circuit-reveal bg-[#211E28] border border-[#322D3B] rounded-xl p-3.5"
                            style={{ animationDelay: `${i * 300}ms` }}
                          >
                            <h5 className="text-xs font-bold text-[#857C93] uppercase tracking-wide mb-2">{def.label}</h5>
                            {card.confident ? (
                              <ul className="flex flex-col gap-1">
                                {card.items.slice(0, 4).map((item, j) => (
                                  <li key={j} className="text-xs text-[#E4DEEA] leading-relaxed">· {item}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-xs text-[#5B5566]">아직 확신 있게 판단하지 못했어요</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={docs.length === 0 || isAnalyzingProfessor}
                  onClick={() => recomputeProfessorAnalysis(professor.id)}
                  className="inline-flex items-center gap-2 bg-[#F4679B] hover:bg-[#D1477F] disabled:bg-[#2A2632] disabled:text-[#857C93] disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                >
                  {isAnalyzingProfessor && <Loader2 className="w-4 h-4 animate-spin" />}
                  이 교수님 분석
                </button>

                {professorAnalysisError && (
                  <p className="text-sm text-[#FF7A6B] mt-3">{professorAnalysisError}</p>
                )}

                {analysisRow && result && (
                  <div className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-5 mt-5 shadow-sm">
                    <p className="text-xs sm:text-sm font-semibold text-[#F4679B] mb-4">
                      {getProfessorAnalysisFramingLine(analysisRow.document_count)}
                    </p>

                    {confidentDefs.length === 0 ? (
                      <p className="text-sm text-[#857C93]">아직 확신 있게 판단할 만큼 자료가 쌓이지 않았어요.</p>
                    ) : (
                      <div className="flex flex-col gap-5 sm:gap-4">
                        {confidentDefs.map((def) => (
                          <div key={def.key}>
                            <h4 className="text-xs font-bold text-[#857C93] uppercase tracking-wide mb-2">{def.label}</h4>
                            <div className="flex flex-wrap gap-2 sm:gap-1.5">
                              {result[def.key].items.map((item, i) => (
                                <span key={i} className="bg-[#2A2632] border border-[#332D3B] text-[#E4DEEA] text-xs sm:text-[11px] px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full">
                                  {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {unconfidentDefs.length > 0 && (
                      <div className="mt-6 pt-5 border-t border-[#322D3B]">
                        <h4 className="text-sm font-bold text-[#F5F2F7] mb-2.5">자료를 더 올리면 이런 걸 알 수 있어요</h4>
                        <div className="flex flex-wrap gap-2 sm:gap-1.5 mb-4">
                          {unconfidentDefs.map((def) => (
                            <span key={def.key} className="bg-[#15131A] border border-[#322D3B] text-[#5B5566] text-xs sm:text-[11px] px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full">
                              {def.label}
                            </span>
                          ))}
                        </div>
                        <label
                          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                            isUploadingProfessorDoc
                              ? 'bg-[#15131A] border border-[#322D3B] text-[#857C93] cursor-wait'
                              : 'bg-[#2A2632] hover:bg-[#332D3B] border border-[#423B4C] text-[#F5F2F7] cursor-pointer'
                          }`}
                        >
                          {isUploadingProfessorDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                          바로 파일 올리기
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            disabled={isUploadingProfessorDoc}
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length > 0) {
                                handleUploadProfessorFiles(e.target.files, professor.id, uploadDocType);
                              }
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

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

              {/* 💡 [신규] 폴더 목록 — 전체/미분류/각 폴더로 지난 대화를 걸러 봅니다. */}
              <div className="flex flex-wrap items-center gap-2 mb-5">
                <button
                  type="button"
                  onClick={() => setLogFolderFilter('all')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                    logFolderFilter === 'all'
                      ? 'bg-[#331F29] text-[#F4679B] border-[#F4679B]'
                      : 'bg-[#211E28] text-[#AFA6BD] border-[#322D3B] hover:text-[#F5F2F7]'
                  }`}
                >
                  전체 ({logs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLogFolderFilter('unfiled')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                    logFolderFilter === 'unfiled'
                      ? 'bg-[#331F29] text-[#F4679B] border-[#F4679B]'
                      : 'bg-[#211E28] text-[#AFA6BD] border-[#322D3B] hover:text-[#F5F2F7]'
                  }`}
                >
                  미분류 ({logs.filter((l) => !l.folder_id).length})
                </button>
                {conversationFolders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setLogFolderFilter(folder.id)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                      logFolderFilter === folder.id
                        ? 'bg-[#331F29] text-[#F4679B] border-[#F4679B]'
                        : 'bg-[#211E28] text-[#AFA6BD] border-[#322D3B] hover:text-[#F5F2F7]'
                    }`}
                  >
                    {folder.name} ({logs.filter((l) => l.folder_id === folder.id).length})
                  </button>
                ))}
                <form
                  onSubmit={(e) => { e.preventDefault(); handleCreateFolder(); }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="+ 새 폴더"
                    className="w-24 bg-[#15131A] border border-[#423B4C] rounded-full px-3 py-1.5 text-[#F5F2F7] text-xs outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[#857C93]"
                  />
                  <button
                    type="submit"
                    disabled={!newFolderName.trim() || isCreatingFolder}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#2A2632] hover:bg-[#332D3B] text-[#F5F2F7] border border-[#423B4C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                  >
                    만들기
                  </button>
                </form>
              </div>

              <div className="flex flex-col gap-3">
                {(() => {
                  const filteredLogs = logs.filter((log) => {
                    if (logFolderFilter === 'all') return true;
                    if (logFolderFilter === 'unfiled') return !log.folder_id;
                    return log.folder_id === logFolderFilter;
                  });
                  if (filteredLogs.length === 0) {
                    return (
                      <div className="text-sm text-[#857C93] text-center py-8 bg-[#211E28] rounded-2xl border border-[#322D3B]">
                        {logs.length === 0 ? '저장된 대화가 없습니다. 물어보기에서 질문을 보내보세요!' : '이 폴더에는 대화가 없어요.'}
                      </div>
                    );
                  }
                  return filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <div key={log.id} className="bg-[#211E28] rounded-2xl border border-[#322D3B] p-4 flex flex-col gap-3 shadow-sm">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                        <div className="flex items-center gap-2 font-mono-console text-xs text-[#F4679B]">
                          <span className="text-[#857C93]">[{new Date(log.created_at).toLocaleTimeString()}]</span>
                          <span className="font-semibold text-[#F5F2F7]">{log.content}</span>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                          <select
                            value={log.folder_id || ''}
                            onChange={(e) => handleMoveLogToFolder(log.id, e.target.value || null)}
                            aria-label="폴더로 옮기기"
                            className="bg-[#15131A] border border-[#322D3B] rounded-lg px-2 py-1.5 text-[#AFA6BD] text-xs outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 cursor-pointer"
                          >
                            <option value="">미분류</option>
                            {conversationFolders.map((folder) => (
                              <option key={folder.id} value={folder.id}>{folder.name}</option>
                            ))}
                          </select>
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
                  });
                })()}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
