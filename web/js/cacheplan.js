import { isUnmarked } from './state.js';

// Measured averages per preview, see docs/spike-results.md.
export const AVG_BYTES = { std: 210 * 1024, hd: 574 * 1024 };

// Which photos a caching run covers, in viewing order. A limit of 0 means no limit.
export function pickForCache(photos, mode, limit = 0) {
  const wanted = mode === 'all' ? photos : photos.filter(isUnmarked);
  return limit > 0 ? wanted.slice(0, limit) : wanted;
}

export const estimateBytes = (count, size) => count * AVG_BYTES[size];

// Rough size of the cached previews, from their URLs. The browser's own storage figure
// is not shown: WebKit only counts it upwards between recounts, so it does not drop
// after a delete and would read as space that cannot be freed.
export function estimateCached(urls) {
  let bytes = 0;
  for (const url of urls) bytes += AVG_BYTES[url.includes('size=hd') ? 'hd' : 'std'];
  return bytes;
}

export function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// Cached sizes that satisfy a request for a size: a larger preview covers a smaller one,
// so lowering the quality setting never downloads a photo again.
export const COVERED_BY = { std: ['std', 'hd'], hd: ['hd'] };

// The photos that still need a download at `size`. `have` holds the cached preview URLs.
export function uncached(photos, size, have, urlFor) {
  return photos.filter((photo) => !COVERED_BY[size].some((cachedSize) => have.has(urlFor(photo.id, cachedSize))));
}

// Second line and state of one choice in the caching dialog. `count` photos are covered
// and `left` of them are not on the device yet; the size estimate is for what is left.
export function cacheChoice(count, left, size) {
  if (count === 0) return { detail: '0 张', disabled: true };
  if (left === 0) return { detail: `${count} 张，已全部缓存`, disabled: true };
  const todo = left === count ? '' : `还差 ${left} 张，`;
  return { detail: `${count} 张，${todo}约 ${formatBytes(estimateBytes(left, size))}`, disabled: false };
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
