import { getPhotos, getSources } from './api.js';
import { kvGet, kvSet } from './store.js';
import { getLink } from './sync.js';

// Failures that mean "cannot reach Lightroom right now", as opposed to a real error.
const OFFLINE_CODES = new Set(['network', 'lr_offline', 'lr_busy', 'lr_timeout']);

const readCopy = (key) => kvGet(key).catch(() => undefined);

// Lightroom first, and keep a copy; the last copy when Lightroom cannot be reached.
// Resolves with { data, stale }.
async function withCopy(key, load) {
  // Already known to be offline: use the copy at once instead of waiting for a timeout.
  if (getLink() === 'network') {
    const copy = await readCopy(key);
    if (copy !== undefined) return { data: copy, stale: true };
  }
  try {
    const data = await load();
    // Stored before the caller can overlay waiting marks, so the copy stays what Lightroom said.
    await kvSet(key, data).catch(() => {});
    return { data, stale: false };
  } catch (e) {
    if (!OFFLINE_CODES.has(e.message)) throw e;
    const copy = await readCopy(key);
    if (copy === undefined) throw e;
    return { data: copy, stale: true };
  }
}

export const loadSources = () => withCopy('sources', getSources);
export const loadPhotos = (sourceId) => withCopy(`photos:${sourceId}`, () => getPhotos(sourceId));
export const savePhotos = (sourceId, photos) => kvSet(`photos:${sourceId}`, photos).catch(() => {});
