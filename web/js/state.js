// Wire field name -> property on the photo object returned by /api/photos.
export const KEY = { rating: 'rating', label: 'label', pickStatus: 'pick' };
const CLEARED = { rating: 0, label: 'none', pickStatus: 0 };

export const isUnmarked = (photo) => photo.pick === 0 && photo.rating === 0 && photo.label === 'none';

// Tapping the value that is already active clears it, as Lightroom does.
export function toggledValue(photo, field, value) {
  return photo[KEY[field]] === value ? CLEARED[field] : value;
}

export function setField(photo, field, value) {
  const previous = photo[KEY[field]];
  photo[KEY[field]] = value;
  return previous;
}

// Which marks jump to the next photo. Flags are a verdict; stars and labels are
// often combined on one photo, so they stay put.
export function shouldAdvance(field, value) {
  return field === 'pickStatus' && value !== 0;
}

// A failed op may undo its optimistic change only if nothing newer has touched the field.
// Otherwise the rollback would clobber a later value the user set.
export function shouldRollback(photo, field, appliedValue) {
  return photo[KEY[field]] === appliedValue;
}

// Button dataset values are strings; labels stay strings, the other fields are numbers.
export const parseValue = (field, raw) => (field === 'label' ? raw : Number(raw));

// Copy Lightroom's current marks onto the snapshot without changing which photos it
// holds or their order. Fields with an op still in flight keep the local value, so a
// refresh never flashes back a mark the user just made. Returns how many photos changed.
export function mergeFresh(photos, fresh, isPending) {
  const latestById = new Map(fresh.map((photo) => [photo.id, photo]));
  let changed = 0;
  for (const photo of photos) {
    const latest = latestById.get(photo.id);
    if (!latest) continue;
    let touched = false;
    for (const [field, key] of Object.entries(KEY)) {
      if (isPending(photo.id, field) || photo[key] === latest[key]) continue;
      photo[key] = latest[key];
      touched = true;
    }
    if (touched) changed += 1;
  }
  return changed;
}

// After switching the filter, stay on the same photo when it is still in the list.
export function indexAfterFilter(list, photoId) {
  const at = photoId === null ? -1 : list.findIndex((photo) => photo.id === photoId);
  return at === -1 ? 0 : at;
}

const LABEL_NAMES = { red: '红色', yellow: '黄色', green: '绿色', blue: '蓝色', purple: '紫色' };

// What the confirmation flash shows right after a mark is applied.
export function markSummary(field, value) {
  if (field === 'pickStatus') {
    if (value === 1) return { icon: 'flag', text: '留用' };
    if (value === -1) return { icon: 'ban', text: '弃用' };
    return { icon: 'flag-off', text: '取消旗标' };
  }
  if (field === 'rating') {
    return value > 0 ? { icon: 'star', text: `${value} 星` } : { icon: 'star-off', text: '清除星级' };
  }
  return value === 'none' ? { icon: 'circle-off', text: '清除色标' } : { swatch: value, text: LABEL_NAMES[value] };
}

// The parts of the mark pill shown on the photo, in display order.
export function badgeParts(photo) {
  const parts = [];
  if (photo.pick === 1) parts.push({ kind: 'pick' });
  if (photo.pick === -1) parts.push({ kind: 'reject' });
  if (photo.rating > 0) parts.push({ kind: 'rating', value: photo.rating });
  if (photo.label !== 'none') parts.push({ kind: 'label', value: photo.label });
  return parts;
}

// Wait at least five times as long as the last refresh took, and never less than the base interval.
export const nextRefreshDelay = (lastDurationMs, baseMs = 5000) => Math.max(baseMs, Math.round(lastDurationMs * 5));
