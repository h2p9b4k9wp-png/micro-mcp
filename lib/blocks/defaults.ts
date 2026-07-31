import { FileText, Library, Search, CalendarClock, HelpCircle, NotebookPen, CalendarPlus, CalendarSync, FileDown, GraduationCap, Cpu, ClipboardList, BookOpen, Camera } from 'lucide-react';
import type { CircuitNode } from '@/types/blocks';

// 💡 [신규] 3계층 노드 레지스트리 (source → lens → action). 예전 5개 블록(McpBlock, on/off 토글) 모델은
// 이번 단계로 완전히 대체되어 삭제되었습니다. 연결 규칙 자체(같은 계층 금지, lens는 그래프에 1개, 방향 등)는
// lib/circuit/validate.ts에서 검증합니다 — 이 파일은 순수하게 "어떤 노드가 존재하는지"만 정의합니다.
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

  // 💡 [신규] "교수님" 상세 화면 회로도 전용 (물어보기 미니 전선과는 별개 그래프) — recomputeProfessorAnalysis
  // 결과를 예상 문제/과제 방향/공부 방식 3갈래로 나눠 보여줄 때 씁니다.
  {
    id: 'professor_docs',
    layer: 'source',
    label: '이 교수님 자료',
    hint: '지금까지 올린 자료 전체를 참고해요',
    icon: GraduationCap,
    estimatedSeconds: 0,
  },
  {
    id: 'professor_ai_core',
    layer: 'lens',
    label: 'AI 분석',
    hint: '올라온 자료를 종합해서 패턴을 찾아요',
    icon: Cpu,
    estimatedSeconds: 6,
  },
  {
    id: 'expected_questions',
    layer: 'action',
    label: '예상 문제',
    hint: '문제 내는 방식·유형을 바탕으로 예상해요',
    icon: HelpCircle,
    estimatedSeconds: 0,
  },
  {
    id: 'assignment_direction',
    layer: 'action',
    label: '과제 방향',
    hint: '과제를 요구하는 스타일을 알려줘요',
    icon: ClipboardList,
    estimatedSeconds: 0,
  },
  {
    id: 'study_method',
    layer: 'action',
    label: '공부 방식',
    hint: '자주 강조하는 주제를 중심으로 알려줘요',
    icon: BookOpen,
    estimatedSeconds: 0,
  },

  // 💡 [신규] 게스트 가이드 체험(로그인 없이 이미지 1장 업로드) 전용 source/lens 노드.
  // action 레이어는 위의 'questions'/'digest'를 그대로 재사용합니다 — 같은 개념(예상
  // 질문/핵심 정리)이라 새 라벨을 또 만들지 않았습니다.
  {
    id: 'guest_upload',
    layer: 'source',
    label: '업로드한 사진',
    hint: '사진이나 캡처본 한 장을 참고해요',
    icon: Camera,
    estimatedSeconds: 0,
  },
  {
    id: 'guest_ai_core',
    layer: 'lens',
    label: 'AI 분석',
    hint: '사진 속 내용을 읽고 분석해요',
    icon: Cpu,
    estimatedSeconds: 6,
  },
];
