import { Search, FileText, CalendarClock, PenLine, NotebookPen } from 'lucide-react';
import type { McpBlock } from '@/types/blocks';

// 💡 [개선] 새로고침해도 블록 활성 상태가 유지되도록 로컬스토리지 연동 구조 적용
// (이 초기값은 이 계정으로 저장된 적이 있는지 확인하기 전 아주 잠깐 쓰이는 값이자,
// 로컬 저장 데이터가 전혀 없는 신규 계정의 최종 상태이기도 합니다 — 그래서 전부 비활성으로 시작합니다.)
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
