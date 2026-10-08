import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { START, END, usedIcons, spriteBlock } from '../tools/icons.mjs';

// A wrong path here fails silently: the browser just shows no icon.
test('every icon the page and the manifest name exists', async () => {
  const html = await readFile('web/index.html', 'utf8');
  const manifest = JSON.parse(await readFile('web/manifest.webmanifest', 'utf8'));
  const linked = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(linked.length, 4);
  for (const file of [...linked, ...manifest.icons.map((icon) => icon.src)]) await access(`web${file}`);
});

// An icon drawn from a separate file made the browser download the whole library again each
// time a script drew one, so the icons in use live in the page. A missing one shows nothing.
test('the page carries exactly the Lucide icons the app uses', async () => {
  const html = (await readFile('web/index.html', 'utf8')).replaceAll('\r\n', '\n');
  const from = html.indexOf(`  ${START}`);
  assert.notEqual(from, -1, 'web/index.html has no icon sprite; run node tools/icons.mjs');
  const inPage = html.slice(from, html.indexOf(END) + END.length);
  assert.equal(inPage, await spriteBlock(await usedIcons()), 'run node tools/icons.mjs');
});

test('nothing refers to the icon library as a separate file', async () => {
  const files = ['web/index.html', 'web/sw.js', ...(await readdir('web/js')).map((name) => `web/js/${name}`)];
  for (const file of files) assert.equal((await readFile(file, 'utf8')).includes('/vendor/'), false, file);
});
