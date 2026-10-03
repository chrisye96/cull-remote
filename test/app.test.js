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

async function start() {
  const bridge = createBridge({ commandTimeoutMs: 2000 });
  const dir = await mkdtemp(path.join(tmpdir(), 'lrc-'));
  const app = createApp({ bridge, previews: createPreviewStore(dir, bridge), webDir: path.resolve('web'), pollMs: 200 });
  const pub = http.createServer(app.publicHandler).listen(0, '127.0.0.1');
  const plug = http.createServer(app.pluginHandler).listen(0, '127.0.0.1');
  await Promise.all([once(pub, 'listening'), once(plug, 'listening')]);
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

// Fake plugin: polls until one command arrives, answers it, returns the command.
async function answerOne(plug, reply) {
  for (;;) {
    const cmd = await (await fetch(`${plug}/next`)).json();
    if (!cmd.id) continue;
    const { type = 'application/json', body } = reply(cmd);
    await fetch(`${plug}/result/${cmd.id}`, { method: 'POST', headers: { 'content-type': type }, body });
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
    const req = http.get(`${s.plug}/next`);
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
