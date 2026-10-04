import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pkg from '../package.json' with { type: 'json' };

// Lightroom shows the plugin's own version in the Plug-in Manager; it has to be bumped by
// hand together with package.json.
test('the plugin reports the same version as package.json', async () => {
  const info = await readFile('plugin/cull-remote.lrplugin/Info.lua', 'utf8');
  const found = info.match(/VERSION = \{ major = (\d+), minor = (\d+), revision = (\d+) \}/);
  assert.ok(found, 'VERSION line not found in Info.lua');
  assert.equal(found.slice(1).join('.'), pkg.version);
});
