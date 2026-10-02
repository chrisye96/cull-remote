import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SIZES = { thumb: 400, std: 1280, hd: 2560 };

// ponytail: cache never invalidates, so an image edited in Lightroom afterwards
// shows its old look. Delete .cache/previews to refresh; key by edit time if it matters.
export function createPreviewStore(dir, bridge) {
  const inflight = new Map();
  const fileFor = (photoId, size) => path.join(dir, `${photoId}_${size}.jpg`);

  async function fetchAndStore(photoId, size) {
    const jpeg = await bridge.send('getPreview', { photoId, size: SIZES[size] });
    await mkdir(dir, { recursive: true });
    await writeFile(fileFor(photoId, size), jpeg);
    return jpeg;
  }

  async function get(photoId, size) {
    try {
      return await readFile(fileFor(photoId, size));
    } catch {
      // Not cached yet.
    }
    const key = `${photoId}_${size}`;
    if (!inflight.has(key)) {
      inflight.set(key, fetchAndStore(photoId, size).finally(() => inflight.delete(key)));
    }
    return inflight.get(key);
  }

  return { get };
}
