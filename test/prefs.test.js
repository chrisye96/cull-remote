import test from 'node:test';
import assert from 'node:assert/strict';
import { readPref, writePref, readChoice, FOLDER_SORTS, PHOTO_SORTS } from '../web/js/prefs.js';

// Install a localStorage stub for one test and restore the previous value afterwards.
function stubStorage(t, stub) {
  const had = Object.hasOwn(globalThis, 'localStorage');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true });
  t.after(() => {
    if (had) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
}

function mapStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
  };
}

test('prefs work when localStorage is undefined', (t) => {
  stubStorage(t, undefined);
  assert.equal(readPref('undef-a', 'fallback'), 'fallback');
  writePref('undef-a', 'v');
  assert.equal(readPref('undef-a', 'fallback'), 'v');
});

test('prefs keep the written value when localStorage throws', (t) => {
  stubStorage(t, {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  });
  assert.equal(readPref('throwing-a', 'fallback'), 'fallback');
  writePref('throwing-a', 'v');
  assert.equal(readPref('throwing-a', 'fallback'), 'v');
});

test('writePref stores JSON under the lrc. prefix', (t) => {
  const storage = mapStorage();
  stubStorage(t, storage);
  writePref('a', { x: 1 });
  assert.equal(storage.map.get('lrc.a'), '{"x":1}');
});

test('readPref parses a value that exists only in storage', (t) => {
  stubStorage(t, mapStorage({ 'lrc.stored-only': '{"y":[1,2]}' }));
  assert.deepEqual(readPref('stored-only', null), { y: [1, 2] });
});

test('readPref returns the fallback for malformed JSON and for a missing key', (t) => {
  stubStorage(t, mapStorage({ 'lrc.bad-json': '{nope' }));
  assert.equal(readPref('bad-json', 'fallback'), 'fallback');
  assert.equal(readPref('never-stored', 'fallback'), 'fallback');
});

test('readChoice returns the stored value only when it is allowed', (t) => {
  stubStorage(t, mapStorage({ 'lrc.choice-ok': '"name"', 'lrc.choice-bad': '"bogus"' }));
  assert.equal(readChoice('choice-ok', PHOTO_SORTS, 'time-asc'), 'name');
  assert.equal(readChoice('choice-bad', PHOTO_SORTS, 'time-asc'), 'time-asc');
  assert.equal(readChoice('choice-missing', FOLDER_SORTS, 'name-desc'), 'name-desc');
});

test('the allowed sort lists are defined once', () => {
  assert.deepEqual(FOLDER_SORTS, ['name-desc', 'name-asc', 'import']);
  assert.deepEqual(PHOTO_SORTS, ['time-asc', 'time-desc', 'name']);
});
