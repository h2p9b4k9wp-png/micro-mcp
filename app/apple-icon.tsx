import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#F4679B',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="120" height="120" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="5" r="2" fill="#FFFFFF" opacity="0.7" />
          <circle cx="21" cy="5" r="2" fill="#FFFFFF" opacity="0.7" />
          <path d="M11 7L13 10" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
          <path d="M21 7L19 10" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
          <rect x="5" y="10" width="22" height="19" rx="8" fill="#FFFFFF" />
          <circle cx="13" cy="19" r="2.2" fill="#F4679B" />
          <circle cx="19" cy="19" r="2.2" fill="#F4679B" />
          <path d="M12.5 23.5C13.8 25 18.2 25 19.5 23.5" stroke="#F4679B" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
