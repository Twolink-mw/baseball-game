// 서비스 워커: 앱 파일을 미리 저장해 오프라인에서도 실행 (cache-first). 외부 요청 없음.
// ★ 파일을 고치거나 추가하면 CACHE 버전 문자열을 꼭 올릴 것 (bbgame-v1 → bbgame-v2 ...)
//   버전이 같으면 설치된 앱이 예전 파일을 계속 씀. 새 파일은 아래 ASSETS 목록에도 추가.
'use strict';

const CACHE = 'bbgame-v22';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/config.js',
  './js/rng.js',
  './js/pitcher.js',
  './js/judge.js',
  './js/game.js',
  './js/storage.js',
  './js/sounds-data.js',
  './js/audio.js',
  './js/scene.js',
  './js/renderer.js',
  './js/input.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bbgame-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      // 페이지 이동은 캐시한 index.html로 (오프라인 실행)
      if (req.mode === 'navigate') return caches.match('./index.html').then((page) => page || fetch(req));
      return fetch(req);
    })
  );
});
