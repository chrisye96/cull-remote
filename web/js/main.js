import { $ } from './dom.js';
import { getStatus } from './api.js';
import { statusLine } from './messages.js';
import { initSync, drain, setLink, getLink, pendingCount } from './sync.js';
import { initSources, showSources } from './sources.js';
import { initViewer, openViewer, onSyncChange, onOpFailed } from './viewer.js';

document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS Safari apply :active pressed states

let sourcesFresh = false; // False until the source list has come from Lightroom rather than the offline copy.
let homeScroll = 0; // Scroll position of the source list, restored when coming Back.

function show(view) {
  $('sources').hidden = view !== 'sources';
  $('viewer').hidden = view !== 'viewer';
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
  button.textContent = '刷新中';
  try {
    await home({ force: true });
  } finally {
    button.disabled = false;
    button.textContent = '刷新';
  }
});

// Offline support needs a secure context (the tailnet HTTPS address or localhost).
navigator.serviceWorker?.register('/sw.js').catch(() => {});

initSources();
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
setInterval(pollStatus, 5000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollStatus();
});
addEventListener('online', pollStatus);
