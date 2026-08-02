'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { CircuitBoard } from '@/components/circuit/circuit-board';
import type { CircuitGraphState } from '@/types/blocks';

// 💡 [수정] /welcome의 "교수님별 정리" 기능 섹션 전용 — 실제 API를 부르지 않는 더미 데이터
// 데모입니다(로그인 후 실제 "교수님" 탭이 하는 일을 미리 체험시켜주는 용도). 교수님 이름·
// 강의·예상 문제·요약·강조 포인트는 원래 한국어로 하드코딩돼 있었는데, 일본어 등 다른
// 로케일로 전환해도 이 더미 데이터만 한국어 그대로 남아있어 "번역기 돌린 한국 앱"처럼
// 보인다는 문제가 있었습니다 — 이제 messages/*.json의 landing.professorSection.demo에서
// t.raw()로 통째로 읽어옵니다. 단순 직역이 아니라 로케일별로 실제 그 언어권에서 자연스러운
// 교수님 이름(예: 일본어는 田中先生, 영어는 Prof. Smith)과 과목명을 씁니다. id는 번역
// 대상이 아니라 그냥 React key/선택 상태용이라 여기 그대로 둡니다.
interface DemoProfessorContent {
  name: string;
  subject: string;
  emphasis: string[];
  questions: string[];
  summary: string;
}

interface DemoProfessor extends DemoProfessorContent {
  id: string;
}

const DEMO_PROFESSOR_IDS = ['p1', 'p2', 'p3'] as const;

type DemoPhase = 'prompted' | 'running' | 'done';

export function ProfessorDemo() {
  const t = useTranslations();
  // t.raw()는 ICU 처리 없이 messages 파일의 원본 JSON 값을 그대로 반환합니다 — 문자열
  // 배열/객체 배열인 emphasis·questions·professors 목록을 그대로 쓰기 위해 필요합니다.
  const demoProfessors = t.raw('landing.professorSection.demo.professors') as DemoProfessorContent[];
  const DEMO_PROFESSORS: DemoProfessor[] = demoProfessors.map((content, i) => ({
    ...content,
    id: DEMO_PROFESSOR_IDS[i],
  }));
  const [selectedId, setSelectedId] = useState<string>(DEMO_PROFESSOR_IDS[0]);
  const [phase, setPhase] = useState<DemoPhase>('done');
  const isFirstRender = useRef(true);

  // 첫 렌더에는 이미 첫 번째 교수님 결과가 다 나와 있는 상태로 보여줍니다(히어로의 자동
  // 루프 데모가 이미 "이렇게 동작해요"를 보여준 뒤라, 여기서 또 지연 없이 바로 결과를
  // 보여주는 게 낫습니다) — 사용자가 실제로 카드를 클릭했을 때만 prompted→running→done을
  // 재생해서 "클릭이 뭔가를 했다"는 피드백을 줍니다.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setPhase('prompted');
    const t1 = setTimeout(() => setPhase('running'), 450);
    const t2 = setTimeout(() => setPhase('done'), 1600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [selectedId]);

  const selected = DEMO_PROFESSORS.find((p) => p.id === selectedId) ?? DEMO_PROFESSORS[0];

  const graph: CircuitGraphState = {
    nodes: [
      { id: 'professor_docs', layer: 'source', status: 'done' },
      { id: 'professor_ai_core', layer: 'lens', status: phase === 'running' ? 'running' : 'done' },
      { id: 'expected_questions', layer: 'action', status: phase === 'done' ? 'done' : 'idle' },
      { id: 'professor_summary', layer: 'action', status: phase === 'done' ? 'done' : 'idle' },
      { id: 'professor_emphasis', layer: 'action', status: phase === 'done' ? 'done' : 'idle' },
    ],
    edges: [
      { from: 'professor_docs', to: 'professor_ai_core' },
      { from: 'professor_ai_core', to: 'expected_questions' },
      { from: 'professor_ai_core', to: 'professor_summary' },
      { from: 'professor_ai_core', to: 'professor_emphasis' },
    ],
  };

  return (
    <div className="w-full">
      {/* 교수님 카드 목록 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {DEMO_PROFESSORS.map((p) => {
          const isSelected = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`relative text-left rounded-2xl border p-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
                isSelected
                  ? 'border-[#F4679B] bg-[#FFF0F5]'
                  : 'border-[#E5E1EA] bg-white hover:border-[#F4679B]/40'
              }`}
            >
              {isSelected && (
                <span className="absolute top-3 right-3 w-4 h-4 rounded-full bg-[#F4679B] flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                </span>
              )}
              <p className="break-keep text-sm font-bold text-[#1C1922] pr-5">{p.name}</p>
              <p className="break-keep text-xs text-[#857C93] mt-0.5">{p.subject}</p>
            </button>
          );
        })}
      </div>

      {/* 자동 프롬프트 적용 */}
      <div
        key={`prompt-${selectedId}`}
        className="professor-circuit-reveal mb-5 flex items-center gap-2 bg-[#15131A] border border-[#2A2632] rounded-xl px-4 py-3 text-left"
      >
        <span className="text-xs font-semibold text-[#6EE7B7] shrink-0">
          ✓ {t('landing.professorSection.demo.autoPromptLabel')}
        </span>
        <p className="break-keep text-sm text-[#E4DEEA] truncate">
          {t('landing.professorSection.demo.promptTemplate', { name: selected.name })}
        </p>
      </div>

      <div key={`circuit-${selectedId}`} className="w-full bg-[#15131A] rounded-[28px] border border-[#2A2632] p-4 sm:p-8">
        <CircuitBoard graph={graph} onNodeClick={() => {}} pannable={false} />

        {phase === 'done' && (
          <div className="w-full max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2 text-left">
            <div className="professor-circuit-reveal bg-[#211E28] border border-[#322D3B] rounded-xl p-3.5">
              <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-2.5">
                {t('nodes.expected_questions.label')}
              </p>
              <ul className="flex flex-col gap-2">
                {selected.questions.map((q, i) => (
                  <li key={i} className="break-keep text-xs text-[#E4DEEA]">Q. {q}</li>
                ))}
              </ul>
            </div>
            <div
              className="professor-circuit-reveal bg-[#211E28] border border-[#322D3B] rounded-xl p-3.5"
              style={{ animationDelay: '150ms' }}
            >
              <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-2.5">
                {t('nodes.professor_summary.label')}
              </p>
              <p className="break-keep text-xs text-[#E4DEEA] leading-relaxed">{selected.summary}</p>
            </div>
            <div
              className="professor-circuit-reveal bg-[#211E28] border border-[#322D3B] rounded-xl p-3.5"
              style={{ animationDelay: '300ms' }}
            >
              <p className="text-xs font-semibold text-[#857C93] uppercase tracking-wide mb-2.5">
                {t('nodes.professor_emphasis.label')}
              </p>
              <ul className="flex flex-col gap-1.5">
                {selected.emphasis.map((e, i) => (
                  <li key={i} className="break-keep text-xs text-[#E4DEEA] list-disc list-inside ml-1">{e}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
