import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Micro-MCP — 나만의 AI 업무 비서',
    short_name: 'Micro-MCP',
    description: '블록을 조립하듯, 나만의 업무와 일상을 자동화하는 AI 워크플로우 플랫폼',
    start_url: '/',
    display: 'standalone',
    background_color: '#15131A',
    theme_color: '#15131A',
    icons: [
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icon-maskable',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
