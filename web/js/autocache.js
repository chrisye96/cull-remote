import { getInfo } from './api.js';
import { cachePhotos, recordCached } from './cacher.js';
import { pickForCache } from './cacheplan.js';
import { previewSize } from './quality.js';
import { readChoice, readPref, AUTO_CACHE_LIMITS } from './prefs.js';

let run = null; // AbortController of the automatic run; one at a time.

export function stopAutoCache() {
  run?.abort();
  run = null;
}

// After a folder opens at home, quietly cache its unmarked photos up to the limit.
// Anywhere else, or when the location is unknown, nothing happens: the manual button is there.
export async function maybeAutoCache(source, photos) {
  stopAutoCache(); // A folder opened earlier gives way to this one.
  if (readPref('autoCache', true) !== true) return;
  const mine = new AbortController();
  run = mine;
  try {
    const { atHome } = await getInfo();
    if (atHome !== true || mine.signal.aborted) return;
    const limit = Number(readChoice('autoCacheLimit', AUTO_CACHE_LIMITS, '500'));
    const picked = pickForCache(photos, 'unmarked', limit);
    if (!picked.length) return;
    // Two at a time, so the photo being viewed is not kept waiting.
    const { cached } = await cachePhotos(picked, previewSize(), { signal: mine.signal, concurrency: 2 });
    if (cached) recordCached(source.id, cached);
  } catch {
    // Stopped, out of space or disconnected: the manual dialog reports details when it is used.
  } finally {
    if (run === mine) run = null;
  }
}
