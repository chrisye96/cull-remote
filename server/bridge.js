import { randomUUID } from 'node:crypto';

export class BridgeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Hands commands from the HTTP API to the Lightroom plugin's long poll and
// routes the plugin's results back to the waiting caller.
export function createBridge({ onlineWindowMs = 30000, commandTimeoutMs = 30000 } = {}) {
  // Urgent commands (marks) are handed out before normal ones (previews, lists), so a
  // burst of preview requests cannot hold up a mark. Each queue keeps its own order.
  const queues = { urgent: [], normal: [] };
  const inflight = new Map();
  let waiter = null;
  let lastPollAt = -Infinity;

  const isOnline = () => Date.now() - lastPollAt < onlineWindowMs;

  function send(type, params = {}, { urgent = false } = {}) {
    if (!isOnline()) return Promise.reject(new BridgeError('lr_offline'));
    const cmd = { id: randomUUID(), type, params };
    const queue = urgent ? queues.urgent : queues.normal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        inflight.delete(cmd.id);
        const at = queue.indexOf(cmd);
        if (at !== -1) queue.splice(at, 1);
        reject(new BridgeError('lr_timeout'));
      }, commandTimeoutMs);
      inflight.set(cmd.id, { resolve, reject, timer });
      if (waiter) {
        const deliver = waiter;
        waiter = null;
        deliver(cmd);
      } else {
        queue.push(cmd);
      }
    });
  }

  // `signal` aborts when the plugin's poll connection drops. A parked poll that is
  // aborted is forgotten at once and the bridge goes offline, so no command is ever
  // handed to a dead connection.
  function next(waitMs, signal) {
    lastPollAt = Date.now();
    const queued = queues.urgent.shift() ?? queues.normal.shift();
    if (queued) return Promise.resolve(queued);
    if (signal?.aborted) {
      lastPollAt = -Infinity;
      return Promise.resolve(null);
    }
    // A newer poll replaces an older parked one (plugin reload).
    if (waiter) waiter(null);
    return new Promise((resolve) => {
      const deliver = (cmd) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        lastPollAt = Date.now();
        resolve(cmd);
      };
      const onAbort = () => {
        if (waiter !== deliver) return;
        waiter = null;
        deliver(null);
        lastPollAt = -Infinity;
      };
      const timer = setTimeout(() => {
        if (waiter === deliver) waiter = null;
        deliver(null);
      }, waitMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      waiter = deliver;
    });
  }

  function complete(id, error, data) {
    const entry = inflight.get(id);
    if (!entry) return;
    inflight.delete(id);
    clearTimeout(entry.timer);
    if (error) entry.reject(new BridgeError(error));
    else entry.resolve(data);
  }

  return { send, next, complete, isOnline };
}
