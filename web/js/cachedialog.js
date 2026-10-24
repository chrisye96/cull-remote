import { $ } from './dom.js';
import { getInfo, previewUrl } from './api.js';
import { loadPhotos } from './data.js';
import { messageFor } from './messages.js';
import { t } from './i18n.js';
import { cachePhotos, cachedUrls, recordCached, deletePreviews } from './cacher.js';
import { stopAutoCache } from './autocache.js';
import { pickForCache, cacheChoice, uncached, cachedOf, estimateCached, formatBytes } from './cacheplan.js';
import { previewSize } from './quality.js';
import { sortPhotos, tallyMarks, filterLabel, filterName } from './state.js';
import { applyQueued } from './queue.js';
import { pendingOps } from './sync.js';
import { readChoice, PHOTO_SORTS } from './prefs.js';
import { buildMarkMenu } from './markmenu.js';

// The two standing choices. A third one covers a single mark, once it is picked in the panel.
const START = { unmarked: 'cache-unmarked', all: 'cache-all' };

let mark = null; // The mark filter picked in the panel, if any.
let drawMarks = () => {}; // Set by initCacheDialog.
let busy = false; // A run is in progress: the choices give way to its progress.
let confirming = false; // Delete was tapped once and now asks to be tapped again.
let askedAt = 0; // When the question appeared.
// A second tap sooner than this is a double tap or a bouncing finger, not an answer.
const CONFIRM_AFTER_MS = 500;

let current = null; // { source, photos, size, have } once the folder's list has loaded
let run = null; // AbortController of the run in progress
let openSeq = 0; // Bumped on every open; a slow list for an earlier folder is dropped.
let onChange = () => {};

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
    marked.setAttribute('aria-label', `${t('cache.marked', { mark: filterName(mark) })}, ${marked.querySelector('.choice-detail').textContent}`);
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
    askedAt = Date.now();
    describe();
    $('cache-delete').scrollIntoView({ block: 'nearest' }); // The question is longer than the offer.
    return;
  }
  if (Date.now() - askedAt < CONFIRM_AFTER_MS) return;
  confirming = false;
  // A run started by opening the folder at home would bring the previews straight back.
  stopAutoCache();
  const { source, photos } = current;
  try {
    // Counted again: the run just stopped may have added previews since the dialog opened.
    const have = await cachedUrls();
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
  const have = await cachedUrls().catch(() => new Set());
  if (token !== openSeq || !current) return;
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
  try {
    const loaded = await loadPhotos(source.id);
    if (loaded.stale) throw new Error('network'); // Caching needs the computer.
    // Marks still waiting to sync count, as they do in the viewer, so a filter here picks
    // the photos the viewer would list.
    applyQueued(loaded.data, pendingOps());
    photos = sortPhotos(loaded.data, readChoice('photoSort', PHOTO_SORTS, 'time-asc'));
    info = await getInfo().catch(() => ({ atHome: null }));
  } catch (e) {
    if (token === openSeq) $('cache-note').textContent = t('cache.loadFailed', { reason: messageFor(e.message) });
    return;
  }
  if (token !== openSeq || !$('cache-dialog').open) return;
  current = { source, photos, size, have: new Set() };
  const summary = t('cache.summary', { photos: t('count.photos', { n: photos.length }), quality: t(`quality.${size}`) });
  $('cache-note').textContent = info.atHome === true ? summary : t('common.twoSentences', { first: summary, second: t('cache.away') });
  describe();
  refreshHave(token);
}
