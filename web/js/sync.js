import { sendOps } from './api.js';
import { addOp, deleteOps, listOps } from './store.js';
import { opKey, pendingKeys, settleBatch } from './queue.js';

const BATCH = 50;

let ops = []; // Marks Lightroom has not confirmed yet, oldest first.
let keys = new Set(); // opKey of every waiting mark
let photos = new Set(); // ids of the photos that have a waiting mark
let link = ''; // '' while the computer and Lightroom answer, else the code of the last failure
let lastAt = 0;
let draining = false;
let onChange = () => {};
let onFailed = () => {};

function changed(settled = false) {
  keys = pendingKeys(ops);
  photos = new Set(ops.map((op) => op.photoId));
  onChange({ settled });
}

export const pendingOps = () => ops;
export const pendingCount = () => ops.length;
export const hasPending = (photoId, field) => keys.has(opKey(photoId, field));
export const photoPending = (photoId) => photos.has(photoId);
export const getLink = () => link;

export function setLink(code) {
  if (code === link) return;
  link = code;
  onChange({ settled: false });
}

// Load the marks left over from an earlier visit. Call once at page load.
export async function initSync(handlers) {
  ({ onChange, onFailed } = handlers);
  try {
    ops = [...(await listOps()), ...ops];
    lastAt = ops.reduce((max, op) => Math.max(max, op.at), 0);
  } catch {
    // No IndexedDB (private browsing, blocked site data): marks still sync while the page stays open.
  }
  changed();
}

// Record a mark. It is durable before it is sent, so closing the page or losing the
// connection cannot drop it.
export function pushOp(photo, field, value) {
  lastAt = Math.max(Date.now(), lastAt + 1);
  const op = { opId: crypto.randomUUID(), photoId: photo.id, field, value, ts: Date.now(), at: lastAt, name: photo.name };
  ops.push(op);
  changed();
  addOp(op).catch(() => {}); // Not persisted: the mark still syncs while the page stays open.
  drain();
}

// Send waiting marks in order until the queue is empty or something stops it.
export async function drain() {
  if (draining || !ops.length) return;
  draining = true;
  try {
    while (ops.length) {
      const batch = ops.slice(0, BATCH);
      let results;
      try {
        results = await sendOps(batch.map(({ opId, photoId, field, value, ts }) => ({ opId, photoId, field, value, ts })));
      } catch (e) {
        setLink(e.message);
        return;
      }
      const { done, failed, halted } = settleBatch(batch, results);
      if (done.length) {
        const gone = new Set(done);
        ops = ops.filter((op) => !gone.has(op.opId));
        deleteOps(done).catch(() => {});
        changed(true);
      }
      for (const { op, error } of failed) onFailed(op, error);
      setLink(halted);
      if (halted) return;
    }
  } finally {
    draining = false;
  }
}
