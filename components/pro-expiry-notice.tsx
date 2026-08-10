'use client';

import type { useTranslations } from 'next-intl';
import { getDaysLeft, PRO_EXPIRY_WARN_WITHIN_DAYS } from '@/lib/pro-expiry';

// 💡 [신규] 소사이어티 코드로 받은 Pro의 남은 기간 안내.
//
// 코드 기반 Pro는 기간이 끝나면 app/api/cron/cleanup-logs가 매일 한 번 돌면서 조용히
// is_pro를 false로 되돌립니다. 그런데 그 사실을 알려주는 화면이 하나도 없어서, 사용자
// 입장에서는 어느 날 갑자기 Pro가 꺼지고 이유도 알 수 없었습니다. 이 컴포넌트가 그
// 공백을 메웁니다.
//
// 결제 기반 Pro에는 뜨지 않습니다 — 그쪽은 pro_expires_at이 항상 null이고(구독 종료는
// Polar 웹훅이 알려줌) 자동 갱신되므로 "언제 끝난다"는 개념 자체가 없습니다.

export function ProExpiryNotice({
  proSource,
  proExpiresAt,
  t,
}: {
  proSource: 'payment' | 'code' | null;
  proExpiresAt: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  // 결제 Pro이거나 만료 시각이 없으면 안내할 게 없습니다.
  if (proSource !== 'code' || !proExpiresAt) return null;

  const daysLeft = getDaysLeft(proExpiresAt);
  if (daysLeft === null) return null;

  // 이미 지났는데 아직 강등 전인 구간(cron은 하루 한 번만 돕니다). 남은 기간을 음수로
  // 보여주면 이상하므로 "오늘 종료"와 같은 문구로 묶습니다.
  const isUrgent = daysLeft <= PRO_EXPIRY_WARN_WITHIN_DAYS;
  const endsOnFormatted = new Date(proExpiresAt).toLocaleDateString();

  return (
    <div
      className={`mx-3 mb-2 rounded-lg border px-3 py-2 ${
        isUrgent
          ? 'bg-[var(--bg-warn-subtle)] border-[var(--border-warn-subtle)]'
          : 'bg-[var(--bg-surface)] border-[var(--border-default)]'
      }`}
    >
      <p className={`text-[11px] font-semibold ${isUrgent ? 'text-[var(--text-warn)]' : 'text-[var(--text-tertiary)]'}`}>
        {daysLeft <= 0 ? t('proExpiry.endsToday') : t('proExpiry.daysLeft', { days: daysLeft })}
      </p>
      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
        {t('proExpiry.endsOn', { date: endsOnFormatted })}
      </p>
    </div>
  );
}
