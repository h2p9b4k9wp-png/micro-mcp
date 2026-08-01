// 브랜드 로고마크 — 토끼 마스코트. app/page.tsx·app/login/page.tsx·app/welcome/page.tsx가
// 전부 같은 마크를 써서 시각적 일관성을 유지합니다.
//
// 다크 페이지에서 마스코트가 검게 보이던 진짜 원인은 브라우저 강제 다크모드 반전이
// 아니라, 원본(1408x768, 토끼 주변에 큰 투명 여백)을 화면 표시 크기(32~128px)까지 브라우저가
// 그때그때 20~40배 다운스케일하면서, 배경 제거로 반투명해진 경계 픽셀에 카드의 어두운
// 배경색이 섞여 들어가는 다운스케일 아티팩트였습니다(Playwright로 실측 확인 — 강제
// 다크모드 on/off는 전체 페이지 픽셀이 완전히 동일했고, 문제는 그 축소 비율 자체였습니다).
//
// 그래서 원본을 그대로 쓰지 않고, 미리 (1) 토끼 바운딩 박스로 타이트하게 크롭하고
// (2) 실제 표시 크기의 2배(레티나 기준)로 알파 프리멀티플라이드 LANCZOS 리샘플링해 둔
// 파일을 씁니다 — 브라우저가 떠안는 축소 비율을 20~40배에서 2배 안팎으로 줄여서 같은
// 아티팩트가 재발하지 않게 합니다. `size="sm"`(rabbit-64.png, 표시 32~56px용)과
// `size="lg"`(rabbit-256.png, 표시 128px 안팎인 로그인 화면 큰 마스코트 전용) 두 가지만
// 있습니다 — 이 앱에서 실제로 쓰는 표시 크기가 두 구간뿐이라 그 이상 세분화하지 않았습니다.
const SIZE_ASSETS = {
  sm: { src: '/mascot/rabbit-64.png', width: 54, height: 64 },
  lg: { src: '/mascot/rabbit-256.png', width: 216, height: 256 },
} as const;

export function Logomark({
  className = 'w-7 h-7',
  size = 'sm',
}: {
  className?: string;
  size?: keyof typeof SIZE_ASSETS;
}) {
  const asset = SIZE_ASSETS[size];
  return (
    <img
      src={asset.src}
      alt="Carrotly"
      width={asset.width}
      height={asset.height}
      className={`${className} shrink-0 object-contain`}
    />
  );
}
