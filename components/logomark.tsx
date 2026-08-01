// 브랜드 로고마크 — 토끼 마스코트(public/mascot/rabbit-mark.png, 배경 제거된 PNG 원본).
// app/page.tsx·app/login/page.tsx·app/welcome/page.tsx가 전부 같은 마크를 써서 시각적
// 일관성을 유지합니다.
//
// 크롬의 강제 다크 모드가 이미지 밝은 영역을 재반전시키던 문제는 <svg><image>로 감싸는
// 우회가 아니라, color-scheme을 html/:root(app/globals.css)와 <meta>(app/layout.tsx)
// 세 곳 모두에 dark로 선언하는 정공법으로 해결했습니다 — 이제 평범한 <img>를 씁니다.
export function Logomark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <img
      src="/mascot/rabbit-mark.png"
      alt="Carrotly"
      width={428}
      height={507}
      className={`${className} shrink-0 object-contain`}
    />
  );
}
