import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnmarked, toggledValue, setField, shouldAdvance, shouldRollback, parseValue, mergeFresh, indexAfterFilter, markSummary, badgeParts, nextRefreshDelay, sortPhotos, swipeFlag, gestureMark, pullProgress, tapZone, resumeIndex, rememberCapped } from '../web/js/state.js';

const blank = () => ({ id: 'x', name: 'a.raw', time: 0, rating: 0, label: 'none', pick: 0 });

test('isUnmarked is true only when flag, rating and label are all empty', () => {
  assert.equal(isUnmarked(blank()), true);
  assert.equal(isUnmarked({ ...blank(), rating: 1 }), false);
  assert.equal(isUnmarked({ ...blank(), label: 'red' }), false);
  assert.equal(isUnmarked({ ...blank(), pick: 1 }), false);
  assert.equal(isUnmarked({ ...blank(), pick: -1 }), false);
});

test('toggledValue clears a value that is already active and sets a new one otherwise', () => {
  const photo = { ...blank(), rating: 3, label: 'red', pick: 1 };
  assert.equal(toggledValue(photo, 'rating', 3), 0);
  assert.equal(toggledValue(photo, 'rating', 5), 5);
  assert.equal(toggledValue(photo, 'label', 'red'), 'none');
  assert.equal(toggledValue(photo, 'label', 'blue'), 'blue');
  assert.equal(toggledValue(photo, 'pickStatus', 1), 0);
  assert.equal(toggledValue(photo, 'pickStatus', -1), -1);
  assert.equal(toggledValue({ ...blank(), pick: -1 }, 'pickStatus', -1), 0);
});

test('setField writes the value and returns the previous one for rollback', () => {
  const photo = blank();
  assert.equal(setField(photo, 'pickStatus', -1), 0);
  assert.equal(photo.pick, -1);
  assert.equal(setField(photo, 'rating', 4), 0);
  assert.equal(photo.rating, 4);
});

test('shouldAdvance moves on after a pick or reject only', () => {
  assert.equal(shouldAdvance('pickStatus', 1), true);
  assert.equal(shouldAdvance('pickStatus', -1), true);
  assert.equal(shouldAdvance('pickStatus', 0), false);
  assert.equal(shouldAdvance('rating', 5), false);
  assert.equal(shouldAdvance('label', 'red'), false);
});

test('shouldRollback only when the field still holds the value the failed op set', () => {
  const photo = blank();
  setField(photo, 'rating', 3);
  assert.equal(shouldRollback(photo, 'rating', 3), true);
  setField(photo, 'rating', 5);
  assert.equal(shouldRollback(photo, 'rating', 3), false);
  setField(photo, 'pickStatus', -1);
  assert.equal(shouldRollback(photo, 'pickStatus', -1), true);
  assert.equal(shouldRollback(photo, 'pickStatus', 1), false);
});

test('parseValue keeps labels as strings and turns other fields into numbers', () => {
  assert.equal(parseValue('label', 'red'), 'red');
  assert.equal(parseValue('rating', '3'), 3);
  assert.equal(parseValue('pickStatus', '-1'), -1);
});

test('mergeFresh copies newer marks without changing membership or order', () => {
  const photos = [{ ...blank(), id: 'a' }, { ...blank(), id: 'b' }, { ...blank(), id: 'c', rating: 2 }];
  const fresh = [
    { ...blank(), id: 'b', rating: 4, label: 'green', pick: 1 },
    { ...blank(), id: 'a' },
    { ...blank(), id: 'z', rating: 5 },
  ];
  const changed = mergeFresh(photos, fresh, () => false);
  assert.equal(changed, 1);
  assert.deepEqual(photos.map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual([photos[1].rating, photos[1].label, photos[1].pick], [4, 'green', 1]);
  assert.equal(photos[2].rating, 2);
  assert.equal(photos.length, 3);
});

test('mergeFresh leaves fields with an op in flight alone', () => {
  const photos = [{ ...blank(), id: 'a', rating: 5 }];
  const fresh = [{ ...blank(), id: 'a', rating: 0, pick: -1 }];
  const changed = mergeFresh(photos, fresh, (id, field) => id === 'a' && field === 'rating');
  assert.equal(changed, 1);
  assert.equal(photos[0].rating, 5);
  assert.equal(photos[0].pick, -1);
});

test('mergeFresh reports zero when nothing changed', () => {
  const photos = [{ ...blank(), id: 'a', rating: 2 }];
  assert.equal(mergeFresh(photos, [{ ...blank(), id: 'a', rating: 2 }], () => false), 0);
});

test('indexAfterFilter stays on the same photo when it is still listed', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(indexAfterFilter(list, 'c'), 2);
  assert.equal(indexAfterFilter(list, 'zz'), 0);
  assert.equal(indexAfterFilter(list, null), 0);
  assert.equal(indexAfterFilter([], 'a'), 0);
});

test('markSummary describes every kind of mark for the confirmation flash', () => {
  assert.deepEqual(markSummary('pickStatus', 1), { icon: 'flag', text: '留用' });
  assert.deepEqual(markSummary('pickStatus', -1), { icon: 'ban', text: '弃用' });
  assert.deepEqual(markSummary('pickStatus', 0), { icon: 'flag-off', text: '取消旗标' });
  assert.deepEqual(markSummary('rating', 3), { icon: 'star', text: '3 星' });
  assert.deepEqual(markSummary('rating', 0), { icon: 'star-off', text: '清除星级' });
  assert.deepEqual(markSummary('label', 'red'), { swatch: 'red', text: '红色' });
  assert.deepEqual(markSummary('label', 'yellow'), { swatch: 'yellow', text: '黄色' });
  assert.deepEqual(markSummary('label', 'green'), { swatch: 'green', text: '绿色' });
  assert.deepEqual(markSummary('label', 'blue'), { swatch: 'blue', text: '蓝色' });
  assert.deepEqual(markSummary('label', 'purple'), { swatch: 'purple', text: '紫色' });
  assert.deepEqual(markSummary('label', 'none'), { icon: 'circle-off', text: '清除色标' });
});

test('badgeParts lists the marks in display order and skips empty ones', () => {
  assert.deepEqual(badgeParts(blank()), []);
  assert.deepEqual(badgeParts({ ...blank(), pick: 1, rating: 3, label: 'yellow' }), [
    { kind: 'pick' },
    { kind: 'rating', value: 3 },
    { kind: 'label', value: 'yellow' },
  ]);
  assert.deepEqual(badgeParts({ ...blank(), pick: -1 }), [{ kind: 'reject' }]);
  assert.deepEqual(badgeParts({ ...blank(), label: 'blue' }), [{ kind: 'label', value: 'blue' }]);
});

test('nextRefreshDelay waits five times the last refresh, never less than the base', () => {
  assert.equal(nextRefreshDelay(0), 5000);
  assert.equal(nextRefreshDelay(400), 5000);
  assert.equal(nextRefreshDelay(1740), 8700);
  assert.equal(nextRefreshDelay(1000, 3000), 5000);
});

test('sortPhotos orders by capture time or file name without touching the input', () => {
  const photos = [
    { id: 'b', name: 'IMG_10.NEF', time: 200 },
    { id: 'a', name: 'IMG_2.NEF', time: 100 },
    { id: 'c', name: 'IMG_1.NEF', time: 200 },
  ];
  const ids = (list) => list.map((photo) => photo.id);
  assert.deepEqual(ids(sortPhotos(photos, 'time-asc')), ['a', 'c', 'b']);
  assert.deepEqual(ids(sortPhotos(photos, 'time-desc')), ['c', 'b', 'a']);
  assert.deepEqual(ids(sortPhotos(photos, 'name')), ['c', 'a', 'b']);
  assert.deepEqual(ids(sortPhotos(photos, 'bogus')), ['a', 'c', 'b']);
  assert.deepEqual(ids(photos), ['b', 'a', 'c']);
});

const gesture = (over = {}) => ({ dx: 0, dy: -120, startY: 400, viewportHeight: 800, durationMs: 200, ...over });

test('swipeFlag: swipe up picks and swipe down rejects', () => {
  assert.equal(swipeFlag(gesture({ dy: -120 })), 1);
  assert.equal(swipeFlag(gesture({ dy: 120 })), -1);
});

test('swipeFlag ignores diagonal, short and exactly-at-threshold gestures', () => {
  assert.equal(swipeFlag(gesture({ dx: 60, dy: -90 })), 0);
  assert.equal(swipeFlag(gesture({ dy: -50 })), 0);
  assert.equal(swipeFlag(gesture({ dy: -80 })), 0);
  assert.equal(swipeFlag(gesture({ dx: 80, dy: -120 })), 0); // ratio exactly 1.5
});

test('swipeFlag ignores gestures that start at the top or bottom screen edge', () => {
  assert.equal(swipeFlag(gesture({ startY: 10 })), 0);
  assert.equal(swipeFlag(gesture({ dy: 120, startY: 790 })), 0);
  assert.equal(swipeFlag(gesture({ startY: 24 })), 1);
  assert.equal(swipeFlag(gesture({ startY: 776 })), 1);
});

test('swipeFlag ignores slow drags', () => {
  assert.equal(swipeFlag(gesture({ durationMs: 1600 })), 0);
  assert.equal(swipeFlag(gesture({ durationMs: 1500 })), 1);
});

test('gestureMark advances when the photo already has the flag and marks otherwise', () => {
  assert.equal(gestureMark({ pick: 1 }, 1), 'advance');
  assert.equal(gestureMark({ pick: -1 }, -1), 'advance');
  assert.equal(gestureMark({ pick: -1 }, 1), 'mark');
  assert.equal(gestureMark({ pick: 0 }, 1), 'mark');
});

test('pullProgress grows with the pull and stops at 1', () => {
  assert.equal(pullProgress(0), 0);
  assert.equal(pullProgress(-40), 0.5);
  assert.equal(pullProgress(40), 0.5);
  assert.equal(pullProgress(-200), 1);
});

test('tapZone keeps a wide middle so a slightly off-centre tap does not change photo', () => {
  assert.equal(tapZone(10, 400), 'prev');
  assert.equal(tapZone(87, 400), 'prev');
  assert.equal(tapZone(88, 400), 'middle');
  assert.equal(tapZone(89, 400), 'middle');
  assert.equal(tapZone(200, 400), 'middle');
  assert.equal(tapZone(311, 400), 'middle');
  assert.equal(tapZone(312, 400), 'middle');
  assert.equal(tapZone(313, 400), 'next');
  assert.equal(tapZone(399, 400), 'next');
});

test('resumeIndex returns to the remembered photo or the next listed one after it', () => {
  const all = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const list = [all[0], all[3], all[4]];
  assert.equal(resumeIndex(all, list, 'd'), 1);
  assert.equal(resumeIndex(all, list, 'b'), 1);
  assert.equal(resumeIndex(all, list, 'c'), 1);
  assert.equal(resumeIndex(all, [all[0], all[1]], 'e'), 0);
  assert.equal(resumeIndex(all, list, 'gone'), 0);
  assert.equal(resumeIndex(all, list, undefined), 0);
  assert.equal(resumeIndex([], [], 'a'), 0);
});

test('rememberCapped keeps the most recent entries and drops the oldest', () => {
  const map = {};
  rememberCapped(map, 'f:1', 'p1', 2);
  rememberCapped(map, 'f:2', 'p2', 2);
  rememberCapped(map, 'f:1', 'p9', 2);
  assert.deepEqual(Object.keys(map), ['f:2', 'f:1']);
  assert.equal(map['f:1'], 'p9');
  rememberCapped(map, 'f:3', 'p3', 2);
  assert.deepEqual(Object.keys(map), ['f:1', 'f:3']);
});
