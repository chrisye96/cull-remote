import { $ } from './dom.js';
import { getInfo, getStatus } from './api.js';
import { readChoice, readPref, writePref, QUALITIES, ADVANCE_RULES, FILTERS, AUTO_CACHE_LIMITS } from './prefs.js';
import { clearCopies } from './store.js';
import { cachedUrls, clearPreviews } from './cacher.js';
import { estimateCached, formatBytes } from './cacheplan.js';
import { pendingCount } from './sync.js';

const HOME_TEXT = { true: '家里的网络（直连）', false: '不在家，或经过中继', null: '无法判断' };

// A <select> that mirrors one stored choice.
export function bindSelect(id, name, allowed, fallback, onChange = () => {}) {
  const select = $(id);
  select.value = readChoice(name, allowed, fallback);
  select.addEventListener('change', () => {
    writePref(name, select.value);
    onChange(select.value);
  });
}

// A checkbox that mirrors one stored on/off preference.
export function bindCheckbox(id, name, fallback, onChange = () => {}) {
  const box = $(id);
  box.checked = readPref(name, fallback) === true;
  box.addEventListener('change', () => {
    writePref(name, box.checked);
    onChange(box.checked);
  });
}

export function applyLeftHand() {
  document.documentElement.classList.toggle('left-hand', readPref('leftHand', false) === true);
}

let usageSeq = 0; // Counting a large cache is slow; only the newest count may be shown.

async function renderUsage() {
  usageSeq += 1;
  const mine = usageSeq;
  $('cache-usage').textContent = '正在统计';
  let urls = [];
  try {
    urls = [...(await cachedUrls())];
  } catch {
    // Cache Storage is unavailable; nothing is cached.
  }
  if (mine !== usageSeq) return; // A newer count is on its way.
  const size = urls.length ? `，约 ${formatBytes(estimateCached(urls))}` : '';
  $('cache-usage').textContent = `已缓存预览 ${urls.length} 张${size}`;
}

function infoRow(list, term, text) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = text;
  list.append(dt, dd);
}

async function renderInfo() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('home-screen-tip').hidden = standalone;
  const [status, info] = await Promise.allSettled([getStatus(), getInfo()]);
  const list = $('conn-info');
  list.textContent = '';
  // The address other devices use; on the computer itself that differs from this page's own.
  const address = info.status === 'fulfilled' ? info.value.address : null;
  infoRow(list, '地址', address ?? location.origin);
  $('conn-pair').hidden = !address;
  if (address) $('conn-qr').src = '/api/qr.svg';
  infoRow(list, 'Lightroom', status.status === 'fulfilled' ? (status.value.lrOnline ? '已连接' : '未运行') : '连不上电脑');
  infoRow(list, '网络位置', info.status === 'fulfilled' ? HOME_TEXT[String(info.value.atHome)] : '未知');
  infoRow(list, '待同步标记', `${pendingCount()} 条`);
  infoRow(list, '打开方式', standalone ? '主屏幕应用' : '浏览器');
  infoRow(list, '版本', info.status === 'fulfilled' ? info.value.version : '未知');
}

// Bind every control. Call once at page load.
export function initSettings(onBack) {
  $('settings-back').addEventListener('click', onBack);
  bindSelect('set-quality', 'quality', QUALITIES, 'auto');
  bindSelect('set-advance', 'advance', ADVANCE_RULES, 'flag');
  bindSelect('set-filter', 'defaultFilter', FILTERS, 'unmarked');
  bindCheckbox('set-left-hand', 'leftHand', false, applyLeftHand);
  applyLeftHand();
  bindCheckbox('set-auto-cache', 'autoCache', true);
  bindSelect('set-auto-limit', 'autoCacheLimit', AUTO_CACHE_LIMITS, '500');
  $('clear-cache').addEventListener('click', async () => {
    if (!confirm('清除这台设备上缓存的预览图和照片列表？还没同步的标记不受影响。')) return;
    await clearPreviews().catch(() => {});
    await clearCopies().catch(() => {});
    writePref('cached', {});
    await renderUsage(); // The count dropping to 0 is the confirmation.
  });
}

// Refresh the parts that change between visits. Resolves once the connection details,
// including the pairing code, are on the page.
export function showSettings() {
  renderUsage();
  return renderInfo();
}
