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
  const pending = [];
  const inflight = new Map();
  let waiter = null;
  let lastPollAt = -Infinity;

  const isOnline = () => Date.now() - lastPollAt < onlineWindowMs;

  function send(type, params = {}) {
    if (!isOnline()) return Promise.reject(new BridgeError('lr_offline'));
    const cmd = { id: randomUUID(), type, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        inflight.delete(cmd.id);
        const at = pending.indexOf(cmd);
        if (at !== -1) pending.splice(at, 1);
        reject(new BridgeError('lr_timeout'));
      }, commandTimeoutMs);
      inflight.set(cmd.id, { resolve, reject, timer });
      if (waiter) {
        const deliver = waiter;
        waiter = null;
        deliver(cmd);
      } else {
        pending.push(cmd);
      }
    });
  }

  function next(waitMs) {
    lastPollAt = Date.now();
    if (pending.length) return Promise.resolve(pending.shift());
    // A newer poll replaces an older parked one (plugin reload).
    if (waiter) waiter(null);
    return new Promise((resolve) => {
      const deliver = (cmd) => {
        clearTimeout(timer);
        lastPollAt = Date.now();
        resolve(cmd);
      };
      const timer = setTimeout(() => {
        if (waiter === deliver) waiter = null;
        deliver(null);
      }, waitMs);
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
