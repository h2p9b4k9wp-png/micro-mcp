import { FileText, Library, Search, CalendarClock, PenLine, HelpCircle, NotebookPen, CalendarPlus, CalendarSync, FileDown } from 'lucide-react';
import type { McpBlock, CircuitNode } from '@/types/blocks';

// @deprecated 3단계에서 제거 예정 — McpBlock(on/off 토글) 기반 구버전 블록 목록.
// NODE_REGISTRY(3계층 노드 그래프 모델)로 대체되는 중이지만, app/page.tsx가 아직 McpBlock 형태를
// 그대로 쓰고 있어서 빌드가 깨지지 않도록 당분간 나란히 export합니다.
export const DEFAULT_BLOCKS: McpBlock[] = [
  {
    id: 'search',
    name: '최신 정보 검색',
    description: '뉴스, 시세, 최신 트렌드처럼 실시간 정보가 필요한 질문에 웹 검색 결과를 반영해서 답변합니다.',
    active: false,
    icon: Search,
    config: { apiKey: 'Live Web Grounding Ready' }
  },
  {
    id: 'filesystem',
    name: '문서 분석 & 요약',
    description: '업로드한 강의자료, 보고서, 계약서, 엑셀 표를 AI가 읽고 답변에 정확히 반영합니다. (엑셀, HWP, PPT, 워드, PDF 텍스트 지원)',
    active: false,
    icon: FileText,
    config: { statusText: 'Local RAG Engine Active' }
  },
  {
    id: 'deadlines',
    name: '마감일 인식',
    description: '마감일 매니저에 등록한 과제·시험·업무 일정을 AI가 파악해서, "오늘 뭐부터 해야 하지?" 같은 질문에 실제 일정 기준으로 답합니다.',
    active: false,
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
];

// 💡 [신규] 3계층 노드 레지스트리 (source → lens → action). 예전 5개 블록(McpBlock, on/off 토글) 모델을
// 대체합니다. 연결 규칙 자체(같은 계층 금지, lens는 그래프에 1개, 방향 등)는 lib/circuit/validate.ts에서
// 검증합니다 — 이 파일은 순수하게 "어떤 노드가 존재하는지"만 정의합니다.
//
// 아이콘은 기존 5개 블록에서 쓰던 것을 최대한 재활용했습니다:
// FileText(문서 분석 & 요약), Search(최신 정보 검색), CalendarClock(마감일 인식), NotebookPen(회의·강의 노트 정리).
export const NODE_REGISTRY: CircuitNode[] = [
  // source
  {
    id: 'this_doc',
    layer: 'source',
    label: '이 문서',
    hint: '지금 보고 있는 문서만 참고해요',
    icon: FileText,
    estimatedSeconds: 0,
  },
  {
    id: 'my_library',
    layer: 'source',
    label: '내 자료실',
    hint: '저장해둔 자료 전체에서 찾아요',
    icon: Library,
    estimatedSeconds: 2,
    minLibraryDocs: 5,
  },
  {
    id: 'web_search',
    layer: 'source',
    label: '웹에서 찾기',
    hint: '실시간으로 웹을 검색해요',
    icon: Search,
    estimatedSeconds: 8,
  },

  // lens
  {
    id: 'deadlines',
    layer: 'lens',
    label: '마감 뽑기',
    hint: '날짜·기한이 있는 항목만 골라내요',
    icon: CalendarClock,
    estimatedSeconds: 3,
  },
  {
    id: 'questions',
    layer: 'lens',
    label: '예상 질문',
    hint: '나올 법한 질문을 미리 뽑아봐요',
    icon: HelpCircle,
    estimatedSeconds: 5,
  },
  {
    id: 'digest',
    layer: 'lens',
    label: '핵심 정리',
    hint: '핵심만 간추려 정리해요',
    icon: NotebookPen,
    estimatedSeconds: 4,
  },

  // action
  {
    id: 'save_deadline',
    layer: 'action',
    label: '마감일로 등록',
    hint: '찾아낸 일정을 마감일 매니저에 저장해요',
    icon: CalendarPlus,
    estimatedSeconds: 0,
    defaultForLens: 'deadlines',
  },
  {
    id: 'sync_calendar',
    layer: 'action',
    label: '캘린더에 넣기',
    hint: '외부 캘린더 앱으로 내보내요',
    icon: CalendarSync,
    estimatedSeconds: 1,
  },
  {
    id: 'export_hwp',
    layer: 'action',
    label: '한글로 내보내기',
    hint: '결과를 한글(HWP) 파일로 저장해요',
    icon: FileDown,
    estimatedSeconds: 2,
  },
];
