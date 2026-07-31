'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { CircuitBoard } from '@/components/circuit/circuit-board';
import type { CircuitGraphState } from '@/types/blocks';

// 💡 [신규] /welcome의 "교수님별 정리" 기능 섹션 전용 — 실제 API를 부르지 않는 더미 데이터
// 데모입니다(로그인 후 실제 "교수님" 탭이 하는 일을 미리 체험시켜주는 용도). 교수님 이름·
// 강의·예상 문제·요약·강조 포인트는 전부 한국어 더미 콘텐츠라 next-intl로 번역하지
// 않습니다(실제 앱의 AI 응답이 늘 한국어 원문 자료를 다루는 것과 같은 맥락) — 반면 섹션
// 제목/설명, 카드 위 라벨(예상 문제/핵심 요약/강조 포인트)은 NODE_REGISTRY를 통해 정상적으로
// 10개 로케일 번역을 씁니다.
interface DemoProfessor {
  id: string;
  name: string;
  subject: string;
  emphasis: string[];
  questions: string[];
  summary: string;
}

const DEMO_PROFESSORS: DemoProfessor[] = [
  {
    id: 'p1',
    name: '김민준 교수님',
    subject: '소프트웨어공학',
    emphasis: [
      '설계 원칙(SOLID)과 실무 적용 사례를 항상 강조',
      '이론보다 실제 코드 리뷰 예시를 중요하게 다룸',
    ],
    questions: [
      'SOLID 원칙 중 하나를 골라 실제 코드로 설명하시오',
      '애자일과 폭포수 모델의 차이를 실무 관점에서 서술하시오',
    ],
    summary: '이번 학기는 설계 원칙과 코드 품질에 집중 — 이론보다 사례 중심 출제 경향이에요.',
  },
  {
    id: 'p2',
    name: '이서연 교수님',
    subject: '데이터베이스',
    emphasis: [
      '정규화 과정을 단계별로 짚어주는 걸 좋아함',
      '실습 위주 문제 출제, 쿼리 작성 비중 높음',
    ],
    questions: [
      '3정규형까지의 정규화 과정을 예시 테이블로 설명하시오',
      'JOIN 종류별 차이를 SQL 예시와 함께 서술하시오',
    ],
    summary: '정규화·SQL 실습 비중이 높고, 개념보다 직접 풀어보는 문제 위주예요.',
  },
  {
    id: 'p3',
    name: '박도윤 교수님',
    subject: '알고리즘',
    emphasis: [
      '시간복잡도 분석을 항상 손으로 계산하게 함',
      '그리디·DP 비교 문제를 자주 냄',
    ],
    questions: [
      '주어진 알고리즘의 시간복잡도를 빅오 표기법으로 분석하시오',
      '그리디 알고리즘이 최적해를 보장하지 못하는 예를 드시오',
    ],
    summary: '복잡도 분석과 그리디/DP 비교가 핵심, 손풀이 방식을 선호해요.',
  },
];

type DemoPhase = 'prompted' | 'running' | 'done';

export function ProfessorDemo() {
  const t = useTranslations();
  const [selectedId, setSelectedId] = useState(DEMO_PROFESSORS[0].id);
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
        <span className="text-xs font-semibold text-[#6EE7B7] shrink-0">✓ 자동 프롬프트 적용</span>
        <p className="break-keep text-sm text-[#E4DEEA] truncate">
          &ldquo;{selected.name} 자료 기반으로 예상 문제와 핵심 요약 뽑아줘&rdquo;
        </p>
      </div>

      <div key={`circuit-${selectedId}`} className="w-full bg-[#15131A] rounded-[28px] border border-[#2A2632] p-4 sm:p-8">
        <CircuitBoard graph={graph} onNodeClick={() => {}} />

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
