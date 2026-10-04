import test from 'node:test';
import assert from 'node:assert/strict';
import { qrSvg } from '../server/qr.js';

test('qrSvg draws a square code with a quiet zone on a white background', () => {
  const svg = qrSvg('https://example.tail1234.ts.net/');
  const size = Number(svg.match(/viewBox="0 0 (\d+) \1"/)?.[1]);
  // 21 modules at least (version 1) plus 4 quiet modules on every side.
  assert.ok(size >= 29, `viewBox size ${size}`);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /fill="#fff"/);
  // The top-left finder pattern starts right after the quiet zone.
  assert.match(svg, /M4 4h1v1h-1z/);
});

test('qrSvg gives different codes for different text', () => {
  assert.notEqual(qrSvg('https://a.ts.net/'), qrSvg('https://b.ts.net/'));
});
