import test from 'node:test';
import assert from 'node:assert/strict';
import { readPref, writePref } from '../web/js/prefs.js';

test('prefs work without localStorage (Node default)', () => {
  assert.equal(typeof globalThis.localStorage, 'undefined');
  assert.equal(readPref('plain', 'fallback'), 'fallback');
  writePref('plain', 'v');
  assert.equal(readPref('plain', 'fallback'), 'v');
});

test('prefs keep the written value when localStorage throws', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  try {
    assert.equal(readPref('throwing', 'fallback'), 'fallback');
    writePref('throwing', 'v');
    assert.equal(readPref('throwing', 'fallback'), 'v');
  } finally {
    delete globalThis.localStorage;
  }
});
