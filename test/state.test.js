import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnmarked, toggledValue, setField, shouldAdvance } from '../web/js/state.js';

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
