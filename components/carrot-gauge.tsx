'use client';

// 💡 [신규] 남은 무료 사용량을 보여주는 당근 게이지 — 기존 회로도(components/circuit/*)를
// 순수 SVG path로 직접 그린 것과 같은 방식입니다. 별도 라이브러리 없이, 남은 비율(0~1)
// 하나만 받아서 "왼쪽 끝(뾰족한 부분)부터 갉아먹힌 당근" 모양을 계산해 그립니다 — 잎(오른쪽
// 끝, 항상 고정)은 절대 줄어들지 않고, 몸통만 왼쪽에서부터 짧아집니다. 갉아먹힌 단면은
// 직선이 아니라 지그재그(이빨 자국)로 그리는데, 진폭을 그 지점의 당근 굵기에 비례해
// 줄여서(halfHeight * BITE_AMP_RATIO) — 그래야 비율이 1에 가까울 때(거의 안 먹은 상태,
// 뾰족한 끝 근처) 지그재그가 실제 당근 폭보다 삐져나와 보이는 일이 없습니다. 이 스케일링
// 덕분에 ratio=1일 때 진폭이 자연스럽게 0으로 수렴해 별도의 "완전한 당근" 분기가 필요 없습니다.
//
// 다 썼을 때(ratio≈0)는 몸통 path 자체를 안 그려서 잎만 남습니다. 옆의 <span> 텍스트는
// 장식용 SVG(aria-hidden)와 별개로 실제 텍스트 노드라 스크린리더가 그대로 읽습니다 — 접근성을
// aria-label 하나에 의존하지 않습니다. 값이 바뀔 때는 path의 d 속성에만 짧은 transition을
// 걸어 "짧게 줄어드는" 정도로 제한합니다(토끼가 뛰어가는 진행바 같은 과한 애니메이션 금지 지침).

const VIEW_W = 132;
const VIEW_H = 44;
const TIP_X = 3;
const BASE_X = 90;
const CENTER_Y = 22;
const HALF_HEIGHT = 13;
const TOP_BASE_Y = CENTER_Y - HALF_HEIGHT;
const BOTTOM_BASE_Y = CENTER_Y + HALF_HEIGHT;
const CORNER_R = 2.5;
const BITE_AMP_MAX = 2.6;
const BITE_AMP_RATIO = 0.7;
// 갉아먹힌 단면을 위→아래로 훑는 지그재그 표본점. 양 끝(0, 1)은 오프셋 0으로 둬서 위/아래
// 테이퍼 변과 이가 맞물리게(단절 없이) 합니다.
const ZIGZAG_T = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1];
const ZIGZAG_SIGN = [0, 1, -1, 1, -1, 1, 0];

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// 당근은 뾰족한 끝(TIP_X, 높이 0)에서 밑동(BASE_X, 높이 2*HALF_HEIGHT)까지 선형으로
// 두꺼워지는 모양으로 단순화합니다 — 실제 당근처럼 살짝 곡선이면 더 좋겠지만, 지그재그
// 절단면 위치를 정확히 맞물리게 계산하려면 선형이 훨씬 안전합니다.
function taperHalfHeightAt(x: number): number {
  const t = clamp01((x - TIP_X) / (BASE_X - TIP_X));
  return HALF_HEIGHT * t;
}

function buildCarrotBodyPath(ratio: number): string | null {
  const remaining = clamp01(ratio);
  if (remaining <= 0.015) return null; // 다 썼음 — 잎만 남김

  const cutX = TIP_X + (1 - remaining) * (BASE_X - TIP_X);
  if (cutX >= BASE_X - 0.5) return null;

  const halfHeight = taperHalfHeightAt(cutX);
  const amp = Math.min(BITE_AMP_MAX, halfHeight * BITE_AMP_RATIO);
  const cutTop = CENTER_Y - halfHeight;
  const cutBottom = CENTER_Y + halfHeight;

  const points = ZIGZAG_T.map((t, i) => ({
    x: cutX + ZIGZAG_SIGN[i] * amp,
    y: cutTop + t * (cutBottom - cutTop),
  }));

  const bitEdge = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  // 밑동(잎이 붙는 쪽) 모서리는 완전 직각 대신 살짝 둥글게.
  return [
    bitEdge,
    `L ${(BASE_X - CORNER_R).toFixed(2)},${BOTTOM_BASE_Y.toFixed(2)}`,
    `Q ${BASE_X},${BOTTOM_BASE_Y} ${BASE_X},${(BOTTOM_BASE_Y - CORNER_R).toFixed(2)}`,
    `L ${BASE_X},${(TOP_BASE_Y + CORNER_R).toFixed(2)}`,
    `Q ${BASE_X},${TOP_BASE_Y} ${(BASE_X - CORNER_R).toFixed(2)},${TOP_BASE_Y}`,
    'Z',
  ].join(' ');
}

// 잎 하나 — 원점에서 위쪽(-y)으로 뻗는 뾰족한 잎 모양. 실제 배치는 <g transform>으로
// 위치·회전시킵니다.
function leafPath(length: number, width: number): string {
  const half = width / 2;
  return `M 0,0 Q ${half.toFixed(2)},${(-length * 0.55).toFixed(2)} 0,${-length} Q ${-half.toFixed(2)},${(-length * 0.55).toFixed(2)} 0,0 Z`;
}

const LEAF_ANCHOR_X = BASE_X + 1;
const LEAF_ANCHOR_Y = CENTER_Y - HALF_HEIGHT * 0.35;
const LEAVES = [
  { rotate: 40, length: 13, width: 7 },
  { rotate: 75, length: 16, width: 8 },
  { rotate: 110, length: 12, width: 6.5 },
];

export interface CarrotGaugeProps {
  /** 남은 비율, 0(다 씀)~1(가득 참). */
  ratio: number;
  /** 이미 번역된 표시 텍스트(예: "2/3 남음") — 이 컴포넌트는 문구를 직접 번역하지 않습니다. */
  countText: string;
  /** 스크린리더용 전체 문맥(예: "채팅 체험 2/3 남음"). 생략하면 countText만 읽힙니다. */
  accessibleLabel?: string;
  className?: string;
}

export function CarrotGauge({ ratio, countText, accessibleLabel, className }: CarrotGaugeProps) {
  const bodyPath = buildCarrotBodyPath(ratio);

  return (
    <div className={`inline-flex items-center gap-1.5 ${className || ''}`}>
      <style jsx>{`
        .carrot-gauge-body {
          transition: d 220ms ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .carrot-gauge-body {
            transition: none;
          }
        }
      `}</style>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width={66}
        height={22}
        aria-hidden="true"
        className="shrink-0"
      >
        {bodyPath && (
          <path className="carrot-gauge-body" d={bodyPath} fill="#F5A03C" stroke="#D9822B" strokeWidth={1} strokeLinejoin="round" />
        )}
        <g transform={`translate(${LEAF_ANCHOR_X},${LEAF_ANCHOR_Y})`}>
          {LEAVES.map((leaf, i) => (
            <path
              key={i}
              d={leafPath(leaf.length, leaf.width)}
              fill="#5FB86A"
              stroke="#3F8A4C"
              strokeWidth={0.75}
              strokeLinejoin="round"
              transform={`rotate(${leaf.rotate})`}
            />
          ))}
        </g>
      </svg>
      <span
        className="text-[11px] font-medium text-[var(--text-muted)] tabular-nums whitespace-nowrap"
        {...(accessibleLabel ? { 'aria-label': accessibleLabel } : {})}
      >
        {countText}
      </span>
    </div>
  );
}
