import { $, icon, playAnimation } from './dom.js';
import { getPhotos, previewUrl } from './api.js';
import { loadPhotos, savePhotos } from './data.js';
import { pushOp, hasPending, photoPending, pendingOps, getLink } from './sync.js';
import { applyQueued } from './queue.js';
import { messageFor } from './messages.js';
import { t } from './i18n.js';
import { KEY, isUnmarked, toggledValue, setField, shouldAdvance, parseValue, mergeFresh, indexAfterFilter, markSummary, badgeParts, nextRefreshDelay, sortPhotos, swipeFlag, gestureMark, pullProgress, pullOpacity, tapZone, resumeIndex, rememberCapped, exposureText, lensText, histogram, smoothBins, MARK_FILTERS, matchesFilter, filterLabel, tallyMarks, FLAG_SWIPE_EDGE_PX } from './state.js';
import { readChoice, readObject, readPref, writePref, PHOTO_SORTS, ADVANCE_RULES, FILTERS } from './prefs.js';
import { HD_QUERY, previewSize } from './quality.js';
import { maybeAutoCache } from './autocache.js';
import { initGrid, renderGrid, revealInGrid, markSign } from './grid.js';

const SWIPE_MIN_DX = 50;
const SWIPE_CLICK_GUARD_MS = 400;
const REFRESH_MS = 5000;
const PULL_FOLLOW = 0.35; // The photo moves this fraction of the finger's vertical travel.
const PULL_MAX_PX = 200; // Far enough that a pull across a phone screen never reaches it.
const LAST_PHOTO_CAP = 100; // Folders whose last viewed photo is remembered on this device.

let all = [];
let list = [];
let index = 0;
let filter = 'unmarked'; // 'unmarked', 'all' or one of MARK_FILTERS.
let sourceName = '';
let notice = ''; // Shown in #empty when there is no photo (loading, open failure).
let openSeq = 0; // Bumped on every open and on Back; stale getPhotos results are dropped.
let failedUrl = null; // URL of the preview that failed to load, if it is still the shown one.
let source = null; // The open folder or collection; null on the home page.
let gridOpen = false; // The thumbnail grid is asked for in place of the single photo.
let refreshing = false;
let loading = false; // True while the initial getPhotos of an open is in flight.
let nextRefreshAt = 0; // Earliest time the next timer-driven refresh may run.
let settledOps = 0; // Bumped when marks are confirmed; a fetch that overlapped one may carry older data.
let savedAtSettled = -1; // Value of settledOps when this folder's offline copy was last written.
// sourceId -> id of the photo last shown there, so reopening a folder resumes in place.
const lastPhoto = readObject('lastPhoto');
// Where the photo last on screen sat in the stage. Tap zones are measured against it, and it
// is kept while the next photo loads so that quick taps keep meaning the same thing.
let photoBox = { left: 0, width: 0 };

// Pull Lightroom's current marks for the open source and merge them into the snapshot.
// The timer is throttled by nextRefreshAt so a slow Lightroom is not kept busy; force skips that.
async function refresh({ force = false } = {}) {
  if (!source || loading || refreshing || document.hidden || $('viewer').hidden) return;
  if (getLink() === 'network') return; // The status poll notices when the computer is back.
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
    // Skip when a mark was confirmed meanwhile: the response may predate it. The next tick refetches.
    if (token !== openSeq || settledOps !== settledBefore) return;
    const changed = mergeFresh(all, fresh, hasPending);
    // Keep the offline copy current: after a change, and once after marks were confirmed.
    if (changed > 0 || savedAtSettled !== settledOps) {
      savePhotos(source.id, fresh);
      savedAtSettled = settledOps;
    }
    if (changed > 0) render();
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
  list = all.filter((photo) => matchesFilter(photo, filter));
  index = indexAfterFilter(list, keepPhotoId);
}

// Both options stay visible with live counts; the active one is highlighted.
// The buttons are static markup: only the count text and aria-pressed change.
function renderFilter() {
  const unmarked = all.filter(isUnmarked).length;
  for (const button of $('filter').querySelectorAll('button')) {
    const isAll = button.dataset.filter === 'all';
    const countEl = button.querySelector('.count');
    const count = String(isAll ? all.length : unmarked);
    if (countEl.textContent !== count) countEl.textContent = count;
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  }
  // The menu of mark filters doubles as a tally of the folder's marks. A filter that would
  // show nothing cannot be chosen.
  const counts = tallyMarks(all);
  const select = $('mark-select');
  for (const option of select.options) {
    if (!option.value) continue;
    const text = `${filterLabel(option.value)}  ${counts[option.value]}`;
    if (option.textContent !== text) option.textContent = text;
    option.disabled = counts[option.value] === 0;
  }
  const marked = MARK_FILTERS.includes(filter);
  select.value = marked ? filter : '';
  const box = $('mark-filter');
  box.hidden = all.length === 0;
  if (box.dataset.shows !== filter) {
    box.dataset.shows = filter;
    $('mark-sign').replaceChildren(marked ? filterSign(filter) : icon('funnel'));
  }
}

// The icon in the tool row says which mark filter is on: its flag, its stars or its colour.
function filterSign(name) {
  if (name === 'pick' || name === 'reject') return markSign({ kind: name });
  if (name.startsWith('star')) {
    const stars = Number(name.slice(4));
    return markSign({ kind: 'rating', value: stars < 5 ? `${stars}+` : '5' });
  }
  const dot = document.createElement('span');
  dot.className = `dot ${name}`;
  return dot;
}

function setFilter(next) {
  if (next === filter) return;
  const currentId = list[index]?.id ?? null;
  filter = next;
  applyFilter(currentId);
  showError('');
  render();
  if (gridOpen) revealInGrid();
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

// All of the photo's marks in one pill. The parts are static; only classes and text
// change, so a mark that is already showing never redraws when another one is added.
let badgesPhotoId = null;

function renderBadges(photo) {
  const box = $('badges');
  // A different photo shows its marks at once; only marks changed on the same photo animate.
  const photoId = photo ? photo.id : null;
  const instant = photoId !== badgesPhotoId;
  badgesPhotoId = photoId;
  if (instant) box.classList.add('instant');
  const parts = photo ? badgeParts(photo) : [];
  const find = (kind) => parts.find((part) => part.kind === kind);
  const flag = find('pick') ?? find('reject');
  const rating = find('rating');
  const label = find('label');
  // Shown only while the connection is down; online, a mark is confirmed within moments.
  const unsynced = Boolean(photo) && getLink() !== '' && photoPending(photo.id);
  let shownBefore = false;
  for (const [name, part] of [['mark-flag', flag], ['mark-rating', rating], ['mark-label', label], ['mark-unsynced', unsynced]]) {
    const el = box.querySelector(`.${name}`);
    el.classList.toggle('on', Boolean(part));
    el.classList.toggle('sep', Boolean(part) && shownBefore);
    if (part) shownBefore = true;
  }
  const flagEl = box.querySelector('.mark-flag');
  // With no flag the last kind stays, so the part fades out showing the icon it had.
  if (flag) {
    flagEl.classList.toggle('pick', flag.kind === 'pick');
    flagEl.classList.toggle('reject', flag.kind === 'reject');
  }
  const valueEl = box.querySelector('.mark-rating .value');
  if (rating && valueEl.textContent !== String(rating.value)) valueEl.textContent = String(rating.value);
  if (label) box.querySelector('.mark-label .dot').className = `dot ${label.value}`;
  box.hidden = !shownBefore;
  if (instant) {
    // Reading a layout value commits the untransitioned state before transitions return.
    void box.offsetWidth;
    box.classList.remove('instant');
  }
}

const HIST_SAMPLE_PX = 320; // Longest side of the downscaled copy the histogram is counted from.
const HIST_SMOOTH = 2; // Levels averaged on either side; 0 draws the raw counts.
const HIST_COLORS =['#ff4d4d', '#3ddc5a', '#4d7dff']; // Together they add up to white.
let histSrc = ''; // Address of the bitmap the histogram shows; '' while it is blank.
let sampler = null;

// Exposure, lens and a histogram of the preview on screen. render() runs on every sync
// and refresh, so the histogram is counted again only when a different bitmap is shown.
function renderInfo(photo) {
  // Settings choose the parts; a tap on the panel folds all of it down to an icon.
  const wantHistogram = readPref('showHistogram', true) === true;
  const exposure = photo && readPref('showExposure', true) === true ? exposureText(photo) : '';
  const lens = photo && readPref('showLens', true) === true ? lensText(photo) : '';
  const collapsed = readPref('infoCollapsed', false) === true;
  const info = $('info');
  info.hidden = !photo || !(wantHistogram || exposure || lens);
  info.classList.toggle('collapsed', collapsed);
  info.setAttribute('aria-expanded', String(!collapsed));
  $('histogram').hidden = !wantHistogram;
  if ($('exposure').textContent !== exposure) $('exposure').textContent = exposure;
  if ($('lens').textContent !== lens) $('lens').textContent = lens;
  const img = $('photo');
  const shown = Boolean(photo) && wantHistogram && !collapsed && !img.hidden && !img.classList.contains('loading') && img.naturalWidth > 0;
  const src = shown ? img.currentSrc : '';
  if (src === histSrc) return;
  histSrc = src;
  const canvas = $('histogram');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!shown) return;
  // ponytail: counted from a small copy, where a few clipped pixels average away. Count
  // the full preview if exact clipping ever matters.
  const scale = HIST_SAMPLE_PX / Math.max(img.naturalWidth, img.naturalHeight);
  sampler ??= document.createElement('canvas');
  sampler.width = Math.max(1, Math.round(img.naturalWidth * scale));
  sampler.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const copy = sampler.getContext('2d', { willReadFrequently: true });
  copy.drawImage(img, 0, 0, sampler.width, sampler.height);
  const bins = histogram(copy.getImageData(0, 0, sampler.width, sampler.height).data).map((channel) => smoothBins(channel, HIST_SMOOTH));
  // Pure black and pure white hold the clipped pixels and can dwarf every other level,
  // so they do not set the scale; a clipped end shows as a full-height bar instead.
  const peak = Math.max(1, ...bins.map((channel) => Math.max(...channel.subarray(1, 255))));
  const step = canvas.width / 256;
  const top = (count) => canvas.height * (1 - Math.min(1, count / peak));
  ctx.globalCompositeOperation = 'lighter';
  bins.forEach((channel, at) => {
    ctx.fillStyle = HIST_COLORS[at];
    ctx.beginPath();
    ctx.moveTo(step, canvas.height);
    for (let level = 1; level < 255; level += 1) ctx.lineTo((level + 0.5) * step, top(channel[level]));
    ctx.lineTo(255 * step, canvas.height);
    ctx.fill();
    ctx.fillRect(0, top(channel[0]), step, canvas.height);
    ctx.fillRect(255 * step, top(channel[255]), step, canvas.height);
  });
}

// On a tall landscape screen the rail has room to spare under the filter, so the panel
// sits there and covers nothing. Everywhere else it lies over the corner of the stage.
const RAIL_INFO_QUERY = matchMedia('(orientation: landscape) and (min-height: 700px)');

function placeInfo() {
  if (RAIL_INFO_QUERY.matches) $('side').prepend($('info'));
  else $('stage').insertBefore($('info'), $('flash'));
}

// Short message in the middle of the photo: an icon or a colour dot, then text.
function showFlash(summary) {
  const box = $('flash');
  box.textContent = '';
  box.dataset.tone = summary.tone ?? '';
  if (summary.icon) box.append(icon(summary.icon));
  if (summary.swatch) {
    const dot = document.createElement('span');
    dot.className = `dot ${summary.swatch}`;
    box.append(dot);
  }
  const text = document.createElement('span');
  text.textContent = summary.text;
  box.append(text);
  playAnimation(box, 'show');
}

// The flash, the photo and the mark pill are pictures. This says the same in words, in a
// live region, for a screen reader: the mark just set and the photo now shown.
function announce(text) {
  $('live').textContent = text;
}

// Pin the corner overlays to the photo's displayed box. offset* ignores the swipe transform.
function placeOverlays() {
  const img = $('photo');
  const stage = $('stage');
  const visible = !img.hidden && img.offsetWidth > 0;
  if (visible) photoBox = { left: img.offsetLeft, width: img.offsetWidth };
  const padLeft = parseFloat(getComputedStyle(stage).paddingLeft) || 0; // Landscape safe-area inset.
  stage.style.setProperty('--img-left', `${visible ? img.offsetLeft : padLeft}px`);
  stage.style.setProperty('--img-top', `${visible ? img.offsetTop : 0}px`);
  stage.style.setProperty('--img-width', `${visible ? img.offsetWidth : stage.clientWidth - padLeft}px`);
  stage.style.setProperty('--img-bottom', `${visible ? stage.clientHeight - img.offsetTop - img.offsetHeight : 0}px`);
}

function render() {
  renderFilter();
  const photo = list[index];
  const showGrid = gridOpen && Boolean(photo);
  const url = photo ? previewUrl(photo.id, previewSize()) : null;
  // Behind the grid the large preview would only take Lightroom's time from the thumbnails.
  if (photo && !showGrid) syncImage(url);
  const previewFailed = Boolean(photo) && failedUrl === url;
  $('photo').hidden = !photo || previewFailed;
  $('photo').alt = photo ? photo.name : '';
  $('actions').hidden = !photo;
  $('empty').hidden = Boolean(photo) && !previewFailed;
  $('photo-name').textContent = photo ? photo.name : sourceName;
  const position = photo ? `${index + 1}/${list.length}` : '';
  $('photo-pos').textContent = position;
  $('caption').textContent = photo ? `${photo.name} · ${position}` : '';
  $('caption').hidden = !photo;
  renderBadges(photo);
  renderInfo(photo);
  $('viewer').classList.toggle('grid-open', showGrid);
  $('stage').hidden = showGrid;
  $('grid').hidden = !showGrid;
  $('grid-toggle').hidden = !photo;
  $('grid-toggle').setAttribute('aria-pressed', String(showGrid));
  if (showGrid) renderGrid(list, photo.id);
  if (photo && source && lastPhoto[source.id] !== photo.id) {
    rememberCapped(lastPhoto, source.id, photo.id, LAST_PHOTO_CAP);
    writePref('lastPhoto', lastPhoto);
  }
  if (!photo) {
    $('empty').textContent = notice || t(filter === 'unmarked' ? 'viewer.noUnmarked' : 'viewer.noPhotos');
    placeOverlays();
    return;
  }
  $('empty').textContent = previewFailed ? t(getLink() === 'network' ? 'viewer.notCached' : 'viewer.previewFailed') : '';
  for (const button of $('actions').querySelectorAll('button')) {
    const { field } = button.dataset;
    const value = parseValue(field, button.dataset.value);
    const current = photo[KEY[field]];
    const on = field === 'rating' ? current >= value : current === value;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
    // Pulse only while a request is really in flight; offline, the pill shows the waiting state.
    button.classList.toggle('pending', getLink() === '' && hasPending(photo.id, field));
  }
  // Warm the next two previews so swiping feels instant.
  if (!showGrid) for (const next of list.slice(index + 1, index + 3)) new Image().src = previewUrl(next.id, previewSize());
  placeOverlays();
}

function setGrid(open) {
  gridOpen = open;
  showError('');
  render();
  if (open) revealInGrid();
}

// Returns true when it moved (and rendered).
function go(delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return false;
  index = target;
  showError('');
  render();
  announce($('caption').textContent);
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

function mark(field, rawValue, { quiet = false } = {}) {
  const photo = list[index];
  if (!photo) return;
  const value = toggledValue(photo, field, parseValue(field, rawValue));
  setField(photo, field, value);
  showError('');
  const summary = markSummary(field, value);
  if (!quiet) showFlash(summary);
  pushOp(photo, field, value); // Durable queue; sync.js delivers it now or when the connection returns.
  // Pick and reject advance right away; the request happens in the background.
  const advanced = shouldAdvance(field, value, readChoice('advance', ADVANCE_RULES, 'flag')) && go(1);
  if (!advanced) render();
  announce(advanced ? `${summary.text} · ${$('caption').textContent}` : summary.text);
}

// Keyboard marks set a value, as in Lightroom, where the buttons toggle: pressing the key
// of the rating a photo already has leaves it alone.
function clearField(field) {
  const photo = list[index];
  const current = photo?.[KEY[field]];
  if (current) mark(field, String(current)); // Marking the active value again clears it.
}

function rate(stars) {
  const photo = list[index];
  if (!photo || photo.rating === stars) return;
  if (stars === 0) clearField('rating');
  else mark('rating', String(stars));
}

// Swipe up picks, swipe down rejects. Unlike the buttons a gesture never clears a flag:
// repeating it on a photo that already has that flag just moves on.
function flagByGesture(value, quiet = false) {
  const photo = list[index];
  if (!photo) return;
  if (gestureMark(photo, value) === 'advance') go(1);
  else mark('pickStatus', String(value), { quiet });
}

// sync.js reports every queue or connection change; `settled` means marks were confirmed.
export function onSyncChange({ settled }) {
  if (settled) settledOps += 1;
  if (!$('viewer').hidden) render();
}

// Lightroom refused a mark for good, for example because the photo left the catalog.
export function onOpFailed(op, error) {
  showError(t('viewer.opFailed', { name: op.name, reason: messageFor(error) }));
  refresh({ force: true }); // The catalog is the truth: pull the real value back.
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
    if (button) setFilter(button.dataset.filter);
  });
  $('mark-select').addEventListener('change', (event) => {
    if (event.target.value) setFilter(event.target.value);
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
    box.style.opacity = String(pullOpacity(progress, armed));
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
    playAnimation(hint, 'show');
    if (go(delta)) return;
    const img = $('photo');
    const bump = delta < 0 ? 'bump-prev' : 'bump-next';
    img.classList.remove(delta < 0 ? 'bump-next' : 'bump-prev');
    playAnimation(img, bump);
  }

  function toggleOverlays() {
    const off = stage.classList.toggle('overlays-off');
    showFlash(off ? { icon: 'eye-off', text: t('viewer.marksHidden') } : { icon: 'eye', text: t('viewer.marksShown') });
  }

  $('prev-photo').addEventListener('click', () => step(-1));
  $('next-photo').addEventListener('click', () => step(1));

  // The keys Lightroom uses: arrows to move, P, X and U for the flag, 0 to 5 for stars,
  // 6 to 9 for the first four colour labels.
  const LABEL_KEYS = { 6: 'red', 7: 'yellow', 8: 'green', 9: 'blue' };
  document.addEventListener('keydown', (event) => {
    if ($('viewer').hidden || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    // G as in Lightroom. The grid only shows, so the marking keys rest while it is open.
    if (key === 'g' && list.length) return setGrid(!gridOpen);
    if (gridOpen) {
      if (key === 'escape') setGrid(false);
      return;
    }
    if (key === 'arrowleft') step(-1);
    else if (key === 'arrowright') step(1);
    else if (key === 'p') flagByGesture(1);
    else if (key === 'x') flagByGesture(-1);
    else if (key === 'u') clearField('pickStatus');
    else if (key >= '0' && key <= '5') rate(Number(key));
    else if (LABEL_KEYS[key]) mark('label', LABEL_KEYS[key]);
  });

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
    // The pull hint already showed this flag, so the central flash would only repeat it.
    const hinted = $('pull').classList.contains('armed') && Number(getComputedStyle($('pull')).opacity) > 0.5;
    hidePull();
    if (!dragging) {
      // A clearly vertical swipe sets a flag; anything else is left to the click handler.
      if (flag !== 0) {
        lastSwipeAt = Date.now();
        setOffset(0);
        flagByGesture(flag, hinted);
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
    const box = photoBox.width ? photoBox : { left: 0, width: stage.clientWidth }; // No photo shown yet in this folder.
    const zone = tapZone(event.clientX - stage.getBoundingClientRect().left, box.left, box.width);
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
  placeInfo();
  RAIL_INFO_QUERY.addEventListener('change', placeInfo);
  initGrid($('grid'), (photoId) => {
    const at = list.findIndex((photo) => photo.id === photoId);
    if (at === -1) return;
    index = at;
    setGrid(false);
    announce($('caption').textContent);
  });
  $('grid-toggle').addEventListener('click', () => setGrid(!gridOpen));
  $('info').addEventListener('click', (event) => {
    event.stopPropagation(); // Over the photo it lies on a tap zone; the tap is for the panel.
    if (Date.now() - lastSwipeAt < SWIPE_CLICK_GUARD_MS) return;
    writePref('infoCollapsed', readPref('infoCollapsed', false) !== true);
    render();
  });
}

// Never throws: failures are shown inside the viewer so Back always works and the
// status bar stays owned by connectivity polling.
export async function openViewer(nextSource) {
  openSeq += 1;
  const token = openSeq;
  source = nextSource;
  // Opening a folder counts as using it, even when the user leaves before its list arrives.
  rememberCapped(lastPhoto, nextSource.id, lastPhoto[nextSource.id] ?? '', LAST_PHOTO_CAP);
  writePref('lastPhoto', lastPhoto);
  nextRefreshAt = Date.now() + REFRESH_MS;
  failedUrl = null;
  gridOpen = false;
  photoBox = { left: 0, width: 0 };
  $('stage').classList.remove('overlays-off');
  delete $('photo').dataset.url;
  sourceName = nextSource.name;
  filter = readChoice('defaultFilter', FILTERS, 'unmarked');
  notice = t('viewer.loading');
  loading = true;
  savedAtSettled = settledOps; // loadPhotos writes the offline copy itself.
  all = [];
  applyFilter();
  showError('');
  render();
  const startedAt = Date.now();
  let fromLightroom = false;
  try {
    const { data: photos, stale } = await loadPhotos(source.id);
    if (token !== openSeq) return;
    fromLightroom = !stale;
    all = sortPhotos(photos, readChoice('photoSort', PHOTO_SORTS, 'time-asc'));
    applyQueued(all, pendingOps()); // Marks still waiting to sync win over the list.
    notice = '';
  } catch (e) {
    if (token !== openSeq) return;
    // Offline with no copy of this folder: say that, rather than how to fix the connection.
    notice = e.message === 'network' ? t('viewer.folderNotCached') : messageFor(e.message);
  }
  loading = false;
  nextRefreshAt = Date.now() + nextRefreshDelay(Date.now() - startedAt, REFRESH_MS);
  applyFilter();
  index = resumeIndex(all, list, lastPhoto[nextSource.id]);
  render(); // Also remembers the photo now shown.
  if (fromLightroom) maybeAutoCache(nextSource, all);
}
