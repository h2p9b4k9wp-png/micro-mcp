// 브랜드 로고마크 — 토끼 마스코트(public/mascot/rabbit-mark.png, 배경 제거된 PNG).
// app/page.tsx·app/login/page.tsx·app/welcome/page.tsx가 전부 같은 마크를 써서 시각적 일관성을 유지합니다.
//
// variant="bg"는 login/page.tsx의 큰 장식용 마스코트(w-40 h-40)·모바일 브랜드 마크(w-14 h-14)
// 전용입니다. 크롬의 "다크 모드로 웹 콘텐츠 표시"는 <img> 요소를 화면에 그려진 크기 기준으로
// 개별 분류해서, 작은 아이콘(사이드바·welcome 헤더의 w-7~w-8 로고)은 건드리지 않지만 일정
// 크기를 넘는 <img>는 "사진"으로 판단해 밝은 영역을 검게 재반전시킵니다 — color-scheme 메타
// 태그(app/layout.tsx)로는 이 이미지별 처리까지 막지 못했습니다. 같은 크롬 기능이 CSS
// background-image는 별도 페인트 경로를 타서 이 재반전 대상이 아니라는 게 널리 확인된
// 우회법이라, 임계값을 넘는 두 곳만 배경 이미지로 그립니다. 작은 로고는 이미 정상 동작하므로
// 굳이 바꾸지 않았습니다.
export function Logomark({
  className = 'w-7 h-7',
  variant = 'img',
}: {
  className?: string;
  variant?: 'img' | 'bg';
}) {
  if (variant === 'bg') {
    return (
      <div
        role="img"
        aria-label="Cramly"
        className={`${className} shrink-0`}
        style={{
          backgroundImage: 'url(/mascot/rabbit-mark.png)',
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          colorScheme: 'light',
        }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- 크기가 제각각인 className으로 쓰이는 작은 로고라 next/image 불필요
    <img
      src="/mascot/rabbit-mark.png"
      alt="Cramly"
      className={`${className} object-contain shrink-0`}
      style={{ colorScheme: 'light' }}
    />
  );
}
