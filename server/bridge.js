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
  // Two lanes: urgent (marks, lists) and normal (previews). The plugin keeps polling while
  // a command runs, and each lane hands out one command at a time, so Lightroom renders one
  // preview and serves one mark or list beside it. A render can take seconds; nothing in
  // the urgent lane waits for it. Each lane keeps its own order.
  // ponytail: a command lost by a plugin reload holds its lane until it times out.
  const lanes = { urgent: { queue: [], running: null }, normal: { queue: [], running: null } };
  const inflight = new Map();
  let waiter = null;
  let lastPollAt = -Infinity;

  const isOnline = () => Date.now() - lastPollAt < onlineWindowMs;

  // The next command the plugin may start, urgent lane first; undefined when there is none.
  function take() {
    for (const lane of [lanes.urgent, lanes.normal]) {
      if (lane.running || !lane.queue.length) continue;
      lane.running = lane.queue.shift();
      inflight.get(lane.running.id).handedAt = Date.now();
      return lane.running;
    }
  }

  // Give the parked poll a command as soon as there is one it may start.
  function feed() {
    if (!waiter) return;
    const cmd = take();
    if (!cmd) return;
    const deliver = waiter;
    waiter = null;
    deliver(cmd);
  }

  // A command is over, answered or timed out: its lane moves on.
  function finish(id) {
    const entry = inflight.get(id);
    inflight.delete(id);
    clearTimeout(entry.timer);
    const { lane, cmd } = entry;
    const at = lane.queue.indexOf(cmd);
    if (at !== -1) lane.queue.splice(at, 1);
    if (lane.running === cmd) lane.running = null;
    feed();
    return entry;
  }

  // `timing`, when given, is filled in on success: { wait, run } in milliseconds, the
  // time spent behind other commands and the time the plugin took.
  function send(type, params = {}, { urgent = false, timing } = {}) {
    if (!isOnline()) return Promise.reject(new BridgeError('lr_offline'));
    const cmd = { id: randomUUID(), type, params };
    const lane = urgent ? lanes.urgent : lanes.normal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        finish(cmd.id);
        reject(new BridgeError('lr_timeout'));
      }, commandTimeoutMs);
      inflight.set(cmd.id, { resolve, reject, timer, timing, lane, cmd, sentAt: Date.now() });
      lane.queue.push(cmd);
      feed();
    });
  }

  // `signal` aborts when the plugin's poll connection drops. A parked poll that is
  // aborted is forgotten at once and the bridge goes offline, so no command is ever
  // handed to a dead connection.
  function next(waitMs, signal) {
    lastPollAt = Date.now();
    const queued = take();
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
    if (!inflight.has(id)) return;
    const entry = finish(id);
    if (error) return entry.reject(new BridgeError(error));
    if (entry.timing) Object.assign(entry.timing, { wait: entry.handedAt - entry.sentAt, run: Date.now() - entry.handedAt });
    entry.resolve(data);
  }

  return { send, next, complete, isOnline };
}
