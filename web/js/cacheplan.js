import { isUnmarked } from './state.js';

// Measured averages per preview, see docs/spike-results.md.
export const AVG_BYTES = { std: 210 * 1024, hd: 574 * 1024 };

// Which photos a caching run covers, in viewing order. A limit of 0 means no limit.
export function pickForCache(photos, mode, limit = 0) {
  const wanted = mode === 'all' ? photos : photos.filter(isUnmarked);
  return limit > 0 ? wanted.slice(0, limit) : wanted;
}

export const estimateBytes = (count, size) => count * AVG_BYTES[size];

export function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// Run `worker` over `items` with at most `limit` running at once. The first error stops
// the lanes from taking new items and is rethrown.
export async function runPool(items, limit, worker) {
  let next = 0;
  let stopped = false;
  async function lane() {
    while (!stopped && next < items.length) {
      const at = next;
      next += 1;
      try {
        await worker(items[at], at);
      } catch (e) {
        stopped = true;
        throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
