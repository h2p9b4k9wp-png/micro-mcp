'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Sun, Moon } from 'lucide-react';

// 💡 [신규] 다크/라이트/시스템 3단 토글 — app/page.tsx 사이드바, app/login/page.tsx 헤더가
// 공유합니다. next-themes의 useTheme()은 서버에는 저장된 테마를 알 방법이 없어 첫 렌더에서
// theme이 undefined인데, 이 값 그대로 아이콘을 그리면 서버 HTML과 클라이언트 첫 렌더가
// 달라져 하이드레이션 경고가 납니다 — mounted 이전에는 동일한 크기의 빈 자리만 그려서
// 이 불일치를 피합니다(실제 테마 전환 자체는 app/layout.tsx의 ThemeProvider가 하이드레이션
// 이전에 이미 <html>에 반영해두므로 화면 깜빡임과는 무관합니다).
const OPTIONS = [
  { value: 'system' as const, label: '시스템 설정', Icon: Monitor },
  { value: 'light' as const, label: '라이트', Icon: Sun },
  { value: 'dark' as const, label: '다크', Icon: Moon },
];

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className={`w-[84px] h-7 rounded-full ${className}`} aria-hidden="true" />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="화면 테마"
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] ${className}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`flex items-center justify-center w-6 h-6 rounded-full cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] ${
              isActive
                ? 'bg-[#F4679B] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2.2} />
          </button>
        );
      })}
    </div>
  );
}
