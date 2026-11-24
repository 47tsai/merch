/* merch Service Worker — 只為滿足 PWA 安裝條件而設（chi-system v1.2.0）。
 *
 * 安裝條件：Chrome／Brave 要求站台有一個帶 fetch 處理的 Service Worker，
 * 且 manifest 提供 192／512 圖示；先前兩項都沒有，所以 Brave 顯示
 * 「無法安裝這個應用程式」。
 *
 * 資料絕對不快取：導覽、/api/*、/data、data/*.json 一律直接走網路
 * （app 本身 fetch 時也用 cache: 'no-store'），新部署或新收藏絕不會
 * 被舊快取蓋掉。靜態 js／css／圖示用 stale-while-revalidate：先給快取、
 * 背景抓新版寫回快取，下次就用新版；未雜湊的 /chi-system/* 檔案
 * （sidebar.js／theme.js／components.css／tokens.css）改版後也不會
 * 被舊快取永遠蓋住。快取名帶版本號，改版時改 CACHE_VERSION
 * 就會清掉舊快取。
 */
const CACHE_VERSION = 'merch-sw-v2';
const STATIC_CACHE = `merch-static-${CACHE_VERSION}`;
const APP_SHELL = ['/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isDataRequest(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/data' ||
    url.pathname.startsWith('/data/') ||
    url.pathname === '/oauth-callback.html'
  );
}

function isCacheableStatic(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/chi-system/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/logo/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/index.html' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 導覽與所有資料請求：直接走網路，絕不讀寫快取。
  if (request.mode === 'navigate' || isDataRequest(url)) {
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request).catch(() => caches.match('/index.html')),
      );
    }
    return;
  }

  // 其餘同源靜態資源：stale-while-revalidate——有快取先給快取、同時
  // 背景抓新版寫回快取；沒快取才等網路。/api/*、/data、/data/*、
  // 導覽不走這裡（見上方），絕對不快取。
  if (!isCacheableStatic(url)) return;
  // 背景更新先啟動：無論有無快取都抓一次新版，成功才寫回快取。
  const networkUpdate = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => undefined);
  event.waitUntil(networkUpdate);
  event.respondWith(
    caches.match(request).then((cached) => cached || networkUpdate),
  );
});
