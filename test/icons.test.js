import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

// A wrong path here fails silently: the browser just shows no icon.
test('every icon the page and the manifest name exists', async () => {
  const html = await readFile('web/index.html', 'utf8');
  const manifest = JSON.parse(await readFile('web/manifest.webmanifest', 'utf8'));
  const linked = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(linked.length, 4);
  for (const file of [...linked, ...manifest.icons.map((icon) => icon.src)]) await access(`web${file}`);
});
