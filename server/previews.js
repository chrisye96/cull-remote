import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BridgeError } from './bridge.js';

export const SIZES = { thumb: 400, std: 1280, hd: 2560 };

// ponytail: cache never invalidates, so an image edited in Lightroom afterwards
// shows its old look. Delete .cache/previews to refresh; key by edit time if it matters.
export function createPreviewStore(dir, bridge) {
  const inflight = new Map();
  const fileFor = (photoId, size) => path.join(dir, `${photoId}_${size}.jpg`);

  async function fetchAndStore(photoId, size) {
    const jpeg = await bridge.send('getPreview', { photoId, size: SIZES[size] });
    // Never cache anything that is not a JPEG (SOI marker FF D8).
    if (!Buffer.isBuffer(jpeg) || jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new BridgeError('bad_preview');
    await mkdir(dir, { recursive: true });
    // Write beside the final file, then rename, so a reader never sees a partial image.
    const final = fileFor(photoId, size);
    const tmp = `${final}.${randomUUID()}.tmp`;
    await writeFile(tmp, jpeg);
    await rename(tmp, final);
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
