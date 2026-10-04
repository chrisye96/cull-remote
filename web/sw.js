// Service worker: keeps the app shell and the cached previews usable without a connection.
const SHELL_CACHE = 'lrc-shell';
const PREVIEW_CACHE = 'lrc-previews';
const SHELL_WAIT_MS = 3000;
const PREVIEW_WAIT_MS = 15000;
const SHELL = [
  '/',
  '/style.css',
  '/vendor/lucide.svg',
  '/js/api.js',
  '/js/cachedialog.js',
  '/js/cacheplan.js',
  '/js/cacher.js',
  '/js/data.js',
  '/js/dom.js',
  '/js/main.js',
  '/js/messages.js',
  '/js/prefs.js',
  '/js/quality.js',
  '/js/queue.js',
  '/js/settings.js',
  '/js/sources.js',
  '/js/state.js',
  '/js/store.js',
  '/js/sync.js',
  '/js/tree.js',
  '/js/viewer.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Shell files have plain names, so the network copy wins whenever the computer answers
// in time; the last copy seen is used otherwise.
async function shell(path) {
  const cache = await caches.open(SHELL_CACHE);
  const copy = await cache.match(path, { ignoreSearch: true });
  if (copy && !navigator.onLine) return copy;
  try {
    // Only race the clock when there is a copy to fall back on.
    const res = await fetch(path, copy ? { signal: AbortSignal.timeout(SHELL_WAIT_MS) } : {});
    if (res.ok) await cache.put(path, res.clone());
    return res;
  } catch {
    return copy ?? Response.error();
  }
}

// Previews are stored only when the page caches a folder, so this reads and never writes.
async function preview(request) {
  const url = new URL(request.url);
  url.searchParams.delete('retry');
  const cache = await caches.open(PREVIEW_CACHE);
  const hit = await cache.match(url.href);
  if (hit) return hit;
  try {
    return await fetch(request, { signal: AbortSignal.timeout(PREVIEW_WAIT_MS) });
  } catch {
    // No connection: the other size is better than nothing.
    url.searchParams.set('size', url.searchParams.get('size') === 'hd' ? 'std' : 'hd');
    return (await cache.match(url.href)) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/preview/')) event.respondWith(preview(request));
  else if (!url.pathname.startsWith('/api/')) event.respondWith(shell(url.pathname));
});
