import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createBridge } from '../server/bridge.js';
import { createPreviewStore } from '../server/previews.js';
import { createApp } from '../server/app.js';

const PHOTO = 'A1B2C3D4-0000-4000-8000-000000000000';

// Node's fetch refuses the ports on the Fetch standard's blocked list ("bad port"), and
// this machine hands out random ports from 1024 up, so a listener can land on one.
const BLOCKED_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);
async function listen(handler) {
  for (;;) {
    const server = http.createServer(handler).listen(0, '127.0.0.1');
    await once(server, 'listening');
    if (!BLOCKED_PORTS.has(server.address().port)) return server;
    server.close();
  }
}

// Tests listen on a random port, so the host allowlist must also accept it. Pass
// { defaultHost: true } to exercise the production allowlist instead.
async function start({ defaultHost = false } = {}) {
  const bridge = createBridge({ commandTimeoutMs: 2000 });
  const dir = await mkdtemp(path.join(tmpdir(), 'lrc-'));
  let pubPort = 0;
  const extra = defaultHost ? {} : { allowedHost: (host) => host === `127.0.0.1:${pubPort}` };
  const app = createApp({ bridge, previews: createPreviewStore(dir, bridge), webDir: path.resolve('web'), pollMs: 200, ...extra });
  const [pub, plug] = await Promise.all([listen(app.publicHandler), listen(app.pluginHandler)]);
  pubPort = pub.address().port;
  const url = (s) => `http://127.0.0.1:${s.address().port}`;
  return {
    pub: url(pub),
    plug: url(plug),
    close() {
      for (const s of [pub, plug]) {
        s.close();
        s.closeAllConnections();
      }
    },
  };
}

const PLUGIN_HEADER = { 'x-lrc-plugin': '1' };

// Fake plugin: polls until one command arrives, answers it, returns the command.
async function answerOne(plug, reply) {
  for (;;) {
    const cmd = await (await fetch(`${plug}/next`, { headers: PLUGIN_HEADER })).json();
    if (!cmd.id) continue;
    const { type = 'application/json', body } = reply(cmd);
    await fetch(`${plug}/result/${cmd.id}`, { method: 'POST', headers: { ...PLUGIN_HEADER, 'content-type': type }, body });
    return cmd;
  }
}
const json = (data) => ({ body: JSON.stringify({ ok: true, data }) });

test('reports offline and answers 503 before the plugin polls', async () => {
  const s = await start();
  try {
    assert.deepEqual(await (await fetch(`${s.pub}/api/status`)).json(), { lrOnline: false });
    const res = await fetch(`${s.pub}/api/sources`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'lr_offline' });
  } finally {
    s.close();
  }
});

test('sources round-trip through the plugin', async () => {
  const s = await start();
  try {
    const plugin = answerOne(s.plug, () => json([{ id: 'f:F:/x', kind: 'folder', name: 'x', depth: 0, count: 3 }]));
    await sleep(30);
    const res = await fetch(`${s.pub}/api/sources`);
    assert.equal(res.status, 200);
    assert.equal((await res.json())[0].name, 'x');
    assert.equal((await plugin).type, 'listSources');
  } finally {
    s.close();
  }
});

test('a photo list is handed to the plugin before previews that were queued earlier', async () => {
  const s = await start();
  try {
    await fetch(`${s.plug}/next`, { headers: PLUGIN_HEADER }); // Online, with no poll parked.
    const preview = fetch(`${s.pub}/api/preview/${PHOTO}?size=std`);
    await sleep(30);
    const list = fetch(`${s.pub}/api/photos?source=${encodeURIComponent('f:F:/x')}`);
    await sleep(30);
    const first = await answerOne(s.plug, () => json([]));
    assert.equal(first.type, 'listPhotos');
    assert.equal((await list).status, 200);
    const second = await answerOne(s.plug, () => ({ type: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }));
    assert.equal(second.type, 'getPreview');
    assert.equal((await preview).status, 200);
  } finally {
    s.close();
  }
});

test('photos rejects a malformed source id without asking the plugin', async () => {
  const s = await start();
  try {
    const res = await fetch(`${s.pub}/api/photos?source=bogus`);
    assert.equal(res.status, 400);
  } finally {
    s.close();
  }
});

test('preview is fetched from the plugin once, then served from disk', async () => {
  const s = await start();
  try {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const plugin = answerOne(s.plug, () => ({ type: 'image/jpeg', body: jpeg }));
    await sleep(30);
    const first = await fetch(`${s.pub}/api/preview/${PHOTO}?size=std`);
    assert.equal(first.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), jpeg);
    assert.deepEqual((await plugin).params, { photoId: PHOTO, size: 1280 });
    // No fake plugin is running now: a second hit can only come from the disk cache.
    const second = await fetch(`${s.pub}/api/preview/${PHOTO}?size=std`);
    assert.deepEqual(Buffer.from(await second.arrayBuffer()), jpeg);
  } finally {
    s.close();
  }
});

test('preview rejects unknown sizes and malformed ids', async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.pub}/api/preview/${PHOTO}?size=huge`)).status, 400);
    assert.equal((await fetch(`${s.pub}/api/preview/not-an-id!?size=std`)).status, 400);
  } finally {
    s.close();
  }
});

test('ops: invalid op is refused, valid op reaches the plugin once, replay is not re-sent', async () => {
  const s = await start();
  const post = (ops) =>
    fetch(`${s.pub}/api/ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops }) }).then((r) => r.json());
  try {
    const good = { opId: 'op-1', photoId: PHOTO, field: 'rating', value: 3, ts: 1 };
    const bad = { opId: 'op-2', photoId: PHOTO, field: 'rating', value: 9, ts: 2 };
    const plugin = answerOne(s.plug, () => json(true));
    await sleep(30);
    const first = await post([bad, good]);
    assert.deepEqual(first.results, [
      { opId: 'op-2', ok: false, error: 'invalid_op', retryable: false },
      { opId: 'op-1', ok: true },
    ]);
    assert.deepEqual((await plugin).params, { photoId: PHOTO, field: 'rating', value: 3 });
    // Replay with no plugin answering: it must succeed from the done-set alone.
    const replay = await post([good]);
    assert.deepEqual(replay.results, [{ opId: 'op-1', ok: true }]);
  } finally {
    s.close();
  }
});

test('ops: a busy Lightroom is reported as retryable', async () => {
  const s = await start();
  try {
    const plugin = answerOne(s.plug, () => ({ body: JSON.stringify({ ok: false, error: 'lr_busy' }) }));
    await sleep(30);
    const res = await fetch(`${s.pub}/api/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ opId: 'op-3', photoId: PHOTO, field: 'pickStatus', value: 1, ts: 1 }] }),
    });
    assert.deepEqual((await res.json()).results, [{ opId: 'op-3', ok: false, error: 'lr_busy', retryable: true }]);
    await plugin;
  } finally {
    s.close();
  }
});

test('ops: a retryable failure halts the rest of the batch, a refused op does not', async () => {
  const s = await start();
  const post = (ops) =>
    fetch(`${s.pub}/api/ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops }) }).then((r) => r.json());
  const op = (n) => ({ opId: `halt-${n}`, photoId: PHOTO, field: 'rating', value: n, ts: n });
  const reply = (body) => () => ({ body: JSON.stringify(body) });
  try {
    const busy = answerOne(s.plug, reply({ ok: false, error: 'lr_busy' }));
    await sleep(30);
    assert.deepEqual((await post([op(1), op(2)])).results, [
      { opId: 'halt-1', ok: false, error: 'lr_busy', retryable: true },
      { opId: 'halt-2', ok: false, error: 'lr_busy', retryable: true },
    ]);
    assert.equal((await busy).params.value, 1); // The second op never reached the plugin.
    // A photo that is gone is final for that op only; the next op still runs.
    const answers = (async () => {
      await answerOne(s.plug, reply({ ok: false, error: 'photo_not_found' }));
      return answerOne(s.plug, reply({ ok: true, data: true }));
    })();
    await sleep(30);
    assert.deepEqual((await post([op(3), op(4)])).results, [
      { opId: 'halt-3', ok: false, error: 'photo_not_found', retryable: false },
      { opId: 'halt-4', ok: true },
    ]);
    assert.equal((await answers).params.value, 4);
  } finally {
    s.close();
  }
});

test('info reports whether the device is at home and the server version', async () => {
  const bridge = createBridge();
  const seen = [];
  const app = createApp({
    bridge,
    previews: createPreviewStore(await mkdtemp(path.join(tmpdir(), 'lrc-')), bridge),
    webDir: path.resolve('web'),
    allowedHost: () => true,
    atHome: async (req) => {
      seen.push(req.headers['x-forwarded-for']);
      return true;
    },
    version: '9.9.9',
  });
  const server = await listen(app.publicHandler);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/info`, { headers: { 'x-forwarded-for': '100.64.0.2' } });
    assert.deepEqual(await res.json(), { atHome: true, version: '9.9.9' });
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(seen, ['100.64.0.2']);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test('the local host allowlist follows the public port', async () => {
  const bridge = createBridge();
  const app = createApp({ bridge, previews: createPreviewStore(await mkdtemp(path.join(tmpdir(), 'lrc-')), bridge), webDir: path.resolve('web'), publicPort: 47810 });
  const call = (host) =>
    new Promise((resolve) => {
      app.publicHandler({ method: 'GET', url: '/api/status', headers: { host } }, { writeHead: (status) => resolve(status), end() {} });
    });
  assert.equal(await call('127.0.0.1:47810'), 200);
  assert.equal(await call('127.0.0.1:47800'), 421);
  assert.equal(await call('my-pc.tail1234.ts.net'), 200);
});

test('static files cannot escape the web directory', async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.pub}/..%2Fpackage.json`)).status, 403);
  } finally {
    s.close();
  }
});

// Node's fetch normalises URLs, so send the request target as-is over node:http.
function rawGet(base, rawPath) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: hostname, port, path: rawPath, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('a request target that is not a valid URL gets 400 and does not kill the server', async () => {
  const s = await start();
  try {
    for (const base of [s.pub, s.plug]) {
      assert.equal(await rawGet(base, '//'), 400, base);
    }
    assert.deepEqual(await (await fetch(`${s.pub}/api/status`)).json(), { lrOnline: false });
    assert.equal((await fetch(`${s.plug}/nope`)).status, 404);
  } finally {
    s.close();
  }
});

test('a plugin error named after an Object.prototype member still maps to 502', async () => {
  const s = await start();
  try {
    const plugin = answerOne(s.plug, () => ({ body: JSON.stringify({ ok: false, error: 'constructor' }) }));
    await sleep(30);
    const res = await fetch(`${s.pub}/api/sources`);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'constructor' });
    await plugin;
  } finally {
    s.close();
  }
});

test('a non-JPEG preview reply is refused with 502 and never cached', async () => {
  const s = await start();
  try {
    const bad = answerOne(s.plug, () => ({ type: 'image/jpeg', body: Buffer.from('nope') }));
    await sleep(30);
    const first = await fetch(`${s.pub}/api/preview/${PHOTO}?size=std`);
    assert.equal(first.status, 502);
    assert.deepEqual(await first.json(), { error: 'bad_preview' });
    await bad;
    // The bad reply was not cached, so a second request must reach the plugin again.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const good = answerOne(s.plug, () => ({ type: 'image/jpeg', body: jpeg }));
    await sleep(30);
    const second = await fetch(`${s.pub}/api/preview/${PHOTO}?size=std`);
    assert.equal(second.status, 200);
    assert.deepEqual(Buffer.from(await second.arrayBuffer()), jpeg);
    await good;
  } finally {
    s.close();
  }
});

test('status turns offline as soon as the plugin drops its parked poll connection', async () => {
  const s = await start();
  try {
    const req = http.get(`${s.plug}/next`, { headers: PLUGIN_HEADER });
    req.on('error', () => {});
    await sleep(30);
    assert.deepEqual(await (await fetch(`${s.pub}/api/status`)).json(), { lrOnline: true });
    req.destroy();
    await sleep(50);
    assert.deepEqual(await (await fetch(`${s.pub}/api/status`)).json(), { lrOnline: false });
  } finally {
    s.close();
  }
});

// Raw request with a chosen Host header; resolves { status, body }.
function rawRequest(base, { path: reqPath, method = 'GET', headers = {}, body }) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: hostname, port, path: reqPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('a foreign Host header is refused with 421 before routing (DNS rebinding defence)', async () => {
  const s = await start();
  try {
    for (const reqPath of ['/api/status', '/']) {
      const res = await rawRequest(s.pub, { path: reqPath, headers: { host: 'evil.example' } });
      assert.equal(res.status, 421, reqPath);
      assert.deepEqual(JSON.parse(res.body), { error: 'bad_host' });
    }
  } finally {
    s.close();
  }
});

test('default allowlist accepts loopback and tailnet hosts and nothing else', async () => {
  const s = await start({ defaultHost: true });
  try {
    const status = (host) => rawRequest(s.pub, { path: '/api/status', headers: { host } }).then((r) => r.status);
    for (const host of ['127.0.0.1:47800', 'localhost:47800', 'dianna.example.ts.net', 'dianna.example.ts.net:443']) {
      assert.equal(await status(host), 200, host);
    }
    for (const host of ['evil.example', 'evil.ts.net.evil.example', 'ts.net.evil.example', '127.0.0.1:1234', 'xts.net', 'dianna.ts.net:8443', '']) {
      assert.equal(await status(host), 421, host);
    }
  } finally {
    s.close();
  }
});

test('ops: a non-JSON content type is refused with 415 and never reaches the plugin', async () => {
  const s = await start();
  try {
    const op = { opId: 'op-9', photoId: PHOTO, field: 'rating', value: 3, ts: 1 };
    const res = await fetch(`${s.pub}/api/ops`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ ops: [op] }) });
    assert.equal(res.status, 415);
    assert.deepEqual(await res.json(), { error: 'unsupported_media_type' });
    assert.deepEqual(await (await fetch(`${s.pub}/api/status`)).json(), { lrOnline: false });
  } finally {
    s.close();
  }
});

test('plugin port refuses /next and /result without the plugin header and never touches the bridge', async () => {
  const s = await start();
  try {
    const next = await rawRequest(s.plug, { path: '/next' });
    assert.equal(next.status, 403);
    assert.deepEqual(JSON.parse(next.body), { error: 'forbidden' });
    const result = await rawRequest(s.plug, { path: '/result/abc', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });
    assert.equal(result.status, 403);
    // A parked poll would have made Lightroom look online.
    assert.deepEqual(await (await fetch(`${s.pub}/api/status`)).json(), { lrOnline: false });
  } finally {
    s.close();
  }
});
