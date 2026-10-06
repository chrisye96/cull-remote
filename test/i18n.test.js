import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { STRINGS } from '../web/js/strings.js';
import { LANGUAGES, matchLanguage, setLang, t } from '../web/js/i18n.js';

const placeholders = (text) => [...text.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();
const english = Object.keys(STRINGS.en);

test('every language offered in settings has a table', () => {
  assert.deepEqual(Object.keys(LANGUAGES).sort(), Object.keys(STRINGS).sort());
});

// A missing key would silently show English; a renamed placeholder would show `{name}` on screen.
test('every table has the English keys and keeps their placeholders', () => {
  for (const [lang, table] of Object.entries(STRINGS)) {
    const missing = english.filter((key) => !(key in table) && !(key.endsWith('#one') && key.replace('#one', '#other') in table));
    assert.deepEqual(missing, [], `${lang} lacks keys`);
    assert.deepEqual(Object.keys(table).filter((key) => !english.includes(key)), [], `${lang} has keys English does not`);
    for (const [key, text] of Object.entries(table)) assert.deepEqual(placeholders(text), placeholders(STRINGS.en[key]), `${lang} ${key}`);
  }
});

// Keys are plain strings in the markup and the scripts, so a typo fails only on screen.
test('every key the page uses exists, and every key is used', async () => {
  const html = await readFile('web/index.html', 'utf8');
  const scripts = await Promise.all((await readdir('web/js')).filter((name) => name !== 'strings.js').map((name) => readFile(`web/js/${name}`, 'utf8')));
  const code = scripts.join('\n');
  const used = new Set([...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((match) => match[1]));
  for (const match of code.matchAll(/'([a-z]+\.[A-Za-z_]+)'/g)) used.add(match[1]);
  // Keys built at run time, such as `error.${code}`: the prefix counts as using all of them.
  const prefixes = [...code.matchAll(/`([a-z]+\.)\$\{/g)].map((match) => match[1]);
  const names = new Set(english.map((key) => key.split('#')[0]));
  assert.deepEqual([...used].filter((key) => !names.has(key)), [], 'used but not defined');
  assert.deepEqual([...names].filter((key) => !used.has(key) && !prefixes.some((prefix) => key.startsWith(prefix))), [], 'defined but not used');
});

test('t fills placeholders, picks the plural form and falls back to the key', () => {
  setLang('en');
  assert.equal(t('count.photos', { n: 1 }), '1 photo');
  assert.equal(t('count.photos', { n: 0 }), '0 photos');
  assert.equal(t('source.collapse', { name: 'Trips' }), 'Collapse Trips');
  assert.equal(t('no.such'), 'no.such');
  setLang('ja');
  assert.equal(t('count.photos', { n: 1 }), '1 枚');
  setLang('de');
  assert.equal(t('mark.stars', { n: 1 }), '1 Stern');
  assert.equal(t('mark.stars', { n: 3 }), '3 Sterne');
});

test('the device language picks the closest table, and English when there is none', () => {
  assert.equal(matchLanguage(['ja-JP', 'en-US']), 'ja');
  assert.equal(matchLanguage(['zh-TW']), 'zh-CN');
  assert.equal(matchLanguage(['fr-FR', 'de-AT']), 'de');
  assert.equal(matchLanguage(['fr-FR']), 'en');
  assert.equal(matchLanguage([]), 'en');
});
