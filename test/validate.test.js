import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOp } from '../server/validate.js';

const base = { opId: 'op-1', photoId: 'A1B2C3D4-0000-4000-8000-000000000000', ts: 1 };

test('accepts every legal field and value', () => {
  for (const [field, values] of [
    ['rating', [0, 1, 5]],
    ['label', ['none', 'red', 'yellow', 'green', 'blue', 'purple']],
    ['pickStatus', [-1, 0, 1]],
  ]) {
    for (const value of values) assert.equal(validateOp({ ...base, field, value }), null, `${field}=${value}`);
  }
});

test('rejects unknown fields, out-of-range values and malformed ids', () => {
  const bad = [
    { ...base, field: 'caption', value: 'x' },
    { ...base, field: 'rating', value: 6 },
    { ...base, field: 'rating', value: 2.5 },
    { ...base, field: 'rating', value: '3' },
    { ...base, field: 'label', value: 'orange' },
    { ...base, field: 'pickStatus', value: 2 },
    { ...base, photoId: '../x', field: 'rating', value: 1 },
    { ...base, opId: '', field: 'rating', value: 1 },
    null,
  ];
  for (const op of bad) assert.equal(validateOp(op), 'invalid_op', JSON.stringify(op));
});
