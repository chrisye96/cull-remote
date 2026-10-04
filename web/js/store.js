// IndexedDB: offline copies of lists ('kv') and the marks waiting to sync ('ops').
// Every function rejects when IndexedDB is unavailable; callers decide how to carry on.
const DB_NAME = 'lrc';
let opening = null;

function open() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('kv');
      request.result.createObjectStore('ops', { keyPath: 'opId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
  return opening;
}

// Run `work` in one transaction; resolves with what it returned once the transaction commits.
// Transactions on one store run in the order they were created, so a delete issued after
// an add always lands after it.
async function run(store, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const out = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const kvGet = async (key) => (await run('kv', 'readonly', (kv) => kv.get(key))).result;
export const kvSet = (key, value) => run('kv', 'readwrite', (kv) => void kv.put(value, key));
// Drop the offline photo lists. The folder tree stays, so the home page still opens
// without a connection; waiting marks stay too, because losing them loses work.
export const clearCopies = () => run('kv', 'readwrite', (kv) => void kv.delete(IDBKeyRange.bound('photos:', 'photos:￿')));

export const addOp = (op) => run('ops', 'readwrite', (ops) => void ops.put(op));
export const deleteOps = (opIds) => run('ops', 'readwrite', (ops) => opIds.forEach((opId) => ops.delete(opId)));
// Oldest first: `at` is a per-device counter that only grows.
export const listOps = async () => (await run('ops', 'readonly', (ops) => ops.getAll())).result.sort((a, b) => a.at - b.at);
