'use client';

import { useTranslations } from 'next-intl';
import type { GuidedTrialLimitType } from '@/lib/use-guided-trial';

// 💡 [신규] 게스트 한도 배너 — session/ip/global 세 가지 한도 사유를 공통 톤으로 안내합니다.
// components/guest-guided-trial.tsx, components/welcome-hero-trial.tsx, app/login/page.tsx의
// 파일 분석·채팅 섹션이 전부 이 컴포넌트를 씁니다. context는 'session' 사유일 때만 의미가
// 있습니다(업로드 예산 소진 vs 채팅 3턴 소진은 안내 문구가 다릅니다) — ip/global은 어느
// 섹션에서 왔든 같은 문구를 씁니다(그 시점엔 해당 세션이 아직 아무것도 안 썼을 때만
// 발생하므로, 업로드/채팅 구분이 의미가 없습니다 — lib/anonymous-usage.ts 참고).
export function GuestLimitBanner({
  limitType,
  context = 'upload',
  onRequestSignUp,
}: {
  limitType: GuidedTrialLimitType;
  context?: 'upload' | 'chat';
  onRequestSignUp: () => void;
}) {
  const t = useTranslations();

  const key =
    limitType === 'session'
      ? context === 'chat'
        ? 'chatSession'
        : 'uploadSession'
      : limitType;

  return (
    <div className="bg-[#331F29] border border-[#F4679B]/40 rounded-xl p-4 text-center">
      <p className="break-keep text-sm text-[#F5F2F7] font-semibold mb-1">
        {t(`login.trial.limit.${key}Title`)}
      </p>
      <p className="break-keep text-xs text-[#C9C0D6] mb-3">
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
