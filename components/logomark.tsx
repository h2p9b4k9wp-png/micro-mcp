// 브랜드 로고마크 — 토끼 마스코트(public/mascot/rabbit-v3.png).
// app/page.tsx·app/login/page.tsx·app/welcome/page.tsx가 전부 같은 마크를 써서 시각적
// 일관성을 유지합니다.
//
// 다크 페이지에서 마스코트가 검게 보이던 진짜 원인은 브라우저 강제 다크모드 반전이
// 아니라, rabbit-mark.png 자체가 배경 제거 과정에서 색이 변질된 파일이었기 때문입니다.
// rabbit-v3.png는 색이 정상인 원본(rabbit-v2.png, 흰 배경)에서 배경만 알파 키잉으로
// 제거해 새로 만든 파일입니다 — RGB는 원본과 픽셀 단위로 완전히 동일하고(검증 완료),
// 알파 채널만 배경 근접색 여부에 따라 조작했습니다.
export function Logomark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <img
      src="/mascot/rabbit-v3.png"
      alt="Carrotly"
      width={1408}
      height={768}
      className={`${className} shrink-0 object-contain`}
    />
  );
}
