import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { pickForCache, estimateBytes, formatBytes, cacheChoice, uncached, runPool } from '../web/js/cacheplan.js';

const photo = (id, marks = {}) => ({ id, name: `${id}.raw`, time: 0, rating: 0, label: 'none', pick: 0, ...marks });

test('pickForCache takes unmarked photos or all of them, in order, up to the limit', () => {
  const photos = [photo('a'), photo('b', { rating: 2 }), photo('c'), photo('d', { pick: -1 }), photo('e')];
  assert.deepEqual(pickForCache(photos, 'unmarked').map((p) => p.id), ['a', 'c', 'e']);
  assert.deepEqual(pickForCache(photos, 'all').map((p) => p.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(pickForCache(photos, 'unmarked', 2).map((p) => p.id), ['a', 'c']);
  assert.equal(pickForCache(photos, 'all', 0).length, 5);
});

test('estimateBytes uses the measured average per size', () => {
  assert.equal(estimateBytes(100, 'std'), 100 * 210 * 1024);
  assert.equal(estimateBytes(100, 'hd'), 100 * 574 * 1024);
  assert.equal(estimateBytes(0, 'hd'), 0);
});

test('formatBytes picks a readable unit', () => {
  assert.equal(formatBytes(0), '1 KB');
  assert.equal(formatBytes(300 * 1024), '300 KB');
  assert.equal(formatBytes(44 * 210 * 1024), '9 MB');
  assert.equal(formatBytes(2515 * 574 * 1024), '1.4 GB');
});

test('uncached treats a larger cached preview as covering a smaller one, not the reverse', () => {
  const urlFor = (id, size) => `/${id}?${size}`;
  const photos = [photo('a'), photo('b'), photo('c')];
  const have = new Set(['/a?std', '/b?hd']);
  assert.deepEqual(uncached(photos, 'std', have, urlFor).map((p) => p.id), ['c']);
  assert.deepEqual(uncached(photos, 'hd', have, urlFor).map((p) => p.id), ['a', 'c']);
  assert.deepEqual(uncached(photos, 'hd', new Set(), urlFor).length, 3);
});

test('cacheChoice says how much is left to download and disables a choice with nothing to do', () => {
  assert.deepEqual(cacheChoice('缓存全部', 0, 0, 'std'), { text: '缓存全部（0 张）', disabled: true });
  assert.deepEqual(cacheChoice('缓存全部', 60, 60, 'std'), { text: '缓存全部（60 张，约 12 MB）', disabled: false });
  assert.deepEqual(cacheChoice('缓存全部', 600, 540, 'hd'), { text: '缓存全部（600 张，还差 540 张，约 303 MB）', disabled: false });
  assert.deepEqual(cacheChoice('缓存未标记', 60, 0, 'hd'), { text: '缓存未标记（60 张，已全部缓存）', disabled: true });
});

test('runPool visits every item and never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  const seen = [];
  await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    await sleep(5);
    seen.push(item);
    running -= 1;
  });
  assert.equal(peak, 3);
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test('runPool stops handing out items after the first error and rethrows it', async () => {
  const started = [];
  await assert.rejects(
    runPool([1, 2, 3, 4, 5, 6], 2, async (item) => {
      started.push(item);
      await sleep(item === 1 ? 1 : 10);
      if (item === 1) throw new Error('boom');
    }),
    /boom/,
  );
  await sleep(30);
  assert.deepEqual(started, [1, 2]);
});

test('runPool with nothing to do resolves', async () => {
  await runPool([], 3, async () => assert.fail('no items'));
});
