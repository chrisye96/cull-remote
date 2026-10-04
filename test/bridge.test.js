import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createBridge, BridgeError } from '../server/bridge.js';

const hasCode = (code) => (e) => e instanceof BridgeError && e.code === code;

test('send rejects with lr_offline when the plugin has never polled', async () => {
  const bridge = createBridge();
  assert.equal(bridge.isOnline(), false);
  await assert.rejects(bridge.send('listSources'), hasCode('lr_offline'));
});

test('a command reaches a parked poll and resolves with the plugin result', async () => {
  const bridge = createBridge();
  const poll = bridge.next(1000);
  const sent = bridge.send('listSources', { a: 1 });
  const cmd = await poll;
  assert.equal(cmd.type, 'listSources');
  assert.deepEqual(cmd.params, { a: 1 });
  bridge.complete(cmd.id, null, [1, 2]);
  assert.deepEqual(await sent, [1, 2]);
});

test('a command sent between polls is delivered by the next poll', async () => {
  const bridge = createBridge();
  assert.equal(await bridge.next(5), null);
  const sent = bridge.send('listSources');
  const cmd = await bridge.next(1000);
  bridge.complete(cmd.id, null, 'ok');
  assert.equal(await sent, 'ok');
});

test('commands are delivered in the order they were sent', async () => {
  const bridge = createBridge();
  await bridge.next(5);
  const first = bridge.send('a');
  const second = bridge.send('b');
  const one = await bridge.next(1000);
  bridge.complete(one.id, null, 1);
  const two = await bridge.next(1000);
  assert.deepEqual([one.type, two.type], ['a', 'b']);
  bridge.complete(two.id, null, 2);
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
});

test('a plugin error rejects with the plugin error string as code', async () => {
  const bridge = createBridge();
  const poll = bridge.next(1000);
  const sent = bridge.send('setMeta');
  const cmd = await poll;
  bridge.complete(cmd.id, 'lr_busy', undefined);
  await assert.rejects(sent, hasCode('lr_busy'));
});

test('urgent commands overtake queued normal ones and keep their own order', async () => {
  const bridge = createBridge();
  await bridge.next(5);
  const sends = [
    bridge.send('getPreview'),
    bridge.send('getPreview'),
    bridge.send('setMeta', { n: 1 }, { urgent: true }),
    bridge.send('setMeta', { n: 2 }, { urgent: true }),
  ];
  const order = [];
  for (let i = 0; i < 4; i += 1) {
    const cmd = await bridge.next(1000);
    order.push(cmd.params.n ?? cmd.type);
    bridge.complete(cmd.id, null, true);
  }
  assert.deepEqual(order, [1, 2, 'getPreview', 'getPreview']);
  await Promise.all(sends);
});

test('a timed-out command leaves its queue and is never delivered', async () => {
  const bridge = createBridge({ commandTimeoutMs: 20 });
  await bridge.next(5);
  await assert.rejects(bridge.send('setMeta', {}, { urgent: true }), hasCode('lr_timeout'));
  await assert.rejects(bridge.send('listSources'), hasCode('lr_timeout'));
  assert.equal(await bridge.next(5), null);
});

test('a command nobody answers rejects with lr_timeout', async () => {
  const bridge = createBridge({ commandTimeoutMs: 20 });
  await bridge.next(5);
  await assert.rejects(bridge.send('listSources'), hasCode('lr_timeout'));
});

test('isOnline turns false once the online window has passed', async () => {
  const bridge = createBridge({ onlineWindowMs: 20 });
  await bridge.next(5);
  assert.equal(bridge.isOnline(), true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(bridge.isOnline(), false);
});

test('aborting a parked poll resolves it with null and takes the bridge offline at once', async () => {
  const bridge = createBridge();
  const ac = new AbortController();
  const poll = bridge.next(1000, ac.signal);
  assert.equal(bridge.isOnline(), true);
  ac.abort();
  assert.equal(await poll, null);
  assert.equal(bridge.isOnline(), false);
});

test('after an abort send rejects lr_offline and no command reaches the aborted waiter', async () => {
  const bridge = createBridge();
  const ac = new AbortController();
  const poll = bridge.next(1000, ac.signal);
  ac.abort();
  assert.equal(await poll, null);
  await assert.rejects(bridge.send('listSources'), hasCode('lr_offline'));
});

test('aborting the signal of a finished poll does not disturb a newer parked poll', async () => {
  const bridge = createBridge();
  const old = new AbortController();
  assert.equal(await bridge.next(5, old.signal), null);
  const newer = bridge.next(1000);
  old.abort();
  assert.equal(bridge.isOnline(), true);
  const sent = bridge.send('listSources');
  const cmd = await newer;
  assert.equal(cmd.type, 'listSources');
  bridge.complete(cmd.id, null, 'ok');
  assert.equal(await sent, 'ok');
});

test('aborting the signal of a replaced poll does not disturb the newer parked poll', async () => {
  const bridge = createBridge();
  const old = new AbortController();
  const first = bridge.next(1000, old.signal);
  const newer = bridge.next(1000);
  assert.equal(await first, null);
  old.abort();
  assert.equal(bridge.isOnline(), true);
  const sent = bridge.send('listSources');
  const cmd = await newer;
  bridge.complete(cmd.id, null, 'ok');
  assert.equal(await sent, 'ok');
});

test('timing separates the wait behind another command from the plugin run time', async () => {
  const bridge = createBridge();
  await bridge.next(5);
  const first = bridge.send('a');
  const timing = {};
  const second = bridge.send('b', {}, { timing });
  const one = await bridge.next(1000);
  await sleep(40); // The plugin is busy with the first command.
  bridge.complete(one.id, null, 1);
  const two = await bridge.next(1000);
  await sleep(40);
  bridge.complete(two.id, null, 2);
  assert.deepEqual([await first, await second], [1, 2]);
  assert.ok(timing.wait >= 30 && timing.wait < 500, `wait ${timing.wait}`);
  assert.ok(timing.run >= 30 && timing.run < 500, `run ${timing.run}`);
});

// The plugin polls again while a command runs. Each lane hands out one command at a time,
// so Lightroom renders one preview and serves one mark or list beside it.
for (const [lane, options] of [['normal', {}], ['urgent', { urgent: true }]]) {
  test(`the ${lane} lane holds its next command back until the running one completes`, async () => {
    const bridge = createBridge();
    await bridge.next(5);
    const sends = [bridge.send('x', { n: 1 }, options), bridge.send('x', { n: 2 }, options)];
    const one = await bridge.next(1000);
    let two = null;
    const parked = bridge.next(1000).then((cmd) => (two = cmd));
    await sleep(20);
    assert.equal(two, null);
    bridge.complete(one.id, null, 1);
    await parked;
    assert.equal(two.params.n, 2);
    bridge.complete(two.id, null, 2);
    assert.deepEqual(await Promise.all(sends), [1, 2]);
  });
}

test('a mark or a list is handed out while a preview is still running', async () => {
  const bridge = createBridge();
  await bridge.next(5);
  const preview = bridge.send('getPreview');
  const one = await bridge.next(1000);
  const parked = bridge.next(1000);
  const list = bridge.send('listPhotos', {}, { urgent: true });
  const two = await parked;
  assert.equal(two.type, 'listPhotos');
  bridge.complete(two.id, null, 'list');
  bridge.complete(one.id, null, 'jpeg');
  assert.deepEqual(await Promise.all([preview, list]), ['jpeg', 'list']);
});

test('a running command that times out frees its lane for the next one', async () => {
  const bridge = createBridge({ commandTimeoutMs: 100 });
  await bridge.next(5);
  const stuck = bridge.send('getPreview', { n: 1 });
  await bridge.next(1000); // Handed out and never answered.
  await sleep(60);
  const waiting = bridge.send('getPreview', { n: 2 });
  const cmd = await bridge.next(1000);
  assert.equal(cmd.params.n, 2);
  bridge.complete(cmd.id, null, 2);
  await assert.rejects(stuck, hasCode('lr_timeout'));
  assert.equal(await waiting, 2);
});
