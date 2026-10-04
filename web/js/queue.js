import { KEY } from './state.js';

export const opKey = (photoId, field) => `${photoId}:${field}`;

// Photo and field pairs that still have a mark waiting; a refresh must not overwrite them.
export const pendingKeys = (ops) => new Set(ops.map((op) => opKey(op.photoId, op.field)));

// Replay waiting marks on top of a photo list, whether it came from Lightroom or from
// the offline copy. Ops are in the order they were made, so the last one for a field wins.
// Returns how many ops found their photo.
export function applyQueued(photos, ops) {
  if (!ops.length) return 0;
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  let applied = 0;
  for (const op of ops) {
    const photo = byId.get(op.photoId);
    if (!photo) continue;
    photo[KEY[op.field]] = op.value;
    applied += 1;
  }
  return applied;
}

// Sort the server's answers for one batch, in batch order.
// done: opIds to drop from the queue (applied, or refused for good).
// failed: the refused ones with the reason, to show the user.
// halted: the code of the retryable failure that stopped the batch, or '' when it ran through.
// Everything after a halt stays queued, so marks never overtake each other.
export function settleBatch(batch, results) {
  const byOpId = new Map((Array.isArray(results) ? results : []).map((result) => [result?.opId, result]));
  const done = [];
  const failed = [];
  for (const op of batch) {
    const result = byOpId.get(op.opId);
    if (!result) return { done, failed, halted: 'network' };
    if (!result.ok && result.retryable) return { done, failed, halted: String(result.error) };
    done.push(op.opId);
    if (!result.ok) failed.push({ op, error: String(result.error) });
  }
  return { done, failed, halted: '' };
}
