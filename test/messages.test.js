import test from 'node:test';
import assert from 'node:assert/strict';
import { messageFor, statusLine } from '../web/js/messages.js';
import { setLang } from '../web/js/i18n.js';

// These tests pin the original Simplified Chinese wording.
setLang('zh-CN');

test('statusLine is empty while everything is reachable, even with marks in flight', () => {
  assert.equal(statusLine('', 0), '');
  assert.equal(statusLine('', 3), '');
});

test('statusLine explains the problem when nothing is waiting', () => {
  assert.equal(statusLine('network', 0), messageFor('network'));
  assert.equal(statusLine('lr_offline', 0), messageFor('lr_offline'));
});

test('statusLine counts the waiting marks', () => {
  assert.equal(statusLine('network', 3), '离线，待同步 3 条');
  assert.equal(statusLine('lr_offline', 12), 'Lightroom 未运行，待同步 12 条');
  assert.equal(statusLine('http_500', 1), `${messageFor('http_500')}，待同步 1 条`);
});
