import { $, icon } from './dom.js';
import { getPhotos, previewUrl, sendOp } from './api.js';
import { messageFor } from './messages.js';
import { KEY, isUnmarked, toggledValue, setField, shouldAdvance, shouldRollback, parseValue, mergeFresh, indexAfterFilter, markSummary } from './state.js';

const HD_QUERY = matchMedia('(min-width: 768px) and (min-height: 600px)');
const previewSize = () => (HD_QUERY.matches ? 'hd' : 'std');
const SWIPE_MIN_DX = 50;
const SWIPE_CLICK_GUARD_MS = 400;
const REFRESH_MS = 5000;

let all = [];
let list = [];
let index = 0;
let onlyUnmarked = true;
let sourceName = '';
let notice = ''; // Shown in #empty when there is no photo (loading, open failure).
let openSeq = 0; // Bumped on every open and on Back; stale getPhotos results are dropped.
let failedUrl = null; // URL of the preview that failed to load, if it is still the shown one.
let opQueue = Promise.resolve(); // Ops go to the server strictly one after another.
let source = null; // The open folder or collection; null on the home page.
let refreshing = false;
let settledOps = 0; // Ops that finished; a fetch that overlapped one may carry pre-op data.
const pending = new Map(); // `${photoId}:${field}` -> number of ops still in flight

const pendingKey = (photoId, field) => `${photoId}:${field}`;
const isPending = (photoId, field) => pending.has(pendingKey(photoId, field));

function trackPending(photoId, field, delta) {
  const key = pendingKey(photoId, field);
  const count = (pending.get(key) ?? 0) + delta;
  if (count > 0) pending.set(key, count);
  else pending.delete(key);
}

// Pull Lightroom's current marks for the open source and merge them into the snapshot.
async function refresh() {
  if (!source || refreshing || document.hidden || $('viewer').hidden) return;
  refreshing = true;
  const token = openSeq;
  const settledBefore = settledOps;
  try {
    let fresh;
    try {
      fresh = await getPhotos(source.id);
    } catch {
      return; // Connectivity problems are reported by the status bar; the next tick retries.
    }
    // Skip when an op finished meanwhile: the response may predate it. The next tick refetches.
    if (token !== openSeq || settledOps !== settledBefore) return;
    if (mergeFresh(all, fresh, isPending) > 0) render();
  } finally {
    refreshing = false;
  }
}

// Operation errors only. Preview failures live in #empty, open failures in #empty.
function showError(text) {
  $('error').textContent = text;
  $('error').hidden = !text;
}

function applyFilter(keepPhotoId = null) {
  list = onlyUnmarked ? all.filter(isUnmarked) : all.slice();
  index = indexAfterFilter(list, keepPhotoId);
}

// Both options stay visible with live counts; the active one is highlighted.
function renderFilter() {
  const unmarked = all.filter(isUnmarked).length;
  for (const button of $('filter').querySelectorAll('button')) {
    const isAll = button.dataset.filter === 'all';
    button.textContent = isAll ? `全部 ${all.length}` : `未标记 ${unmarked}`;
    button.setAttribute('aria-pressed', String(isAll !== onlyUnmarked));
  }
}

// Point the image at the current photo only when the URL changed, and keep the old
// bitmap hidden until the new one has loaded so it never shows under new metadata.
function syncImage(url) {
  const img = $('photo');
  if (img.dataset.url === url) return;
  img.dataset.url = url;
  failedUrl = null;
  img.classList.add('loading');
  img.src = url;
}

function badge(className, children) {
  const el = document.createElement('span');
  el.className = `badge ${className}`;
  el.append(...children);
  return el;
}

// The photo's current marks, always visible in the corner.
function renderBadges(photo) {
  const box = $('badges');
  box.textContent = '';
  if (!photo) return;
  if (photo.pick === 1) box.append(badge('pick', [icon('flag')]));
  if (photo.pick === -1) box.append(badge('reject', [icon('ban')]));
  if (photo.rating > 0) box.append(badge('rating', [icon('star'), String(photo.rating)]));
  if (photo.label !== 'none') box.append(badge(`swatch ${photo.label}`, []));
}

// Short confirmation in the middle of the photo right after a mark.
function flash(field, value) {
  const summary = markSummary(field, value);
  const box = $('flash');
  box.textContent = '';
  if (summary.icon) box.append(icon(summary.icon));
  if (summary.swatch) {
    const dot = document.createElement('span');
    dot.className = `dot ${summary.swatch}`;
    box.append(dot);
  }
  const text = document.createElement('span');
  text.textContent = summary.text;
  box.append(text);
  box.classList.remove('show');
  void box.offsetWidth; // restart the animation when marks come in quick succession
  box.classList.add('show');
}

function render() {
  renderFilter();
  const photo = list[index];
  const url = photo ? previewUrl(photo.id, previewSize()) : null;
  if (photo) syncImage(url);
  const previewFailed = Boolean(photo) && failedUrl === url;
  $('photo').hidden = !photo || previewFailed;
  $('actions').hidden = !photo;
  $('empty').hidden = Boolean(photo) && !previewFailed;
  $('title').textContent = photo ? `${photo.name}  ${index + 1}/${list.length}` : sourceName;
  renderBadges(photo);
  if (!photo) {
    $('empty').textContent = notice || (onlyUnmarked ? '这里没有未标记的照片' : '这里没有照片');
    return;
  }
  $('empty').textContent = previewFailed ? '预览加载失败，点照片中间重试' : '';
  for (const button of $('actions').querySelectorAll('button')) {
    const { field } = button.dataset;
    const value = parseValue(field, button.dataset.value);
    const current = photo[KEY[field]];
    button.classList.toggle('on', field === 'rating' ? current >= value : current === value);
    button.setAttribute('aria-pressed', String(current === value));
    button.classList.toggle('pending', isPending(photo.id, field));
  }
  // Warm the next two previews so swiping feels instant.
  for (const next of list.slice(index + 1, index + 3)) new Image().src = previewUrl(next.id, previewSize());
}

// Returns true when it moved (and rendered).
function go(delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return false;
  index = target;
  showError('');
  render();
  return true;
}

function retryPreview() {
  const photo = list[index];
  if (!photo || failedUrl !== previewUrl(photo.id, previewSize())) return;
  failedUrl = null;
  $('photo').classList.add('loading');
  // Cache-busting param so the browser refetches instead of replaying the failure.
  $('photo').src = `${previewUrl(photo.id, previewSize())}&retry=${Date.now()}`;
  render();
}

function enqueue(task) {
  const run = opQueue.then(task);
  opQueue = run.catch(() => {});
  return run;
}

function mark(field, rawValue) {
  const photo = list[index];
  if (!photo) return;
  const value = toggledValue(photo, field, parseValue(field, rawValue));
  const previous = setField(photo, field, value);
  showError('');
  flash(field, value);
  trackPending(photo.id, field, 1);
  // Pick and reject advance right away; the request happens in the background.
  if (!(shouldAdvance(field, value) && go(1))) render();
  enqueue(() => sendOp(photo.id, field, value))
    .catch((e) => {
      // Roll back only if nothing newer has changed this field since.
      if (shouldRollback(photo, field, value)) setField(photo, field, previous);
      showError(`${photo.name}：${messageFor(e.message)}`);
    })
    .finally(() => {
      trackPending(photo.id, field, -1);
      settledOps += 1;
      if (!$('viewer').hidden) render();
    });
}

export function initViewer(onBack) {
  $('back').addEventListener('click', () => {
    openSeq += 1;
    source = null;
    showError('');
    onBack();
  });
  $('filter').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const wantUnmarked = button.dataset.filter === 'unmarked';
    if (wantUnmarked === onlyUnmarked) return;
    const currentId = list[index]?.id ?? null;
    onlyUnmarked = wantUnmarked;
    applyFilter(currentId);
    showError('');
    render();
  });
  $('actions').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button) mark(button.dataset.field, button.dataset.value);
  });
  $('photo').addEventListener('load', () => {
    $('photo').classList.remove('loading');
    failedUrl = null;
    render();
  });
  $('photo').addEventListener('error', () => {
    failedUrl = $('photo').dataset.url;
    render();
  });

  const stage = $('stage');
  let start = null;
  let dragging = false;
  let lastSwipeAt = 0;

  function setOffset(px, animate = false) {
    const img = $('photo');
    img.style.transition = animate ? 'transform .18s ease-out' : 'none';
    img.style.transform = px ? `translateX(${px}px)` : '';
  }

  stage.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
    dragging = false;
  }, { passive: true });

  stage.addEventListener('touchmove', (event) => {
    if (!start) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) dragging = true;
    if (!dragging) return;
    const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === list.length - 1);
    setOffset(atEdge ? dx * 0.3 : dx); // rubber band at the first and last photo
  }, { passive: true });

  stage.addEventListener('touchend', (event) => {
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    start = null;
    if (!dragging) return;
    dragging = false;
    lastSwipeAt = Date.now();
    const delta = dx < 0 ? 1 : -1;
    const target = index + delta;
    const passed = Math.abs(dx) > SWIPE_MIN_DX && Math.abs(dx) > Math.abs(dy);
    if (!passed || target < 0 || target >= list.length) {
      setOffset(0, true);
      return;
    }
    setOffset(-delta * stage.clientWidth, true);
    setTimeout(() => {
      setOffset(0);
      go(delta);
    }, 180);
  });

  stage.addEventListener('touchcancel', () => {
    start = null;
    dragging = false;
    setOffset(0, true);
  });
  // Tap the left or right third to step; tap the middle to retry a failed preview.
  stage.addEventListener('click', (event) => {
    if (Date.now() - lastSwipeAt < SWIPE_CLICK_GUARD_MS) return; // synthetic click after a swipe
    const third = stage.clientWidth / 3;
    if (event.clientX < third) go(-1);
    else if (event.clientX > third * 2) go(1);
    else retryPreview();
  });

  setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  // Rotation or Split View can cross the tier boundary; show the matching preview.
  HD_QUERY.addEventListener('change', render);
}

// Never throws: failures are shown inside the viewer so Back always works and the
// status bar stays owned by connectivity polling.
export async function openViewer(nextSource) {
  openSeq += 1;
  const token = openSeq;
  source = nextSource;
  sourceName = nextSource.name;
  notice = '加载中';
  all = [];
  applyFilter();
  showError('');
  render();
  try {
    const photos = await getPhotos(source.id);
    if (token !== openSeq) return;
    all = photos;
    notice = '';
  } catch (e) {
    if (token !== openSeq) return;
    notice = messageFor(e.message);
  }
  applyFilter();
  render();
}
