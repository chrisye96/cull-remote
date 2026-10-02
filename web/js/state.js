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
