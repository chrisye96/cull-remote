import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// A module missing from the list would only fail later, on a device with no connection.
test('the service worker precaches every shell file', async () => {
  const source = await readFile('web/sw.js', 'utf8');
  const listed = [...source.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const scripts = (await readdir('web/js')).filter((name) => name.endsWith('.js')).map((name) => `/js/${name}`);
  assert.deepEqual(listed.sort(), ['/', '/style.css', '/vendor/lucide.svg', ...scripts].sort());
});
