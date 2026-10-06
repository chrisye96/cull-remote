import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const TEXT = /\.(md|js|mjs|css|html|json|lua|svg|webmanifest|txt)$|^(LICENSE|\.gitignore|\.gitattributes)$/;

// One stray NUL made GitHub show the README as raw text instead of rendering it; nothing
// else complained. Tab, line feed and carriage return are the only control bytes text needs.
test('no tracked text file contains a control character', async () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((name) => TEXT.test(name));
  assert.ok(files.includes('README.md'));
  const bad = [];
  for (const name of files) {
    const at = (await readFile(name)).findIndex((byte) => byte < 32 && byte !== 9 && byte !== 10 && byte !== 13);
    if (at !== -1) bad.push(`${name} at byte ${at}`);
  }
  assert.deepEqual(bad, []);
});
