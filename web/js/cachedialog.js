import { $ } from './dom.js';
import { getInfo, previewUrl } from './api.js';
import { loadPhotos } from './data.js';
import { messageFor } from './messages.js';
import { t } from './i18n.js';
import { cachePhotos, cachedUrls, recordCached, deletePreviews } from './cacher.js';
import { stopAutoCache } from './autocache.js';
import { pickForCache, cacheChoice, uncached, cachedOf, estimateCached, formatBytes } from './cacheplan.js';
import { previewSize } from './quality.js';
import { sortPhotos, tallyMarks, filterLabel } from './state.js';
import { readChoice, PHOTO_SORTS } from './prefs.js';
import { buildMarkMenu } from './markmenu.js';

// The two standing choices. A third one covers a single mark, once it is picked in the panel.
const START = { unmarked: 'cache-unmarked', all: 'cache-all' };

let mark = null; // The mark filter picked in the panel, if any.
let drawMarks = () => {}; // Set by initCacheDialog.
let busy = false; // A run is in progress: the choices give way to its progress.
let confirming = false; // Delete was tapped once and now asks to be tapped again.

let current = null; // { source, photos, size, have } once the folder's list has loaded
let run = null; // AbortController of the run in progress
let openSeq = 0; // Bumped on every open; a slow list for an earlier folder is dropped.
let onChange = () => {};

// DIAG (temporary): shows where the time of opening the dialog goes. Kept until the
// away-from-home reading has been taken, then remove.
const diagLines = [];
const ms = Math.round;
function diagShow() {
  let el = $('cache-diag');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'cache-diag';
    el.style.cssText = 'margin:0;font-size:11px;white-space:pre-wrap;user-select:text';
    $('cache-dialog').querySelector('.dialog-body').append(el);
  }
  el.textContent = diagLines.join('\n');
}
// The newest request to `path`: time to the first byte, download time and the server's own figures.
function diagFetch(path) {
  const e = performance.getEntriesByType('resource').filter((x) => new URL(x.name).pathname === path).at(-1);
  if (!e) return 'no request seen';
  const server = (e.serverTiming ?? []).map((t) => `${t.name} ${ms(t.duration)}`).join(', ');
  return `first byte ${ms(e.responseStart - e.startTime)} + download ${ms(e.responseEnd - e.responseStart)} (${ms(e.encodedBodySize / 1024)} KB) | server: ${server || 'n/a'}`;
}

function setBusy(now) {
  busy = now;
  for (const id of Object.values(START)) $(id).hidden = busy;
  $('cache-progress').hidden = !busy;
  $('cache-cancel').hidden = !busy;
  describe();
}

// Write one choice: how many photos it covers and how many are still to download.
function describeChoice(button, filter) {
  const detail = button.querySelector('.choice-detail');
  if (!current) {
    button.disabled = true;
    detail.textContent = '';
    return;
  }
  const picked = pickForCache(current.photos, filter);
  const left = uncached(picked, current.size, current.have, previewUrl).length;
  const choice = cacheChoice(picked.length, left, current.size);
  button.disabled = choice.disabled;
  detail.textContent = choice.detail;
}

function describe() {
  for (const [filter, id] of Object.entries(START)) describeChoice($(id), filter);
  // The marks the folder holds, offered only when it holds any, and the choice for the one picked.
  const counts = current ? tallyMarks(current.photos) : null;
  $('cache-marks').hidden = busy || !counts || !Object.values(counts).some(Boolean);
  if (counts) drawMarks(counts, mark);
  const marked = $('cache-marked');
  marked.hidden = busy || !mark;
  if (mark) {
    marked.querySelector('.choice-title').textContent = t('cache.marked', { mark: filterLabel(mark) });
    describeChoice(marked, mark);
  }
  // Deleting is offered once the folder has previews on this device. The first tap only
  // turns the button into the question, with what would go.
  const held = current ? cachedOf(current.photos, current.have, previewUrl) : { urls: [], count: 0 };
  const remove = $('cache-delete');
  remove.hidden = busy || held.count === 0;
  remove.classList.toggle('confirm', confirming);
  const what = t('common.withSize', { what: t('count.photos', { n: held.count }), size: formatBytes(estimateCached(held.urls)) });
  remove.textContent = confirming ? t('cache.deleteConfirm', { what }) : t('cache.delete');
}

async function removeCached() {
  if (!confirming) {
    confirming = true;
    describe();
    $('cache-delete').scrollIntoView({ block: 'nearest' }); // The question is longer than the offer.
    return;
  }
  confirming = false;
  const { source, photos, have } = current;
  try {
    await deletePreviews(source.id, cachedOf(photos, have, previewUrl).urls);
  } catch {
    refreshHave(openSeq); // Show what is really left instead of claiming it is gone.
    return;
  }
  onChange();
  // Nothing left to decide: the row's sign on the home page is the confirmation.
  $('cache-dialog').close();
}

// Which previews are already on the device; counting a large cache takes a moment,
// so the choices are shown first and corrected when this arrives.
async function refreshHave(token) {
  const startedAt = performance.now();
  const have = await cachedUrls().catch(() => new Set());
  if (token !== openSeq || !current) return;
  diagLines.push(`count ${ms(performance.now() - startedAt)} ms (${have.size} cached previews)`);
  diagShow();
  current.have = have;
  describe();
}

async function start(filter) {
  const { source, photos, size } = current;
  const picked = pickForCache(photos, filter);
  stopAutoCache(); // The manual run takes over.
  run = new AbortController();
  const { signal } = run;
  setBusy(true);
  $('cache-progress').max = picked.length;
  $('cache-progress').value = 0;
  $('cache-state').textContent = t('cache.progress', { done: 0, total: picked.length });
  // Ask the browser not to evict this site's data; it may say no, which changes nothing here.
  navigator.storage?.persist?.().catch(() => {});
  let last = { cached: 0, failed: 0 };
  let ending = '';
  let finished = false; // True when every photo of the run is on the device.
  try {
    last = await cachePhotos(picked, size, {
      signal,
      onProgress: (progress) => {
        last = progress;
        $('cache-progress').value = progress.cached + progress.failed;
        $('cache-state').textContent = t('cache.progress', { done: progress.cached, total: picked.length });
      },
    });
    finished = last.failed === 0;
    ending = t('cache.endFailed', last);
  } catch (e) {
    if (signal.aborted) ending = t('cache.endCancelled', last);
    else if (e.name === 'QuotaExceededError') ending = t('cache.endQuota', last);
    else ending = t('cache.endInterrupted', last);
  }
  run = null;
  if (last.cached) recordCached(source.id, last.cached);
  setBusy(false);
  onChange();
  if (finished) {
    // Nothing left to decide: the row's cached count on the home page is the confirmation.
    $('cache-dialog').close();
    return;
  }
  $('cache-state').textContent = ending;
  refreshHave(openSeq);
}

// Bind the dialog's buttons. Call once at page load; `changed` runs after every run.
export function initCacheDialog(changed) {
  onChange = changed;
  for (const [filter, id] of Object.entries(START)) $(id).addEventListener('click', () => start(filter));
  $('cache-marked').addEventListener('click', () => start(mark));
  // Picking a mark only adds its choice, with the size of the download; tapping it again takes
  // the choice away.
  drawMarks = buildMarkMenu($('cache-marks').querySelector('.mark-menu'), (name) => {
    mark = name === mark ? null : name;
    describe();
    if (mark) $('cache-marked').scrollIntoView({ block: 'nearest' });
  });
  $('cache-delete').addEventListener('click', removeCached);
  // A tap anywhere else in the dialog takes the question back.
  $('cache-dialog').addEventListener('click', (event) => {
    if (!confirming || event.target === $('cache-delete')) return;
    confirming = false;
    describe();
  });
  $('cache-cancel').addEventListener('click', () => run?.abort());
  $('cache-close').addEventListener('click', () => $('cache-dialog').close());
  // Closing the dialog, by its button or by Esc, also stops the run.
  $('cache-dialog').addEventListener('close', () => run?.abort());
}

export async function openCacheDialog(source) {
  openSeq += 1;
  const token = openSeq;
  current = null;
  $('cache-title').textContent = source.name;
  $('cache-note').textContent = t('cache.loading');
  $('cache-state').textContent = '';
  mark = null;
  confirming = false;
  $('cache-marks').open = false;
  setBusy(false);
  $('cache-dialog').showModal();
  // Start on the title: otherwise the close button, first in the dialog, opens with a focus ring.
  $('cache-title').focus();
  const size = previewSize();
  let photos;
  let info;
  // The browser keeps only 250 request timings, and a caching run fills that.
  performance.clearResourceTimings();
  diagLines.length = 0;
  diagLines.push('timing: waiting for the list');
  diagShow();
  const t0 = performance.now();
  let t1 = t0;
  try {
    const loaded = await loadPhotos(source.id);
    t1 = performance.now();
    if (loaded.stale) throw new Error('network'); // Caching needs the computer.
    photos = sortPhotos(loaded.data, readChoice('photoSort', PHOTO_SORTS, 'time-asc'));
    info = await getInfo().catch(() => ({ atHome: null }));
  } catch (e) {
    if (token === openSeq) {
      $('cache-note').textContent = t('cache.loadFailed', { reason: messageFor(e.message) });
      diagLines.splice(0, 1, `list failed (${e.message}) after ${ms(performance.now() - t0)} ms: ${diagFetch('/api/photos')}`);
      diagShow();
    }
    return;
  }
  const t2 = performance.now();
  if (token !== openSeq || !$('cache-dialog').open) return;
  diagLines.splice(0, 1,
    `list ${ms(t1 - t0)} ms: ${diagFetch('/api/photos')}`,
    `info ${ms(t2 - t1)} ms (atHome ${info.atHome}): ${diagFetch('/api/info')}`,
    `until choices ${ms(t2 - t0)} ms`,
  );
  diagShow();
  current = { source, photos, size, have: new Set() };
  // With nothing unmarked the first choice is of no use, so the marks are shown at once.
  $('cache-marks').open = pickForCache(photos, 'unmarked').length === 0;
  const summary = t('cache.summary', { photos: t('count.photos', { n: photos.length }), quality: t(`quality.${size}`) });
  $('cache-note').textContent = info.atHome === true ? summary : t('common.twoSentences', { first: summary, second: t('cache.away') });
  describe();
  refreshHave(token);
}
