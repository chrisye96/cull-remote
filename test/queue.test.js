import test from 'node:test';
import assert from 'node:assert/strict';
import { opKey, pendingKeys, applyQueued, settleBatch } from '../web/js/queue.js';

const photo = (id) => ({ id, name: `${id}.raw`, time: 0, rating: 0, label: 'none', pick: 0 });
const op = (opId, photoId, field, value) => ({ opId, photoId, field, value });

test('pendingKeys lists each photo and field that still has a mark waiting', () => {
  const keys = pendingKeys([op('1', 'a', 'rating', 3), op('2', 'a', 'rating', 4), op('3', 'b', 'label', 'red')]);
  assert.deepEqual([...keys].sort(), [opKey('a', 'rating'), opKey('b', 'label')]);
});

test('applyQueued replays marks in order, so the last one for a field wins', () => {
  const photos = [photo('a'), photo('b')];
  const applied = applyQueued(photos, [op('1', 'a', 'rating', 3), op('2', 'a', 'pickStatus', 1), op('3', 'a', 'rating', 5), op('4', 'gone', 'label', 'red')]);
  assert.equal(applied, 3);
  assert.deepEqual(photos[0], { ...photo('a'), rating: 5, pick: 1 });
  assert.deepEqual(photos[1], photo('b'));
});

test('applyQueued with an empty queue changes nothing', () => {
  const photos = [photo('a')];
  assert.equal(applyQueued(photos, []), 0);
  assert.deepEqual(photos, [photo('a')]);
});

test('settleBatch drops applied marks and reports the ones refused for good', () => {
  const batch = [op('1', 'a', 'rating', 3), op('2', 'b', 'rating', 3), op('3', 'c', 'rating', 3)];
  const out = settleBatch(batch, [
    { opId: '1', ok: true },
    { opId: '2', ok: false, error: 'photo_not_found', retryable: false },
    { opId: '3', ok: true },
  ]);
  assert.deepEqual(out.done, ['1', '2', '3']);
  assert.deepEqual(out.failed, [{ op: batch[1], error: 'photo_not_found' }]);
  assert.equal(out.halted, '');
});

test('settleBatch keeps everything from a retryable failure onwards', () => {
  const batch = [op('1', 'a', 'rating', 3), op('2', 'b', 'rating', 3), op('3', 'c', 'rating', 3)];
  const out = settleBatch(batch, [
    { opId: '1', ok: true },
    { opId: '2', ok: false, error: 'lr_busy', retryable: true },
    { opId: '3', ok: false, error: 'lr_busy', retryable: true },
  ]);
  assert.deepEqual(out, { done: ['1'], failed: [], halted: 'lr_busy' });
});

test('settleBatch treats a missing or malformed answer as a lost connection', () => {
  const batch = [op('1', 'a', 'rating', 3), op('2', 'b', 'rating', 3)];
  assert.deepEqual(settleBatch(batch, [{ opId: '1', ok: true }]), { done: ['1'], failed: [], halted: 'network' });
  assert.deepEqual(settleBatch(batch, undefined), { done: [], failed: [], halted: 'network' });
});
