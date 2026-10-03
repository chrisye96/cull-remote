import { $, icon } from './dom.js';
import { getPhotos, previewUrl, sendOp } from './api.js';
import { messageFor } from './messages.js';
import { KEY, isUnmarked, toggledValue, setField, shouldAdvance, shouldRollback, parseValue, mergeFresh, indexAfterFilter, markSummary, badgeParts, nextRefreshDelay, sortPhotos, swipeFlag, gestureMark, pullProgress, tapZone, resumeIndex, rememberCapped, FLAG_SWIPE_EDGE_PX } from './state.js';
import { readChoice, readPref, writePref, PHOTO_SORTS } from './prefs.js';

const HD_QUERY = matchMedia('(min-width: 768px) and (min-height: 600px)');
const previewSize = () => (HD_QUERY.matches ? 'hd' : 'std');
const SWIPE_MIN_DX = 50;
const SWIPE_CLICK_GUARD_MS = 400;
const REFRESH_MS = 5000;
const PULL_FOLLOW = 0.35; // The photo moves this fraction of the finger's vertical travel.
const PULL_MAX_PX = 70;
const LAST_PHOTO_CAP = 100; // Folders whose last viewed photo is remembered on this device.

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
let loading = false; // True while the initial getPhotos of an open is in flight.
let nextRefreshAt = 0; // Earliest time the next timer-driven refresh may run.
let settledOps = 0; // Ops that finished; a fetch that overlapped one may carry pre-op data.
const pending = new Map(); // `${photoId}:${field}` -> number of ops still in flight
// sourceId -> id of the photo last shown there, so reopening a folder resumes in place.
const storedLastPhoto = readPref('lastPhoto', {});
const lastPhoto = storedLastPhoto && typeof storedLastPhoto === 'object' && !Array.isArray(storedLastPhoto) ? storedLastPhoto : {};

const pendingKey = (photoId, field) => `${photoId}:${field}`;
const isPending = (photoId, field) => pending.has(pendingKey(photoId, field));

function trackPending(photoId, field, delta) {
  const key = pendingKey(photoId, field);
  const count = (pending.get(key) ?? 0) + delta;
  if (count > 0) pending.set(key, count);
  else pending.delete(key);
}

// Pull Lightroom's current marks for the open source and merge them into the snapshot.
// The timer is throttled by nextRefreshAt so a slow Lightroom is not kept busy; force skips that.
async function refresh({ force = false } = {}) {
  if (!source || loading || refreshing || document.hidden || $('viewer').hidden) return;
  if (!force && Date.now() < nextRefreshAt) return;
  refreshing = true;
  const token = openSeq;
  const settledBefore = settledOps;
  let duration = 0; // Stays 0 when the fetch fails.
  try {
    let fresh;
    try {
      const startedAt = Date.now();
      fresh = await getPhotos(source.id);
      duration = Date.now() - startedAt;
    } catch {
      return; // Connectivity problems are reported by the status bar; the next tick retries.
    }
    // Skip when an op finished meanwhile: the response may predate it. The next tick refetches.
    if (token !== openSeq || settledOps !== settledBefore) return;
    if (mergeFresh(all, fresh, isPending) > 0) render();
  } finally {
    refreshing = false;
    nextRefreshAt = Date.now() + nextRefreshDelay(duration, REFRESH_MS);
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
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(isAll ? all.length : unmarked);
    button.replaceChildren(isAll ? '全部' : '未标记', count);
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

function badgePart(part) {
  const el = document.createElement('span');
  el.className = `part ${part.kind}`;
  if (part.kind === 'pick') el.append(icon('flag'));
  if (part.kind === 'reject') el.append(icon('ban'));
  if (part.kind === 'rating') el.append(icon('star'), String(part.value));
  if (part.kind === 'label') el.classList.add('dot', part.value);
  return el;
}

// All of the photo's marks in one pill in the corner; hidden when it has none.
function renderBadges(photo) {
  const box = $('badges');
  const parts = photo ? badgeParts(photo) : [];
  box.replaceChildren();
  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      box.append(sep);
    }
    box.append(badgePart(part));
  });
  box.hidden = parts.length === 0;
}

// Short message in the middle of the photo: an icon or a colour dot, then text.
function showFlash(summary) {
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
  void box.offsetWidth; // restart the animation when messages come in quick succession
  box.classList.add('show');
}

const flash = (field, value) => showFlash(markSummary(field, value));

// Pin the corner overlays to the photo's displayed box. offset* ignores the swipe transform.
function placeOverlays() {
  const img = $('photo');
  const stage = $('stage');
  const visible = !img.hidden && img.offsetWidth > 0;
  const padLeft = parseFloat(getComputedStyle(stage).paddingLeft) || 0; // Landscape safe-area inset.
  stage.style.setProperty('--img-left', `${visible ? img.offsetLeft : padLeft}px`);
  stage.style.setProperty('--img-top', `${visible ? img.offsetTop : 0}px`);
  stage.style.setProperty('--img-width', `${visible ? img.offsetWidth : stage.clientWidth - padLeft}px`);
  stage.style.setProperty('--img-bottom', `${visible ? stage.clientHeight - img.offsetTop - img.offsetHeight : 0}px`);
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
  $('photo-name').textContent = photo ? photo.name : sourceName;
  const position = photo ? `${index + 1}/${list.length}` : '';
  $('photo-pos').textContent = position;
  $('caption').textContent = photo ? `${photo.name} · ${position}` : '';
  $('caption').hidden = !photo;
  renderBadges(photo);
  if (photo && source && lastPhoto[source.id] !== photo.id) {
    rememberCapped(lastPhoto, source.id, photo.id, LAST_PHOTO_CAP);
    writePref('lastPhoto', lastPhoto);
  }
  if (!photo) {
    $('empty').textContent = notice || (onlyUnmarked ? '这里没有未标记的照片' : '这里没有照片');
    placeOverlays();
    return;
  }
  $('empty').textContent = previewFailed ? '预览加载失败，点照片中间重试' : '';
  for (const button of $('actions').querySelectorAll('button')) {
    const { field } = button.dataset;
    const value = parseValue(field, button.dataset.value);
    const current = photo[KEY[field]];
    const on = field === 'rating' ? current >= value : current === value;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('pending', isPending(photo.id, field));
  }
  // Warm the next two previews so swiping feels instant.
  for (const next of list.slice(index + 1, index + 3)) new Image().src = previewUrl(next.id, previewSize());
  placeOverlays();
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
  if (!photo || failedUrl !== previewUrl(photo.id, previewSize())) return false;
  failedUrl = null;
  $('photo').classList.add('loading');
  // Cache-busting param so the browser refetches instead of replaying the failure.
  $('photo').src = `${previewUrl(photo.id, previewSize())}&retry=${Date.now()}`;
  render();
  return true;
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

// Swipe up picks, swipe down rejects. Unlike the buttons a gesture never clears a flag:
// repeating it on a photo that already has that flag just moves on.
function flagByGesture(value) {
  const photo = list[index];
  if (!photo) return;
  if (gestureMark(photo, value) === 'advance') go(1);
  else mark('pickStatus', String(value));
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
  new ResizeObserver(placeOverlays).observe($('stage'));
  $('photo').addEventListener('error', () => {
    failedUrl = $('photo').dataset.url;
    render();
  });

  const stage = $('stage');
  let start = null;
  let dragging = false;
  let lastSwipeAt = 0;
  let slideTimer = null;
  let pendingSlide = null; // { delta, seq, from } of the slide-out that has not completed yet.

  function setOffset(px, animate = false, py = 0) {
    const img = $('photo');
    img.style.transition = animate ? 'transform .18s ease-out' : 'none';
    img.style.transform = px || py ? `translate(${px}px, ${py}px)` : '';
  }

  // Finish a step that is still sliding out so a quick second flick does not lose it.
  function completeSlide() {
    clearTimeout(slideTimer);
    slideTimer = null;
    setOffset(0);
    const slide = pendingSlide;
    pendingSlide = null;
    if (slide && slide.seq === openSeq && slide.from === index) go(slide.delta);
  }

  // Live hint while the finger pulls up (pick) or down (reject).
  function showPull(value, progress, armed) {
    const box = $('pull');
    if (box.dataset.value !== String(value)) {
      const summary = markSummary('pickStatus', value);
      box.dataset.value = String(value);
      box.replaceChildren(icon(summary.icon), summary.text);
    }
    box.className = `${value === 1 ? 'pick' : 'reject'}${armed ? ' armed' : ''}`;
    box.style.opacity = String(0.35 + 0.65 * progress);
  }

  function hidePull() {
    $('pull').style.opacity = '0';
  }

  function updatePull(dx, dy) {
    const eligible = Boolean(list[index])
      && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)
      && start.y >= FLAG_SWIPE_EDGE_PX && start.y <= window.innerHeight - FLAG_SWIPE_EDGE_PX;
    if (!eligible) {
      hidePull();
      setOffset(0);
      return;
    }
    const value = dy < 0 ? 1 : -1;
    const armed = swipeFlag({ dx, dy, startY: start.y, viewportHeight: window.innerHeight, durationMs: Date.now() - start.at }) === value;
    showPull(value, pullProgress(dy), armed);
    setOffset(0, false, Math.max(-PULL_MAX_PX, Math.min(PULL_MAX_PX, dy * PULL_FOLLOW)));
  }

  // Edge taps show a chevron where they landed; a tap with no photo that way nudges the photo.
  function step(delta) {
    const hint = $(delta < 0 ? 'tap-prev' : 'tap-next');
    hint.classList.remove('show');
    void hint.offsetWidth;
    hint.classList.add('show');
    if (go(delta)) return;
    const img = $('photo');
    const bump = delta < 0 ? 'bump-prev' : 'bump-next';
    img.classList.remove('bump-prev', 'bump-next');
    void img.offsetWidth;
    img.classList.add(bump);
  }

  function toggleOverlays() {
    const off = stage.classList.toggle('overlays-off');
    showFlash(off ? { icon: 'eye-off', text: '已隐藏标记' } : { icon: 'eye', text: '已显示标记' });
  }

  stage.addEventListener('touchstart', (event) => {
    completeSlide();
    if (event.touches.length > 1) {
      // A second finger makes this a multi-touch gesture, never a swipe or a flag.
      start = null;
      dragging = false;
      hidePull();
      setOffset(0);
      return;
    }
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    dragging = false;
  }, { passive: true });

  stage.addEventListener('touchmove', (event) => {
    if (!start) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) dragging = true;
    if (!dragging) {
      updatePull(dx, dy);
      return;
    }
    hidePull();
    const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === list.length - 1);
    setOffset(atEdge ? dx * 0.3 : dx); // rubber band at the first and last photo
  }, { passive: true });

  stage.addEventListener('touchend', (event) => {
    if (event.touches.length > 0) {
      start = null; // Another finger is still down; this is not a single-finger gesture.
      dragging = false;
      hidePull();
      setOffset(0, true);
      return;
    }
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const flag = swipeFlag({ dx, dy, startY: start.y, viewportHeight: window.innerHeight, durationMs: Date.now() - start.at });
    start = null;
    hidePull();
    if (!dragging) {
      // A clearly vertical swipe sets a flag; anything else is left to the click handler.
      if (flag !== 0) {
        lastSwipeAt = Date.now();
        setOffset(0);
        flagByGesture(flag);
      } else {
        setOffset(0, true); // let the photo settle back after a pull that was not far enough
      }
      return;
    }
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
    pendingSlide = { delta, seq: openSeq, from: index };
    slideTimer = setTimeout(completeSlide, 180);
  });

  stage.addEventListener('touchcancel', () => {
    start = null;
    dragging = false;
    hidePull();
    setOffset(0, true);
  });
  // Tap the left or right edge to step. Tap the wide middle to retry a failed preview,
  // or otherwise to hide or show the mark pill and the filename tag.
  stage.addEventListener('click', (event) => {
    if (Date.now() - lastSwipeAt < SWIPE_CLICK_GUARD_MS) return; // synthetic click after a swipe
    const zone = tapZone(event.clientX - stage.getBoundingClientRect().left, stage.clientWidth);
    if (zone === 'prev') step(-1);
    else if (zone === 'next') step(1);
    else if (!retryPreview() && list[index]) toggleOverlays();
  });

  setInterval(refresh, 1000); // Cheap tick; nextRefreshAt decides whether a fetch actually happens.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh({ force: true });
  });
  // Rotation or Split View can cross the tier boundary; show the matching preview.
  HD_QUERY.addEventListener('change', () => { if (!$('viewer').hidden) render(); });
}

// Never throws: failures are shown inside the viewer so Back always works and the
// status bar stays owned by connectivity polling.
export async function openViewer(nextSource) {
  openSeq += 1;
  const token = openSeq;
  source = nextSource;
  nextRefreshAt = Date.now() + REFRESH_MS;
  failedUrl = null;
  $('stage').classList.remove('overlays-off');
  delete $('photo').dataset.url;
  sourceName = nextSource.name;
  notice = '加载中';
  loading = true;
  all = [];
  applyFilter();
  showError('');
  render();
  const startedAt = Date.now();
  try {
    const photos = await getPhotos(source.id);
    if (token !== openSeq) return;
    all = sortPhotos(photos, readChoice('photoSort', PHOTO_SORTS, 'time-asc'));
    notice = '';
  } catch (e) {
    if (token !== openSeq) return;
    notice = messageFor(e.message);
  }
  loading = false;
  nextRefreshAt = Date.now() + nextRefreshDelay(Date.now() - startedAt, REFRESH_MS);
  applyFilter();
  index = resumeIndex(all, list, lastPhoto[nextSource.id]);
  render();
}
