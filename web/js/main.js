import { $ } from './dom.js';
import { getStatus } from './api.js';
import { messageFor } from './messages.js';
import { showSources } from './sources.js';
import { initViewer, openViewer } from './viewer.js';

let sourcesLoaded = false;

function show(view) {
  $('sources').hidden = view !== 'sources';
  $('viewer').hidden = view !== 'viewer';
}

function setStatus(text) {
  $('status').textContent = text;
  $('status').hidden = !text;
}

async function home() {
  show('sources');
  try {
    await showSources(async (source) => {
      show('viewer');
      await openViewer(source);
    });
    sourcesLoaded = true;
  } catch (e) {
    sourcesLoaded = false;
    setStatus(messageFor(e.message));
  }
}

async function pollStatus() {
  try {
    const { lrOnline } = await getStatus();
    setStatus(lrOnline ? '' : messageFor('lr_offline'));
    if (lrOnline && !sourcesLoaded && !$('sources').hidden) await home();
  } catch (e) {
    setStatus(messageFor(e.message));
  }
}

initViewer(home);
await home();
setInterval(pollStatus, 5000);
