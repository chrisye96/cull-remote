import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnmarked, toggledValue, setField, shouldAdvance, shouldRollback, parseValue, mergeFresh } from '../web/js/state.js';

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
  const photos = [{ ...blank(), id: 'a' }, { ...blank(), id: 'b' }, { ...blank(), id: 'c' }];
  const fresh = [
    { ...blank(), id: 'b', rating: 4, label: 'green', pick: 1 },
    { ...blank(), id: 'a' },
    { ...blank(), id: 'z', rating: 5 },
  ];
  const changed = mergeFresh(photos, fresh, () => false);
  assert.equal(changed, 1);
  assert.deepEqual(photos.map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual([photos[1].rating, photos[1].label, photos[1].pick], [4, 'green', 1]);
  assert.equal(photos[2].rating, 0);
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
