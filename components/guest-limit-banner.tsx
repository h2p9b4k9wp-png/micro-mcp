'use client';

import { useTranslations } from 'next-intl';
import type { GuidedTrialLimitType } from '@/lib/use-guided-trial';

// 💡 [신규] 게스트 한도 배너 — session/ip/global 세 가지 한도 사유를 공통 톤으로 안내합니다.
// components/guest-guided-trial.tsx, components/welcome-hero-trial.tsx, app/login/page.tsx의
// 파일 분석·채팅 섹션이 전부 이 컴포넌트를 씁니다. context는 'session' 사유일 때만 의미가
// 있습니다(업로드 예산 소진 vs 채팅 3턴 소진은 안내 문구가 다릅니다) — ip/global은 어느
// 섹션에서 왔든 같은 문구를 씁니다(그 시점엔 해당 세션이 아직 아무것도 안 썼을 때만
// 발생하므로, 업로드/채팅 구분이 의미가 없습니다 — lib/anonymous-usage.ts 참고).
//
// 💡 [수정] context에 'all'을 추가했습니다 — 업로드 예산과 채팅 턴을 "둘 다" 소진해서
// 체험으로 할 수 있는 게 남지 않은 상태를 체험 패널 맨 아래에서 한 번 정리해주는 용도입니다
// (app/login/page.tsx). 섹션별 배너(upload/chat)가 "이 기능은 다 썼다"를 알려준다면, 이쪽은
// "체험 자체가 끝났다"를 알려주는 마무리 카드라 문구가 따로 필요합니다. 마크업·버튼은
// 그대로 재사용하므로 톤과 생김새는 기존 배너들과 완전히 같습니다.
export function GuestLimitBanner({
  limitType,
  context = 'upload',
  onRequestSignUp,
}: {
  limitType: GuidedTrialLimitType;
  context?: 'upload' | 'chat' | 'all';
  onRequestSignUp: () => void;
}) {
  const t = useTranslations();

  const key =
    limitType === 'session'
      ? context === 'chat'
        ? 'chatSession'
        : context === 'all'
          ? 'allUsed'
          : 'uploadSession'
      : limitType;

  return (
    <div className="bg-[var(--bg-accent-subtle)] border border-[#F4679B]/40 rounded-xl p-4 text-center">
      <p className="break-keep text-sm text-[var(--text-primary)] font-semibold mb-1">
        {t(`login.trial.limit.${key}Title`)}
      </p>
      <p className="break-keep text-xs text-[var(--text-secondary)] mb-3">
        {t(`login.trial.limit.${key}Desc`)}
      </p>
      <button
        onClick={onRequestSignUp}
        className="w-full py-2 rounded-lg border-none bg-[#F4679B] text-white font-semibold text-sm cursor-pointer hover:bg-[#D1477F] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4679B] focus-visible:ring-offset-2"
      >
        {t('login.trial.signUpCta')}
      </button>
    </div>
  );
}
