// 브랜드 로고마크 — 귀여운 블록 캐릭터 얼굴. app/page.tsx·app/login/page.tsx·app/welcome/page.tsx가
// 전부 같은 마크를 써서 시각적 일관성을 유지합니다(currentColor라 밝은/어두운 배경 어디서든 씁니다).
export function Logomark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="11" cy="5" r="2" fill="currentColor" opacity="0.7" />
      <circle cx="21" cy="5" r="2" fill="currentColor" opacity="0.7" />
      <path d="M11 7L13 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <path d="M21 7L19 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <rect x="5" y="10" width="22" height="19" rx="8" fill="currentColor" />
      <circle cx="13" cy="19" r="2.2" fill="white" />
      <circle cx="19" cy="19" r="2.2" fill="white" />
      <path d="M12.5 23.5C13.8 25 18.2 25 19.5 23.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}
