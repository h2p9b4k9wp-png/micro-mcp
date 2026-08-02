'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Monitor, Sun, Moon } from 'lucide-react';

// 💡 [수정] 다크/라이트/시스템 3단 토글 — app/page.tsx 사이드바, app/login/page.tsx 헤더가
// 공유합니다. next-themes의 useTheme()은 서버에는 저장된 테마를 알 방법이 없어 첫 렌더에서
// theme이 undefined인데, 이 값 그대로 아이콘을 그리면 서버 HTML과 클라이언트 첫 렌더가
// 달라져 하이드레이션 경고가 납니다 — mounted 이전에는 동일한 크기의 빈 자리만 그려서
// 이 불일치를 피합니다(실제 테마 전환 자체는 app/layout.tsx의 ThemeProvider가 하이드레이션
// 이전에 이미 <html>에 반영해두므로 화면 깜빡임과는 무관합니다).
// 라벨(시스템 설정/라이트/다크, 그룹 aria-label)은 원래 한국어로 하드코딩돼 있어서 다른
// 로케일에서도 툴팁/스크린리더에 한국어가 그대로 나왔습니다 — messages/*.json의
// themeToggle 네임스페이스로 옮겼습니다.
const OPTION_VALUES = ['system', 'light', 'dark'] as const;
const OPTION_ICONS = { system: Monitor, light: Sun, dark: Moon };

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const t = useTranslations('themeToggle');

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className={`w-[84px] h-7 rounded-full ${className}`} aria-hidden="true" />;
  }

  const OPTIONS = OPTION_VALUES.map((value) => ({
    value,
    label: t(value),
    Icon: OPTION_ICONS[value],
  }));

  return (
    <div
      role="radiogroup"
      aria-label={t('ariaLabel')}
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
