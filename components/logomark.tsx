// 브랜드 로고마크 — 토끼 마스코트(public/mascot/rabbit-mark.png, 배경 제거된 PNG 원본).
// app/page.tsx·app/login/page.tsx·app/welcome/page.tsx가 전부 같은 마크를 써서 시각적
// 일관성을 유지합니다.
//
// <img> 대신 <svg><image href=... /></svg>로 감싸서 씁니다 — 크롬/웨일의 "다크 모드로 웹
// 콘텐츠 표시" 기능은 <img>/<picture> 요소를 화면에 그려진 크기 기준으로 개별 분류해서,
// 일정 크기를 넘는 이미지를 "사진"으로 판단해 밝은 영역(크림색 털)을 검게 재반전시킵니다.
// 같은 PNG를 그대로 <svg>의 <image>로 감싸면(내용물은 100% 동일한 래스터 이미지) 이 분류
// 대상에서 제외됩니다 — 벡터 도형으로 다시 그리는 대신, 이미지 자체는 원본 그대로 유지한 채
// 브라우저가 "img 콘텐츠"로 인식하는 경로만 피하는 방법입니다.
export function Logomark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 428 507"
      role="img"
      aria-label="Cramly"
      className={`${className} shrink-0`}
    >
      <image href="/mascot/rabbit-mark.png" width={428} height={507} preserveAspectRatio="xMidYMid meet" />
    </svg>
  );
}
