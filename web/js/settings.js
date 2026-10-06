import { $ } from './dom.js';
import { getInfo, getStatus } from './api.js';
import { readChoice, readPref, writePref, QUALITIES, ADVANCE_RULES, FILTERS, AUTO_CACHE_LIMITS } from './prefs.js';
import { clearCopies } from './store.js';
import { cachedUrls, clearPreviews } from './cacher.js';
import { estimateCached, formatBytes } from './cacheplan.js';
import { pendingCount } from './sync.js';
import { t, useStoredLang, LANGUAGES, LANGUAGE_CHOICES } from './i18n.js';

const HOME_KEY = { true: 'net.home', false: 'net.away', null: 'net.unknown' };

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
  $('cache-usage').textContent = t('settings.counting');
  let urls = [];
  try {
    urls = [...(await cachedUrls())];
  } catch {
    // Cache Storage is unavailable; nothing is cached.
  }
  if (mine !== usageSeq) return; // A newer count is on its way.
  const previews = t('count.previews', { n: urls.length });
  $('cache-usage').textContent = urls.length ? t('common.withSize', { what: previews, size: formatBytes(estimateCached(urls)) }) : previews;
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
  infoRow(list, t('info.address'), address ?? location.origin);
  $('conn-pair').hidden = !address;
  if (address) $('conn-qr').src = '/api/qr.svg';
  infoRow(list, 'Lightroom', status.status === 'fulfilled' ? t(status.value.lrOnline ? 'info.lrConnected' : 'info.lrOff') : t('info.unreachable'));
  infoRow(list, t('info.network'), info.status === 'fulfilled' ? t(HOME_KEY[String(info.value.atHome)]) : t('info.unknown'));
  infoRow(list, t('info.pending'), t('info.pendingCount', { n: pendingCount() }));
  infoRow(list, t('info.openedAs'), t(standalone ? 'info.standalone' : 'info.browser'));
  infoRow(list, t('info.version'), info.status === 'fulfilled' ? info.value.version : t('info.unknown'));
}

// Bind every control. Call once at page load. `onLanguage` runs after the language changed,
// for the text this module does not own.
export function initSettings(onBack, onLanguage) {
  $('settings-back').addEventListener('click', onBack);
  for (const [code, name] of Object.entries(LANGUAGES)) $('set-language').add(new Option(name, code));
  bindSelect('set-language', 'lang', LANGUAGE_CHOICES, 'auto', () => {
    useStoredLang();
    onLanguage();
    showSettings();
  });
  bindSelect('set-quality', 'quality', QUALITIES, 'auto');
  bindSelect('set-advance', 'advance', ADVANCE_RULES, 'flag');
  bindSelect('set-filter', 'defaultFilter', FILTERS, 'unmarked');
  bindCheckbox('set-left-hand', 'leftHand', false, applyLeftHand);
  applyLeftHand();
  bindCheckbox('set-auto-cache', 'autoCache', true);
  bindSelect('set-auto-limit', 'autoCacheLimit', AUTO_CACHE_LIMITS, '500');
  $('clear-cache').addEventListener('click', async () => {
    if (!confirm(t('settings.clearConfirm'))) return;
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
