// 브랜드 로고마크 — 토끼 마스코트(public/mascot/rabbit-mark.png, 배경 제거된 PNG).
// app/page.tsx·app/login/page.tsx·app/welcome/page.tsx가 전부 같은 마크를 써서 시각적 일관성을 유지합니다.
export function Logomark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 크기가 제각각인 className으로 쓰이는 작은 로고라 next/image 불필요
    <img
      src="/mascot/rabbit-mark.png"
      alt="Cramly"
      className={`${className} object-contain shrink-0`}
    />
  );
}
