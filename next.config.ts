import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@ohah/hwpjs', 'tesseract.js'],
  // tesseract.js는 워커 스크립트를 동적 경로로 require하기 때문에, 정적 트레이싱만으로는
  // Vercel 배포 산출물에서 누락될 수 있어 /api/chat 라우트에 한해 명시적으로 포함시킵니다.
  outputFileTracingIncludes: {
    '/api/chat': ['./node_modules/tesseract.js/**/*', './node_modules/tesseract.js-core/**/*'],
  },
  /* config options here */
};

export default nextConfig;
