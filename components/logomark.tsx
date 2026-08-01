// 브랜드 로고마크 — 토끼 마스코트(public/mascot/rabbit-v2.png, 가공 없이 그대로 사용).
// app/page.tsx·app/login/page.tsx·app/welcome/page.tsx가 전부 같은 마크를 써서 시각적
// 일관성을 유지합니다.
//
// 💡 [주의] rabbit-v2.png는 rabbit-mark.png와 달리 배경이 제거돼 있지 않습니다 — 알파
// 채널이 전 픽셀 255(완전 불투명)라 캔버스(1408x768) 전체가 근백색/크림색 배경으로
// 채워진 사각형입니다. 리사이즈·배경 제거·색상 변환 없이 파일 그대로 쓰기로 해서,
// 렌더링하면 토끼 주위로 밝은 사각형이 함께 보입니다 — 다크 배경 페이지 위에서
// 이질감이 있다면 원인은 코드가 아니라 이 파일 자체의 배경입니다.
//
// 크롬의 강제 다크 모드가 이미지 밝은 영역을 재반전시키던 문제는 <svg><image>로 감싸는
// 우회가 아니라, color-scheme을 html/:root(app/globals.css)·<html> 인라인 스타일·
// <meta>(app/layout.tsx) 세 곳 모두에 dark로 선언하는 정공법으로 해결했습니다 — 평범한
// <img>를 씁니다.
export function Logomark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <img
      src="/mascot/rabbit-v2.png"
      alt="Carrotly"
      width={1408}
      height={768}
      className={`${className} shrink-0 object-contain`}
    />
  );
}
