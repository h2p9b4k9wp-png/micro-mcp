// 브랜드 로고마크 — 토끼 마스코트를 손으로 그린 인라인 SVG(래스터 PNG 아님)로 표현합니다.
// app/page.tsx·app/login/page.tsx·app/welcome/page.tsx가 전부 같은 마크를 써서 시각적
// 일관성을 유지합니다.
//
// PNG(public/mascot/rabbit-mark.png)를 쓰던 이전 버전은 크롬/웨일의 "다크 모드로 웹 콘텐츠
// 표시" 기능이 <img>를 화면에 그려진 크기 기준으로 개별 분류해서, 일정 크기를 넘는 이미지를
// "사진"으로 판단해 밝은 영역(크림색 털)을 검게 재반전시켰습니다. CSS background-image로
// 우회를 시도했지만 웨일에서는 재현됐고(크롬과 이미지 다크모드 처리 방식이 다름), 원본
// PNG를 벡터 트레이싱(vtracer)해도 겹치는 패스의 fill 해석이 브라우저마다 달라 같은 문제가
// 재현됐습니다 — 그래서 겹치지 않는 단순 도형만으로 직접 새로 그렸습니다. 이런 다크모드
// 보정은 <img>/<picture> 같은 래스터 콘텐츠에만 적용되고, 이렇게 직접 그린 벡터 도형에는
// 적용 대상 자체가 아니라 브라우저·엔진에 관계없이 항상 원래 색 그대로 보입니다.
export function Logomark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 220"
      role="img"
      aria-label="Cramly"
      className={`${className} shrink-0`}
    >
      {/* 귀 (머리 뒤) */}
      <g stroke="#354565" strokeWidth={6} strokeLinejoin="round">
        <ellipse cx={72} cy={88} rx={20} ry={55} transform="rotate(-16 72 88)" fill="#FAF3E0" />
        <ellipse cx={72} cy={92} rx={10} ry={36} transform="rotate(-16 72 88)" fill="#FDA387" stroke="none" />
        <ellipse cx={128} cy={88} rx={20} ry={55} transform="rotate(16 128 88)" fill="#FAF3E0" />
        <ellipse cx={128} cy={92} rx={10} ry={36} transform="rotate(16 128 88)" fill="#FDA387" stroke="none" />
      </g>

      {/* 얼굴 */}
      <ellipse cx={100} cy={132} rx={68} ry={60} fill="#FAF3E0" stroke="#354565" strokeWidth={6} />

      {/* 볼 */}
      <ellipse cx={52} cy={150} rx={14} ry={9} fill="#FDA387" opacity={0.85} />
      <ellipse cx={148} cy={150} rx={14} ry={9} fill="#FDA387" opacity={0.85} />

      {/* 눈썹 */}
      <path d="M62 108 Q72 100 82 106" fill="none" stroke="#354565" strokeWidth={5} strokeLinecap="round" />
      <path d="M118 106 Q128 100 138 108" fill="none" stroke="#354565" strokeWidth={5} strokeLinecap="round" />

      {/* 눈 */}
      <circle cx={74} cy={128} r={10} fill="#354565" />
      <circle cx={71} cy={124} r={3} fill="#FFFFFF" />
      <circle cx={126} cy={128} r={10} fill="#354565" />
      <circle cx={123} cy={124} r={3} fill="#FFFFFF" />

      {/* 코 */}
      <path d="M94 142 Q100 136 106 142 Q100 148 94 142 Z" fill="#FDA387" />

      {/* 입 */}
      <path
        d="M86 150 Q94 160 100 150 Q106 160 114 150"
        fill="none"
        stroke="#354565"
        strokeWidth={4.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 연필 (베레모 뒤) */}
      <g transform="rotate(38 150 70)">
        <rect x={140} y={30} width={12} height={70} rx={3} fill="#8B95A3" stroke="#354565" strokeWidth={4} />
        <path d="M140 30 L146 16 L152 30 Z" fill="#E8B564" stroke="#354565" strokeWidth={4} strokeLinejoin="round" />
        <rect x={140} y={86} width={12} height={14} fill="#E8836F" stroke="#354565" strokeWidth={4} />
      </g>

      {/* 베레모 */}
      <ellipse cx={150} cy={78} rx={30} ry={26} fill="#F6EFDD" stroke="#354565" strokeWidth={6} />
      <circle cx={163} cy={60} r={4} fill="#FFFFFF" opacity={0.8} />
    </svg>
  );
}
