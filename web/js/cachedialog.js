import { $ } from './dom.js';
import { getInfo } from './api.js';
import { loadPhotos } from './data.js';
import { messageFor } from './messages.js';
import { cachePhotos, recordCached } from './cacher.js';
import { pickForCache, estimateBytes, formatBytes } from './cacheplan.js';
import { previewSize } from './quality.js';
import { sortPhotos } from './state.js';
import { readChoice, PHOTO_SORTS } from './prefs.js';

const SIZE_NAME = { std: '标准', hd: '高清' };
const START = { unmarked: 'cache-unmarked', all: 'cache-all' };
const LABEL = { unmarked: '缓存未标记', all: '缓存全部' };

let current = null; // { source, photos, size } once the folder's list has loaded
let run = null; // AbortController of the run in progress
let openSeq = 0; // Bumped on every open; a slow list for an earlier folder is dropped.
let onChange = () => {};

function setBusy(busy) {
  for (const id of Object.values(START)) $(id).hidden = busy;
  $('cache-progress').hidden = !busy;
  $('cache-close').textContent = busy ? '取消' : '关闭';
}

function describe(mode) {
  const button = $(START[mode]);
  const count = current ? pickForCache(current.photos, mode).length : 0;
  button.disabled = count === 0;
  button.textContent = !current
    ? LABEL[mode]
    : count === 0
      ? `${LABEL[mode]}（0 张）`
      : `${LABEL[mode]}（${count} 张，约 ${formatBytes(estimateBytes(count, current.size))}）`;
}

async function start(mode) {
  const { source, photos, size } = current;
  const picked = pickForCache(photos, mode);
  run = new AbortController();
  const { signal } = run;
  setBusy(true);
  $('cache-progress').max = picked.length;
  $('cache-progress').value = 0;
  $('cache-state').textContent = `已缓存 0 / ${picked.length}`;
  // Ask the browser not to evict this site's data; it may say no, which changes nothing here.
  navigator.storage?.persist?.().catch(() => {});
  let last = { cached: 0, failed: 0 };
  let ending;
  try {
    last = await cachePhotos(picked, size, {
      signal,
      onProgress: (progress) => {
        last = progress;
        $('cache-progress').value = progress.cached + progress.failed;
        $('cache-state').textContent = `已缓存 ${progress.cached} / ${picked.length}`;
      },
    });
    ending = last.failed
      ? `完成，已缓存 ${last.cached} 张，${last.failed} 张失败，再点一次可以重试`
      : `完成，已缓存 ${last.cached} 张`;
  } catch (e) {
    if (signal.aborted) ending = `已取消，已缓存 ${last.cached} 张`;
    else if (e.name === 'QuotaExceededError') ending = `设备存储空间不足，已缓存 ${last.cached} 张`;
    else ending = `连接中断，已缓存 ${last.cached} 张，稍后再点一次可以继续`;
  }
  run = null;
  if (last.cached) recordCached(source.id, last.cached);
  setBusy(false);
  $('cache-state').textContent = ending;
  onChange();
}

// Bind the dialog's buttons. Call once at page load; `changed` runs after every run.
export function initCacheDialog(changed) {
  onChange = changed;
  for (const [mode, id] of Object.entries(START)) $(id).addEventListener('click', () => start(mode));
  $('cache-close').addEventListener('click', () => {
    if (run) run.abort();
    else $('cache-dialog').close();
  });
  // Esc or any other way of closing also stops the run.
  $('cache-dialog').addEventListener('close', () => run?.abort());
}

export async function openCacheDialog(source) {
  openSeq += 1;
  const token = openSeq;
  current = null;
  $('cache-title').textContent = source.name;
  $('cache-note').textContent = '正在读取照片列表';
  $('cache-state').textContent = '';
  setBusy(false);
  describe('unmarked');
  describe('all');
  $('cache-dialog').showModal();
  const size = previewSize();
  let photos;
  let info;
  try {
    const loaded = await loadPhotos(source.id);
    if (loaded.stale) throw new Error('network'); // Caching needs the computer.
    photos = sortPhotos(loaded.data, readChoice('photoSort', PHOTO_SORTS, 'time-asc'));
    info = await getInfo().catch(() => ({ atHome: null }));
  } catch (e) {
    if (token === openSeq) $('cache-note').textContent = `读取失败：${messageFor(e.message)}`;
    return;
  }
  if (token !== openSeq || !$('cache-dialog').open) return;
  current = { source, photos, size };
  const away = info.atHome === true ? '' : '当前不在家里的网络，或无法判断，下载可能会用到蜂窝流量。';
  $('cache-note').textContent = `共 ${photos.length} 张，${SIZE_NAME[size]}清晰度。${away}`;
  describe('unmarked');
  describe('all');
}
