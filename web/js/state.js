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
// The rule comes from the settings page: 'flag' (pick and reject only), 'any' (every
// mark that sets a value) or 'never'. Clearing a mark never advances.
export function shouldAdvance(field, value, rule = 'flag') {
  if (rule === 'never' || value === CLEARED[field]) return false;
  return rule === 'any' || field === 'pickStatus';
}

// Preview size for a quality setting: 'auto' follows the screen, the others are fixed.
export const sizeFor = (quality, largeScreen) => (quality === 'auto' ? (largeScreen ? 'hd' : 'std') : quality);

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

// Natural, case-insensitive name order: "a2" before "a10", "raw" equal to "RAW".
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Photo order chosen on the home page. Ties fall back to the other key so the order is stable.
export function sortPhotos(photos, mode) {
  const byName = (a, b) => collator.compare(a.name, b.name);
  const byTime = (a, b) => a.time - b.time;
  if (mode === 'name') return photos.slice().sort((a, b) => byName(a, b) || byTime(a, b));
  const direction = mode === 'time-desc' ? -1 : 1;
  return photos.slice().sort((a, b) => direction * byTime(a, b) || byName(a, b));
}

export const FLAG_SWIPE_MIN_DY = 80;
export const FLAG_SWIPE_RATIO = 1.5;
export const FLAG_SWIPE_EDGE_PX = 24;
export const FLAG_SWIPE_MAX_MS = 1500;

// Decide whether a finished single-finger gesture is a flag swipe.
// Returns 1 (pick, swipe up), -1 (reject, swipe down) or 0 (not a flag gesture).
// Gestures that start near the top or bottom screen edge are ignored, because iOS
// uses those edges for Notification Center and Home; slow drags are ignored too.
export function swipeFlag({ dx, dy, startY, viewportHeight, durationMs }) {
  if (Math.abs(dy) <= FLAG_SWIPE_MIN_DY || Math.abs(dy) <= Math.abs(dx) * FLAG_SWIPE_RATIO) return 0;
  if (startY < FLAG_SWIPE_EDGE_PX || startY > viewportHeight - FLAG_SWIPE_EDGE_PX) return 0;
  if (durationMs > FLAG_SWIPE_MAX_MS) return 0;
  return dy < 0 ? 1 : -1;
}

// A flag gesture never clears a flag: repeating it on a photo that already has that flag moves on.
export const gestureMark = (photo, value) => (photo.pick === value ? 'advance' : 'mark');

// How far a vertical pull has come toward the flag threshold, from 0 to 1.
export const pullProgress = (dy) => Math.min(1, Math.abs(dy) / FLAG_SWIPE_MIN_DY);

// Opacity of the pull hint: full only once the flag is armed, so a bright hint always
// means that releasing will set the flag.
export const pullOpacity = (progress, armed) => (armed ? 1 : Math.min(0.6, 0.35 + 0.65 * progress));

// Which part of the photo a tap landed in. The middle is wide on purpose, so a tap that
// is slightly off-centre does not change photo.
export const EDGE_TAP_RATIO = 0.22;
export function tapZone(x, width) {
  if (x < width * EDGE_TAP_RATIO) return 'prev';
  if (x > width * (1 - EDGE_TAP_RATIO)) return 'next';
  return 'middle';
}

// Where to resume in a folder: the remembered photo if it is still listed, otherwise the
// first listed photo that follows it in the full order, otherwise the start.
export function resumeIndex(all, list, photoId) {
  const listed = new Map(list.map((photo, at) => [photo.id, at]));
  if (listed.has(photoId)) return listed.get(photoId);
  const from = all.findIndex((photo) => photo.id === photoId);
  if (from === -1) return 0;
  for (let i = from + 1; i < all.length; i += 1) {
    if (listed.has(all[i].id)) return listed.get(all[i].id);
  }
  return 0;
}

// Remember `value` under `key`, most recent last, keeping at most `cap` entries.
export function rememberCapped(map, key, value, cap) {
  delete map[key];
  map[key] = value;
  const keys = Object.keys(map);
  for (const old of keys.slice(0, Math.max(0, keys.length - cap))) delete map[old];
}
