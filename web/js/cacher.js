import { previewUrl } from './api.js';
import { runPool, COVERED_BY } from './cacheplan.js';
import { readObject, writePref } from './prefs.js';

export const PREVIEW_CACHE = 'lrc-previews';
const STALL_AFTER = 5; // Give up after this many photos fail one after another.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// iOS suspends a hidden page; wait here and carry on when it is shown again.
function visible() {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('visibilitychange', function onShow() {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onShow);
      resolve();
    });
  });
}

// Fetch one preview into the cache. Resolves true when the photo is covered afterwards.
async function cacheOne(cache, photoId, size, signal) {
  for (const cachedSize of COVERED_BY[size]) {
    if (await cache.match(previewUrl(photoId, cachedSize))) return true;
  }
  const url = previewUrl(photoId, size);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await visible();
    signal.throwIfAborted();
    try {
      const res = await fetch(url, { signal });
      if (res.ok) {
        await cache.put(url, res);
        // The larger preview replaces a smaller one cached before the quality was raised.
        if (size === 'hd') await cache.delete(previewUrl(photoId, 'std'));
        return true;
      }
      if (res.status < 500) return false; // This photo has no preview; retrying will not help.
    } catch (e) {
      if (signal.aborted || e.name === 'QuotaExceededError') throw e;
    }
    await sleep(1000 * (attempt + 1));
  }
  return false;
}

// Download previews for `photos`. Already cached ones are skipped, so a second run
// continues where the first stopped. Resolves with { cached, failed }.
export async function cachePhotos(photos, size, { signal, concurrency = 3, onProgress = () => {} }) {
  const cache = await caches.open(PREVIEW_CACHE);
  let lock = null;
  try {
    lock = await navigator.wakeLock?.request('screen');
  } catch {
    // Not supported or not allowed: caching still works while the screen stays on.
  }
  let cached = 0;
  let failed = 0;
  let failedInARow = 0;
  try {
    await runPool(photos, concurrency, async (photo) => {
      if (await cacheOne(cache, photo.id, size, signal)) {
        cached += 1;
        failedInARow = 0;
      } else {
        failed += 1;
        failedInARow += 1;
      }
      onProgress({ cached, failed });
      if (failedInARow >= STALL_AFTER) throw new Error('stalled');
    });
  } finally {
    lock?.release().catch(() => {});
  }
  return { cached, failed };
}

// Preview URLs (path and query, as previewUrl builds them) that are on this device.
export async function cachedUrls() {
  const requests = await (await caches.open(PREVIEW_CACHE)).keys();
  return new Set(requests.map((request) => {
    const url = new URL(request.url);
    return url.pathname + url.search;
  }));
}

// Remove every cached preview. Entries are deleted one by one: deleting the whole cache
// leaves its space occupied until every page and worker that opened it has gone.
export async function clearPreviews() {
  const cache = await caches.open(PREVIEW_CACHE);
  await Promise.all((await cache.keys()).map((request) => cache.delete(request)));
}

// Remember how many previews of a folder are on this device, for the home page.
export function recordCached(sourceId, count) {
  const cached = readObject('cached');
  cached[sourceId] = { count, at: Date.now() };
  writePref('cached', cached);
}
