// 브랜드 로고마크 — 토끼 마스코트(public/mascot/rabbit-mark.png, 배경 제거된 PNG 원본).
// app/page.tsx·app/login/page.tsx·app/welcome/page.tsx가 전부 같은 마크를 써서 시각적
// 일관성을 유지합니다. rabbit-v2.png는 배경이 제거돼 있지 않아(알파 채널 전 픽셀
// 불투명) 쓸 수 없다고 확인돼 rabbit-mark.png로 되돌렸습니다.
//
// color-scheme을 html/:root(app/globals.css)·<html> 인라인 스타일·<meta>(app/layout.tsx)
// 세 곳 모두에 dark로 선언해도 일부 브라우저에서 여전히 밝은 영역이 재반전되는 경우가
// 있어, app/login/page.tsx의 큰 장식용 마스코트는 이 컴포넌트를 어두운 카드 배경 컨테이너로
// 감싸 사용합니다 — "이미 어두운 UI 요소"로 보이게 해서 반전 대상에서 빠지길 노리는
// 접근입니다. 효과가 확인되면 다른 위치(작은 로고 크기)에도 같은 패턴을 적용합니다.
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
