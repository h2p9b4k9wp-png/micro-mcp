import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@ohah/hwpjs', 'tesseract.js'],
  // tesseract.js의 워커 스크립트는 worker_threads로 별도 실행되는 파일이라, 자동 트레이싱이
  // 그 안에서 require하는 하위 의존성까지는 따라가지 못합니다. tesseract.js가 실제로 필요로 하는
  // 전체 의존성 트리(package.json 기준, 재귀 확인 완료)를 /api/chat 라우트에 명시적으로 포함시킵니다.
  outputFileTracingIncludes: {
    '/api/chat': [
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/bmp-js/**/*',
      './node_modules/idb-keyval/**/*',
      './node_modules/is-url/**/*',
      './node_modules/node-fetch/**/*',
      './node_modules/whatwg-url/**/*',
      './node_modules/tr46/**/*',
      './node_modules/webidl-conversions/**/*',
      './node_modules/regenerator-runtime/**/*',
      './node_modules/wasm-feature-detect/**/*',
      './node_modules/zlibjs/**/*',
    ],
  },
  /* config options here */
};

export default nextConfig;
