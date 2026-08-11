'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  GraduationCap, FolderOpen,
  ArrowLeft,
  ArrowDown,
} from 'lucide-react';
import type { NodeId, CircuitGraphState, GraphNode } from '@/types/blocks';
import { NODE_REGISTRY } from '@/lib/blocks/defaults';
import { loadGraphPreferences, saveGraphPreferences, clearLegacyBlockState, type GraphPreferences } from '@/lib/blocks/storage';
import { loadUserScopedItem, saveUserScopedItem } from '@/lib/storage/user-scoped';
import { MAX_AVOID_QUESTIONS, MAX_AVOID_QUESTION_CHARS, MAX_PROFESSOR_ANALYSIS_DOC_CHARS, truncateForPrompt } from '@/lib/truncate-text';
import { buildUploadFailureMessage, formatBytes, readUploadResponse } from '@/lib/upload-failure-message';
import { MAX_CHAT_ATTACHMENTS, MAX_REQUEST_FILE_BYTES, getEffectiveUploadLimitBytes } from '@/lib/upload-limits';
import { uploadFileToStorage, StorageUploadError } from '@/lib/storage-upload';
import { PRO_LIMITS } from '@/lib/plan-limits';
import { SUPPORTED_CHAT_IMAGE_MIME_TYPES, resizeImageDataUrl } from '@/lib/image-constraints';
import { getPlanLimits, getPolarCheckoutUrl, getPolarCustomerPortalUrl, logProfileLookupFailure, PRO_PRICE_LABEL, type UsageLevel } from '@/lib/plan-limits';
import { PENDING_TRIAL_RESULT_KEY, type PendingTrialResult } from '@/lib/pending-trial-result';
import { detectBrowserLanguageName } from '@/lib/detect-browser-language';
import { trackFunnelEvent } from '@/lib/funnel-tracking';
import { Logomark } from '@/components/logomark';
import { ThemeToggle } from '@/components/theme-toggle';
import { CircuitBoard } from '@/components/circuit/circuit-board';
import { LoadingText } from '@/components/loading-text';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { CarrotGauge } from '@/components/carrot-gauge';
import { OnboardingModal } from '@/components/onboarding-modal';
// 💡 [신규] 잔량 구간별 게이지 색. globals.css의 --text-warn/--accent-danger와 같은 계열
// 값을 SVG fill로 직접 넘겨야 해서(CSS 변수는 이 컴포넌트의 fill 속성에 쓰기 번거로움)
// 여기 리터럴로 둡니다. ok는 기존 당근색 그대로입니다.
const USAGE_LEVEL_COLORS: Record<UsageLevel, { fill: string; stroke: string }> = {
  ok:   { fill: '#F5A03C', stroke: '#D9822B' },
  warn: { fill: '#E8B54A', stroke: '#B98A2E' },
  low:  { fill: '#E86A5A', stroke: '#B84A3C' },
  out:  { fill: '#8A8194', stroke: '#6B6376' },
};
import { ProExpiryNotice } from '@/components/pro-expiry-notice';
import { renderTrialResult } from '@/components/trial-result-view';
import { AnswerDisclosure } from '@/components/answer-disclosure';
import { useTranslations, useLocale } from 'next-intl';
import {
  detectLens,
  CIRCUIT_LENS_IDS,
  type LensId,
  type CircuitLensId,
  type DeadlinesResult,
  type DeadlineItem,
  type QuestionsResult,
  type DigestResult,
  type ExamQuestionsResult,
} from '@/lib/lenses';
import {
  buildProfessorContext,
  normalizeProfessorItems,
  type ProfessorAnalysisItem,
  type ProfessorAnalysisResult,
} from '@/lib/professor-analysis';

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

// 💡 ProfessorAnalysisItem/Category/Result와 normalizeProfessorItems는 lib/professor-analysis.ts로
// 옮겼습니다 — 채팅 탭의 "교수님 자료로 만들기"가 같은 결과를 프롬프트 블록으로 바꿔
// /api/analyze에 넘겨야 해서, 화면 코드와 그 변환 로직이 같은 타입을 공유해야 했습니다.
// (예전 string[] 모양과 새 {text, evidence}[] 모양을 모두 받아내는 이유도 그 파일에 적어뒀습니다.)

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
// 라벨이 번역돼야 해서(t() 필요) 컴포넌트 안의 docTypeDefs/docTypeLabels로 계산합니다 —
// 이 목록에서는 키(DOC_TYPE_KEYS)만 갖고 있습니다.
const DOC_TYPE_KEYS = ['lecture', 'exam', 'assignment', 'paper'] as const;

// AI 콘솔이 아직 아무 대화도 시작하지 않았을 때의 상태를 나타내는 내부 식별자(sentinel) — 실제
// 표시 문구는 messages/*.json의 workspace.idleMessage로 지역화되어 렌더링 시점에 t()로 가져옵니다.
const IDLE_CONSOLE_SENTINEL = '__idle__';

// 콘솔이 비어있을 때 채워주는 예시 프롬프트 — 5가지 MCP 블록과 하나씩 매칭됩니다.
// 실제 문구는 messages/*.json의 workspace.examplePrompts.{key}에서 지역화되어 렌더링 시점에 가져옵니다.
const EXAMPLE_PROMPT_DEFS = [
  { icon: Search, key: 'searchTrend' },
  { icon: FileText, key: 'summarizeDoc' },
  { icon: CalendarClock, key: 'weeklyPlan' },
  { icon: PenLine, key: 'extensionEmail' },
  { icon: NotebookPen, key: 'meetingNotes' },
];

// 채팅 입력창 위 미니 전선에서 고를 수 있는 답변 종류. 'none' = 그냥 대화(관점 분석 없이 평소처럼).
// 라벨은 messages/*.json의 workspace.lensChoices.{key}에서 지역화되어 렌더링 시점에 가져옵니다.
const CHAT_LENS_CHOICE_DEFS: { id: CircuitLensId | 'none'; key: string }[] = [
  { id: 'deadlines', key: 'deadlines' },
  { id: 'questions', key: 'questions' },
  { id: 'digest', key: 'digest' },
  { id: 'none', key: 'none' },
];

// 💡 [신규] 채팅 탭 "교수님 자료로 만들기"에서 만들 수 있는 세 가지 결과물. 위
// CHAT_LENS_CHOICE_DEFS(채팅에 붙인 파일 하나를 다른 관점으로 보는 것)와는 대상이 다릅니다 —
// 이쪽은 고른 교수님의 자료 전체가 대상이고, 교수님 성향까지 프롬프트에 함께 들어갑니다.
// '마감 뽑기'가 빠진 이유: 마감은 교수님 성향과 무관하고 강의계획서 한 장에서 뽑는 게
// 맞아서, 기존 첨부 파일 경로에 그대로 두는 편이 낫습니다.
const PROFESSOR_GEN_LENS_DEFS: { id: LensId; key: string }[] = [
  { id: 'digest', key: 'digest' },
  { id: 'questions', key: 'questions' },
  { id: 'examQuestions', key: 'examQuestions' },
];

// 💡 교수님 분석 결과의 6개 카테고리 — ProfessorAnalysisResult의 키와 1:1 대응. 라벨이
// 번역돼야 해서(t() 필요) 컴포넌트 안의 professorCategoryDefs로 계산합니다 — 여기서는
// 순서와 키만 고정해둡니다. 각 카테고리는 AI가 반환한 confident 값에 따라 화면에서 실제
// 결과(위)로 올라가거나 "더 올리면 알 수 있는 것"(아래, 회색)으로 내려갑니다.
const PROFESSOR_CATEGORY_KEYS: (keyof ProfessorAnalysisResult)[] = [
  'topics', 'examStyle', 'assignmentStyle', 'examQuestionTypes', 'gradingStrictness', 'researchInterests',
];

// 💡 [신규] "이 개수 이상이면 정확도가 확 올라간다"고 안내하는 기준값. 분석을 막는 문턱이
// 아니라 안내 문구를 띄울지만 정하는 값입니다 — 자료가 1개여도 분석은 그대로 돌아갑니다.
// getProfessorAnalysisFramingLine의 문구 구간과 같은 값(3)을 씁니다.
const PROFESSOR_RELIABLE_DOC_COUNT = 3;

// 💡 [신규] 교수님 상세 화면 회로도의 action 노드 3개 — 이미 계산된 6개 카테고리 결과를 재활용해서
// 매핑합니다(별도 API 호출 없음). "공부 방식"은 어느 카테고리와도 정확히 대응되지 않아서, 자주
// 강조되는 주제(topics)를 "무엇을 중점적으로 공부해야 하는지"로 재해석해서 씁니다. 라벨은
// professorCircuitDefs(컴포넌트 안)에서 t()로 계산합니다.
const PROFESSOR_CIRCUIT_NODE_DEFS: { nodeId: Extract<NodeId, 'expected_questions' | 'assignment_direction' | 'study_method'>; keys: (keyof ProfessorAnalysisResult)[] }[] = [
  { nodeId: 'expected_questions', keys: ['examStyle', 'examQuestionTypes'] },
  { nodeId: 'assignment_direction', keys: ['assignmentStyle'] },
  { nodeId: 'study_method', keys: ['topics'] },
];

// 💡 [수정] 예전에는 confident인 카테고리의 items만 모아서, 확신이 낮으면 카드가 통째로
// "아직 확신 있게 판단하지 못했어요"로 바뀌었습니다. 이제는 confident와 무관하게 items를
// 전부 모읍니다 — 근거(evidence)가 붙은 항목만 서버가 내려주므로, 자료가 1개여도 보여줄
// 내용이 있으면 보여줍니다. confident는 "여러 자료에서 교차 확인됨" 여부를 나타내는 표시로만
// 남아, 화면에서는 정확도 안내 문구를 띄울지 판단하는 데 씁니다.
function getProfessorCircuitCardData(result: ProfessorAnalysisResult | undefined, keys: (keyof ProfessorAnalysisResult)[]) {
  if (!result) return { confident: false, items: [] as ProfessorAnalysisItem[] };
  return {
    confident: keys.some((k) => result[k].confident),
    items: keys.flatMap((k) => normalizeProfessorItems(result[k].items)),
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

// 💡 [수정] 교수님 1명당 누적 가능한 자료 개수 상한. 자료 추가는 이제 기존 분석 요약 + 새
// 자료만 보내는 증분 업데이트라 개수가 늘어나도 업로드 1건당 비용은 크게 늘지 않지만, 자료
// 삭제 시에는 여전히 전체 자료를 다시 보내 재분석하므로(recomputeProfessorAnalysisFull)
// 상한 자체는 유지합니다. app/api/analyze-professor/route.ts의 MAX_PROFESSOR_DOCUMENTS와
// 같은 값으로 맞춰주세요.
const MAX_PROFESSOR_DOCUMENTS = 30;

// 💡 [신규] AI 답변 언어 설정 드롭다운에 기본으로 보여줄 후보들 — 브라우저가 이 목록에 없는
// 언어를 감지해서 반환하면(예: Intl.DisplayNames가 "Swahili"를 반환) 그 값도 옵션에 그대로
// 끼워 넣습니다(아래 responseLanguageOptions 계산 참고), 이 목록은 어디까지나 자주 쓰이는
// 후보를 빠르게 고를 수 있게 하는 용도일 뿐 지원 언어를 제한하지 않습니다.
const COMMON_RESPONSE_LANGUAGES = [
  'Korean', 'English', 'Japanese', 'Chinese', 'Spanish', 'French', 'German',
  'Portuguese', 'Vietnamese', 'Thai', 'Indonesian', 'Russian', 'Arabic', 'Hindi',
];

// 자료 개수에 따라 분석 결과 위에 붙는 한 줄 — 개수가 많아질수록 신뢰도가 올라간다는 걸 보여줍니다.
export default function HomePage() {
  const router = useRouter();
  // 💡 [신규] 다국어 지원 — 10개 로케일(messages/{locale}.json)로 확장됐습니다. locale은
  // toLocaleDateString 등 날짜 포맷팅에도 씁니다 — UI 언어를 영어로 봐도 날짜가 여전히
  // "7월 15일" 같은 한국어 포맷으로 굳어 있으면 어색해서, 번역을 새로 추가하는 화면부터는
  // 하드코딩된 'ko-KR' 대신 이 값을 씁니다(기존에 이미 하드코딩된 곳까지 전부 훑어 고치진
  // 않았습니다 — 범위가 너무 커서 이번엔 새로 손대는 화면 위주로 반영).
  const t = useTranslations();
  const locale = useLocale();

  // 💡 [신규] NODE_REGISTRY(lib/blocks/defaults.ts)의 label/hint는 한국어가 고정값으로 박혀
  // 있어서(CircuitNode 타입상 label/hint가 필수라 완전히 뺄 수 없었습니다), 실제 화면에 쓸 때는
  // 여기서 번역된 값으로 덮어씁니다. components/circuit/circuit-board.tsx도 동일한 패턴을 씁니다.
  const getNodeMeta = (id: NodeId) => {
    const base = NODE_REGISTRY.find((n) => n.id === id);
    if (!base) return undefined;
    return { ...base, label: t(`nodes.${id}.label`), hint: t(`nodes.${id}.hint`) };
  };
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('connecting');
  const [command, setCommand] = useState('');
  const [streamingLog, setStreamingLog] = useState(IDLE_CONSOLE_SENTINEL);
  const [isExecuting, setIsExecuting] = useState(false);
  // 💡 [신규] /api/chat 요청을 보내고 첫 글자가 도착하기 전까지만 true — 이 구간엔 아직 보여줄
  // 실제 텍스트가 없어서 <LoadingText />(재밌는 로딩 문구)를 보여줍니다. 스트리밍이 시작되면
  // (첫 청크 도착) 바로 false로 바꿔서 실제 답변으로 자연스럽게 넘어갑니다.
  const [isAwaitingChatResponse, setIsAwaitingChatResponse] = useState(false);

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
  // 💡 [신규] logs 조회 완료 여부. fetchLogs는 결과가 0건이면 setLogs를 아예 부르지 않아서
  // logs가 []인 상태만으로는 "아직 로딩 중"과 "정말 대화가 없음"을 구분할 수 없습니다.
  // 온보딩 표시 조건이 바로 그 구분에 의존하므로 플래그를 따로 둡니다.
  const [isLogsLoaded, setIsLogsLoaded] = useState(false);
  const [selectedProfessorId, setSelectedProfessorId] = useState<string | null>(null);

  const [isUploadingProfessorDoc, setIsUploadingProfessorDoc] = useState(false);
  const [uploadProfessorChoice, setUploadProfessorChoice] = useState('');
  const [newProfessorName, setNewProfessorName] = useState('');
  const [isCreatingProfessor, setIsCreatingProfessor] = useState(false);
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

  // 💡 [신규] 교수님 탭 요약·핵심정리 — 채팅창의 "핵심 정리"(digest 렌즈)를 그대로 재사용합니다.
  // 통합 요약(교수님 자료 전체를 합쳐 1회 호출)과 문서별 요약(문서 1개씩 호출)을 따로 담습니다.
  // 서버에 저장하지 않고 화면 상태로만 들고 있습니다 — professor_analysis처럼 영속화하려면
  // 테이블이 하나 더 필요한데, 요약은 언제든 다시 만들 수 있는 파생 결과라 새 스키마를 만들
  // 만큼의 이득이 없다고 판단했습니다(교수님을 바꾸면 초기화됩니다).
  // 💡 통합 요약과 그 오류는 "어느 교수님 것인지"를 함께 들고 있습니다 — 교수님을 바꿀 때
  // useEffect로 초기화하는 대신, 렌더 시점에 현재 선택된 교수님 것일 때만 보여주는 방식입니다
  // (effect 안에서 setState를 연쇄로 호출하지 않아도 되고, 이전 교수님 결과가 잠깐 스쳐
  // 보이는 문제도 없습니다). 문서별 요약은 문서 id로 키를 잡으므로 애초에 섞이지 않습니다.
  // 💡 교수님 자료 "통합 요약"은 여기서 없어졌습니다 — 채팅 탭의 "교수님 자료로 만들기 →
  // 강의 요약"이 완전히 같은 일(이 교수님 자료 전체를 digest 렌즈로 한 번에 정리)을 하고
  // 있어 같은 기능이 두 군데에 있던 상태였습니다. 아래 문서별 요약(professorDocDigests)은
  // 대상이 다르므로(자료 목록에서 파일 하나만) 그대로 남겨둡니다.
  const [professorDocDigests, setProfessorDocDigests] = useState<Record<string, DigestResult>>({});

  // 💡 [신규] 채팅 탭의 "교수님 자료로 만들기" — 고른 교수님의 자료 전체를 세 가지 결과물
  // (강의 요약 / 예상 질문 / 예상 시험 문제) 중 하나로 만듭니다. 첨부 문서용 렌즈 상태
  // (lensId/lensStage/lensResult)와 일부러 분리했습니다: 그쪽은 "지금 채팅에 붙인 파일 하나"에
  // 묶인 상태 기계라, 첨부가 없어도 동작해야 하는 이 기능을 같은 슬롯에 태우면 미니 전선
  // (chatLensGraph)과 마감 등록 인덱스까지 얽힙니다.
  const [professorGenProfessorId, setProfessorGenProfessorId] = useState<string | null>(null);
  // 💡 [신규] 채팅에서 선택한 "주제 폴더" — 교수님 선택(professorGenProfessorId)과 완전히
  // 같은 역할을 폴더 축으로 합니다: 이 값이 있으면 logs에 folder_id로 함께 저장되고,
  // 다음 요청의 "최근 대화 기록"이 그 폴더 대화로 좁혀집니다. 교수님과 동시에 켜지지
  // 않습니다(둘 중 하나를 고르면 나머지는 해제 — 어느 맥락을 우선할지 애매해지므로).
  // "지난 대화" 탭의 폴더 필터(logFolderFilter)와는 별개 상태입니다: 그쪽은 보기 필터,
  // 이쪽은 대화의 맥락 지정이라 서로 영향을 주면 안 됩니다.
  const [chatFolderId, setChatFolderId] = useState<string | null>(null);
  // 💡 [신규] 대화 저장(logs insert)이 실패했을 때의 메시지. 예전에는 이 실패를 코드가
  // 그냥 버려서, DB 스키마가 어긋난 동안 모든 대화가 저장되지 않는데도 화면에는 아무
  // 표시가 없었습니다(handleExecute의 저장 부분 주석 참고). alert이 아니라 화면 안 배너로
  // 두는 이유는, 답변 자체는 정상적으로 나온 상황이라 흐름을 끊을 일은 아니기 때문입니다.
  const [logSaveError, setLogSaveError] = useState<string | null>(null);
  // 💡 [신규] "물어보기" 탭 안에서 교수님/폴더를 그 자리에서 만들기 위한 인라인 폼 토글.
  // 교수님 탭으로 건너갔다 오지 않아도 되게 하려는 것이므로, 기본은 접힌 상태입니다 —
  // 대부분의 방문에서는 만들 일이 없고, 펼쳐두면 정작 자주 쓰는 선택 칩이 밀립니다.
  const [showInlineProfessorForm, setShowInlineProfessorForm] = useState(false);
  const [showInlineFolderForm, setShowInlineFolderForm] = useState(false);
  // 💡 [신규] 방금 저장된 대화의 id. 답변 직후 "이 대화를 폴더에 넣기"를 띄우는 데 씁니다.
  // 대화 목록을 통째로 물어보기로 옮기지 않은 이유는 "지난 대화" 탭과 완전히 중복되기
  // 때문이고, 실제로 폴더를 정하고 싶은 순간은 대화를 막 끝냈을 때라 그 지점만 노출합니다.
  const [lastSavedLogId, setLastSavedLogId] = useState<string | null>(null);
  // 💡 [신규] "예상 시험 문제"를 다시 뽑을 때 같은 문제가 반복되지 않도록, 이미 낸 문항의
  // 한 줄 요약을 교수님별로 기억합니다. 교수님 id를 키로 쓰기 때문에 다른 교수님으로
  // 넘어가면 그 교수님의 목록이 따로 관리됩니다(요청대로 "교수님이 바뀌면 초기화").
  // localStorage에 저장하는 이유: 새로고침 한 번에 기억이 날아가면 같은 문제가 다시 나오는데,
  // 그게 이 기능을 만든 이유 자체라 메모리에만 두면 반쪽이 됩니다. DB까지 갈 일은 아니라고
  // 판단했습니다 — 기기가 바뀌면 초기화돼도 실질적인 손해가 없고, 마이그레이션·정리 정책·
  // 목록 상한 같은 부담만 늘어납니다.
  const [examQuestionHistory, setExamQuestionHistory] = useState<Record<string, string[]>>({});
  const [professorGenLens, setProfessorGenLens] = useState<LensId | null>(null);
  const [professorGenResult, setProfessorGenResult] = useState<
    DigestResult | QuestionsResult | ExamQuestionsResult | null
  >(null);
  const [isGeneratingFromProfessor, setIsGeneratingFromProfessor] = useState(false);
  const [professorGenError, setProfessorGenError] = useState<string | null>(null);
  const [digestingDocId, setDigestingDocId] = useState<string | null>(null);
  const [professorDocDigestError, setProfessorDocDigestError] = useState<{ professorId: string; message: string } | null>(null);

  // 💡 [신규] 유료 전환 준비 — 결제 시스템은 아직 없고 profiles.is_pro만 봅니다(기본 false).
  // "Pro로 업그레이드하기" 배지/한도 도달 시 열리는 요청 폼 공용 상태.
  const [isPro, setIsPro] = useState(false);
  // 💡 [신규] 서버가 실제로 호출 중인 OpenAI 모델명(/api/usage-summary가 내려줍니다).
  // 사이드바 연동 배지에만 씁니다. 아직 안 왔거나 조회에 실패하면 null로 남고, 그때는
  // 모델명 없이 "OpenAI 연동됨"만 표시합니다 — 배지는 연결 상태 표시가 본체이고,
  // 모델명은 아는 경우에만 덧붙이는 정보라 이 순서가 맞습니다.
  const [aiModel, setAiModel] = useState<string | null>(null);
  // 💡 [신규] 사이드바 당근 게이지(components/carrot-gauge.tsx)용 — 이번 달 채팅/파일 처리
  // 사용량. 한도에 도달했을 때만 알려주던 기존 openUpgradeModal()과 달리, 평소에도 "몇 회
  // 남았는지"를 보여주기 위한 조회 전용 상태입니다(/api/usage-summary, fetchUsageSummary).
  const [usageSummary, setUsageSummary] = useState<{
    isPro: boolean;
    // 💡 [수정] 토큰 잔량 비율과 구간만 받습니다 — 숫자는 애초에 서버가 안 보냅니다.
    usage: { ratio: number; level: UsageLevel } | null;
    // 💡 [신규] 코드 기반 Pro의 남은 기간 안내(components/pro-expiry-notice.tsx)용.
    // 결제 기반 Pro는 proExpiresAt이 항상 null이라 안내가 뜨지 않습니다.
    proSource: 'payment' | 'code' | null;
    proExpiresAt: string | null;
  } | null>(null);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  // 💡 [신규] 소사이어티 코드 월 사용 상한 도달 안내. 일반 한도와 달리 Pro 결제 모달을
  // 띄우지 않습니다 — 이 상한은 결제로 즉시 풀리는 성격이 아니라 "다음 달에 초기화되는"
  // 것이라, 그 자리에서 결제를 권하면 안내가 아니라 판매가 됩니다.
  const [isSocietyCodeLimitOpen, setIsSocietyCodeLimitOpen] = useState(false);
  const [upgradeContext, setUpgradeContext] = useState<string | null>(null);
  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradeMemo, setUpgradeMemo] = useState('');
  const [isSubmittingUpgradeRequest, setIsSubmittingUpgradeRequest] = useState(false);
  const [upgradeRequestSubmitted, setUpgradeRequestSubmitted] = useState(false);

  // 💡 [신규] 소사이어티 코드 입력 — 업그레이드 모달 안의 별도 섹션(app/api/society-code/redeem
  // 참고). 이 앱이 오버레이를 거의 안 쓰고 업그레이드 모달 하나만 재사용하는 기존 원칙을
  // 그대로 따라, 새 모달을 만들지 않고 이 모달에 이어붙입니다.
  const [societyCode, setSocietyCode] = useState('');
  const [isRedeemingSocietyCode, setIsRedeemingSocietyCode] = useState(false);
  const [societyCodeError, setSocietyCodeError] = useState<string | null>(null);
  const [societyCodeRedeemed, setSocietyCodeRedeemed] = useState(false);

  // 💡 [신규] 계정 삭제 — handleDeleteAccount 진행 중 사이드바 버튼을 비활성화하는 데만 씁니다.
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  // 💡 [신규] Pro 구독 중 삭제 경고 모달 — 체크박스를 명시적으로 체크해야만 모달 안의
  // "계정 삭제" 버튼이 활성화됩니다. 모달을 닫거나 다시 열면 체크 상태를 초기화합니다
  // (매번 다시 인지하고 체크하게 하기 위해서 — 이전에 체크했던 상태가 남아있으면 안 됨).
  const [isProDeleteWarningOpen, setIsProDeleteWarningOpen] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);

  // 💡 [신규] AI 답변 언어 — /api/chat, /api/analyze, /api/analyze-professor에 보내는
  // responseLanguage 값. 화면 고정 글자(메뉴·버튼)의 ko/en 로케일(useLocale())과는 별개의
  // 설정입니다 — 저건 next-intl UI 번역이 딱 두 언어뿐이라 그대로 두고, 이건 브라우저 언어를
  // 감지해 훨씬 다양한 언어를 기본값으로 잡습니다. 사용자가 설정에서 직접 바꾸면 그 값을
  // 계정별로 기억합니다(loadUserScopedItem/saveUserScopedItem, key mcp_response_language).
  const [responseLanguage, setResponseLanguageState] = useState('English');

  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  // 💡 [신규] 본문 스크롤 컨테이너 — 문서 대신 이 영역만 스크롤합니다(위 루트 주석 참고).
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // 바닥에서 이 거리 이내면 "따라가는 중"으로 봅니다. 너무 작으면 관성 스크롤이 살짝
  // 튈 때마다 따라가기가 끊기고, 너무 크면 위로 올려도 계속 끌려 내려갑니다.
  const SCROLL_FOLLOW_THRESHOLD_PX = 100;
  const [isNearBottom, setIsNearBottom] = useState(true);

  const handleContentScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsNearBottom(distanceFromBottom <= SCROLL_FOLLOW_THRESHOLD_PX);
  };

  // 💡 [신규] 전송을 누른 그 순간 한 번만 답변 영역으로 이동합니다.
  //
  // 문제: 파일을 첨부하고 관점을 고른 뒤 전송하면, 진행 애니메이션이 화면 아래쪽에 있어서
  // 스크롤하지 않으면 "지금 돌고 있는지"조차 알 수 없었습니다.
  //
  // 위쪽의 자동 따라가기(isNearBottom 조건)는 그대로 둡니다 — 이 함수는 streamingLog가
  // 바뀔 때가 아니라 전송 핸들러에서만 불립니다. 이동한 뒤 사용자가 위로 올리면 그때부터는
  // 따라가지 않습니다(그 규칙은 건드리지 않았습니다).
  const scrollToResponsePanel = (target: 'chat' | 'lens' = 'chat') => {
    const el = (target === 'lens' ? lensResultRef.current : responsePanelRef.current) ?? responsePanelRef.current;
    if (!el) return;
    // block:'center'가 아니라 'start' — 답변이 화면 위쪽에서 시작해야 아래로 읽어 내려갑니다.
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 💡 여기서 isNearBottom을 손대지 않습니다. 부드러운 스크롤이 진행되면서 scroll 이벤트가
    // 발생하고, handleContentScroll이 실제 위치로 값을 갱신합니다 — 억지로 true를 넣으면
    // "전송 직후 한 번만 이동" 규칙이 깨져서, 답변을 읽으려 위로 올려도 다시 끌려갑니다.
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };
  const commandInputRef = useRef<HTMLInputElement>(null);
  // 💡 [신규] 전송 직후 답변 영역으로 딱 한 번 이동하기 위한 ref. 스트리밍 중 강제 스크롤은
  // 여전히 하지 않습니다 — 아래 scrollToResponsePanel()은 전송 시점에만 호출합니다.
  const responsePanelRef = useRef<HTMLDivElement>(null);
  // 관점(렌즈) 분석 결과는 답변 패널 아래 별도 카드에 그려지므로 따로 잡습니다.
  const lensResultRef = useRef<HTMLDivElement>(null);

  // 💡 [신규] 그래프 자체는 저장하지 않지만, 다음 그래프를 빠르게 구성할 때 참고할 최소한의 힌트
  // (마지막에 쓴 렌즈, 선호 action)는 계정별로 저장합니다.
  const [graphPreferences, setGraphPreferences] = useState<GraphPreferences>({ lastLens: null, preferredAction: null });
  const [isGraphPreferencesLoaded, setIsGraphPreferencesLoaded] = useState(false);

  const [logs, setLogs] = useState<LogItem[]>([]);

  // 💡 [신규] 가입 직후 딱 한 번 뜨는 3단계 안내(components/onboarding-modal.tsx).
  //
  // "봤는지"는 계정별 localStorage에 기록합니다(mcp_onboarding_seen:{userId}) — 기기마다
  // 한 번씩 더 뜰 수 있지만 실질적 피해가 없고, DB 컬럼을 추가하려면 마이그레이션과
  // profiles UPDATE 권한 확장(20260818이 좁혀둠)이 함께 필요해 비용이 큽니다.
  //
  // 기록만으로 판단하지 않고 "정말 아무것도 안 한 계정"인지도 함께 봅니다. localStorage를
  // 지웠거나 새 기기로 접속한 기존 사용자에게 "1. 교수님 추가하기"가 다시 뜨면 어색합니다.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const hasSeenOnboarding = useMemo(
    () => (user ? loadUserScopedItem<boolean>(user.id, 'mcp_onboarding_seen') === true : true),
    [user]
  );
  const showOnboarding =
    !onboardingDismissed &&
    !hasSeenOnboarding &&
    isProfessorsLoaded &&
    isLogsLoaded &&
    professors.length === 0 &&
    logs.length === 0;

  const dismissOnboarding = () => {
    setOnboardingDismissed(true);
    if (user) saveUserScopedItem(user.id, 'mcp_onboarding_seen', true);
  };

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
  const [chatLensChoice, setChatLensChoice] = useState<CircuitLensId | 'none' | null>(null);

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
  // 💡 [신규] 화면 언어를 profiles.locale에 적어둡니다. 언어 설정은 브라우저 쿠키에만
  // 있어서, 사용자가 접속하지 않은 상태에서 도는 cron(만료 안내 메일)은 이 사람이 어떤
  // 언어를 쓰는지 알 방법이 없습니다. 값이 이미 같으면 쓰지 않아 불필요한 UPDATE가 매
  // 로드마다 나가지 않습니다. 실패해도 조용히 넘어갑니다 — 메일 언어가 기본값으로
  // 떨어질 뿐이라 화면 동작을 막을 이유가 아닙니다.
  const syncLocaleToProfile = async (userId: string) => {
    try {
      const { data } = await supabase.from('profiles').select('locale').eq('id', userId).single();
      if (data?.locale === locale) return;
      await supabase.from('profiles').update({ locale }).eq('id', userId);
    } catch (err) {
      console.error('화면 언어 저장 실패:', err);
    }
  };

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

  // 💡 [신규] 로그인 없이 체험(app/login/page.tsx)한 뒤 "로그인하고 저장하기"를 눌러
  // localStorage에 잠깐 담아둔 분석 결과를 로그인 성공 직후 자동으로 저장합니다 — 파일을
  // 다시 올리게 하지 않는 게 목적이라, 이미 뽑아둔 텍스트를 "내 파일"에 추가하고 렌즈
  // 결과도 그대로 복원합니다. isFilesLoaded가 true인 뒤에 실행해야 위 effect(로컬 파일
  // 목록 불러오기)가 이 추가 내용을 덮어쓰지 않습니다.
  useEffect(() => {
    if (!user || !isFilesLoaded) return;

    let pending: PendingTrialResult | null = null;
    try {
      const raw = localStorage.getItem(PENDING_TRIAL_RESULT_KEY);
      if (raw) pending = JSON.parse(raw);
    } catch (err) {
      console.error('체험 결과 불러오기 실패:', err);
    }
    if (!pending) return;
    localStorage.removeItem(PENDING_TRIAL_RESULT_KEY);

    const newFile: FileItem = {
      id: Date.now().toString(),
      name: pending.fileName,
      size: `${(pending.text.length / 1024).toFixed(1)} KB`,
      content: pending.text,
      mimeType: 'text/plain',
      date: new Date().toISOString().split('T')[0],
    };
    setFiles((prev) => [newFile, ...prev]);
    recordDocumentUpload(pending.fileName, 'text/plain');

    setLensId(pending.lens);
    setLensResult(pending.result);
    setLensStage('done');
    setActiveTab('workspace');
  }, [user, isFilesLoaded]);

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

  // 💡 [신규] AI 답변 언어 — 저장해둔 값이 있으면 그걸 쓰고, 없으면(처음 로그인) 브라우저
  // 언어를 감지해 기본값으로 씁니다.
  useEffect(() => {
    if (!user) return;
    const saved = loadUserScopedItem<Record<string, string[]>>(user.id, 'mcp_exam_question_history');
    if (saved && typeof saved === 'object') setExamQuestionHistory(saved);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const saved = loadUserScopedItem<string>(user.id, 'mcp_response_language');
    setResponseLanguageState(saved || detectBrowserLanguageName());
  }, [user]);

  // 💡 설정에서 직접 바꿀 때 씁니다 — 상태 변경과 동시에 계정별로 저장합니다.
  const setResponseLanguage = (lang: string) => {
    setResponseLanguageState(lang);
    if (user) saveUserScopedItem(user.id, 'mcp_response_language', lang);
  };

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
        fetchIsPro(retrySession.user.id);
        fetchUsageSummary();
        syncLocaleToProfile(retrySession.user.id);
      } else {
        setUser(session.user);
        fetchLogs(session.user.id);
        fetchDocumentUploads(session.user.id);
        fetchProfessorsAndDocuments(session.user.id);
        fetchConversationFolders(session.user.id);
        fetchIsPro(session.user.id);
        fetchUsageSummary();
        syncLocaleToProfile(session.user.id);
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
    setIsLogsLoaded(true);
  };

  // 💡 [신규] 유료 전환 준비 — profiles.is_pro 조회. 프로필 행이 아직 없거나(가입 직후 등)
  // 조회에 실패해도 무료 등급(false)으로 안전하게 취급합니다.
  //
  // 💡 [수정] 예전에는 `const { data } = ...`로 error를 버려서, 조회 실패와 "실제로 무료
  // 등급"이 화면에서도 콘솔에서도 완전히 구분되지 않았습니다(둘 다 배지가 'Pro', 게이지
  // 표시). is_pro를 수동으로 켰는데 화면에 반영이 안 될 때 원인을 좁힐 단서가 아예 없었던
  // 이유입니다. 이제 실패 원인을 lib/plan-limits.ts의 logProfileLookupFailure로 분류해
  // 콘솔에 남기고, 화면 동작(무료 등급 폴백)은 그대로 유지합니다.
  const fetchIsPro = async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('is_pro').eq('id', userId).single();
    if (error) {
      logProfileLookupFailure('fetchIsPro', userId, error);
      setIsPro(false);
      return;
    }
    setIsPro(Boolean(data?.is_pro));
  };

  // 💡 [신규] 사이드바 당근 게이지용 — /api/usage-summary(조회 전용)를 호출합니다. 실패해도
  // (네트워크 등) 조용히 넘어갑니다 — 게이지가 잠깐 안 보이는 것뿐이라 다른 기능을 막을
  // 이유가 아닙니다. 초기 로드 시(fetchIsPro와 같은 시점) + 채팅/파일 업로드가 성공할
  // 때마다(handleExecute의 logs insert, recordDocumentUpload) 다시 불러 최신 상태를 유지합니다.
  const fetchUsageSummary = async () => {
    try {
      const res = await fetch('/api/usage-summary');
      if (!res.ok) return;
      const data = await res.json();
      setUsageSummary({
        isPro: Boolean(data.isPro),
        usage: data.usage ?? null,
        proSource: data.proSource ?? null,
        proExpiresAt: data.proExpiresAt ?? null,
      });
      // 💡 서버가 실제로 쓰고 있는 모델명 — 사이드바 연동 배지에 그대로 씁니다.
      if (typeof data.model === 'string' && data.model) setAiModel(data.model);
    } catch (err) {
      console.error('사용량 조회 실패:', err);
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
      fetchUsageSummary();
    } catch (err) {
      console.error('문서 업로드 기록 실패:', err);
    }
  };

  // 💡 [수정] 예전에는 streamingLog가 바뀔 때마다 무조건 맨 아래로 끌어내렸습니다. 답변을
  // 읽으려고 위로 올려둬도 다음 글자가 도착하는 순간 다시 바닥으로 튕겨서, 긴 답변은
  // 사실상 읽을 수가 없었습니다.
  //
  // 이제 "사용자가 이미 바닥 근처에 있을 때만" 따라 내려갑니다. 위로 올라가 있으면
  // 자동 스크롤을 멈추고, 대신 "맨 아래로" 버튼을 띄웁니다. 다시 바닥 근처로 내려오면
  // isNearBottom이 true가 되면서 자동으로 따라가기가 재개됩니다.
  useEffect(() => {
    if (!isNearBottom) return;
    scrollToBottom('smooth');
  }, [streamingLog, logs, isNearBottom]);

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
  const effectiveChatLens: CircuitLensId | 'none' = chatLensChoice
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

  // 💡 [신규] "교수님 자료로 만들기"에서 지금 고른 교수님의 자료 수와, 성향 블록이 실제로
  // 만들어지는지(= 화면에 "성향 반영" 표시를 띄울지). buildProfessorContext는 confident한
  // 카테고리가 하나도 없으면 빈 문자열을 돌려주므로, 길이만 보면 충분합니다.
  // 💡 [신규] 등급별 파일 크기 상한(무료 5MB / Pro 20MB) — 서버(/api/extract)가 실제로 쓰는
  // 값과 같은 소스(lib/plan-limits.ts)에서 가져옵니다. 예전엔 클라이언트가 10MB로 하드코딩돼
  // 있어서 무료 사용자에게 "여기선 통과, 서버에서 거절"이 생겼습니다.
  // 💡 [수정] 문서 업로드는 이제 브라우저 → Supabase Storage 직접 업로드라(lib/storage-upload.ts)
  // 플랫폼(Vercel) 요청 본문 상한을 타지 않습니다 — 서버에 가는 건 파일이 아니라 경로 문자열
  // 하나뿐이라서요. 그래서 등급 상한(무료 30MB / Pro 100MB)이 그대로 실효 상한이 됩니다.
  // 예전에는 두 값 중 작은 쪽(≈3.2MB)이 실효 상한이라 등급 상한이 사실상 무의미했습니다.
  const uploadLimitBytes = getEffectiveUploadLimitBytes(getPlanLimits(isPro).maxUploadBytes, true);
  // Pro로 올렸을 때의 실효 상한 — 업그레이드 안내를 붙일지 판단하는 데만 씁니다.
  const proUploadLimitBytes = getEffectiveUploadLimitBytes(PRO_LIMITS.maxUploadBytes, true);
  // 사진(채팅 첨부)만은 여전히 요청 본문에 base64로 실어야 하므로 별도 상한을 씁니다 —
  // 비전 API가 이미지 URL이 아니라 base64를 받기 때문에 Storage를 거쳐도 결국 본문에 들어갑니다.
  const imageLimitBytes = Math.min(uploadLimitBytes, MAX_REQUEST_FILE_BYTES);
  // 업로드 화면에 미리 보여줄 안내 문구(올리기 전에 상한과 지원 형식을 알 수 있게).
  const uploadLimitHint = t('upload.hint', {
    max: formatBytes(uploadLimitBytes),
    formats: 'PDF, PPTX, DOCX, XLSX, HWP, TXT',
  });

  const professorGenDocCount = professorGenProfessorId
    ? professorDocuments.filter((d) => d.professor_id === professorGenProfessorId).length
    : 0;
  const professorGenHasProfile = (() => {
    if (!professorGenProfessorId) return false;
    const professor = professors.find((p) => p.id === professorGenProfessorId);
    const analysisRow = professorAnalyses.find((a) => a.professor_id === professorGenProfessorId);
    return (
      buildProfessorContext({
        result: analysisRow?.result,
        professorName: professor?.name,
        school: professor?.school,
        department: professor?.department,
      }).length > 0
    );
  })();

  const handleSelectChatLens = (choice: CircuitLensId | 'none') => {
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
        return <p className="text-base sm:text-sm text-[var(--text-secondary)] leading-relaxed">{t('workspace.lens.noDeadlinesFound')}</p>;
      }
      const allRegistered = result.items.every((_, i) => registeredDeadlineIndexes.has(i));
      return (
        <div className="flex flex-col gap-4 sm:gap-3">
          <div className="flex justify-end">
            <button
              type="button"
              disabled={allRegistered}
              onClick={() => registerAllDeadlineItems(result.items)}
              className="inline-flex items-center gap-1.5 bg-[var(--surface-chip)] hover:bg-[var(--border-chip-hover)] border border-[var(--border-accent-subtle)] text-[#F4679B] text-sm sm:text-xs font-semibold px-4 sm:px-3.5 py-2.5 sm:py-2 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:border-[var(--border-chip-hover)] disabled:text-[var(--text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
            >
              {allRegistered ? t('workspace.lens.registerAllDone') : t('workspace.lens.registerAll')}
            </button>
          </div>
          <ul className="flex flex-col gap-4 sm:gap-3">
            {result.items.map((item, i) => {
              const isRegistered = registeredDeadlineIndexes.has(i);
              return (
                <li key={i} className="border border-[var(--border-chip-hover)] rounded-xl p-4 sm:p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5 sm:mb-1">
                    <span className="text-base sm:text-sm font-semibold text-[var(--text-primary)] leading-snug">{item.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm sm:text-xs font-semibold text-[#F4679B]">{item.date}</span>
                      <button
                        type="button"
                        disabled={isRegistered}
                        onClick={() => registerDeadlineItem(item, i)}
                        className={`text-xs sm:text-[11px] font-semibold px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                          isRegistered
                            ? 'bg-[var(--bg-success-subtle)] text-[#6EE7B7] border-[var(--border-success-subtle)] cursor-default'
                            : 'bg-[var(--surface-chip)] hover:bg-[var(--border-chip-hover)] text-[#F4679B] border-[var(--border-accent-subtle)] cursor-pointer'
                        }`}
                      >
                        {isRegistered ? t('workspace.lens.registered') : t('workspace.lens.register')}
                      </button>
                    </div>
                  </div>
                  <p className="text-sm sm:text-xs text-[var(--text-oncard)] italic leading-loose">&quot;{item.evidence}&quot;</p>
                  <div className="mt-2.5 sm:mt-2 h-1.5 sm:h-1 rounded-full bg-[var(--surface-chip)] overflow-hidden">
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
        return <p className="text-base sm:text-sm text-[var(--text-secondary)] leading-relaxed">{t('workspace.lens.noQuestionsFound')}</p>;
      }
      return (
        <ul className="flex flex-col gap-4 sm:gap-3">
          {result.items.map((item, i) => (
            <li key={i} className="border border-[var(--border-chip-hover)] rounded-xl p-4 sm:p-3.5">
              <p className="text-base sm:text-sm font-semibold text-[var(--text-primary)] mb-2 sm:mb-1.5 leading-relaxed">Q. {item.question}</p>
              <p className="text-sm sm:text-xs text-[#F4679B] mb-2 sm:mb-1.5 leading-loose">{t('workspace.lens.weakness', { text: item.targetWeakness })}</p>
              {/* 💡 답변 초안은 처음엔 가려둡니다 — 교수님 자료로 만든 예상 질문과 같은 동작.
                  AnswerDisclosure는 열림 상태를 스스로 들고 있어서, 훅을 부를 수 없는
                  이 함수(renderLensResult) 안에서도 그대로 쓸 수 있습니다. */}
              <AnswerDisclosure
                answer={item.draftAnswer}
                showLabel={t('workspace.lens.showDraftAnswer')}
                hideLabel={t('workspace.lens.hideDraftAnswer')}
                answerClassName="text-sm sm:text-xs text-[var(--text-oncard)] leading-loose"
              />
              {item.source_quote && (
                <p className="text-xs sm:text-[11px] text-[var(--text-muted)] italic leading-loose mt-1.5">{t('workspace.lens.evidencePrefix')}: &quot;{item.source_quote}&quot;</p>
              )}
            </li>
          ))}
        </ul>
      );
    }

    const result = lensResult as DigestResult;
    return (
      <div className="flex flex-col gap-5 sm:gap-4">
        <p className="text-base sm:text-sm font-semibold text-[var(--text-primary)] leading-relaxed">{result.summary}</p>
        {result.keyPoints.length > 0 && (
          <ul className="flex flex-col gap-2 sm:gap-1.5">
            {result.keyPoints.map((point, i) => (
              <li key={i} className="text-sm sm:text-xs text-[var(--text-oncard)] leading-loose list-disc list-inside">
                {point.text}
                {point.evidence && (
                  <span className="block text-xs sm:text-[11px] text-[var(--text-muted)] italic mt-0.5 pl-4">&quot;{point.evidence}&quot;</span>
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
                className="bg-[var(--surface-chip)] border border-[var(--border-chip-hover)] text-[var(--text-oncard)] text-xs sm:text-[11px] px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full"
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

    if (chatAttachments.length + filesToAttach.length > MAX_CHAT_ATTACHMENTS) {
      alert(t('workspace.errors.tooManyAttachments', { max: MAX_CHAT_ATTACHMENTS, count: chatAttachments.length }));
      return;
    }

    setIsAttachingChatFile(true);
    try {
      for (const file of filesToAttach) {
        const isImage = file.type.startsWith('image/');

        // 💡 [수정] 사진과 문서의 상한이 다릅니다. 문서는 Storage로 직접 올라가 등급 상한
        // (무료 30MB / Pro 100MB)이 그대로 적용되지만, 사진은 비전 API에 base64로 실어야 해서
        // 여전히 요청 본문 상한을 탑니다.
        const limitForFile = isImage ? imageLimitBytes : uploadLimitBytes;
        if (file.size > limitForFile) {
          alert(
            buildUploadFailureMessage(t, file.name, {
              code: 'too_large',
              sizeBytes: file.size,
              maxBytes: limitForFile,
              isPro,
            }, MAX_REQUEST_FILE_BYTES, proUploadLimitBytes)
          );
          continue;
        }

        if (isImage) {
          if (!SUPPORTED_CHAT_IMAGE_MIME_TYPES.includes(file.type)) {
            alert(t('workspace.errors.unsupportedImage', { fileName: file.name, mimeType: file.type || t('workspace.errors.unknownFormat') }));
            continue;
          }

          // 💡 [수정] 예전에는 여기서 /api/upload-quota를 불러 "월간 파일 처리 횟수"를
          // 확인했습니다. 사용량 축이 토큰으로 바뀌면서 그 라우트는 삭제됐습니다 —
          // 이미지 첨부 자체는 토큰을 쓰지 않고(비전 호출은 /api/chat에서 일어남),
          // 실제 소비는 그 채팅 요청 시점에 등급별 토큰 한도가 검사합니다.
          const dataUrl: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error(t('workspace.errors.fileReadFailed')));
            reader.readAsDataURL(file);
          });

          const resizedDataUrl = await resizeImageDataUrl(dataUrl);
          const resizedMimeType = resizedDataUrl === dataUrl ? file.type : 'image/jpeg';
          setChatAttachments(prev => [
            ...prev,
            { id: `${Date.now()}-${file.name}`, name: file.name, kind: 'image', mimeType: resizedMimeType, dataUrl: resizedDataUrl },
          ]);
          recordDocumentUpload(file.name, resizedMimeType);
          continue;
        }

        if (!user) continue;

        try {
          // 💡 [수정] 파일 바이트를 요청 본문에 base64로 싣지 않고, 브라우저에서 Storage로
          // 바로 올린 뒤 경로만 보냅니다 — 그래야 Vercel의 4.5MB 본문 상한을 아예 안 탑니다.
          // 서버는 추출이 끝나면 원본을 지웁니다(app/api/extract).
          const storagePath = await uploadFileToStorage(supabase, user.id, file);
          const res = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              storagePath,
            }),
          });
          // 💡 [수정] 상태·content-type을 먼저 확인합니다. 곧바로 res.json()을 부르면
          // 플랫폼이 돌려준 HTML 413에서 "Unexpected token 'R'"이 튀어나옵니다.
          const { ok, payload: data } = await readUploadResponse(res);
          if (!ok) {
            if (data.limitReached) {
              handleLimitReached(data);
              break;
            }
            alert(buildUploadFailureMessage(t, file.name, data, MAX_REQUEST_FILE_BYTES, proUploadLimitBytes));
            continue;
          }
          setChatAttachments(prev => [
            ...prev,
            { id: `${Date.now()}-${file.name}`, name: file.name, kind: 'text', text: data.text || '' },
          ]);
          recordDocumentUpload(file.name, file.type);
        } catch (err: any) {
          // 💡 Storage 업로드 자체가 실패한 경우는 원인이 다릅니다(용량 정책·네트워크 끊김 등).
          // 서버 응답 실패와 같은 문구로 뭉개면 사용자가 어디서 막혔는지 알 수 없습니다.
          if (err instanceof StorageUploadError) {
            alert(buildUploadFailureMessage(t, file.name, { code: 'storage_upload_failed' }, MAX_REQUEST_FILE_BYTES, proUploadLimitBytes));
          } else {
            alert(t('workspace.errors.attachProcessingFailed', { fileName: file.name, error: err.message || err }));
          }
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

  // 💡 [신규] 유료 전환 준비 — 무료/Pro 한도에 도달했을 때 그냥 막지 않고 "Pro로
  // 업그레이드하기" 요청 폼을 엽니다. contextMessage는 어떤 한도 때문에 열렸는지 보여주고,
  // 그대로 요청 메모 초안으로도 채워집니다(사용자가 그대로 보내도 되고, 고쳐도 됩니다).
  const openUpgradeModal = (contextMessage?: string) => {
    setUpgradeContext(contextMessage ?? null);
    setUpgradeMemo(contextMessage ?? '');
    setUpgradeRequestSubmitted(false);
    setIsUpgradeModalOpen(true);
  };

  const closeUpgradeModal = () => {
    setIsUpgradeModalOpen(false);
    setSocietyCode('');
    setSocietyCodeError(null);
    setSocietyCodeRedeemed(false);
  };

  // 💡 [신규] 소사이어티 코드 입력 제출 — 실제 검증·profiles.is_pro 갱신은 서비스 롤로
  // /api/society-code/redeem이 처리합니다(app/api/society-code/redeem/route.ts,
  // lib/society-codes.ts). 성공하면 이 클라이언트의 isPro 상태도 즉시 true로 반영해
  // 새로고침 없이 사이드바 Pro 배지 등이 바로 갱신되게 합니다.
  // 💡 [신규] 한도 응답(limitReached) 처리를 한 곳으로 모읍니다 — 소사이어티 코드 상한만
  // 다른 안내를 띄워야 하는데, 호출부가 5곳이라 각자 분기하면 한 군데씩 빠뜨리기 쉽습니다.
  const handleLimitReached = (data: { error?: string; limitType?: string }) => {
    if (data.limitType === 'societyCode') {
      setIsSocietyCodeLimitOpen(true);
      return;
    }
    openUpgradeModal(data.error);
  };

  const handleRedeemSocietyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyCode.trim() || isRedeemingSocietyCode) return;
    setIsRedeemingSocietyCode(true);
    setSocietyCodeError(null);
    try {
      const res = await fetch('/api/society-code/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: societyCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSocietyCodeError(data.error || t('upgrade.societyCode.genericError'));
        return;
      }
      setSocietyCodeRedeemed(true);
      setIsPro(true);
      // 💡 [신규] 응답의 expiresAt을 그대로 받아 사이드바 "코드 기간 D-N" 안내에 즉시
      // 반영합니다 — 예전에는 이 값을 버려서, 코드를 막 등록한 사람이 기간을 확인하려면
      // 다음 새로고침까지 기다려야 했습니다.
      if (typeof data.expiresAt === 'string' && data.expiresAt) {
        setUsageSummary((prev) =>
          prev ? { ...prev, proSource: 'code', proExpiresAt: data.expiresAt } : prev
        );
      }
    } catch {
      setSocietyCodeError(t('upgrade.societyCode.genericError'));
    } finally {
      setIsRedeemingSocietyCode(false);
    }
  };

  const handleSubmitUpgradeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !upgradeEmail.trim()) return;
    setIsSubmittingUpgradeRequest(true);
    try {
      const { error } = await supabase.from('pro_requests').insert({
        user_id: user.id,
        email: upgradeEmail.trim(),
        memo: upgradeMemo.trim() || null,
      });
      if (error) {
        alert(t('upgrade.requestSendFailed', { error: error.message }));
        return;
      }
      setUpgradeRequestSubmitted(true);
    } finally {
      setIsSubmittingUpgradeRequest(false);
    }
  };

  // 💡 [신규] 계정 삭제 — 사이드바의 "계정 삭제" 버튼이 부릅니다. /privacy 페이지의 "삭제
  // 요청" 권리를 실제로 실행하는 기능입니다. 확인 창은 한 번만(요청대로) 띄우고, 승인되면
  // 이 계정이 소유한 모든 자료성 테이블을 지웁니다. professors→documents/professor_analysis,
  // documents→doc_chunks는 모두 on delete cascade FK라 professors 하나만 지워도 나머지가
  // 자동으로 따라 지워지지만, 여기서는 각 테이블을 명시적으로 병렬 삭제합니다 — 라이브
  // DB에 마이그레이션이 정확히 반영돼 있다는 가정에 기대지 않고, 어떤 테이블이 비어 있는
  // 상태로 남는지 실패 시 바로 알 수 있게 하기 위해서입니다.
  // 💡 [수정] GDPR 점검 중 발견 — 예전 버전은 여기서 데이터 행만 지우고 로그인 계정
  // (auth.users, profiles 포함)은 그대로 남겨서, "계정 삭제"를 눌러도 같은 이메일/OAuth로
  // 다시 로그인하면 그대로 들어와졌습니다 (버튼 라벨은 "계정 삭제"인데 실제로는 "데이터만
  // 삭제"였던 불일치 — GDPR 삭제 요청 관점에서도 로그인 자격 증명이 남아있으면 불완전합니다).
  // 이제 데이터 행 삭제가 전부 성공한 뒤 /api/account/delete를 호출해 실제 로그인 계정까지
  // 지웁니다. 그 라우트가 서비스 롤 키로 auth.admin.deleteUser()를 부르면 profiles를 포함한
  // 모든 사용자 데이터 테이블이 auth.users를 향한 on delete cascade로 걸려있어 자동으로도
  // 다 지워지지만, 위 명시적 테이블 삭제는 그대로 남겨둡니다 — "라이브 DB의 cascade 설정이
  // 이 저장소의 마이그레이션과 실제로 일치하는지 가정하지 않는다"는 기존 원칙 그대로입니다.
  //
  // 💡 [수정] Pro 구독 중이면 경고 모달을 띄웁니다 — Polar가 Merchant of Record라 우리는
  // 구독 ID를 저장하지도, Polar API로 대신 취소하지도 못합니다(POLAR_ACCESS_TOKEN 자체가
  // 없음). 이 상태로 로그인 계정을 지우면 Polar 결제 구독은 그대로 남아 계속 청구될 수
  // 있습니다 — 하지만 GDPR 삭제권(제17조)은 사업자가 무기한 보류할 수 있는 권리가 아니라서,
  // 예전처럼 서버가 409로 완전히 막는 건 위험할 수 있다는 판단으로 되돌렸습니다. 대신
  // (1) 구독 취소 포털로 바로 갈 수 있는 버튼, (2) "그래도 삭제하겠습니다" 체크박스를
  // 명시적으로 체크해야만 모달 안의 삭제 버튼이 활성화되는 방식으로 바꿨습니다 — 경고는
  // 강하게 보여주되 삭제 자체를 막지는 않습니다. isPro 상태값은 세션 로드 시점에 한 번
  // 가져온 값이라 그 사이 다른 경로(영수증 이메일 링크 등)로 이미 구독을 취소했을 수
  // 있으므로, 여기서 profiles.is_pro를 다시 조회해 최신 값으로 판단합니다.
  const handleDeleteAccount = async () => {
    if (!user) return;

    // 💡 [수정] 여기서도 error를 버리고 있었습니다. 조회가 실패하면 freshProfile이 null이
    // 되어 아래 분기를 그냥 통과하므로, 실제로는 Pro인 사용자가 "구독 먼저 취소하세요"
    // 경고를 못 보고 삭제로 직행할 수 있습니다. 삭제 자체를 막지는 않되(위 GDPR 관련
    // 판단 그대로) 실패했다는 사실은 로그로 남깁니다.
    const { data: freshProfile, error: freshProfileError } = await supabase
      .from('profiles')
      .select('is_pro')
      .eq('id', user.id)
      .single();
    if (freshProfileError) {
      logProfileLookupFailure('handleDeleteAccount', user.id, freshProfileError);
    }
    if (freshProfile?.is_pro) {
      setDeleteAcknowledged(false);
      setIsProDeleteWarningOpen(true);
      return;
    }

    const confirmed = window.confirm(t('account.deleteConfirm'));
    if (!confirmed) return;

    await performAccountDeletion();
  };

  // 💡 [신규] 실제 삭제 실행 — 일반 경로(Pro 아님, window.confirm만 통과)와 Pro 구독 경고
  // 모달에서 체크박스를 체크하고 "계정 삭제"를 누른 경로가 여기로 합류합니다. 두 경로 모두
  // 이 지점에 도달했다는 것 자체가 이미 필요한 확인(네이티브 confirm 또는 모달의 체크박스)을
  // 마쳤다는 뜻이라 여기서 추가 확인 창은 띄우지 않습니다.
  const performAccountDeletion = async () => {
    if (!user) return;

    setIsDeletingAccount(true);
    try {
      const results = await Promise.all([
        supabase.from('doc_chunks').delete().eq('user_id', user.id),
        supabase.from('documents').delete().eq('user_id', user.id),
        supabase.from('professor_analysis').delete().eq('user_id', user.id),
        supabase.from('professors').delete().eq('user_id', user.id),
        supabase.from('logs').delete().eq('user_id', user.id),
        supabase.from('conversation_folders').delete().eq('user_id', user.id),
      ]);
      const firstError = results.find((r) => r.error)?.error;
      if (firstError) {
        alert(t('account.deleteErrorAlert', { error: firstError.message }));
        return;
      }

      const res = await fetch('/api/account/delete', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(t('account.deleteErrorAlert', { error: data.error || res.statusText }));
        return;
      }

      await supabase.auth.signOut();
      router.push('/login');
    } catch (error) {
      alert(t('account.deleteErrorAlert', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const closeProDeleteWarning = () => {
    setIsProDeleteWarningOpen(false);
    setDeleteAcknowledged(false);
  };

  const handleConfirmDeleteWithActiveSubscription = async () => {
    if (!deleteAcknowledged) return;
    setIsProDeleteWarningOpen(false);
    await performAccountDeletion();
  };

  // 💡 [신규] 교수님 새로 등록. 학교/학과는 필수이고, 성공하면 다음 등록 폼의 기본값으로 기억해둡니다
  // (전공 용어·출제 관행 해석에 학교/학과 맥락이 꼭 필요해서 — runProfessorAnalysis 참고).
  // 성공하면 새 교수님의 id를 반환합니다(같은 흐름에서 바로 파일을 올릴 수 있게).
  const handleCreateProfessor = async (name: string, school: string, department: string): Promise<string | null> => {
    if (!user || !name.trim()) return null;
    const trimmedSchool = school.trim();
    const trimmedDepartment = department.trim();
    if (!trimmedSchool || !trimmedDepartment) {
      alert(t('professors.errors.schoolDeptRequired'));
      return null;
    }

    // 💡 [신규] 유료 전환 준비 — 무료 등급은 교수님 1명까지만 등록 가능. 이 액션은
    // professors 테이블에 클라이언트가 직접 insert하는 구조라(서버 라우트를 거치지 않음)
    // 여기서 클라이언트측으로 검사합니다.
    const limits = getPlanLimits(isPro);
    if (professors.length >= limits.maxProfessors) {
      openUpgradeModal(t('professors.upgradeMaxProfessors', { max: limits.maxProfessors, price: PRO_PRICE_LABEL }));
      return null;
    }

    const { data, error } = await supabase
      .from('professors')
      .insert({ user_id: user.id, name: name.trim(), school: trimmedSchool, department: trimmedDepartment })
      .select()
      .single();
    if (error || !data) {
      alert(t('professors.errors.registerFailed', { error: error?.message || t('common.unknownError') }));
      return null;
    }
    setProfessors(prev => [data, ...prev]);

    const defaults = { school: trimmedSchool, department: trimmedDepartment };
    setProfessorFormDefaults(defaults);
    saveUserScopedItem(user.id, 'mcp_professor_defaults', defaults);

    return data.id;
  };

  // 💡 [신규] /api/analyze-professor 호출 + professor_analysis upsert + 에러 처리를 담당하는
  // 공용 헬퍼 — 전체 분석(recomputeProfessorAnalysisFull)과 증분 업데이트
  // (recomputeProfessorAnalysisIncremental)가 이 함수를 공유합니다. documentCountAfter는
  // 이번 분석이 반영하는 시점의 실제 총 자료 개수로, 성공 시 그대로 DB에 기록됩니다.
  //
  // 실패(네트워크 오류·429·OpenAI 오류 등) 시 document_count가 실제 자료 개수와 어긋난 채
  // 조용히 남지 않도록, 한 번 자동으로 재시도하고 그래도 실패하면 화면에 에러를 표시하면서
  // alert로도 즉시 알립니다(자료 올리기는 "교수님" 목록 화면에서도 시작될 수 있어, 상세
  // 화면의 인라인 에러 문구만으로는 그 화면에 있지 않은 사용자가 놓칠 수 있어서입니다).
  const runProfessorAnalysis = async (
    professorId: string,
    requestBody: Record<string, unknown>,
    documentCountAfter: number
  ) => {
    if (!user) return;
    const professor = professors.find(p => p.id === professorId);

    setIsAnalyzingProfessor(true);
    setProfessorAnalysisError(null);

    // 💡 [신규] 문서별 글자 수를 여기서 한 번에 자릅니다. 호출부가 세 곳(증분·전체·수동)이라
    // 각자 자르게 하면 언젠가 한 곳이 빠집니다. 왜 잘라야 하는지는
    // MAX_PROFESSOR_ANALYSIS_DOC_CHARS 주석 참고 — 자르지 않으면 전체 재분석 요청 본문이
    // 플랫폼 상한을 넘겨 우리 코드가 실행되기도 전에 실패합니다.
    const trimmedBody = { ...requestBody };
    for (const key of ['documents', 'newDocuments'] as const) {
      const docs = trimmedBody[key];
      if (!Array.isArray(docs)) continue;
      trimmedBody[key] = docs.map((doc) => {
        const d = doc as { text?: string };
        return typeof d.text === 'string'
          ? { ...d, text: truncateForPrompt(d.text, MAX_PROFESSOR_ANALYSIS_DOC_CHARS) }
          : doc;
      });
    }

    let lastErrorMessage: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch('/api/analyze-professor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trimmedBody),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('professors.errors.updateFailed'));

        const { data: upserted, error } = await supabase
          .from('professor_analysis')
          .upsert(
            { user_id: user.id, professor_id: professorId, result: data.result, document_count: documentCountAfter, updated_at: new Date().toISOString() },
            { onConflict: 'professor_id' }
          )
          .select('professor_id, result, document_count, updated_at')
          .single();
        if (error || !upserted) throw new Error(error?.message || t('professors.errors.saveAnalysisFailed'));

        setProfessorAnalyses(prev => [upserted, ...prev.filter(a => a.professor_id !== professorId)]);
        setIsAnalyzingProfessor(false);
        return;
      } catch (err) {
        lastErrorMessage = err instanceof Error ? err.message : String(err);
      }
    }

    setIsAnalyzingProfessor(false);
    setProfessorAnalysisError(lastErrorMessage);
    alert(
      t('professors.errors.updateFailedAlert', {
        name: professor?.name ?? t('professors.errors.thisProfessorFallback'),
        error: lastErrorMessage ?? '',
      })
    );
  };

  // 💡 [신규] 자료가 추가됐을 때 씁니다. 이미 분석 결과가 있으면 "기존 분석 결과 요약 + 새로
  // 추가된 자료"만 보내 업데이트합니다(전체 자료를 매번 다시 보내지 않아 자료가 쌓일수록
  // 비용이 커지던 문제를 해결). 아직 분석 결과가 없는 교수님(첫 업로드)은 새 자료 자체가
  // 곧 전체 자료이므로 자연스럽게 전체 분석과 동일하게 동작합니다.
  //
  // 💡 이전 시도가 실패해서 professor_analysis.document_count가 실제 자료 개수와 어긋나
  // 있으면(예: "기존 분석 결과"에 반영된 자료 수 ≠ 지금 이 자료를 뺀 나머지 자료 수) 그 위에
  // 증분 업데이트를 쌓지 않고 전체 재분석으로 자동 전환합니다 — 사용자가 수동으로 "이 교수님
  // 분석" 버튼을 누르지 않아도 다음 업로드에서 스스로 어긋남이 바로잡힙니다.
  //
  // 💡 [수정] 자료 목록을 React state(professorDocuments)에서 읽지 않고 인자로 받습니다.
  //
  // 이 함수는 handleUploadProfessorFiles가 **실행 중일 때** 호출되는데, 그 함수는 방금
  // setProfessorDocuments로 새 문서를 넣어둔 상태입니다. 하지만 setState는 재렌더를 예약할
  // 뿐이고, 실행 중인 함수가 클로저로 붙잡은 professorDocuments 값은 절대 바뀌지 않습니다.
  // 그래서 여기서 state를 읽으면 **방금 올린 파일이 빠진 목록**을 보게 됩니다.
  //
  // 그 결과 실제로 이런 일이 벌어지고 있었습니다:
  //   - 첫 업로드: 목록이 비어 있어 아래 Full이 docs.length === 0으로 조용히 반환 → 분석 없음
  //   - 두 번째 업로드: 첫 파일 1개만으로 분석 → "자료 1개로 본 첫인상"
  //   - 이후로도 분석이 영원히 한 발짝씩 뒤처짐
  //   - document_count가 항상 어긋나므로 아래 증분 조건이 한 번도 참이 되지 않음
  //     (= 비용을 아끼려고 만든 증분 경로가 통째로 죽고 매번 더 비싼 Full이 돌고 있었음)
  const recomputeProfessorAnalysisIncremental = async (
    professorId: string,
    newDocs: ProfessorDocument[],
    // 이 교수님의 **업로드 후** 전체 자료 목록. 호출부가 방금 insert한 문서까지 포함해
    // 넘겨줍니다. 생략하면 state에서 읽습니다(회로도 클릭처럼 업로드와 무관한 경로용).
    allDocsOverride?: ProfessorDocument[]
  ) => {
    if (newDocs.length === 0) return;
    const existingAnalysis = professorAnalyses.find(a => a.professor_id === professorId);
    const allDocs = allDocsOverride ?? professorDocuments.filter(d => d.professor_id === professorId);
    const newDocIds = new Set(newDocs.map(d => d.id));
    const previousDocsCount = allDocs.filter(d => !newDocIds.has(d.id)).length;

    if (existingAnalysis && existingAnalysis.document_count === previousDocsCount) {
      const professor = professors.find(p => p.id === professorId);
      await runProfessorAnalysis(
        professorId,
        {
          previousResult: existingAnalysis.result,
          newDocuments: newDocs.map(d => ({ fileName: d.file_name, text: d.content, docType: d.doc_type })),
          professor: professor ? { school: professor.school, department: professor.department } : undefined,
          responseLanguage,
        },
        existingAnalysis.document_count + newDocs.length
      );
      return;
    }

    // 분석 결과가 아예 없거나(첫 업로드), 있어도 자료 수가 어긋나 있으면(이전 실패 흔적)
    // 안전하게 전체 자료로 다시 분석합니다. 여기도 state가 아니라 방금 만든 목록을 넘깁니다.
    await recomputeProfessorAnalysisFull(professorId, allDocs);
  };

  // 💡 [수정] 자료를 삭제했을 때, 또는 회로도/버튼에서 수동으로 다시 분석할 때 씁니다. 이
  // 교수님의 자료 전체를 처음부터 다시 분석합니다 — 삭제는 "빼는" 방향이라 증분 업데이트로는
  // 정확히 반영하기 어렵고(어떤 근거가 삭제된 자료에서 나온 건지 모델이 구분할 수 없음),
  // 수동 재분석은 증분 업데이트가 실패로 쌓여 어긋났을 때 되돌릴 수 있는 복구 수단이기도
  // 합니다. docsOverride는 삭제 직후처럼 professorDocuments state가 아직 최신 반영 전일 때
  // 정확한 자료 목록을 넘기기 위함입니다.
  const recomputeProfessorAnalysisFull = async (professorId: string, docsOverride?: ProfessorDocument[]) => {
    const docs = docsOverride ?? professorDocuments.filter(d => d.professor_id === professorId);
    // 💡 [수정] 예전에는 여기서 그냥 `return`했습니다. 자료가 0개면 분석할 게 없는 게 맞지만,
    // 실제로는 클로저가 낡아서 방금 올린 파일이 안 보이던 상황이 이 조용한 반환에 묻혀
    // "첫 업로드에는 아무 일도 안 일어남"으로 나타났습니다 — 에러도 로그도 없이요.
    // 자료를 지워서 0개가 된 경우는 호출부가 professor_analysis 행 자체를 지우므로 여기까지
    // 오지 않습니다. 즉 여기 도달했다는 건 정상 경로가 아니라는 뜻이라, 화면에 남깁니다.
    if (docs.length === 0) {
      console.error(`[professor-analysis] 분석할 자료가 없습니다 (professor ${professorId})`);
      setProfessorAnalysisError(t('professors.errors.noDocumentsToAnalyze'));
      return;
    }
    const professor = professors.find(p => p.id === professorId);

    await runProfessorAnalysis(
      professorId,
      {
        documents: docs.map(d => ({ fileName: d.file_name, text: d.content, docType: d.doc_type })),
        professor: professor ? { school: professor.school, department: professor.department } : undefined,
        responseLanguage,
      },
      docs.length
    );
  };

  // 💡 [신규] 교수님 탭 요약·핵심정리 — 채팅창이 쓰는 것과 완전히 같은 경로(/api/analyze의
  // digest 렌즈, lib/lenses.ts의 "핵심 정리")를 그대로 호출합니다. 새 프롬프트나 새 라우트를
  // 만들지 않은 이유는 그 렌즈의 anti-hallucination 규칙(COMMON_RULES, 근거 없는 항목 드롭)이
  // 이미 잘 튜닝돼 있어서, 같은 일을 하는 두 번째 구현을 만들면 드리프트만 생기기 때문입니다.
  // 속도 제한·월 사용량·크기 상한도 그 라우트에 이미 붙어 있어 그대로 적용됩니다.
  const runAnalyzeRequest = async (
    text: string,
    fileName: string,
    lens: LensId,
    professorContext?: string,
    avoidQuestions?: string[]
  ): Promise<unknown> => {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, fileName, lens, responseLanguage, professorContext, avoidQuestions }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.limitReached) handleLimitReached(data);
      throw new Error(data.error || t('workspace.errors.analyzeFailed'));
    }
    return data.result;
  };

  const runDigest = async (text: string, fileName: string): Promise<DigestResult> =>
    (await runAnalyzeRequest(text, fileName, 'digest')) as DigestResult;

  // 💡 [신규] 고른 교수님의 자료 전체를 이어붙여 한 번만 호출합니다. 문서마다 따로 부르는
  // 것보다 호출 횟수·비용이 훨씬 적고, 여러 자료를 가로지르는 결과를 뽑는 데도 이쪽이
  // 맞습니다(길이는 /api/analyze가 서버에서 truncateForPrompt로 잘라냅니다).
  //
  // 💡 이 교수님의 professor_analysis 결과가 있으면 성향 블록으로 만들어 함께 보냅니다 —
  // 이게 없으면 "교수님을 고른다"는 행위가 사실상 파일 묶음을 고르는 것에 지나지 않아,
  // 같은 파일을 그냥 채팅에 첨부한 것과 결과가 똑같아집니다. 분석 결과가 아직 없거나
  // 모든 카테고리가 confident: false면 buildProfessorContext가 빈 문자열을 돌려주고,
  // 그때는 평소 렌즈 분석과 동일하게 동작합니다(기능이 막히지는 않습니다).
  const handleGenerateFromProfessor = async (lens: LensId) => {
    const professorId = professorGenProfessorId;
    if (!professorId) return;
    const docs = professorDocuments.filter((d) => d.professor_id === professorId);
    if (docs.length === 0) return;
    const professor = professors.find((p) => p.id === professorId);
    const analysisRow = professorAnalyses.find((a) => a.professor_id === professorId);

    setProfessorGenLens(lens);
    setProfessorGenResult(null);
    setProfessorGenError(null);
    setIsGeneratingFromProfessor(true);
    try {
      const combined = docs.map((d) => `[${d.file_name}]\n${d.content}`).join('\n\n---\n\n');
      const professorContext = buildProfessorContext({
        result: analysisRow?.result,
        professorName: professor?.name,
        school: professor?.school,
        department: professor?.department,
      });
      // 💡 [신규] 예상 시험 문제만 "이미 낸 문항"을 함께 보내 중복을 피합니다. 다른 관점
      // (요약·예상 질문)은 다시 눌렀을 때 같은 결과가 나오는 게 오히려 자연스러워서 그대로 둡니다.
      const avoidQuestions = lens === 'examQuestions' ? examQuestionHistory[professorId] : undefined;
      const result = await runAnalyzeRequest(
        combined,
        professor?.name || 'professor',
        lens,
        professorContext,
        avoidQuestions
      );
      setProfessorGenResult(result as DigestResult | QuestionsResult | ExamQuestionsResult);

      // 방금 낸 문항을 기억해둡니다 — 문항 전문이 아니라 한 줄 요약(question 앞부분)만
      // 담아서, 재생성을 반복해도 프롬프트가 눈덩이처럼 커지지 않게 합니다.
      if (lens === 'examQuestions') {
        const items = (result as ExamQuestionsResult)?.items ?? [];
        const summaries = items
          .map((it) => (it?.question || '').trim().replace(/\s+/g, ' ').slice(0, MAX_AVOID_QUESTION_CHARS))
          .filter((q) => q.length > 0);
        if (summaries.length > 0) {
          setExamQuestionHistory((prev) => {
            const merged = [...(prev[professorId] ?? []), ...summaries];
            // 오래된 것부터 버리고 최근 MAX_AVOID_QUESTIONS개만 유지합니다.
            const trimmed = merged.slice(-MAX_AVOID_QUESTIONS);
            const next = { ...prev, [professorId]: trimmed };
            if (user) saveUserScopedItem(user.id, 'mcp_exam_question_history', next);
            return next;
          });
        }
      }
    } catch (err) {
      setProfessorGenError(err instanceof Error ? err.message : t('workspace.errors.analyzeErrorFallback'));
    } finally {
      setIsGeneratingFromProfessor(false);
    }
  };

  // 문서별 요약 — 자료 목록에서 개별 문서 하나만 요약합니다. 이미 만들어둔 요약이 있으면
  // 다시 호출하지 않고 접기/펴기만 합니다(불필요한 유료 호출 방지).
  const handleDigestProfessorDocument = async (doc: ProfessorDocument, professorId: string) => {
    if (professorDocDigests[doc.id]) {
      setProfessorDocDigests((prev) => {
        const next = { ...prev };
        delete next[doc.id];
        return next;
      });
      return;
    }
    setDigestingDocId(doc.id);
    setProfessorDocDigestError(null);
    try {
      const result = await runDigest(doc.content, doc.file_name);
      setProfessorDocDigests((prev) => ({ ...prev, [doc.id]: result }));
    } catch (err) {
      setProfessorDocDigestError({
        professorId,
        message: err instanceof Error ? err.message : t('workspace.errors.analyzeErrorFallback'),
      });
    } finally {
      setDigestingDocId(null);
    }
  };

  // 💡 [신규] 파일에서 글자를 뽑아(/api/extract) documents 테이블에 저장하고, doc_chunks로도 쪼개
  // 저장합니다. 텍스트를 못 뽑는 형식(예: 이미지)은 안내만 하고 건너뜁니다. 하나라도 성공하면
  // 이 교수님 분석을 자동으로 다시 계산해 예전 결과가 남아있지 않게 합니다.
  const handleUploadProfessorFiles = async (fileList: FileList | File[], professorId: string, docType: string) => {
    const filesToUpload = Array.from(fileList);
    if (filesToUpload.length === 0 || !user) return;

    // 💡 [신규] 유료 전환 준비 — 무료 등급은 교수님 1명당 자료 개수도 제한됩니다. 이 값이
    // 아래 기술적 상한(MAX_PROFESSOR_DOCUMENTS, 비용 보호용)보다 작으므로 무료 등급은
    // 이 검사에 먼저 걸립니다. Pro는 무제한(Infinity)이라 이 검사를 통과하고 기술적
    // 상한만 적용됩니다.
    const existingCount = professorDocuments.filter(d => d.professor_id === professorId).length;
    const limits = getPlanLimits(isPro);
    if (existingCount + filesToUpload.length > limits.maxDocumentsPerProfessor) {
      openUpgradeModal(t('professors.upgradeMaxDocuments', { max: limits.maxDocumentsPerProfessor, price: PRO_PRICE_LABEL }));
      return;
    }
    if (existingCount + filesToUpload.length > MAX_PROFESSOR_DOCUMENTS) {
      alert(t('professors.errors.docLimitReached', { max: MAX_PROFESSOR_DOCUMENTS, count: existingCount }));
      return;
    }

    setIsUploadingProfessorDoc(true);
    const newlyInserted: ProfessorDocument[] = [];
    // 💡 [신규] 업로드 전 이 교수님의 자료 목록을 여기서 미리 떠둡니다. 아래에서
    // setProfessorDocuments를 부르더라도 이 함수가 붙잡고 있는 professorDocuments 값은
    // 바뀌지 않으므로, 재계산에 넘길 "업로드 후 전체 목록"을 직접 만들어야 합니다
    // (recomputeProfessorAnalysisIncremental 주석 참고).
    const docsBeforeUpload = professorDocuments.filter(d => d.professor_id === professorId);
    try {
      for (const file of filesToUpload) {
        if (file.size > uploadLimitBytes) {
          alert(
            buildUploadFailureMessage(t, file.name, {
              code: 'too_large',
              sizeBytes: file.size,
              maxBytes: uploadLimitBytes,
              isPro,
            }, MAX_REQUEST_FILE_BYTES, proUploadLimitBytes)
          );
          continue;
        }

        try {
          // 💡 [수정] 채팅 첨부와 같은 이유로 Storage 직접 업로드로 바꿨습니다 — 강의자료는
          // 채팅에 붙이는 파일보다 크기가 큰 경우가 많아, 예전 방식에서는 여기가 가장 자주
          // 막히는 지점이었습니다(등급 상한과 무관하게 3.2MB 남짓에서 실패).
          const storagePath = await uploadFileToStorage(supabase, user.id, file);
          const res = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              storagePath,
            }),
          });
          // 💡 [수정] 상태·content-type을 먼저 확인합니다. 곧바로 res.json()을 부르면
          // 플랫폼이 돌려준 HTML 413에서 "Unexpected token 'R'"이 튀어나옵니다.
          const { ok, payload: data } = await readUploadResponse(res);
          if (!ok) {
            if (data.limitReached) {
              handleLimitReached(data);
              break;
            }
            alert(buildUploadFailureMessage(t, file.name, data, MAX_REQUEST_FILE_BYTES, proUploadLimitBytes));
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
            alert(t('professors.errors.docSaveFailed', { fileName: file.name, error: error?.message || t('common.unknownError') }));
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
          if (err instanceof StorageUploadError) {
            alert(buildUploadFailureMessage(t, file.name, { code: 'storage_upload_failed' }, MAX_REQUEST_FILE_BYTES, proUploadLimitBytes));
            continue;
          }
          const message = err instanceof Error ? err.message : String(err);
          alert(t('workspace.errors.attachProcessingFailed', { fileName: file.name, error: message }));
        }
      }
    } finally {
      setIsUploadingProfessorDoc(false);
    }

    if (newlyInserted.length > 0) {
      // 방금 올린 문서까지 포함한 "업로드 후" 전체 목록을 함께 넘깁니다 — 이게 없으면
      // 재계산이 방금 올린 파일을 못 보고 한 발짝 뒤처진 결과를 만듭니다.
      await recomputeProfessorAnalysisIncremental(professorId, newlyInserted, [
        ...newlyInserted,
        ...docsBeforeUpload,
      ]);
    }
  };

  // 💡 [신규] 파일 없이 교수님만 먼저 등록합니다. 예전에는 이 패널의 유일한 실행 버튼이
  // "파일 선택"이라, 교수님을 만들려면 반드시 파일을 하나 골라야 했습니다 — 자료가 아직
  // 없거나 나중에 올리고 싶은 사람은 교수님 자체를 만들 수 없었습니다.
  // 자료 0개인 교수님은 분석 결과도 0개라 화면에서는 "아직 파악된 게 없어요" 상태로
  // 자연스럽게 표시되고, 채팅의 교수님 선택에서도 자료 0개로 그대로 나타납니다.
  const handleCreateProfessorOnly = async () => {
    if (!newProfessorName.trim()) {
      alert(t('professors.errors.nameRequired'));
      return;
    }
    setIsCreatingProfessor(true);
    try {
      const createdId = await handleCreateProfessor(newProfessorName, newProfessorSchool, newProfessorDepartment);
      if (!createdId) return;
      // 만든 교수님을 바로 선택 상태로 둬서, 이어서 자료를 올리려면 그대로 파일만 고르면 됩니다.
      setUploadProfessorChoice(createdId);
      setNewProfessorName('');
      setNewProfessorSchool('');
      setNewProfessorDepartment('');
    } finally {
      setIsCreatingProfessor(false);
    }
  };

  // 💡 [신규] 교수님 목록 화면의 "자료 올리기" 패널 전용 — 기존 교수님을 고르거나, "새 교수님 등록"을
  // 고른 뒤 이름을 입력하면 그 자리에서 등록하고 바로 그 교수님에게 파일을 올립니다.
  const handleProfessorUploadPanelFiles = async (fileList: FileList) => {
    if (fileList.length === 0) return;

    let professorId = uploadProfessorChoice;
    if (professorId === '__new__') {
      if (!newProfessorName.trim()) {
        alert(t('professors.errors.nameRequired'));
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
      alert(t('professors.errors.selectProfessorFirst'));
      return;
    }
    await handleUploadProfessorFiles(fileList, professorId, uploadDocType);
  };

  // 💡 [신규] 자료 삭제 — documents에서 지우면 doc_chunks는 on delete cascade로 함께 지워집니다.
  // 남은 자료가 있으면 분석을 다시 계산하고, 하나도 안 남으면 분석 결과 자체를 지웁니다.
  const handleDeleteProfessorDocument = async (docId: string, professorId: string) => {
    const { error } = await supabase.from('documents').delete().eq('id', docId);
    if (error) {
      alert(t('professors.errors.docDeleteFailed', { error: error.message }));
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
    await recomputeProfessorAnalysisFull(professorId, remaining);
  };

  // 💡 [신규] 교수님 자체를 삭제 — documents/doc_chunks/professor_analysis는 모두 professor_id에
  // on delete cascade로 걸려있어 DB에서 함께 정리됩니다(supabase/migrations/20260727_...,
  // 20260728_...). 되돌릴 수 없는 작업이라(등록된 자료가 전부 함께 사라짐) 확인을 한 번 거칩니다.
  const handleDeleteProfessor = async (professorId: string, professorName: string) => {
    if (!window.confirm(t('professors.deleteConfirm', { name: professorName }))) {
      return;
    }
    const { error } = await supabase.from('professors').delete().eq('id', professorId);
    if (error) {
      alert(t('professors.errors.professorDeleteFailed', { error: error.message }));
      return;
    }
    setProfessors(prev => prev.filter(p => p.id !== professorId));
    setProfessorDocuments(prev => prev.filter(d => d.professor_id !== professorId));
    setProfessorAnalyses(prev => prev.filter(a => a.professor_id !== professorId));
    setSelectedProfessorId(null);
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

    // 💡 사용자가 직접 보낸 요청은 위로 올라가 있었더라도 따라가기를 다시 켭니다 —
    // 자기가 방금 보낸 질문과 그 답이 화면 밖에서 흘러가면 오히려 이상합니다.
    setIsNearBottom(true);
    setStreamingLog(header);
    setIsAwaitingChatResponse(true);
    // 전송한 그 순간 답변 영역으로 한 번 이동합니다(진행 중인지 바로 보이도록).
    // 다음 프레임에 호출해야 위 setState로 패널이 그려진 뒤의 위치로 이동합니다.
    requestAnimationFrame(() => scrollToResponsePanel('chat'));
    // 새 질문을 보내는 순간 직전 대화의 "폴더에 넣기"는 대상이 아니게 됩니다.
    setLastSavedLogId(null);

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
          token,
          responseLanguage,
          // 💡 [신규] "교수님 자료로 만들기"에서 고른 교수님을 채팅에도 함께 보냅니다.
          // 예전엔 이 선택이 /api/analyze 경로에만 쓰여서, 교수님을 골라둔 채로 채팅에
          // 질문하면 서버는 그 사실을 전혀 몰랐습니다(프롬프트에 이름을 직접 적어야만
          // 그 교수님 자료가 실렸음). 이제 선택돼 있으면 이름 언급 여부와 무관하게
          // 그 교수님 자료를 배경 정보로 씁니다.
          professorId: professorGenProfessorId,
          folderId: chatFolderId,
        }),
      });

      if (!res.ok) {
        // 에러 응답은 이전처럼 JSON 형태로 옵니다.
        const errData = await res.json().catch(() => ({ error: t('workspace.errors.unknownError') }));
        aiAnswer = t('workspace.errors.requestFailed', { error: errData.error });
        setStreamingLog(header + aiAnswer);
        setIsAwaitingChatResponse(false);
        // 💡 [신규] 유료 전환 준비 — 월간 채팅 한도 도달은 그냥 막지 않고 업그레이드 요청
        // 폼을 바로 띄웁니다.
        if (errData.limitReached) {
          handleLimitReached(errData);
        }
      } else if (res.body) {
        // 💡 [속도 개선] 답변을 다 기다리지 않고, 도착하는 대로 바로바로 화면에 이어붙입니다.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          aiAnswer += decoder.decode(value, { stream: true });
          setStreamingLog(header + aiAnswer);
          setIsAwaitingChatResponse(false); // 첫 청크가 도착하면(빈 청크라도) 로딩 문구를 내림
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
      aiAnswer = t('workspace.errors.networkError', { error: err.message || err });
      setStreamingLog(header + aiAnswer);
    }

    setIsExecuting(false);
    setIsAwaitingChatResponse(false); // 안전망 — 위 분기 어디서든 못 내렸으면 여기서 확실히 내림

    try {
      const { data, error } = await supabase
        .from('logs')
        .insert([{
          user_id: user.id,
          content: `[Prompt] ${currentCommand}`,
          response: aiAnswer,
          status: 'SUCCESS',
          // 💡 [신규] 어떤 교수님을 선택한 상태에서 나눈 대화인지 함께 남깁니다(미선택이면 null).
          // 다음 요청의 "최근 대화 기록"을 이 값으로 좁혀서, 다른 교수님 얘기가 섞여 들어오지
          // 않게 하는 데 씁니다(app/api/chat/route.ts).
          professor_id: professorGenProfessorId,
          // 💡 [신규] 선택한 주제 폴더(미선택이면 null). professor_id와 같은 용도입니다 —
          // 다음 요청의 최근 대화 기록을 이 폴더 대화로 좁히는 데 씁니다.
          folder_id: chatFolderId,
        }])
        .select()
        .single();

      // 💡 [수정] 저장 실패를 조용히 버리지 않습니다.
      //
      // 이전 코드는 `if (!error && data)`로 성공만 처리하고 error를 그대로 흘려보냈습니다.
      // 그래서 logs 테이블에 professor_id 컬럼이 없던 기간 동안 **모든 대화 저장이 실패하고
      // 있었는데도** 화면에는 아무 표시가 없었습니다. 답변은 정상적으로 스트리밍돼 보이니
      // 사용자는 저장된 줄 알았고, 폴더 기능이 동작하지 않는 걸 보고서야 알아챘습니다.
      //
      // 저장 실패는 사용자가 알아야 하는 일입니다 — 이 대화는 새로고침하면 사라지고,
      // 폴더·교수님 맥락에도 쌓이지 않습니다.
      if (error || !data) {
        console.error('대화 저장 실패:', error);
        setLogSaveError(error?.message || t('common.unknownError'));
      } else {
        setLogSaveError(null);
        setLogs(prev => [data, ...prev]);
        // 답변 직후 폴더에 넣을 수 있도록 방금 저장된 대화 id를 기억합니다.
        setLastSavedLogId(data.id);
        fetchUsageSummary();
      }
    } catch (dbErr) {
      console.error('로그 저장 중 오류 발생:', dbErr);
      setLogSaveError(dbErr instanceof Error ? dbErr.message : String(dbErr));
    }
  };

  const handleAddFile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;

    const newFile: FileItem = {
      id: Date.now().toString(),
      name: newFileName,
      size: `${(newFileContent.length / 1024).toFixed(1)} KB`,
      content: newFileContent || t('monitoring.emptyContentPlaceholder'),
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
      alert(t('logs.errors.logDeleteFailed', { error: err.message || err }));
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
        alert(t('logs.errors.folderCreateFailed', { error: error?.message || t('common.unknownError') }));
        return;
      }
      setConversationFolders(prev => [data, ...prev]);
      setNewFolderName('');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // 💡 [신규] 폴더 삭제 — 폴더 안의 대화는 지워지지 않고 미분류로 돌아갑니다(DB의
  // logs.folder_id on delete set null과 동일하게, 화면에도 즉시 반영되도록 로컬 logs
  // state의 folder_id를 직접 null로 갱신합니다). 지금 이 폴더로 필터링 중이었다면 "전체"로
  // 되돌립니다 — 안 그러면 존재하지 않는 폴더로 필터링된 빈 화면이 남습니다.
  const handleDeleteFolder = async (folderId: string, folderName: string) => {
    if (!window.confirm(t('logs.deleteFolderConfirm', { folderName }))) {
      return;
    }
    const { error } = await supabase.from('conversation_folders').delete().eq('id', folderId);
    if (error) {
      alert(t('logs.errors.folderDeleteFailed', { error: error.message }));
      return;
    }
    setConversationFolders(prev => prev.filter(f => f.id !== folderId));
    setLogs(prev => prev.map(log => (log.folder_id === folderId ? { ...log, folder_id: null } : log)));
    setLogFolderFilter(prev => (prev === folderId ? 'all' : prev));
  };

  // 💡 [신규] 대화를 폴더로 옮기기(또는 미분류로 되돌리기, folderId === null).
  const handleMoveLogToFolder = async (logId: string, folderId: string | null) => {
    const { error } = await supabase.from('logs').update({ folder_id: folderId }).eq('id', logId);
    if (error) {
      alert(t('logs.errors.moveToFolderFailed', { error: error.message }));
      return;
    }
    setLogs(prev => prev.map(log => (log.id === logId ? { ...log, folder_id: folderId } : log)));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > uploadLimitBytes) {
      alert(
        buildUploadFailureMessage(t, file.name, {
          code: 'too_large',
          sizeBytes: file.size,
          maxBytes: uploadLimitBytes,
          isPro,
        }, MAX_REQUEST_FILE_BYTES, proUploadLimitBytes)
      );
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
      alert(t('monitoring.errors.unsupportedFormat'));
      e.target.value = '';
    }
  };

  // 💡 [신규] 채팅에 첨부된 문서(latestTextAttachment)의 글자로 지정한 관점(lens)을 분석합니다.
  // 관점 전환 버튼과 "전송" 버튼(handleExecute)이 공유하는 경로입니다.
  const runLensAnalyze = async (text: string, lens: LensId, fileName?: string) => {
    // 렌즈 분석도 결과가 화면 아래에 그려지므로 전송 시점에 한 번 이동합니다.
    requestAnimationFrame(() => scrollToResponsePanel('lens'));
    setLensId(lens);
    setLensStage('analyzing');
    setLensError(null);
    setRegisteredDeadlineIndexes(new Set());

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, fileName, lens, responseLanguage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('workspace.errors.analyzeFailed'));

      setLensResult(data.result);
      setLensStage('done');
    } catch (err: any) {
      setLensError(err.message || t('workspace.errors.analyzeErrorFallback'));
      setLensStage('error');
    }
  };

  // 💡 [신규] 관점 전환 버튼 — 이미 분석한 문서를 재추출 없이 다른 관점으로 다시 봅니다.
  const chatLensActionsRow = lensId && lensStage !== 'idle' && (
    <div className="flex flex-wrap items-center gap-2">
      {CIRCUIT_LENS_IDS
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
              className="inline-flex items-center gap-1.5 bg-[var(--bg-page)] hover:bg-[var(--surface-chip)] border border-[var(--border-default)] hover:border-[#F4679B]/50 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-[13px] sm:text-xs font-medium px-3.5 py-2.5 sm:py-2 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
            >
              {meta && <meta.icon className="w-3.5 h-3.5 text-[#F4679B] shrink-0" strokeWidth={2} />}
              {meta && t('workspace.viewAsLens', { label: meta.label })}
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
      course: t('workspace.meetingNotesCourseLabel'),
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
    course: t('workspace.lensRegisterCourseLabel', { date: item.date }),
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
    if (diffMs < 0) return { label: t('deadlines.badgeOverdue'), urgency: 'overdue' as const };

    const diffDays = getCalendarDayDiff(dueAt);
    if (diffDays <= 0) return { label: 'D-DAY', urgency: 'critical' as const };
    if (diffDays <= 3) return { label: `D-${diffDays}`, urgency: 'high' as const };
    if (diffDays <= 7) return { label: `D-${diffDays}`, urgency: 'medium' as const };
    return { label: `D-${diffDays}`, urgency: 'low' as const };
  };

  const urgencyStyles: Record<string, string> = {
    overdue: 'bg-[var(--surface-chip)] text-[var(--text-tertiary)] border-[var(--border-default)]',
    critical: 'bg-[var(--bg-error-subtle)] text-[var(--text-error)] border-[var(--border-error-subtle)]',
    high: 'bg-[var(--bg-warn-subtle)] text-[var(--text-warn)] border-[var(--border-warn-subtle)]',
    medium: 'bg-[var(--bg-accent-subtle)] text-[#F4679B] border-[var(--border-accent-subtle)]',
    low: 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-default)]',
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

  const kpiTiles = [
    { label: t('deadlines.kpi.total'), icon: '⏰', value: deadlines.length },
    { label: t('deadlines.kpi.thisWeek'), icon: '📅', value: upcomingWeekCount },
    { label: t('deadlines.kpi.overdue'), icon: '⚠️', value: overdueDeadlinesCount, emphasize: overdueDeadlinesCount > 0 },
    { label: t('deadlines.kpi.files'), icon: '📁', value: files.length },
  ];

  const urgencyBuckets = [
    { key: 'overdue', label: t('deadlines.urgency.overdue'), color: 'var(--text-muted)' },
    { key: 'critical', label: t('deadlines.urgency.critical'), color: 'var(--accent-danger)' },
    { key: 'high', label: t('deadlines.urgency.high'), color: '#FFD97D' },
    { key: 'medium', label: t('deadlines.urgency.medium'), color: '#F4679B' },
    { key: 'low', label: t('deadlines.urgency.low'), color: '#6EE7B7' },
  ];
  const urgencyCounts = deadlines.reduce((acc, d) => {
    const { urgency } = getDDayInfo(d.dueAt);
    acc[urgency] = (acc[urgency] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const maxUrgencyCount = Math.max(0, ...urgencyBuckets.map((b) => urgencyCounts[b.key] || 0));

  // 💡 [수정] 예전엔 번역된 라벨 문자열 자체를 그룹핑 키로 썼는데, 로케일마다 문자열이
  // 달라지는 값을 키로 쓰는 건 불안정해서 안정적인 영어 키(overdue/thisWeek/...)로
  // 분리했습니다 — 라벨은 timelineBuckets에서 그 키로 t()를 조회해 표시만 담당합니다.
  const getTimelineBucketKey = (dueAt: string) => {
    if (new Date(dueAt).getTime() < nowTs) return 'overdue';
    const diffDays = getCalendarDayDiff(dueAt);
    if (diffDays <= 7) return 'thisWeek';
    if (diffDays <= 14) return 'nextWeek';
    if (diffDays <= 21) return 'in2Weeks';
    return 'in3PlusWeeks';
  };
  const timelineCountMap = deadlines.reduce((acc, d) => {
    const key = getTimelineBucketKey(d.dueAt);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const timelineBuckets = (['overdue', 'thisWeek', 'nextWeek', 'in2Weeks', 'in3PlusWeeks'] as const).map((key) => ({
    key,
    label: t(`deadlines.timelineBuckets.${key}`),
    count: timelineCountMap[key] || 0,
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
      const key = d.course?.trim() || t('records.deadlinesCard.noCategory');
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
    { key: 'excel', label: t('records.documentsCard.formats.excel'), icon: '📊' },
    { key: 'hwp', label: t('records.documentsCard.formats.hwp'), icon: '📃' },
    { key: 'ppt', label: t('records.documentsCard.formats.ppt'), icon: '📽️' },
    { key: 'word', label: t('records.documentsCard.formats.word'), icon: '📝' },
    { key: 'pdf', label: t('records.documentsCard.formats.pdf'), icon: '📕' },
    { key: 'image', label: t('records.documentsCard.formats.image'), icon: '🖼️' },
  ].map((f) => ({ ...f, count: fileFormatCounts[f.key] || 0 }));
  const etcFileCount = fileFormatCounts['etc'] || 0;

  const docTypeDefs = DOC_TYPE_KEYS.map((key) => ({ key, label: t(`professors.docType.${key}`) }));
  const docTypeLabels: Record<string, string> = Object.fromEntries(docTypeDefs.map((d) => [d.key, d.label]));

  const professorCategoryDefs = PROFESSOR_CATEGORY_KEYS.map((key) => ({ key, label: t(`professors.category.${key}`) }));
  const professorCircuitDefs = PROFESSOR_CIRCUIT_NODE_DEFS.map((def) => ({
    ...def,
    label: t(`professors.circuit.${def.nodeId}`),
  }));
  const getProfessorAnalysisFramingLine = (count: number): string => {
    if (count <= 1) return t('professors.framing.first');
    if (count <= 3) return t('professors.framing.some', { count });
    return t('professors.framing.clear', { count });
  };

  const NAV_ITEMS = [
    { id: 'workspace', label: t('nav.workspace'), icon: Sparkles },
    { id: 'records', label: t('nav.records'), icon: Archive },
    { id: 'deadlines', label: t('nav.deadlines'), icon: AlarmClock },
    { id: 'professors', label: t('nav.professors'), icon: GraduationCap },
    { id: 'monitoring', label: t('nav.monitoring'), icon: LineChart },
    { id: 'logs', label: t('nav.logs'), icon: ScrollText },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-surface)] flex items-center justify-center">
        <style jsx global>{`
          @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
          * { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
        `}</style>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-[var(--border-default)] border-t-[#F4679B] rounded-full animate-spin" />
          <span className="text-sm text-[var(--text-tertiary)]">{t('app.loadingSession')}</span>
        </div>
      </div>
    );
  }

  return (
    <>
    {/* 💡 [수정] 예전에는 min-h-screen이라 내용이 길어지면 루트가 통째로 늘어나고 문서
        전체가 스크롤됐습니다. 그래서 AI 답변이 길어질수록 왼쪽 사이드바까지 같이 위로
        끌려 올라갔고, 아래 자동 스크롤도 문서를 움직여 화면 전체가 튀었습니다.
        높이를 화면에 고정하고 스크롤을 각 영역(사이드바/본문) 안으로 넣습니다.
        100vh 대신 100dvh를 쓰는 이유는 모바일 브라우저의 주소창이 접혔다 펴질 때
        100vh가 실제 보이는 높이와 어긋나기 때문입니다. */}
    <div className="h-[100dvh] bg-[var(--bg-surface)] text-[var(--text-primary)] flex flex-col md:flex-row">
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
      <div className="md:hidden flex items-center justify-between bg-[var(--bg-page)] border-b border-[var(--border-default)] px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-[15px] text-[var(--text-primary)] tracking-tight">Carrotly</span>
          {/* 💡 [수정] 예전엔 무료 사용자에게도 이 배지가 떴고, Pro와의 차이가
              {isPro ? 'PRO' : 'Pro'} — 즉 대소문자뿐이라 사실상 구분이 불가능했습니다
              (테두리·색·크기가 전부 동일). 이제 Pro일 때만 렌더링합니다. */}
          {isPro && (
            <button
              type="button"
              onClick={() => openUpgradeModal()}
              className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border border-[#F4679B]/50 text-[#F4679B] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
            >
              PRO
            </button>
          )}
        </div>
        {/* 💡 [신규] 데스크톱 사이드바 헤더의 LocaleSwitcher는 md:flex 행 안에 있어 모바일에선
            햄버거 메뉴를 열어도 안 보였습니다 — "헤더에 언어 선택기 항상 노출" 요건을
            모바일에서도 만족시키려면 이 상단 바에도 따로 둬야 합니다. */}
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={t('common.openMenu')}
            className="text-[var(--text-primary)] text-xl p-1.5 rounded-lg hover:bg-[var(--bg-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
          >
            {isMobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* 사이드바 메뉴 */}
      <div className={`
        ${isMobileMenuOpen ? 'flex' : 'hidden'} md:flex
        w-full md:w-64 bg-[var(--bg-page)] border-r border-[var(--border-default)] flex-col shrink-0
        overflow-y-auto
        z-50
      `}>
        {/* 💡 [수정] 예전에는 브랜드 묶음과 LocaleSwitcher가 한 줄에서 justify-between으로
            마주보고 있었는데, 사이드바 폭(w-64 = 256px, px-6을 빼면 208px)에 다 들어가지
            않았습니다. 언어 선택 <select>는 가장 긴 옵션에 맞춰 폭이 정해져서(한국어가
            아니라 "Nederlands" 기준 104px) 로고+워드마크+PRO 배지와 합치면 223px —
            PRO 사용자에게만 15px 넘쳐서 드롭다운 오른쪽이 사이드바 밖으로 삐져나왔습니다.
            무료 사용자는 배지가 없어 1px 차이로 겨우 들어가 있던 상태라, 같은 줄을 유지하는
            한 언제 깨져도 이상하지 않았습니다.

            셀렉트 폭을 고정해 같은 줄에 욱여넣는 안도 재봤지만, 그러면 "Nederlands"·
            "Português" 같은 긴 언어명이 잘리거나 워드마크가 "Carr…"로 잘립니다. 언어 선택기를
            아래 줄로 내려 오른쪽 정렬하면 셀렉트가 원래 폭을 그대로 쓰면서 어떤 언어를 골라도
            잘리지 않고, 앞으로 언어가 더 늘어도 이 줄이 다시 깨지지 않습니다. */}
        <div className="hidden md:flex px-6 py-5 flex-col gap-3 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-2.5 text-[#F4679B] min-w-0">
            {/* 💡 로그인 화면 큰 마스코트와 동일한 흰색 원형 배경 패턴 — 이 사이드바도
                bg-[var(--bg-page)] 어두운 배경이라 같은 처리를 적용합니다. */}
            <div className="shrink-0 w-7 h-7 rounded-full bg-white border border-[var(--border-default)] p-1 flex items-center justify-center">
              <Logomark className="w-full h-full" />
            </div>
            <span className="shrink-0 text-[16px] font-extrabold text-[var(--text-primary)] tracking-tight">Carrotly</span>
            {/* 💡 [수정] 모바일 상단 바와 같은 이유로 Pro일 때만 렌더링합니다 — 위 주석 참고. */}
            {isPro && (
              <button
                type="button"
                onClick={() => openUpgradeModal()}
                className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border border-[#F4679B]/50 text-[#F4679B] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
              >
                PRO
              </button>
            )}
          </div>
          <div className="flex justify-end">
            <LocaleSwitcher />
          </div>
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
                  ? 'bg-[var(--bg-accent-subtle)] text-[#F4679B] font-semibold border-[#F4679B]'
                  : 'text-[var(--text-tertiary)] border-transparent hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]'
              }`}
            >
              <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {/* 💡 [신규] 코드 기반 Pro의 남은 기간 안내 — 무료 사용자의 당근 게이지가 있던
            자리와 같은 구역(사이드바 하단, 연결 배지 바로 위)에 둡니다. 두 대상이 겹치지
            않아서(게이지는 무료, 이쪽은 코드 Pro) 같은 자리를 나눠 쓸 수 있습니다.
            결제 Pro와 무료 사용자에게는 컴포넌트가 스스로 null을 반환해 아무것도 그리지
            않습니다. */}
        {usageSummary && (
          <ProExpiryNotice
            proSource={usageSummary.proSource}
            proExpiresAt={usageSummary.proExpiresAt}
            t={t}
          />
        )}

        {/* 좌측 하단 MCP 연결 상태 배지 UI */}
        <div className="p-4 border-t border-[var(--border-default)] text-xs bg-[var(--bg-page-alt)]">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${dbStatus === 'connected' ? 'bg-[#6EE7B7] animate-pulse' : 'bg-[var(--accent-danger)]'}`}></span>
            <span className="font-semibold text-[var(--text-primary)]">
              {aiModel ? t('common.aiConnectedWithModel', { model: aiModel }) : t('common.aiConnected')}
            </span>
          </div>
        </div>

        {/* 💡 [신규] 이번 달 남은 사용량 — 당근 게이지(components/carrot-gauge.tsx). Pro는
            한도가 사실상 무제한(월 1000회/200회)이라 의미가 없으므로 무료 등급에만 보여줍니다.
            usageSummary가 아직 안 왔으면(로딩 중/조회 실패) 아무것도 그리지 않습니다 — 0/0
            같은 잘못된 값을 잠깐 보여주는 것보다 안전합니다. */}
        {/* 💡 [수정] 게이지가 "채팅 N회 / 파일 N회" 두 개에서 **이번 달 이용량** 하나로
            바뀌었습니다. 계산 기준은 토큰이지만 화면에는 토큰도 숫자도 나오지 않습니다 —
            서버가 비율(0~1)과 구간만 내려주고(app/api/usage-summary), 문구는 구간별 고정
            문장입니다. 당근이 갉아먹히는 SVG는 ratio 하나만 보므로 시각적 형태는 그대로입니다.
            usage가 null이면(Pro이거나 조회 실패) 아무것도 그리지 않습니다. */}
        {usageSummary?.usage && (
          <div className="px-4 py-3 border-t border-[var(--border-default)] flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
              {t('usage.title')}
            </span>
            {/* 💡 문구가 한 줄에 안 들어가면 당근이 찌그러지므로 좌우 배치 대신 위아래로
                둡니다 — 게이지 폭(132px)이 고정이라 좁은 사이드바에서는 이쪽이 안전합니다. */}
            <div className="flex flex-col gap-1">
              <CarrotGauge
                ratio={usageSummary.usage.ratio}
                countText=""
                accessibleLabel={t(`usage.level.${usageSummary.usage.level}`)}
                fill={USAGE_LEVEL_COLORS[usageSummary.usage.level].fill}
                stroke={USAGE_LEVEL_COLORS[usageSummary.usage.level].stroke}
              />
              <span className="text-[11px] text-[var(--text-tertiary)] leading-snug">
                {t(`usage.level.${usageSummary.usage.level}`)}
              </span>
            </div>
          </div>
        )}

        {/* 💡 [신규] AI 답변 언어 설정 — 브라우저 언어로 자동 감지된 값을 기본으로 쓰고,
            여기서 바꾸면 계정별로 기억됩니다(handleExecute/runLensAnalyze/
            recomputeProfessorAnalysis*가 이 값을 responseLanguage로 API에 보냅니다). */}
        <div className="px-4 py-3 border-t border-[var(--border-default)]">
          <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
            {t('common.responseLanguageLabel')}
          </label>
          <select
            value={responseLanguage}
            onChange={(e) => setResponseLanguage(e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md px-2 py-1.5 text-xs text-[var(--text-secondary)] outline-none focus:border-[#F4679B] cursor-pointer"
          >
            {Array.from(new Set([responseLanguage, ...COMMON_RESPONSE_LANGUAGES])).map((lang) => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
        </div>

        {/* 💡 [신규] 화면 테마 설정 — 시스템 설정을 따를지, 라이트/다크 중 직접 고를지.
            AI 답변 언어 설정과 같은 자리(사이드바 하단 설정 묶음)에 둡니다. */}
        <div className="px-4 py-3 border-t border-[var(--border-default)] flex items-center justify-between">
          <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            {t('common.themeLabel')}
          </span>
          <ThemeToggle />
        </div>

        {/* 💡 [신규] "Pro로 업그레이드" — Pro 배지를 Pro 사용자 전용으로 바꾸면서 무료
            사용자에게 자발적 업그레이드 경로가 사라졌던 걸 되살립니다. 배지처럼 등급 표시를
            겸하는 애매한 자리가 아니라, 무엇을 하는 항목인지 문구로 분명한 별도 줄입니다.
            이미 Pro인 사용자에게는 보여줄 이유가 없어 숨깁니다(그쪽은 배지가 대신합니다).
            클릭하면 기존 업그레이드 모달을 그대로 엽니다 — 모달 안에 Polar 결제 링크와
            소사이어티 코드 입력이 함께 있어서, 여기서 결제로 바로 보내는 것보다 낫습니다. */}
        {!isPro && (
          <button
            type="button"
            onClick={() => openUpgradeModal()}
            className="w-full text-left block px-4 py-3 border-t border-[var(--border-default)] bg-transparent text-xs font-semibold text-[#F4679B] hover:bg-[var(--surface-chip)] cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-inset"
          >
            {t('common.upgradeToPro')}
          </button>
        )}

        <Link
          href="/pricing"
          className="block px-4 py-3 border-t border-[var(--border-default)] text-xs text-[var(--text-muted)] hover:text-[#F4679B] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-inset"
        >
          Pricing
        </Link>

        {/* 💡 [신규] 소사이어티 코드 안내 — 코드 입력창은 업그레이드 모달 안에만 있어서,
            동아리에서 코드를 받은 학생이 "Pro 배지를 눌러본다" 말고는 찾아갈 길이 없었습니다.
            같은 모달을 여는 링크를 한 줄 둬서 경로를 하나 더 만듭니다. */}
        <button
          type="button"
          onClick={() => openUpgradeModal()}
          className="block w-full text-left px-4 py-3 border-t border-[var(--border-default)] text-xs text-[var(--text-muted)] hover:text-[#F4679B] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-inset"
        >
          {t('upgrade.societyCode.sidebarLink')}
        </button>

        {/* 💡 [신규] 계정 삭제 — /privacy 페이지가 약속하는 "삭제 요청" 권리를 이메일 문의 없이
            직접 실행할 수 있는 버튼. 실수로 누르는 걸 막기 위해 다른 사이드바 항목들과
            시각적으로 분리(맨 아래, 위험 색상)해뒀습니다. */}
        <button
          type="button"
          onClick={handleDeleteAccount}
          disabled={isDeletingAccount}
          className="block w-full text-left px-4 py-3 border-t border-[var(--border-default)] text-xs text-[var(--accent-danger)]/70 hover:text-[var(--accent-danger)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-danger)] focus-visible:ring-inset"
        >
          {isDeletingAccount ? t('account.deleting') : t('account.delete')}
        </button>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleContentScroll}
        className="flex-1 flex flex-col min-w-0 overflow-y-auto"
      >
        <div className="hidden md:flex h-[68px] border-b border-[var(--border-default)] items-center justify-end px-8 gap-3 bg-[var(--bg-page)]/70 backdrop-blur">
          <div className="flex items-center gap-2 bg-[var(--bg-surface)] px-3.5 py-2 rounded-full border border-[var(--border-default)]">
            <span className="text-xs text-[var(--text-tertiary)] max-w-[220px] truncate">{user?.email}</span>
          </div>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.push('/login');
            }}
            className="px-4 py-2 rounded-lg border border-[var(--border-error-subtle)] bg-[var(--bg-page)] text-[var(--accent-danger)] hover:bg-[var(--bg-error-subtle)] text-xs font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-danger)]"
          >
            {t('common.logout')}
          </button>
        </div>

        {/* 💡 [수정] max-w-4xl(896px) → max-w-5xl(1024px). AI 답변이 한 줄에 더 많이 들어가
          답변을 읽는 동안 눈이 덜 튑니다(ChatGPT·Gemini도 이 정도 폭을 씁니다). */}
        <div className="p-4 sm:p-6 md:p-8 max-w-5xl w-full mx-auto">

          {activeTab === 'workspace' && (
            <>
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  Live AI Playground
                </h1>
                <p className="text-[var(--text-tertiary)] text-xs sm:text-sm mt-1.5">
                  {t('workspace.subtitle')}
                </p>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setIsDraggingOverChat(true); }}
                onDragLeave={() => setIsDraggingOverChat(false)}
                onDrop={handleChatDrop}
                className={`bg-[var(--bg-page)] rounded-2xl border p-4 sm:p-6 mb-6 shadow-sm transition-colors ${
                  isDraggingOverChat ? 'border-[#F4679B] bg-[var(--bg-accent-subtle)]' : 'border-[var(--border-default)]'
                }`}
              >
                <div className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                  {t('workspace.promptSectionLabel')}
                </div>

                {chatAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {chatAttachments.map((a) => (
                      <span
                        key={a.id}
                        className="inline-flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] text-xs pl-2.5 pr-1.5 py-1.5 rounded-full max-w-[220px]"
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
                          aria-label={t('workspace.removeAttachment', { name: a.name })}
                          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-[var(--surface-chip)] text-[var(--text-muted)] hover:text-[var(--accent-danger)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-danger)]"
                        >
                          <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* 💡 [신규] 교수님 자료로 만들기 — 교수님 탭에 흩어져 있던 "자료 전체 요약"을
                    여기로 옮기면서, 예상 질문/예상 시험 문제까지 같은 자리에서 뽑을 수 있게
                    했습니다. 교수님 탭은 자료를 쌓고 성향을 보는 곳, 여기는 쌓인 걸 꺼내
                    쓰는 곳으로 역할을 나눕니다. */}
                {/* 💡 [수정] 예전에는 professors.length > 0일 때만 이 패널이 떴습니다. 이제 교수님을
                    여기서 직접 만들 수 있으므로, 한 명도 없을 때야말로 이 패널이 필요합니다. */}
                {(
                  <div className="bg-[var(--bg-deep)] rounded-xl border border-[var(--surface-chip)] p-3 mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <GraduationCap className="w-4 h-4 text-[#F4679B] shrink-0" strokeWidth={2} />
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">
                        {t('workspace.professorGen.title')}
                      </h4>
                      {professorGenHasProfile && (
                        <span className="text-[10px] font-semibold text-[#F4679B] bg-[var(--bg-accent-subtle)] px-2 py-0.5 rounded-full">
                          {t('workspace.professorGen.profileApplied')}
                        </span>
                      )}
                    </div>

                    {/* 1단계 — 교수님 고르기. 드롭다운이 아니라 버튼으로 둡니다: 대부분
                        교수님이 서너 명이라 목록을 펼치는 동작 자체가 군더더기이고,
                        자료 개수를 한눈에 비교하면서 고를 수 있어야 하기 때문입니다. */}
                    <p className="text-[11px] text-[var(--text-muted)] mb-1.5">
                      {t('workspace.professorGen.step1')}
                    </p>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('workspace.professorGen.selectLabel')}>
                      {professors.map((p) => {
                        const count = professorDocuments.filter((d) => d.professor_id === p.id).length;
                        const isSelected = professorGenProfessorId === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => {
                              // 같은 교수님을 다시 누르면 선택 해제. 교수님이 바뀌면
                              // 이전 결과는 남겨두면 안 됩니다(누구 것인지 헷갈림).
                              const next = isSelected ? null : p.id;
                              setProfessorGenProfessorId(next);
                              setProfessorGenResult(null);
                              setProfessorGenError(null);
                              setProfessorGenLens(null);
                              // 💡 [수정] 주제 폴더 선택을 더 이상 해제하지 않습니다. 둘은
                              // 경쟁하는 축이 아닙니다 — 교수님은 "무슨 자료를 볼까",
                              // 폴더는 "어떤 대화 맥락에서 볼까"라, 함께 켜두는 게
                              // 자연스러운 조합입니다(서버가 교집합으로 좁힙니다).
                            }}
                            className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                              isSelected
                                ? 'bg-[#F4679B] text-white border-[#F4679B]'
                                : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            {t('workspace.professorGen.optionLabel', { name: p.name, count })}
                          </button>
                        );
                      })}

                      {/* 💡 [신규] 교수님 탭으로 건너가지 않고 여기서 바로 만듭니다. 칩 목록 끝에
                          두는 이유는, 고르기와 만들기가 같은 줄에 있어야 "없으면 만들면 된다"가
                          한눈에 보이기 때문입니다. */}
                      <button
                        type="button"
                        aria-expanded={showInlineProfessorForm}
                        onClick={() => setShowInlineProfessorForm((v) => !v)}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-dashed border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[#F4679B] hover:border-[#F4679B] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                      >
                        + {t('workspace.professorGen.addProfessor')}
                      </button>
                    </div>

                    {showInlineProfessorForm && (
                      <form
                        className="mt-2 flex flex-wrap gap-1.5 items-center"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await handleCreateProfessorOnly();
                          // 이름이 비어 있으면 handleCreateProfessorOnly가 alert만 띄우고
                          // state를 그대로 두므로, 성공했을 때만(= 이름이 비워졌을 때) 접습니다.
                          setShowInlineProfessorForm(false);
                        }}
                      >
                        <input
                          value={newProfessorName}
                          onChange={(e) => setNewProfessorName(e.target.value)}
                          placeholder={t('professors.uploadPanel.namePlaceholder')}
                          className="flex-1 min-w-[110px] bg-[var(--bg-page)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[#F4679B]"
                        />
                        <input
                          value={newProfessorSchool}
                          onChange={(e) => setNewProfessorSchool(e.target.value)}
                          placeholder={t('professors.uploadPanel.schoolPlaceholder')}
                          className="flex-1 min-w-[90px] bg-[var(--bg-page)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[#F4679B]"
                        />
                        <input
                          value={newProfessorDepartment}
                          onChange={(e) => setNewProfessorDepartment(e.target.value)}
                          placeholder={t('professors.uploadPanel.departmentPlaceholder')}
                          className="flex-1 min-w-[90px] bg-[var(--bg-page)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[#F4679B]"
                        />
                        <button
                          type="submit"
                          disabled={!newProfessorName.trim() || isCreatingProfessor}
                          className="bg-[#F4679B] hover:bg-[#D1477F] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
                        >
                          {t('professors.uploadPanel.createOnly')}
                        </button>
                      </form>
                    )}

                    {/* 💡 [신규] 이 선택이 아래 채팅에도 영향을 준다는 안내 — 선택 상태가
                        /api/chat 요청에 함께 실려가면서 생긴 동작이라, 알려주지 않으면
                        "왜 갑자기 이 교수님 얘기를 하지?"가 됩니다. */}
                    {professorGenProfessorId && (
                      <p className="text-[10px] text-[var(--text-faint)] mt-1.5 leading-relaxed">
                        {t('workspace.professorGen.chatHint')}
                      </p>
                    )}

                    {/* 2단계 — 교수님을 고른 뒤에만 나타납니다. 고르기 전부터 비활성 버튼
                        세 개가 떠 있으면 뭘 먼저 해야 하는지가 흐려집니다. */}
                    {/* 💡 [신규] 자료 올리기 — 교수님을 고른 뒤 바로 여기서 올립니다. 예전에는
                        자료가 0개면 "교수님 탭에서 올려주세요"라는 안내만 나오는 막다른 길이었고,
                        자료가 있어도 추가하려면 탭을 옮겨야 했습니다. 자료 종류(강의자료/시험지/
                        과제/논문)를 함께 고르는 이유는 분석이 이 값으로 근거를 가리기 때문입니다
                        (특히 연구 관심사는 '논문'으로 표시된 자료만 봅니다). */}
                    {professorGenProfessorId && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                        <select
                          value={uploadDocType}
                          onChange={(e) => setUploadDocType(e.target.value)}
                          aria-label={t('professors.docTypeLabel')}
                          className="bg-[var(--bg-page)] border border-[var(--border-default)] rounded-lg px-2 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[#F4679B] cursor-pointer"
                        >
                          {DOC_TYPE_KEYS.map((k) => (
                            <option key={k} value={k}>{t(`professors.docType.${k}`)}</option>
                          ))}
                        </select>
                        <label className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[#F4679B] hover:border-[#F4679B] transition-colors cursor-pointer">
                          {isUploadingProfessorDoc ? <LoadingText /> : t('workspace.professorGen.addMaterials')}
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            disabled={isUploadingProfessorDoc}
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length > 0) {
                                handleUploadProfessorFiles(e.target.files, professorGenProfessorId, uploadDocType);
                              }
                              e.target.value = '';
                            }}
                          />
                        </label>
                        <span className="text-[10px] text-[var(--text-faint)]">{uploadLimitHint}</span>
                      </div>
                    )}

                    {professorGenProfessorId && (
                      professorGenDocCount === 0 ? (
                        <p className="text-[11px] text-[var(--text-muted)] mt-2.5">
                          {t('workspace.professorGen.noDocuments')}
                        </p>
                      ) : (
                        <>
                          <p className="text-[11px] text-[var(--text-muted)] mt-2.5 mb-1.5">
                            {t('workspace.professorGen.step2')}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {PROFESSOR_GEN_LENS_DEFS.map((def, i) => (
                              <button
                                key={def.id}
                                type="button"
                                disabled={isGeneratingFromProfessor}
                                onClick={() => handleGenerateFromProfessor(def.id)}
                                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                                  professorGenLens === def.id
                                    ? 'bg-[var(--bg-accent-subtle)] text-[#F4679B] border-[#F4679B]'
                                    : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                                }`}
                              >
                                {/* 💡 [신규] 이미 문제를 받아본 교수님이면 "예상 시험 문제" 대신
                                    "새 문제 받기"로 바뀝니다 — 같은 버튼을 다시 눌렀을 때 같은
                                    결과가 나오는 게 아니라 새 문항이 온다는 걸 알려주기 위함입니다. */}
                                {i + 1}.{' '}
                                {def.id === 'examQuestions' &&
                                (examQuestionHistory[professorGenProfessorId] ?? []).length > 0
                                  ? t('workspace.professorGen.lenses.examQuestionsMore')
                                  : t(`workspace.professorGen.lenses.${def.key}`)}
                              </button>
                            ))}
                          </div>
                        </>
                      )
                    )}

                    {isGeneratingFromProfessor && (
                      <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)] mt-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        <LoadingText />
                      </div>
                    )}

                    {professorGenError && (
                      <p className="text-[11px] text-[var(--accent-danger)] mt-2">{professorGenError}</p>
                    )}

                    {professorGenLens && professorGenResult && !isGeneratingFromProfessor && (
                      <div className="mt-3">
                        {renderTrialResult(professorGenLens, professorGenResult, t)}
                        <p className="mt-2 text-[10px] text-[var(--text-muted)] text-center">
                          {t('common.aiGeneratedNotice')}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* 💡 [신규] 주제 폴더 고르기 — 위 교수님 선택과 같은 역할을 폴더 축으로 합니다.
                    고른 폴더는 채팅 저장 시 logs.folder_id로 남고, 다음 요청의 "최근 대화 기록"이
                    그 폴더 대화로 좁혀집니다. 교수님과 함께 켤 수 있습니다(둘 다 켜면 교집합).
                    💡 [수정] 폴더 만들기도 여기서 합니다 — 예전에는 "지난 대화" 탭에만 있어서,
                    폴더가 하나도 없는 사용자는 이 패널에서 안내 문구만 보고 탭을 옮겨야 했습니다. */}
                <div className="bg-[var(--bg-deep)] rounded-xl border border-[var(--surface-chip)] p-3 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <FolderOpen className="w-4 h-4 text-[#F4679B] shrink-0" strokeWidth={2} />
                    <h4 className="text-xs font-bold text-[var(--text-primary)]">
                      {t('workspace.chatFolder.title')}
                    </h4>
                  </div>

                  {conversationFolders.length === 0 && (
                    <p className="text-[11px] text-[var(--text-muted)] mb-1.5">
                      {t('workspace.chatFolder.emptyHint')}
                    </p>
                  )}
                  {(
                    <>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('workspace.chatFolder.selectLabel')}>
                        {conversationFolders.map((folder) => {
                          const isSelected = chatFolderId === folder.id;
                          return (
                            <button
                              key={folder.id}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => {
                                // 같은 폴더를 다시 누르면 선택 해제.
                                const next = isSelected ? null : folder.id;
                                setChatFolderId(next);
                                // 💡 [수정] 교수님 선택을 더 이상 해제하지 않습니다
                                // (위 교수님 버튼 쪽 주석과 같은 이유).
                              }}
                              className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                                isSelected
                                  ? 'bg-[#F4679B] text-white border-[#F4679B]'
                                  : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                              }`}
                            >
                              {folder.name}
                            </button>
                          );
                        })}

                        {/* 교수님 칩과 같은 방식 — 고르기와 만들기를 같은 줄에 둡니다. */}
                        <button
                          type="button"
                          aria-expanded={showInlineFolderForm}
                          onClick={() => setShowInlineFolderForm((v) => !v)}
                          className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-dashed border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[#F4679B] hover:border-[#F4679B] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                        >
                          + {t('workspace.chatFolder.addFolder')}
                        </button>
                      </div>

                      {showInlineFolderForm && (
                        <form
                          className="mt-2 flex gap-1.5"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            await handleCreateFolder();
                            setShowInlineFolderForm(false);
                          }}
                        >
                          <input
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            placeholder={t('logs.newFolderPlaceholder')}
                            className="flex-1 bg-[var(--bg-page)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[#F4679B]"
                          />
                          <button
                            type="submit"
                            disabled={!newFolderName.trim() || isCreatingFolder}
                            className="bg-[#F4679B] hover:bg-[#D1477F] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
                          >
                            {t('common.create')}
                          </button>
                        </form>
                      )}
                      {chatFolderId && (
                        <p className="text-[10px] text-[var(--text-faint)] mt-1.5 leading-relaxed">
                          {/* 💡 [수정] 폴더에 지난 대화가 아직 없으면 "지난 대화를 참고해요"는
                              사실이 아닙니다. 실제 건수를 보고 문구를 갈라 씁니다. */}
                          {logs.some((l) => l.folder_id === chatFolderId)
                            ? t('workspace.chatFolder.chatHint')
                            : t('workspace.chatFolder.chatHintEmpty')}
                        </p>
                      )}
                    </>
                  )}
                </div>

                {chatLensGraph && (
                  <div className="bg-[var(--bg-deep)] rounded-xl border border-[var(--surface-chip)] p-2 mb-3">
                    <CircuitBoard graph={chatLensGraph} onNodeClick={handleNodeClick} compact />
                    <div className="flex flex-wrap gap-1.5 justify-center mt-1.5">
                      {CHAT_LENS_CHOICE_DEFS.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => handleSelectChatLens(choice.id)}
                          className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                            effectiveChatLens === choice.id
                              ? 'bg-[var(--bg-accent-subtle)] text-[#F4679B] border-[#F4679B]'
                              : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {t(`workspace.lensChoices.${choice.key}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <form onSubmit={handleExecute} className="flex flex-col sm:flex-row gap-3">
                  <label
                    className={`shrink-0 flex items-center justify-center w-11 sm:w-auto sm:px-3.5 h-11 sm:h-auto rounded-lg border transition-colors ${
                      isAttachingChatFile
                        ? 'bg-[var(--bg-surface)] border-[var(--border-default)] text-[var(--text-muted)] cursor-wait'
                        : 'bg-[var(--bg-page)] hover:bg-[var(--surface-chip)] border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer'
                    }`}
                    aria-label={t('workspace.attachFile')}
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
                    aria-label={t('workspace.webSearchToggle')}
                    title={isSearchActive ? t('workspace.webSearchOnTitle') : t('workspace.webSearchOffTitle')}
                    className={`shrink-0 flex items-center justify-center gap-1.5 w-11 sm:w-auto sm:px-3.5 h-11 sm:h-auto rounded-lg border transition-colors cursor-pointer ${
                      isSearchActive
                        ? 'bg-[var(--bg-accent-subtle)] hover:bg-[var(--bg-accent-subtle-hover)] border-[#F4679B] text-[#F4679B]'
                        : 'bg-[var(--bg-page)] hover:bg-[var(--surface-chip)] border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Search className="w-4 h-4" strokeWidth={2} />
                    <span className="hidden sm:inline text-xs font-semibold">
                      {t('workspace.webSearchLabel', { state: isSearchActive ? 'ON' : 'OFF' })}
                    </span>
                  </button>
                  <input
                    ref={commandInputRef}
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder={t('workspace.promptPlaceholder')}
                    className="flex-1 bg-[var(--bg-page)] border border-[var(--border-strong)] rounded-lg px-4 py-3 text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 transition-colors placeholder:text-[var(--text-muted)]"
                  />
                  <button
                    type="submit"
                    disabled={isExecuting}
                    className="bg-[#F4679B] hover:bg-[#D1477F] text-white border-none rounded-lg px-6 py-3 font-semibold text-sm cursor-pointer disabled:opacity-50 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
                  >
                    {isExecuting ? t('common.sending') : t('common.send')}
                  </button>
                </form>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  {isAttachingChatFile ? <LoadingText /> : t('workspace.dropHint')}
                </p>
                {/* 💡 [신규] 올리기 전에 상한·지원 형식을 미리 알려줍니다 — 실패하고 나서야
                    한도를 알게 되는 게 가장 나쁜 순서입니다. 등급에 따라 숫자가 바뀝니다. */}
                <p className="text-[10px] text-[var(--text-faint)] mt-1">{uploadLimitHint}</p>
              </div>

              {/* 💡 [신규] 대화 저장 실패 배너 — 예전에는 이 실패를 코드가 조용히 버려서,
                  DB 스키마가 어긋난 동안 모든 대화가 저장되지 않는데도 사용자는 전혀 몰랐습니다.
                  답변 자체는 정상이라 alert으로 흐름을 끊지 않고, 답변 패널 위에 눈에 띄게
                  띄웁니다. 원인 문자열(error.message)까지 보여줘야 실제로 고칠 수 있습니다. */}
              {logSaveError && (
                <div className="mb-3 rounded-xl border border-[var(--accent-danger)] bg-[var(--bg-panel)] px-4 py-3">
                  <p className="text-[12px] font-semibold text-[var(--accent-danger)]">
                    {t('workspace.logSaveFailed.title')}
                  </p>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-1 leading-relaxed">
                    {t('workspace.logSaveFailed.body')}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1.5 break-all">{logSaveError}</p>
                </div>
              )}

              <div className="bg-[var(--bg-deep)] rounded-2xl border border-[var(--surface-chip)] overflow-hidden shadow-sm">
                <div className="bg-[var(--bg-panel)] px-4 py-3 flex items-center gap-2 border-b border-[var(--surface-chip)]">
                  <MessageCircle className="w-4 h-4 text-[#F4679B]" strokeWidth={2} />
                  <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {t('workspace.aiResponseLabel')}
                  </span>
                </div>

                {/* 💡 [수정] 답변 영역을 넉넉하게: 글자 14px→16(모바일)/17px(데스크톱), 줄간격
                    1.8→1.95, 최소 높이 150px→320/420px, 안쪽 여백도 함께 키웠습니다.
                    긴 답변을 읽는 화면인데 카드 하나가 화면의 일부만 차지하고 있었습니다. */}
                <div
                  ref={responsePanelRef}
                  className="px-5 py-5 sm:px-7 sm:py-6 text-[16px] sm:text-[17px] leading-[1.95] font-medium text-[var(--text-ai-response)] whitespace-pre-wrap min-h-[320px] sm:min-h-[420px]"
                >
                  {streamingLog === IDLE_CONSOLE_SENTINEL ? t('workspace.idleMessage') : streamingLog}
                  {isAwaitingChatResponse && (
                    <span className="text-[var(--text-secondary)] font-normal">
                      <LoadingText />
                    </span>
                  )}
                  {streamingLog === IDLE_CONSOLE_SENTINEL && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {EXAMPLE_PROMPT_DEFS.map((example) => {
                        const promptText = t(`workspace.examplePrompts.${example.key}`);
                        return (
                          <button
                            key={example.key}
                            type="button"
                            onClick={() => {
                              setCommand(promptText);
                              commandInputRef.current?.focus();
                            }}
                            className="inline-flex items-center gap-1.5 bg-[var(--bg-page)] hover:bg-[var(--surface-chip)] border border-[var(--border-default)] hover:border-[#F4679B]/50 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-medium pl-2.5 pr-3.5 py-2 rounded-full transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                          >
                            <example.icon className="w-3.5 h-3.5 text-[#F4679B] shrink-0" strokeWidth={2} />
                            {promptText}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div ref={terminalEndRef} />
                </div>

                {/* 💡 [신규] 방금 나눈 대화를 그 자리에서 폴더로 옮깁니다.
                    대화 목록 전체를 여기로 옮기지 않은 이유는 "지난 대화" 탭과 완전히 중복되기
                    때문입니다. 실제로 분류를 정하고 싶은 순간은 대화를 막 끝냈을 때이고,
                    여러 건을 한꺼번에 정리하는 건 그 탭에 그대로 남겨둡니다.
                    폴더를 미리 골라두고 대화했다면 이미 그 폴더로 저장돼 있어, 여기서는
                    "바꾸기"로 동작합니다(선택값이 현재 폴더로 맞춰져 있습니다). */}
                {lastSavedLogId && conversationFolders.length > 0 && (
                  <div className="border-t border-[var(--surface-chip)] px-4 py-2.5 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-[var(--text-tertiary)]">
                      {t('workspace.saveToFolder.label')}
                    </span>
                    <select
                      value={logs.find((l) => l.id === lastSavedLogId)?.folder_id || ''}
                      onChange={(e) => handleMoveLogToFolder(lastSavedLogId, e.target.value || null)}
                      aria-label={t('workspace.saveToFolder.label')}
                      className="bg-[var(--bg-page)] border border-[var(--border-default)] rounded-lg px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[#F4679B] cursor-pointer"
                    >
                      <option value="">{t('logs.unfiledOption')}</option>
                      {conversationFolders.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {lensStage !== 'idle' && (
                <div
                  ref={lensResultRef}
                  className="mt-4 bg-[var(--bg-page-alt)] rounded-2xl border border-[var(--border-chip-hover)] p-5 sm:p-6"
                >
                  {lensStage === 'analyzing' && (
                    <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <Loader2 className="w-4 h-4 animate-spin text-[#F4679B] shrink-0" strokeWidth={2} />
                      <LoadingText />
                    </div>
                  )}
                  {lensStage === 'error' && (
                    <p className="flex items-center gap-1.5 text-sm text-[var(--accent-danger)]">
                      <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2} />
                      {lensError}
                    </p>
                  )}
                  {lensStage === 'done' && (
                    <>
                      {renderLensResult()}
                      <p className="mt-3 text-xs text-[var(--text-muted)]">{t('common.aiGeneratedNotice')}</p>
                      {chatLensActionsRow && <div className="mt-4">{chatLensActionsRow}</div>}
                    </>
                  )}
                </div>
              )}

              {detectedActionItems.length > 0 && (
                <div className="mt-4 bg-[var(--bg-page)] rounded-2xl border border-[#F4679B]/40 p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-[#F4679B] mb-3">{t('workspace.actionItemsFound')}</h3>
                  <div className="flex flex-col gap-2.5">
                    {detectedActionItems.map((item, idx) => (
                      <div
                        key={`${item.title}-${idx}`}
                        className="flex items-center justify-between gap-3 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-3"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{item.title}</div>
                          <div className="text-xs text-[var(--text-muted)] mt-0.5">
                            {new Date(item.dueAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddDetectedDeadline(item)}
                          className="shrink-0 bg-[#F4679B] hover:bg-[#D1477F] text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
                        >
                          {t('workspace.registerAsDeadline')}
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
                  {t('records.title')}
                </h1>
                <p className="text-[var(--text-tertiary)] text-xs sm:text-sm mt-1.5">
                  {t('records.subtitle')}
                </p>
              </div>

              {/* 히어로 숫자 */}
              <div className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-6 sm:p-8 mb-5 shadow-sm text-center">
                <p className="text-xs sm:text-sm text-[var(--text-tertiary)] mb-3">{t('records.heroLabel')}</p>
                <div className="text-5xl sm:text-6xl font-extrabold text-[#F4679B] tracking-tight leading-none">
                  {totalKnownCount}
                  <span className="text-xl sm:text-2xl text-[var(--text-primary)] ml-1.5 align-middle">{t('records.unitSuffix')}</span>
                </div>
                {daysSinceJoin !== null && (
                  <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-4">
                    {t('records.daysSinceJoin', { days: daysSinceJoin })}
                  </p>
                )}
              </div>

              {/* 카드 3개: 마감일 / 문서 / 대화 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-5 shadow-sm flex flex-col">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">⏰</span>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">{t('records.deadlinesCard.title')}</h3>
                  </div>
                  <div className="text-3xl font-extrabold text-[var(--text-primary)] mb-3">
                    {deadlines.length}<span className="text-xs font-medium text-[var(--text-muted)] ml-1">{t('records.unitSuffix')}</span>
                  </div>
                  {courseBreakdown.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">{t('records.deadlinesCard.empty')}</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {courseBreakdown.slice(0, 5).map((c) => (
                        <div key={c.course} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-[var(--text-tertiary)] truncate">{c.course}</span>
                          <span className="shrink-0 text-[var(--text-primary)] font-semibold tabular-nums">{c.count}{t('records.unitSuffix')}</span>
                        </div>
                      ))}
                      {courseBreakdown.length > 5 && (
                        <span className="text-[11px] text-[var(--text-muted)] mt-0.5">{t('records.deadlinesCard.moreCategories', { count: courseBreakdown.length - 5 })}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-5 shadow-sm flex flex-col">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">📁</span>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">{t('records.documentsCard.title')}</h3>
                  </div>
                  <div className="text-3xl font-extrabold text-[var(--text-primary)] mb-3">
                    {documentUploads.length}<span className="text-xs font-medium text-[var(--text-muted)] ml-1">{t('records.unitSuffix')}</span>
                  </div>
                  {documentUploads.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">{t('records.documentsCard.empty')}</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {fileFormatBreakdown.map((f) => (
                        <div key={f.key} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-[var(--text-tertiary)] flex items-center gap-1.5 truncate">
                            <span>{f.icon}</span>{f.label}
                          </span>
                          <span className="shrink-0 text-[var(--text-primary)] font-semibold tabular-nums">{f.count}{t('records.unitSuffix')}</span>
                        </div>
                      ))}
                      {etcFileCount > 0 && (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-[var(--text-tertiary)] flex items-center gap-1.5 truncate"><span>📄</span>{t('records.documentsCard.etc')}</span>
                          <span className="shrink-0 text-[var(--text-primary)] font-semibold tabular-nums">{etcFileCount}{t('records.unitSuffix')}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-5 shadow-sm flex flex-col">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">📜</span>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">{t('records.logsCard.title')}</h3>
                  </div>
                  <div className="text-3xl font-extrabold text-[var(--text-primary)] mb-3">
                    {logs.length}<span className="text-xs font-medium text-[var(--text-muted)] ml-1">{t('records.unitSuffix')}</span>
                  </div>
                  {logs.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">{t('records.logsCard.empty')}</p>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)]">
                      {t('records.logsCard.mostRecent', { date: new Date(logs[0].created_at).toLocaleDateString(locale, { month: 'long', day: 'numeric' }) })}
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
                  {t('deadlines.title')}
                </h1>
                <p className="text-[var(--text-tertiary)] text-xs sm:text-sm mt-1.5">
                  {t('deadlines.subtitle')}
                </p>
              </div>

              {/* 대시보드 — 마감일 · 첨부 파일 · 활성 블록 데이터를 한눈에 요약 */}
              <div className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-5 mb-6 shadow-sm">
                <h3 className="text-sm sm:text-base font-bold text-[var(--text-primary)] mb-4">{t('deadlines.dashboardTitle')}</h3>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
                  {kpiTiles.map((tile) => (
                    <div key={tile.label} className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-3.5 flex flex-col gap-1.5">
                      <span className="text-[11px] text-[var(--text-muted)] font-medium uppercase tracking-wide flex items-center gap-1">
                        <span>{tile.icon}</span> {tile.label}
                      </span>
                      <span className={`text-xl sm:text-2xl font-extrabold tabular-nums ${tile.emphasize ? 'text-[var(--accent-danger)]' : 'text-[var(--text-primary)]'}`}>
                        {tile.value}
                      </span>
                    </div>
                  ))}
                </div>

                {deadlines.length === 0 ? (
                  <div className="text-sm text-[var(--text-muted)] text-center py-8 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] flex flex-col items-center gap-3">
                    <span>{t('deadlines.emptyHint')}</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('workspace')}
                      className="inline-flex items-center gap-1.5 bg-[var(--bg-page)] hover:bg-[var(--surface-chip)] border border-[var(--border-accent-subtle)] text-[#F4679B] text-xs font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                    >
                      {t('deadlines.goToChatTab')}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 긴급도 분포 */}
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mb-3">{t('deadlines.urgencyDistribution')}</h4>
                      <div className="flex flex-col gap-2.5">
                        {urgencyBuckets.map((bucket) => {
                          const count = urgencyCounts[bucket.key] || 0;
                          const widthPct = maxUrgencyCount > 0 ? (count / maxUrgencyCount) * 100 : 0;
                          return (
                            <div key={bucket.key} className="flex items-center gap-2.5">
                              <span className="w-[92px] shrink-0 text-xs text-[var(--text-tertiary)] truncate">{bucket.label}</span>
                              <div className="flex-1 h-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-full overflow-hidden">
                                {count > 0 && (
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${Math.max(widthPct, 6)}%`, backgroundColor: bucket.color }}
                                  />
                                )}
                              </div>
                              <span className="w-5 shrink-0 text-right text-xs font-semibold text-[var(--text-primary)] tabular-nums">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* 다가오는 일정 타임라인 */}
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mb-3">{t('deadlines.timeline')}</h4>
                      <div className="flex items-end justify-between gap-2 h-[96px] border-b border-[var(--border-default)]">
                        {timelineBuckets.map((bucket) => {
                          const heightPct = maxTimelineCount > 0 ? (bucket.count / maxTimelineCount) * 100 : 0;
                          return (
                            <div key={bucket.key} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
                              <span className="text-[11px] font-semibold text-[var(--text-primary)] tabular-nums h-4">{bucket.count > 0 ? bucket.count : ''}</span>
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
                          <span key={bucket.key} className="flex-1 text-center text-[10px] text-[var(--text-muted)] truncate">{bucket.label}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-6 pt-5 border-t border-[var(--border-default)]">
                  <div>
                    <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mb-2.5">{t('deadlines.recentFilesLabel')}</h4>
                    {files.length === 0 ? (
                      <span className="text-xs text-[var(--text-muted)] italic">{t('deadlines.noAttachedFiles')}</span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {files.slice(0, 3).map((f) => (
                          <div key={f.id} className="flex items-center justify-between gap-2 text-xs text-[var(--text-tertiary)]">
                            <span className="truncate">📄 {f.name}</span>
                            <span className="shrink-0 text-[var(--text-muted)]">{f.date}</span>
                          </div>
                        ))}
                        {files.length > 3 && (
                          <span className="text-[11px] text-[var(--text-muted)]">{t('deadlines.moreFiles', { count: files.length - 3 })}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-5 mb-6 shadow-sm">
                <h3 className="text-sm sm:text-base font-bold mb-4 text-[var(--text-primary)]">{t('deadlines.addManually')}</h3>
                <form onSubmit={handleAddDeadline} className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr_auto] gap-3">
                  <input
                    type="text"
                    required
                    placeholder={t('deadlines.form.titlePlaceholder')}
                    value={newDeadlineTitle}
                    onChange={(e) => setNewDeadlineTitle(e.target.value)}
                    className="px-3.5 py-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[var(--text-muted)]"
                  />
                  <input
                    type="text"
                    placeholder={t('deadlines.form.coursePlaceholder')}
                    value={newDeadlineCourse}
                    onChange={(e) => setNewDeadlineCourse(e.target.value)}
                    className="px-3.5 py-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[var(--text-muted)]"
                  />
                  <input
                    type="datetime-local"
                    required
                    value={newDeadlineDue}
                    onChange={(e) => setNewDeadlineDue(e.target.value)}
                    className="px-3.5 py-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20"
                  />
                  <button
                    type="submit"
                    className="bg-[#F4679B] hover:bg-[#D1477F] text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
                  >
                    {t('deadlines.form.submit')}
                  </button>
                </form>
              </div>

              <div className="flex flex-col gap-2.5">
                {sortedDeadlines.length === 0 && (
                  <div className="text-sm text-[var(--text-muted)] text-center py-8 bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)]">
                    {t('deadlines.noDeadlinesYet')}
                  </div>
                )}
                {sortedDeadlines.map((deadline) => {
                  const dday = getDDayInfo(deadline.dueAt);
                  return (
                    <div
                      key={deadline.id}
                      className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-4 flex items-center justify-between gap-3 shadow-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-bold border ${urgencyStyles[dday.urgency]}`}>
                          {dday.label}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{deadline.title}</div>
                          <div className="text-xs text-[var(--text-muted)] mt-0.5">
                            {deadline.course && <span>{deadline.course} · </span>}
                            {new Date(deadline.dueAt).toLocaleString(locale, { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteDeadline(deadline.id)}
                        className="shrink-0 text-[var(--accent-danger)] hover:text-[var(--text-error)] text-xs px-2.5 py-1.5 bg-[var(--bg-error-subtle)] rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-danger)]"
                      >
                        {t('common.delete')}
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
                  {t('professors.title')}
                </h1>
                <p className="text-[var(--text-tertiary)] text-xs sm:text-sm mt-1.5">
                  {t('professors.subtitle')}
                </p>
              </div>

              <div className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-5 mb-6 shadow-sm">
                <h3 className="text-sm sm:text-base font-bold text-[var(--text-primary)] mb-4">{t('professors.uploadPanel.title')}</h3>

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
                    className="bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20"
                  >
                    <option value="">{t('professors.uploadPanel.selectProfessor')}</option>
                    {professors.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    <option value="__new__">{t('professors.uploadPanel.registerNew')}</option>
                  </select>

                  {uploadProfessorChoice === '__new__' && (
                    <div className="flex flex-col gap-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-3.5">
                      <input
                        type="text"
                        placeholder={t('professors.uploadPanel.namePlaceholder')}
                        value={newProfessorName}
                        onChange={(e) => setNewProfessorName(e.target.value)}
                        className="bg-[var(--bg-page)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[var(--text-muted)]"
                      />
                      <input
                        type="text"
                        placeholder={t('professors.uploadPanel.schoolPlaceholder')}
                        value={newProfessorSchool}
                        onChange={(e) => setNewProfessorSchool(e.target.value)}
                        className="bg-[var(--bg-page)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[var(--text-muted)]"
                      />
                      <input
                        type="text"
                        placeholder={t('professors.uploadPanel.departmentPlaceholder')}
                        value={newProfessorDepartment}
                        onChange={(e) => setNewProfessorDepartment(e.target.value)}
                        className="bg-[var(--bg-page)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[var(--text-muted)]"
                      />
                      <p className="text-[11px] text-[var(--text-muted)]">{t('professors.uploadPanel.schoolDeptHint')}</p>
                      {/* 💡 [신규] 파일 없이 교수님만 먼저 만드는 버튼. 아래 "파일 선택"은
                          그대로 두어, 자료가 이미 있으면 한 번에 등록+업로드도 됩니다. */}
                      <button
                        type="button"
                        disabled={isCreatingProfessor || !newProfessorName.trim()}
                        onClick={handleCreateProfessorOnly}
                        className="self-start inline-flex items-center gap-2 mt-1 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-[#F4679B] text-[#F4679B] hover:bg-[var(--bg-accent-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                      >
                        {isCreatingProfessor ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : null}
                        {t('professors.uploadPanel.createOnly')}
                      </button>
                      <p className="text-[11px] text-[var(--text-muted)]">{t('professors.uploadPanel.createOnlyHint')}</p>
                    </div>
                  )}

                  <select
                    value={uploadDocType}
                    onChange={(e) => setUploadDocType(e.target.value)}
                    className="bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20"
                  >
                    {docTypeDefs.map((def) => (
                      <option key={def.key} value={def.key}>{def.label}</option>
                    ))}
                  </select>

                  <label
                    className={`inline-flex self-start items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                      isUploadingProfessorDoc || !uploadProfessorChoice
                        ? 'bg-[var(--surface-chip)] text-[var(--text-muted)] cursor-wait'
                        : 'bg-[#F4679B] hover:bg-[#D1477F] text-white cursor-pointer'
                    }`}
                  >
                    {isUploadingProfessorDoc ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <LoadingText />
                      </>
                    ) : (
                      <span>{t('professors.uploadPanel.chooseFile')}</span>
                    )}
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
                  <p className="text-xs text-[var(--text-muted)]">{t('professors.uploadPanel.paperHint')}</p>
                  <p className="text-[11px] text-[var(--text-faint)] mt-1">{uploadLimitHint}</p>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                {!isProfessorsLoaded ? (
                  <div className="text-sm text-[var(--text-muted)] text-center py-8 bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)]">
                    {t('professors.loading')}
                  </div>
                ) : professors.length === 0 ? (
                  <div className="text-sm text-[var(--text-muted)] text-center py-8 bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)]">
                    {t('professors.noneRegistered')}
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
                        className="bg-[var(--bg-page)] hover:bg-[var(--surface-chip)] rounded-2xl border border-[var(--border-default)] p-4 flex items-center justify-between gap-3 shadow-sm transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="shrink-0 w-9 h-9 rounded-full bg-[var(--bg-accent-subtle)] border border-[var(--border-accent-subtle)] flex items-center justify-center text-[#F4679B]">
                            <GraduationCap className="w-4 h-4" strokeWidth={2} />
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{p.name}</div>
                            {subtitle && <div className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{subtitle}</div>}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-[var(--text-tertiary)] bg-[var(--bg-surface)] border border-[var(--border-default)] px-2.5 py-1 rounded-full tabular-nums">
                          {t('professors.documentCount', { count })}
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
            // 💡 [수정] 예전엔 confident 여부로 "실제 결과"와 "더 올리면 알 수 있는 것"을 갈랐는데,
            // 이제는 근거가 붙은 항목이 실제로 있는지(items 유무)로 가릅니다 — 확신이 낮아도 근거를
            // 댈 수 있는 판단은 결과로 보여주고, 정말 내용이 없는 카테고리만 아래 티저로 내립니다.
            const defsWithItems = result
              ? professorCategoryDefs.filter((def) => normalizeProfessorItems(result[def.key].items).length > 0)
              : [];
            const emptyDefs = result
              ? professorCategoryDefs.filter((def) => normalizeProfessorItems(result[def.key].items).length === 0)
              : [];
            // 자료가 3개 미만이면 결과는 그대로 보여주되 정확도가 낮을 수 있다는 안내를 함께 띄웁니다.
            const showLowDataNotice = docs.length > 0 && docs.length < PROFESSOR_RELIABLE_DOC_COUNT;

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
                ...professorCircuitDefs.map((def) => ({
                  id: def.nodeId,
                  layer: 'action' as const,
                  status: (getProfessorCircuitCardData(result, def.keys).confident ? 'done' : 'idle') as GraphNode['status'],
                })),
              ],
              edges: [
                { from: 'professor_docs', to: 'professor_ai_core' },
                ...professorCircuitDefs.map((def) => ({ from: 'professor_ai_core' as NodeId, to: def.nodeId as NodeId })),
              ],
            };

            // 💡 [수정] 예전에는 자료/AI 코어 노드를 누르면 "이 교수님 분석" 버튼과 똑같이
            // 전체 재분석이 돌았습니다. 그 버튼을 없애면서 이 경로도 함께 껐습니다 —
            // 화면에 보이는 분석 버튼은 없는데 그림을 누르면 유료 호출이 나가는 건
            // 사용자가 예측할 수 없는 동작입니다. 이제 이 회로도는 전부 읽기 전용입니다.
            const handleProfessorCircuitNodeClick = () => {};

            return (
              <div>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => setSelectedProfessorId(null)}
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2.5} />
                    {t('professors.backToList')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteProfessor(professor.id, professor.name)}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-danger)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-danger)] rounded px-2 py-1"
                  >
                    {t('professors.deleteProfessor')}
                  </button>
                </div>

                <div className="mb-6">
                  <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">{professor.name}</h1>
                  <p className="text-[var(--text-tertiary)] text-xs sm:text-sm mt-1.5">
                    {subtitle || t('professors.noSchoolDept')}
                  </p>
                </div>

                <div className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-5 mb-6 shadow-sm">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                    <h3 className="text-sm sm:text-base font-bold text-[var(--text-primary)]">{t('professors.documentListTitle', { count: docs.length })}</h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={uploadDocType}
                        onChange={(e) => setUploadDocType(e.target.value)}
                        className="bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg px-2.5 py-2 text-[var(--text-primary)] text-xs outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20"
                      >
                        {docTypeDefs.map((def) => (
                          <option key={def.key} value={def.key}>{def.label}</option>
                        ))}
                      </select>
                      <label
                        className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                          isUploadingProfessorDoc
                            ? 'bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-muted)] cursor-wait'
                            : 'bg-[var(--surface-chip)] hover:bg-[var(--border-chip-hover)] border border-[var(--border-strong)] text-[var(--text-primary)] cursor-pointer'
                        }`}
                      >
                        {isUploadingProfessorDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <UploadCloud className="w-3.5 h-3.5" />}
                        {isUploadingProfessorDoc ? <LoadingText /> : t('professors.uploadPanel.chooseFile')}
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
                  <p className="text-[11px] text-[var(--text-muted)]">{t('professors.uploadPanel.paperHint')}</p>
                  <p className="text-[11px] text-[var(--text-faint)] mb-4">{uploadLimitHint}</p>

                  {docs.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)] text-center py-4">{t('professors.noDocumentsYet')}</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {docs.map((d) => (
                        <div key={d.id} className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] text-sm">
                          <div className="flex items-center justify-between gap-3 p-3">
                            <span className="text-[var(--text-primary)] truncate flex items-center gap-2 min-w-0">
                              <span className="shrink-0">{FORMAT_ICONS[d.format] || '📄'}</span>
                              <span className="truncate">{d.file_name}</span>
                              <span className="shrink-0 text-[10px] font-semibold text-[var(--text-tertiary)] bg-[var(--surface-chip)] border border-[var(--border-chip-hover)] px-2 py-0.5 rounded-full">
                                {docTypeLabels[d.doc_type] || d.doc_type}
                              </span>
                            </span>
                            <div className="shrink-0 flex items-center gap-2.5">
                              {/* 💡 [신규] 문서 1개만 따로 요약 — 이미 만들어둔 요약이 있으면 다시
                                  호출하지 않고 접기/펴기만 합니다. */}
                              <button
                                type="button"
                                onClick={() => handleDigestProfessorDocument(d, professor.id)}
                                disabled={digestingDocId !== null}
                                className="text-xs font-semibold text-[#F4679B] hover:text-[#D1477F] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed cursor-pointer bg-transparent border-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
                              >
                                {digestingDocId === d.id
                                  ? t('professors.digest.docLoading')
                                  : professorDocDigests[d.id]
                                    ? t('professors.digest.docHide')
                                    : t('professors.digest.docButton')}
                              </button>
                              <span className="text-xs text-[var(--text-muted)]">
                                {new Date(d.created_at).toLocaleDateString(locale, { month: 'long', day: 'numeric' })}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeleteProfessorDocument(d.id, professor.id)}
                                aria-label={t('professors.deleteDocumentAria', { fileName: d.file_name })}
                                className="w-6 h-6 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--accent-danger)] hover:bg-[var(--surface-chip)] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-danger)]"
                              >
                                <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                              </button>
                            </div>
                          </div>
                          {professorDocDigests[d.id] && (
                            <div className="border-t border-[var(--border-default)] p-3">
                              {renderTrialResult('digest', professorDocDigests[d.id], t)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {professorDocDigestError?.professorId === professor.id && (
                    <p className="text-sm text-[var(--accent-danger)] mt-3">{professorDocDigestError.message}</p>
                  )}
                </div>

                <div className="bg-[var(--bg-deep)] rounded-2xl border border-[var(--surface-chip)] p-3 sm:p-6 mb-6 shadow-sm">
                  <p className="text-xs text-[var(--text-muted)] text-center mb-3">{t('professors.circuitHint')}</p>
                  <CircuitBoard graph={professorCircuitGraph} onNodeClick={handleProfessorCircuitNodeClick} />
                  {result && (
                    <>
                      <div key={analysisRow?.updated_at} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                        {professorCircuitDefs.map((def, i) => {
                          const card = getProfessorCircuitCardData(result, def.keys);
                          return (
                            <div
                              key={def.nodeId}
                              className="professor-circuit-reveal bg-[var(--bg-page)] border border-[var(--border-default)] rounded-xl p-3.5"
                              style={{ animationDelay: `${i * 300}ms` }}
                            >
                              <h5 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mb-2">{def.label}</h5>
                              {/* 💡 [수정] confident가 아니라 items 유무로 판단합니다 — 자료가 1개여도
                                  근거가 붙은 항목이 있으면 그대로 보여줍니다. 정말 보여줄 게 없을 때만
                                  안내 문구로 대체합니다. */}
                              {card.items.length > 0 ? (
                                <ul className="flex flex-col gap-1">
                                  {card.items.slice(0, 4).map((item, j) => (
                                    <li key={j} className="text-xs text-[var(--text-oncard)] leading-relaxed" title={item.evidence || undefined}>· {item.text}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-[var(--text-faint)]">{t('professors.notConfidentYet')}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-3 text-xs text-[var(--text-muted)] text-center">{t('common.aiGeneratedNotice')}</p>
                    </>
                  )}
                </div>

                {/* 💡 [수정] 여기 있던 "이 교수님 분석" 버튼과 "요약 만들기" 버튼을 모두
                    없앴습니다. 이 탭은 이제 "자료를 쌓고 지금까지 뭐가 파악됐는지 보는 곳"만
                    담당하고, 결과물을 뽑는 건 물어보기 탭의 "교수님 자료로 만들기"가 전담합니다.
                    수동 분석 버튼이 없어도 분석 자체는 계속 최신으로 유지됩니다 — 자료를 올리면
                    recomputeProfessorAnalysisIncremental()이, 지우면 recomputeProfessorAnalysisFull()이
                    자동으로 돌기 때문에 사용자가 눌러줘야 갱신되는 구조가 아니었습니다. */}
                {professorAnalysisError && (
                  <p className="text-sm text-[var(--accent-danger)] mt-3">{professorAnalysisError}</p>
                )}

                {analysisRow && result && (
                  <div className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-5 mt-5 shadow-sm">
                    <p className="text-xs sm:text-sm font-semibold text-[#F4679B] mb-4">
                      {getProfessorAnalysisFramingLine(analysisRow.document_count)}
                    </p>

                    {/* 💡 [신규] 자료가 3개 미만일 때만 뜨는 정확도 안내 — 결과를 막지 않고
                        같이 보여주기만 합니다. */}
                    {showLowDataNotice && (
                      <p className="text-xs text-[var(--text-muted)] bg-[var(--surface-chip)] border border-[var(--border-default)] rounded-lg px-3 py-2.5 mb-4 leading-relaxed">
                        {t('professors.lowDataAccuracyNotice', { count: PROFESSOR_RELIABLE_DOC_COUNT })}
                      </p>
                    )}

                    {defsWithItems.length === 0 ? (
                      <p className="text-sm text-[var(--text-muted)]">{t('professors.notEnoughData')}</p>
                    ) : (
                      <div className="flex flex-col gap-5 sm:gap-4">
                        {defsWithItems.map((def) => (
                          <div key={def.key}>
                            <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mb-2">
                              {def.label}
                              {/* 확신이 낮은(교차 확인 안 된) 카테고리는 라벨 옆에 작게 표시만 합니다. */}
                              {!result[def.key].confident && (
                                <span className="ml-1.5 normal-case font-medium text-[10px] text-[var(--text-faint)]">
                                  {t('professors.tentativeBadge')}
                                </span>
                              )}
                            </h4>
                            <div className="flex flex-wrap gap-2 sm:gap-1.5">
                              {normalizeProfessorItems(result[def.key].items).map((item, i) => (
                                <span
                                  key={i}
                                  title={item.evidence || undefined}
                                  className="bg-[var(--surface-chip)] border border-[var(--border-chip-hover)] text-[var(--text-oncard)] text-xs sm:text-[11px] px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full"
                                >
                                  {item.text}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {emptyDefs.length > 0 && (
                      <div className="mt-6 pt-5 border-t border-[var(--border-default)]">
                        <h4 className="text-sm font-bold text-[var(--text-primary)] mb-2.5">{t('professors.teaserTitle')}</h4>
                        <div className="flex flex-wrap gap-2 sm:gap-1.5 mb-4">
                          {emptyDefs.map((def) => (
                            <span key={def.key} className="bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-faint)] text-xs sm:text-[11px] px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full">
                              {def.label}
                            </span>
                          ))}
                        </div>
                        <label
                          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                            isUploadingProfessorDoc
                              ? 'bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-muted)] cursor-wait'
                              : 'bg-[var(--surface-chip)] hover:bg-[var(--border-chip-hover)] border border-[var(--border-strong)] text-[var(--text-primary)] cursor-pointer'
                          }`}
                        >
                          {isUploadingProfessorDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <UploadCloud className="w-3.5 h-3.5" />}
                          {isUploadingProfessorDoc ? <LoadingText /> : t('professors.uploadDirectly')}
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
                  {t('monitoring.title')}
                </h1>
                <p className="text-[var(--text-tertiary)] text-xs sm:text-sm mt-1.5">
                  {t('monitoring.subtitle')}
                </p>
              </div>

              <div className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-5 mb-6 shadow-sm">
                <h3 className="text-sm sm:text-base font-bold mb-4 text-[var(--text-primary)]">{t('monitoring.uploadSectionTitle')}</h3>

                <div className="mb-5">
                  <label className="inline-flex bg-[#F4679B] hover:bg-[#D1477F] text-white px-5 py-2.5 rounded-lg text-sm font-semibold cursor-pointer items-center gap-2 transition-colors">
                    <span>{t('monitoring.attachButton')}</span>
                    <input
                      type="file"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <p className="text-[11px] text-[var(--text-faint)] mb-4">{uploadLimitHint}</p>

                <div className="text-xs text-[var(--text-muted)] mb-5 flex items-center gap-3">
                  <hr className="flex-1 border-[var(--border-default)]" />
                  <span>{t('monitoring.orDivider')}</span>
                  <hr className="flex-1 border-[var(--border-default)]" />
                </div>

                <form onSubmit={handleAddFile} className="flex flex-col gap-3">
                  <input
                    type="text"
                    placeholder={t('monitoring.form.titlePlaceholder')}
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    className="bg-[var(--bg-page)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[var(--text-muted)]"
                  />
                  <textarea
                    placeholder={t('monitoring.form.contentPlaceholder')}
                    value={newFileContent}
                    onChange={(e) => setNewFileContent(e.target.value)}
                    rows={3}
                    className="bg-[var(--bg-page)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-[var(--text-primary)] text-sm outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 resize-none placeholder:text-[var(--text-muted)]"
                  />
                  <button type="submit" className="self-end bg-[var(--bg-page)] hover:bg-[var(--bg-surface)] text-[var(--text-primary)] px-5 py-2.5 rounded-lg text-sm font-semibold border border-[var(--border-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]">
                    {t('monitoring.form.submit')}
                  </button>
                </form>

                <div className="mt-8 flex flex-col gap-2">
                  <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">{t('monitoring.fileListTitle')}</h4>
                  {files.length === 0 && (
                    <div className="text-sm text-[var(--text-muted)] text-center py-4">{t('monitoring.noFiles')}</div>
                  )}
                  {files.map(file => (
                    <div key={file.id} className="flex flex-col bg-[var(--bg-page-alt)] p-3.5 rounded-lg border border-[var(--border-default)] text-sm gap-1">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-[#F4679B]">📄 {file.name} <span className="text-xs text-[var(--text-muted)] font-normal">({file.size})</span></span>
                        <button onClick={() => handleDeleteFile(file.id)} className="text-[var(--accent-danger)] hover:text-[var(--text-error)] text-xs px-2 py-1 bg-[var(--bg-error-subtle)] rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-danger)]">{t('common.delete')}</button>
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] truncate mt-1">{t('monitoring.fileType', { mimeType: file.mimeType || 'text/plain' })}</p>
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
                  {t('logs.title')}
                </h1>
                <p className="text-[var(--text-tertiary)] text-xs sm:text-sm mt-1.5">
                  {t('logs.subtitle')}
                </p>
              </div>

              {/* 💡 [신규] 폴더 목록 — 전체/미분류/각 폴더로 지난 대화를 걸러 봅니다. */}
              <div className="flex flex-wrap items-center gap-2 mb-5">
                <button
                  type="button"
                  onClick={() => setLogFolderFilter('all')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                    logFolderFilter === 'all'
                      ? 'bg-[var(--bg-accent-subtle)] text-[#F4679B] border-[#F4679B]'
                      : 'bg-[var(--bg-page)] text-[var(--text-tertiary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {t('logs.filterAll', { count: logs.length })}
                </button>
                <button
                  type="button"
                  onClick={() => setLogFolderFilter('unfiled')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                    logFolderFilter === 'unfiled'
                      ? 'bg-[var(--bg-accent-subtle)] text-[#F4679B] border-[#F4679B]'
                      : 'bg-[var(--bg-page)] text-[var(--text-tertiary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {t('logs.filterUnfiled', { count: logs.filter((l) => !l.folder_id).length })}
                </button>
                {conversationFolders.map((folder) => (
                  <span
                    key={folder.id}
                    className={`inline-flex items-center gap-1 rounded-full border pl-3 pr-1.5 py-1 transition-colors ${
                      logFolderFilter === folder.id
                        ? 'bg-[var(--bg-accent-subtle)] text-[#F4679B] border-[#F4679B]'
                        : 'bg-[var(--bg-page)] text-[var(--text-tertiary)] border-[var(--border-default)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setLogFolderFilter(folder.id)}
                      className="text-xs font-semibold cursor-pointer hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
                    >
                      {t('logs.folderButtonLabel', { name: folder.name, count: logs.filter((l) => l.folder_id === folder.id).length })}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteFolder(folder.id, folder.name)}
                      aria-label={t('logs.deleteFolderAria', { folderName: folder.name })}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-[var(--surface-chip)] text-[var(--text-muted)] hover:text-[var(--accent-danger)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-danger)]"
                    >
                      <X className="w-3 h-3" strokeWidth={2.5} />
                    </button>
                  </span>
                ))}
                <form
                  onSubmit={(e) => { e.preventDefault(); handleCreateFolder(); }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder={t('logs.newFolderPlaceholder')}
                    className="w-24 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-full px-3 py-1.5 text-[var(--text-primary)] text-xs outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 placeholder:text-[var(--text-muted)]"
                  />
                  <button
                    type="submit"
                    disabled={!newFolderName.trim() || isCreatingFolder}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--surface-chip)] hover:bg-[var(--border-chip-hover)] text-[var(--text-primary)] border border-[var(--border-strong)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                  >
                    {t('common.create')}
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
                      <div className="text-sm text-[var(--text-muted)] text-center py-8 bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)]">
                        {logs.length === 0 ? t('logs.noConversationsAtAll') : t('logs.noConversationsInFolder')}
                      </div>
                    );
                  }
                  return filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <div key={log.id} className="bg-[var(--bg-page)] rounded-2xl border border-[var(--border-default)] p-4 flex flex-col gap-3 shadow-sm">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                        <div className="flex items-center gap-2 font-mono-console text-xs text-[#F4679B]">
                          <span className="text-[var(--text-muted)]">[{new Date(log.created_at).toLocaleTimeString(locale)}]</span>
                          <span className="font-semibold text-[var(--text-primary)]">{log.content}</span>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                          <select
                            value={log.folder_id || ''}
                            onChange={(e) => handleMoveLogToFolder(log.id, e.target.value || null)}
                            aria-label={t('logs.moveToFolderAria')}
                            className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-2 py-1.5 text-[var(--text-tertiary)] text-xs outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 cursor-pointer"
                          >
                            <option value="">{t('logs.unfiledOption')}</option>
                            {conversationFolders.map((folder) => (
                              <option key={folder.id} value={folder.id}>{folder.name}</option>
                            ))}
                          </select>
                          {log.response && (
                            <button
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              className="bg-[var(--bg-accent-subtle)] hover:bg-[var(--bg-accent-subtle-hover)] text-[#F4679B] border border-[var(--border-accent-subtle)] text-xs px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                            >
                              {isExpanded ? t('logs.collapseAnswer') : t('logs.viewAnswer')}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteLog(log.id)}
                            aria-label={t('logs.deleteLogAria')}
                            className="w-7 h-7 flex items-center justify-center bg-[var(--bg-surface)] hover:bg-[var(--bg-error-subtle)] text-[var(--text-muted)] hover:text-[var(--accent-danger)] border border-[var(--border-default)] rounded-lg text-xs transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-danger)]"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {isExpanded && log.response && (
                        <div className="bg-[var(--bg-deep)] p-4 rounded-lg border border-[var(--surface-chip)] text-[14px] font-medium text-[var(--text-ai-response)] leading-[1.8] whitespace-pre-wrap mt-1">
                          <div className="text-[11px] text-[var(--text-muted)] mb-2">{t('logs.responseRecordLabel')}</div>
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

    {/* 💡 [신규] 유료 전환 준비 — 한도 도달 시 자동으로 열리거나, "Pro" 배지를 눌러 언제든
        열 수 있는 업그레이드 요청 폼. 결제는 아직 연결하지 않고 이메일/메모만 pro_requests에
        저장합니다. 이 앱에서 처음 쓰는 오버레이 모달이라 좁은 화면에서도 잘리지 않도록
        max-h-[90vh] overflow-y-auto로 감쌉니다. */}
    {/* 💡 [신규] "맨 아래로" 버튼 — 위로 올라가 자동 따라가기가 멈춘 동안에만 뜹니다.
        채팅 UI에서 흔한 패턴이고, 자동 스크롤을 껐을 때 "다시 최신으로 가는 길"이 없으면
        긴 답변에서 바닥까지 손으로 끌어내려야 합니다.
        z-40은 모달(z-60)보다 아래라, 모달이 열려 있을 땐 그 위로 떠오르지 않습니다. */}
    {!isNearBottom && (
      <button
        type="button"
        onClick={() => scrollToBottom('smooth')}
        aria-label={t('workspace.scrollToBottom')}
        title={t('workspace.scrollToBottom')}
        className="fixed bottom-6 right-6 z-40 w-10 h-10 rounded-full bg-[var(--bg-page)] border border-[var(--border-strong)] text-[var(--text-secondary)] shadow-lg hover:text-[var(--text-primary)] hover:border-[#F4679B] flex items-center justify-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
      >
        <ArrowDown className="w-4 h-4" strokeWidth={2.5} />
      </button>
    )}

    {showOnboarding && (
      <OnboardingModal
        t={t}
        onClose={dismissOnboarding}
        onSelectStep={(target) => {
          dismissOnboarding();
          setActiveTab(target);
        }}
      />
    )}

    {/* 💡 [신규] 소사이어티 코드 월 사용 상한 안내 카드. 예전에는 서버가 돌려준 영어 문구
        하나가 Pro 결제 모달에 그대로 실려 떴는데, (1) 12개 언어를 쓰는 앱에서 이 안내만
        영어였고 (2) 결제로 즉시 풀리는 상한이 아닌데 결제를 권하고 있었습니다. 문구는
        여기서 지역화하고(서버는 사용자의 화면 언어를 모릅니다), 결제 유도 없이 "다음 달에
        초기화된다"는 사실만 전합니다. */}
    {isSocietyCodeLimitOpen && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
        onClick={() => setIsSocietyCodeLimitOpen(false)}
      >
        <div
          className="bg-[var(--bg-page)] border border-[var(--border-default)] rounded-2xl p-6 w-full max-w-sm shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col items-center text-center gap-3">
            <span className="text-3xl">🥕</span>
            <h3 className="text-base font-bold text-[var(--text-primary)]">
              {t('societyCodeLimit.title')}
            </h3>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {t('societyCodeLimit.body')}
            </p>
            {/* 💡 [수정] 소사이어티 코드 사용자는 이미 Pro를 써본 사람이라, 무료 사용자에게
                띄우는 "가입하세요"와 같은 안내를 보여줄 이유가 없습니다. 바로 결제로
                이어지는 CTA를 1순위로 둡니다. */}
            {user && (
              <a
                href={getPolarCheckoutUrl(user.id, user.email)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsSocietyCodeLimitOpen(false)}
                className="mt-2 w-full bg-[#F4679B] hover:bg-[#D1477F] text-white px-5 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] text-center"
              >
                {t('societyCodeLimit.cta')}
              </a>
            )}
            <button
              type="button"
              onClick={() => setIsSocietyCodeLimitOpen(false)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
            >
              {t('societyCodeLimit.close')}
            </button>
          </div>
        </div>
      </div>
    )}

    {isUpgradeModalOpen && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
        onClick={closeUpgradeModal}
      >
        <div
          className="bg-[var(--bg-page)] border border-[var(--border-default)] rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {upgradeRequestSubmitted ? (
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <span className="text-3xl">✨</span>
              <h3 className="text-base font-bold text-[var(--text-primary)]">{t('upgrade.requestReceivedTitle')}</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{t('upgrade.requestReceivedDesc')}</p>
              <button
                type="button"
                onClick={closeUpgradeModal}
                className="mt-2 bg-[#F4679B] hover:bg-[#D1477F] text-white text-sm font-semibold px-5 py-2.5 rounded-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
              >
                {t('common.close')}
              </button>
            </div>
          ) : (
            <>
              <h3 className="text-base font-bold text-[var(--text-primary)] mb-1.5">{t('upgrade.title')}</h3>
              <p className="text-sm font-bold text-[#F4679B] mb-3">{t('upgrade.priceLine', { price: PRO_PRICE_LABEL })}</p>
              <p className="text-xs text-[var(--text-tertiary)] mb-4 leading-relaxed">
                {upgradeContext || t('upgrade.defaultContext')}
              </p>
              {/* 💡 [신규] Polar 결제 연동 — 실제 결제는 이 링크 하나로 끝. reference_id로
                  실어 보낸 user.id가 웹훅(app/api/webhooks/polar)을 통해 profiles.is_pro를
                  자동으로 켭니다. 새 탭으로 열어서 결제 중에도 앱 상태(입력 중이던 내용 등)가
                  날아가지 않게 합니다. */}
              {/* 💡 [신규] 전환 퍼널의 "결제" 단계 — 결제 완료가 아니라 이 체크아웃 링크
                  클릭 시점을 기록합니다(결제 완료 확인은 웹훅에서 일어나는데, 익명 anon_id를
                  거기까지 전달하려면 Polar 체크아웃 메타데이터 왕복이 추가로 필요해서 이번
                  버전은 클릭=결제 시도로 단순화했습니다). target="_blank"라 네비게이션을
                  막을 필요가 없어 그냥 fire-and-forget으로 호출합니다. */}
              <a
                href={user ? getPolarCheckoutUrl(user.id, user.email) : '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackFunnelEvent('payment')}
                className="block text-center bg-[#F4679B] hover:bg-[#D1477F] text-white text-sm font-semibold px-4 py-2.5 rounded-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
              >
                {t('upgrade.checkoutButton')}
              </a>

              {/* 💡 [신규] 소사이어티 코드 입력 — 결제 없이 코드로 Pro가 되는 경로.
                  이미 코드로 성공했으면(societyCodeRedeemed) 폼 대신 완료 메시지만 보여줍니다. */}
              <div className="flex items-center gap-2 my-4">
                <div className="flex-1 h-px bg-[var(--border-default)]" />
                <span className="text-[10px] text-[var(--text-faint)]">{t('upgrade.societyCode.divider')}</span>
                <div className="flex-1 h-px bg-[var(--border-default)]" />
              </div>
              {societyCodeRedeemed ? (
                <p className="text-xs text-[#6EE7B7] text-center">{t('upgrade.societyCode.success')}</p>
              ) : (
                <form onSubmit={handleRedeemSocietyCode} className="flex flex-col gap-2">
                  <label className="block text-xs font-semibold text-[var(--text-tertiary)]">
                    {t('upgrade.societyCode.label')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={societyCode}
                      onChange={(e) => setSocietyCode(e.target.value)}
                      placeholder={t('upgrade.societyCode.placeholder')}
                      className="flex-1 min-w-0 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 transition-colors placeholder:text-[var(--text-faint)] font-mono"
                    />
                    <button
                      type="submit"
                      disabled={isRedeemingSocietyCode || !societyCode.trim()}
                      className="shrink-0 bg-[var(--bg-surface)] hover:bg-[var(--bg-deep)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--text-secondary)] border border-[var(--border-default)] text-sm font-semibold px-4 py-2.5 rounded-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                    >
                      {isRedeemingSocietyCode ? t('upgrade.societyCode.applying') : t('upgrade.societyCode.applyButton')}
                    </button>
                  </div>
                  {societyCodeError && <p className="text-xs text-[var(--accent-danger)]">{societyCodeError}</p>}
                </form>
              )}

              <div className="flex items-center gap-2 my-4">
                <div className="flex-1 h-px bg-[var(--border-default)]" />
                <span className="text-[10px] text-[var(--text-faint)]">{t('upgrade.orContactDivider')}</span>
                <div className="flex-1 h-px bg-[var(--border-default)]" />
              </div>
              <form onSubmit={handleSubmitUpgradeRequest} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-tertiary)] mb-1.5">{t('upgrade.emailLabel')}</label>
                  <input
                    type="email"
                    required
                    value={upgradeEmail}
                    onChange={(e) => setUpgradeEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 transition-colors placeholder:text-[var(--text-faint)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-tertiary)] mb-1.5">{t('upgrade.memoLabel')}</label>
                  <textarea
                    value={upgradeMemo}
                    onChange={(e) => setUpgradeMemo(e.target.value)}
                    rows={3}
                    placeholder={t('upgrade.memoPlaceholder')}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#F4679B] focus:ring-2 focus:ring-[#F4679B]/20 transition-colors placeholder:text-[var(--text-faint)] resize-none"
                  />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={closeUpgradeModal}
                    className="flex-1 bg-[var(--bg-surface)] hover:bg-[var(--bg-deep)] text-[var(--text-secondary)] border border-[var(--border-default)] text-sm font-semibold px-4 py-2.5 rounded-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-muted)]"
                  >
                    {t('common.close')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingUpgradeRequest || !upgradeEmail.trim()}
                    className="flex-1 bg-[#F4679B] hover:bg-[#D1477F] disabled:bg-[var(--surface-chip)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2.5 rounded-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
                  >
                    {isSubmittingUpgradeRequest ? t('upgrade.sending') : t('upgrade.sendRequest')}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    )}

    {/* 💡 [신규] Pro 구독 중 계정 삭제 경고 모달 — handleDeleteAccount가 profiles.is_pro가
        true일 때 window.confirm() 대신 이 모달을 엽니다. 체크박스(deleteAcknowledged)를
        명시적으로 체크해야만 아래 "계정 삭제" 버튼이 활성화됩니다. */}
    {isProDeleteWarningOpen && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
        onClick={closeProDeleteWarning}
      >
        <div
          className="bg-[var(--bg-page)] border border-[var(--accent-danger)]/50 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-base font-bold text-[var(--text-primary)] mb-1.5">
            {t('account.proWarningTitle')}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
            {t('account.proWarningBody')}
          </p>
          <a
            href={getPolarCustomerPortalUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center bg-[#F4679B] hover:bg-[#D1477F] text-white text-sm font-semibold px-4 py-2.5 rounded-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B]"
          >
            {t('account.goToPortalButton')}
          </a>

          <div className="flex items-center gap-2 my-4">
            <div className="flex-1 h-px bg-[var(--border-default)]" />
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={deleteAcknowledged}
              onChange={(e) => setDeleteAcknowledged(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--accent-danger)] cursor-pointer"
            />
            <span className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {t('account.acknowledgeCheckboxLabel')}
            </span>
          </label>

          <div className="flex items-center gap-2 mt-5">
            <button
              type="button"
              onClick={closeProDeleteWarning}
              className="flex-1 bg-[var(--bg-surface)] hover:bg-[var(--bg-deep)] text-[var(--text-secondary)] border border-[var(--border-default)] text-sm font-semibold px-4 py-2.5 rounded-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-muted)]"
            >
              {t('common.close')}
            </button>
            <button
              type="button"
              onClick={handleConfirmDeleteWithActiveSubscription}
              disabled={!deleteAcknowledged || isDeletingAccount}
              className="flex-1 bg-[var(--accent-danger)] hover:opacity-90 disabled:bg-[var(--surface-chip)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2.5 rounded-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-danger)]"
            >
              {isDeletingAccount ? t('account.deleting') : t('account.delete')}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
