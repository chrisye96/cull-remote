import { $ } from './dom.js';
import { getStatus } from './api.js';
import { messageFor } from './messages.js';
import { initSources, showSources } from './sources.js';
import { initViewer, openViewer } from './viewer.js';

document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS Safari apply :active pressed states

let sourcesLoaded = false;
let homeScroll = 0; // Scroll position of the source list, restored when coming Back.

function show(view) {
  $('sources').hidden = view !== 'sources';
  $('viewer').hidden = view !== 'viewer';
}

function setStatus(text) {
  $('status').textContent = text;
  $('status').hidden = !text;
}

async function home({ force = false, restoreScroll = false } = {}) {
  show('sources');
  try {
    await showSources(async (source) => {
      homeScroll = $('home-list').scrollTop;
      show('viewer');
      await openViewer(source);
    }, { force });
    if (restoreScroll) $('home-list').scrollTop = homeScroll;
    sourcesLoaded = true;
  } catch (e) {
    sourcesLoaded = false;
    setStatus(messageFor(e.message));
  }
}

let polling = false;

async function pollStatus() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    const { lrOnline } = await getStatus();
    setStatus(lrOnline ? '' : messageFor('lr_offline'));
    if (lrOnline && !sourcesLoaded && !$('sources').hidden) await home({ force: true });
  } catch (e) {
    setStatus(messageFor(e.message));
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

initSources();
initViewer(() => home({ restoreScroll: true }));
await home();
setInterval(pollStatus, 5000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollStatus();
});
