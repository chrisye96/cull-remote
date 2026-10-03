import { $ } from './dom.js';
import { getPhotos, previewUrl, sendOp } from './api.js';
import { messageFor } from './messages.js';
import { KEY, isUnmarked, toggledValue, setField, shouldAdvance, shouldRollback, parseValue, mergeFresh, indexAfterFilter } from './state.js';

const size = matchMedia('(min-width: 768px)').matches ? 'hd' : 'std';
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
  try {
    const fresh = await getPhotos(source.id);
    if (token === openSeq && mergeFresh(all, fresh, isPending) > 0) render();
  } catch {
    // Connectivity problems are reported by the status bar; the next tick retries.
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

function render() {
  renderFilter();
  const photo = list[index];
  const url = photo ? previewUrl(photo.id, size) : null;
  if (photo) syncImage(url);
  const previewFailed = Boolean(photo) && failedUrl === url;
  $('photo').hidden = !photo || previewFailed;
  $('actions').hidden = !photo;
  $('empty').hidden = Boolean(photo) && !previewFailed;
  $('title').textContent = photo ? `${photo.name}  ${index + 1}/${list.length}` : sourceName;
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
  }
  // Warm the next two previews so swiping feels instant.
  for (const next of list.slice(index + 1, index + 3)) new Image().src = previewUrl(next.id, size);
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
  if (!photo || failedUrl !== previewUrl(photo.id, size)) return;
  failedUrl = null;
  $('photo').classList.add('loading');
  // Cache-busting param so the browser refetches instead of replaying the failure.
  $('photo').src = `${previewUrl(photo.id, size)}&retry=${Date.now()}`;
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
      render();
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
  let lastSwipeAt = 0;
  stage.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  stage.addEventListener('touchend', (event) => {
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    start = null;
    if (Math.abs(dx) > SWIPE_MIN_DX && Math.abs(dx) > Math.abs(dy)) {
      lastSwipeAt = Date.now();
      go(dx < 0 ? 1 : -1);
    }
  });
  stage.addEventListener('touchcancel', () => { start = null; });
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
