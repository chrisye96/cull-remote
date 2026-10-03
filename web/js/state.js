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
