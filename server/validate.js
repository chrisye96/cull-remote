export const PHOTO_ID = /^[0-9A-Fa-f-]{32,36}$/;

const ALLOWED = {
  rating: (v) => Number.isInteger(v) && v >= 0 && v <= 5,
  label: (v) => ['none', 'red', 'yellow', 'green', 'blue', 'purple'].includes(v),
  pickStatus: (v) => v === -1 || v === 0 || v === 1,
};

// Trust boundary: everything a device sends is checked before it can reach Lightroom.
export function validateOp(op) {
  const ok =
    op !== null &&
    typeof op === 'object' &&
    typeof op.opId === 'string' &&
    op.opId.length > 0 &&
    op.opId.length <= 64 &&
    typeof op.photoId === 'string' &&
    PHOTO_ID.test(op.photoId) &&
    Object.hasOwn(ALLOWED, op.field) &&
    ALLOWED[op.field](op.value);
  return ok ? null : 'invalid_op';
}
