'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 💡 [신규] app/layout.tsx에 있던 전역 푸터를 뺐습니다 — 다크 테마 고정이라(bg-[#15131A])
// 라이트 테마인 app/welcome/page.tsx 아래에 그대로 붙으면 화면 하단에 어두운 띠가
// 어색하게 남습니다. usePathname()으로 /welcome에서만 숨기고, 나머지 모든 페이지(다크
// 테마)에서는 기존과 동일하게 보입니다.
export function SiteFooter() {
  const pathname = usePathname();
  if (pathname === '/welcome') return null;

  return (
    <footer className="shrink-0 bg-[#15131A] border-t border-[#2A2632] px-5 py-4 text-center text-xs text-[#5B5566]">
      © {new Date().getFullYear()} Cramly ·{' '}
      <Link
        href="/pricing"
        className="text-[#857C93] hover:text-[#F4679B] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
      >
        Pricing
      </Link>{' '}
      ·{' '}
      <Link
        href="/privacy"
        className="text-[#857C93] hover:text-[#F4679B] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] rounded"
      >
        Privacy Policy
      </Link>
    </footer>
  );
}
