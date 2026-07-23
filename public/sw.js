const CACHE_NAME = 'micro-mcp-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 💡 API 요청(로그인, AI 응답 등)은 항상 실시간 네트워크로만 처리하고 절대 캐시하지 않습니다.
// 그 외 정적 리소스는 네트워크를 우선 시도하고, 오프라인이면 캐시된 걸 보여줍니다.
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET' || request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        return response;
      })
      .catch(() => caches.match(request))
  );
});