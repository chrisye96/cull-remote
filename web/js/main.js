import { $ } from './dom.js';
import { getStatus } from './api.js';
import { statusLine } from './messages.js';
import { initSync, drain, setLink, getLink, pendingCount } from './sync.js';
import { initSources, showSources, showSourcesNotice } from './sources.js';
import { initSettings, showSettings } from './settings.js';
import { initViewer, openViewer, onSyncChange, onOpFailed } from './viewer.js';
import { t, useStoredLang, applyStatic } from './i18n.js';

// The markup carries no text of its own; every view stays hidden until this has run.
useStoredLang();
applyStatic();

document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS Safari apply :active pressed states

let sourcesFresh = false; // False until the source list has come from Lightroom rather than the offline copy.
let homeScroll = 0; // Scroll position of the source list, restored when coming Back.
let shown = '';

function show(view) {
  $('sources').hidden = view !== 'sources';
  $('viewer').hidden = view !== 'viewer';
  $('settings').hidden = view !== 'settings';
  // Focus follows the view, so a keyboard or a screen reader is not left on a control that
  // just became hidden. Only on a real change: the home page is shown again while typing a search.
  if (view !== shown) $(view).focus({ preventScroll: true });
  shown = view;
}

function renderStatus() {
  const text = statusLine(getLink(), pendingCount());
  $('status').textContent = text;
  $('status').hidden = !text;
}

async function home({ force = false, restoreScroll = false } = {}) {
  show('sources');
  try {
    const { stale } = await showSources(async (source) => {
      homeScroll = $('home-list').scrollTop;
      show('viewer');
      await openViewer(source);
    }, { force });
    if (restoreScroll) $('home-list').scrollTop = homeScroll;
    sourcesFresh = !stale;
  } catch (e) {
    sourcesFresh = false;
    setLink(e.message);
    showSourcesNotice(t(e.message === 'network' ? 'home.noListOffline' : 'home.noList'));
  }
}

let polling = false;

async function pollStatus() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    const { lrOnline } = await getStatus();
    if (!lrOnline) setLink('lr_offline');
    else if (pendingCount()) await drain(); // drain() sets the link from its own outcome.
    else setLink('');
    if (lrOnline && !sourcesFresh && !$('sources').hidden) await home({ force: true });
  } catch (e) {
    setLink(e.message);
  } finally {
    polling = false;
  }
}

$('refresh-sources').addEventListener('click', async () => {
  const button = $('refresh-sources');
  button.disabled = true;
  button.textContent = t('home.refreshing');
  try {
    await home({ force: true });
  } finally {
    button.disabled = false;
    button.textContent = t('home.refresh');
  }
});

// Offline support needs a secure context (the tailnet HTTPS address or localhost).
navigator.serviceWorker?.register('/sw.js').catch(() => {});

initSources();
initSettings(() => home({ restoreScroll: true }), () => {
  applyStatic();
  renderStatus();
});
function openSettings() {
  homeScroll = $('home-list').scrollTop;
  show('settings');
  return showSettings();
}
$('open-settings').addEventListener('click', openSettings);
initViewer(() => home({ restoreScroll: true }));
await initSync({
  onChange: (change) => {
    renderStatus();
    onSyncChange(change);
  },
  onFailed: onOpFailed,
});
await pollStatus(); // Learn whether the computer answers before choosing between Lightroom and the offline copy.
await home();
// The plugin's menu item opens the app here to show the address and its QR code.
if (location.hash === '#settings') {
  await openSettings();
  $('conn-pair').scrollIntoView({ block: 'center' });
}
setInterval(pollStatus, 5000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollStatus();
});
addEventListener('online', pollStatus);
