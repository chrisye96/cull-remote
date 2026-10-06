import { $ } from './dom.js';
import { getInfo, previewUrl } from './api.js';
import { loadPhotos } from './data.js';
import { messageFor } from './messages.js';
import { t } from './i18n.js';
import { cachePhotos, cachedUrls, recordCached } from './cacher.js';
import { stopAutoCache } from './autocache.js';
import { pickForCache, cacheChoice, uncached } from './cacheplan.js';
import { previewSize } from './quality.js';
import { sortPhotos } from './state.js';
import { readChoice, PHOTO_SORTS } from './prefs.js';

const START = { unmarked: 'cache-unmarked', all: 'cache-all' };

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

function setBusy(busy) {
  for (const id of Object.values(START)) $(id).hidden = busy;
  $('cache-progress').hidden = !busy;
  $('cache-cancel').hidden = !busy;
}

// Write both choices: how many photos each covers and how many are still to download.
function describe() {
  for (const [mode, id] of Object.entries(START)) {
    const button = $(id);
    const detail = button.querySelector('.choice-detail');
    if (!current) {
      button.disabled = true;
      detail.textContent = '';
      continue;
    }
    const picked = pickForCache(current.photos, mode);
    const left = uncached(picked, current.size, current.have, previewUrl).length;
    const choice = cacheChoice(picked.length, left, current.size);
    button.disabled = choice.disabled;
    detail.textContent = choice.detail;
  }
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

async function start(mode) {
  const { source, photos, size } = current;
  const picked = pickForCache(photos, mode);
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
  for (const [mode, id] of Object.entries(START)) $(id).addEventListener('click', () => start(mode));
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
  setBusy(false);
  describe();
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
  const summary = t('cache.summary', { photos: t('count.photos', { n: photos.length }), quality: t(`quality.${size}`) });
  $('cache-note').textContent = info.atHome === true ? summary : t('common.twoSentences', { first: summary, second: t('cache.away') });
  describe();
  refreshHave(token);
}
