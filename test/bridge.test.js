import test from 'node:test';
import assert from 'node:assert/strict';
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
  const two = await bridge.next(1000);
  assert.deepEqual([one.type, two.type], ['a', 'b']);
  bridge.complete(one.id, null, 1);
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
