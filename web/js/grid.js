import { icon } from './dom.js';
import { previewUrl } from './api.js';
import { badgeParts, markSummary, createLoadQueue } from './state.js';

// Thumbnail grid of the open list: an overview of the marks and a way to jump to a photo.
// It only shows; marking stays with the single photo.

// Lightroom renders one preview at a time and the service worker gives a request 15 s,
// so a longer line would only make the photos at its end time out.
const LOADS_AT_ONCE = 2;

let box = null;
let watcher = null;
let shown = null; // The list array the cells were built from.
let currentId = null;
const cells = new Map(); // photo id -> its cell
const filled = new Set(); // Cells that have been on screen and so have content.

const queue = createLoadQueue(LOADS_AT_ONCE, (cell, done) => {
  const img = cell.querySelector('img');
  const settle = (ok) => {
    cell.loading = false;
    cell.classList.toggle('loaded', ok);
    if (!ok) img.removeAttribute('src'); // Tried again when the cell next scrolls into view.
    done();
  };
  img.onload = () => settle(true);
  img.onerror = () => settle(false);
  cell.loading = true;
  img.src = previewUrl(cell.photo.id, 'thumb');
});

// The same signs as the pill on the single photo: a flag or a ban, a star with its count,
// and the colour label as a strip along the bottom edge. A rejected photo is dimmed.
function drawMarks(cell) {
  const { photo } = cell;
  const state = `${photo.pick}|${photo.rating}|${photo.label}`;
  if (cell.marks === state) return;
  cell.marks = state;
  const signs = [];
  const said = [photo.name];
  for (const part of badgeParts(photo)) {
    if (part.kind === 'rating') {
      const stars = document.createElement('span');
      stars.className = 'cell-stars';
      stars.append(icon('star'), String(part.value));
      signs.push(stars);
      said.push(markSummary('rating', part.value).text);
    } else if (part.kind === 'label') {
      said.push(markSummary('label', part.value).text);
    } else {
      const sign = icon(part.kind === 'pick' ? 'flag' : 'ban');
      sign.classList.add(part.kind);
      signs.push(sign);
      said.push(markSummary('pickStatus', photo.pick).text);
    }
  }
  cell.querySelector('.cell-marks').replaceChildren(...signs);
  cell.querySelector('.cell-label').className = `cell-label dot ${photo.label}`;
  cell.classList.toggle('reject', photo.pick === -1);
  cell.setAttribute('aria-label', said.join(', '));
}

function fill(cell) {
  if (filled.has(cell)) return;
  filled.add(cell);
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  const name = document.createElement('span');
  name.className = 'cell-name';
  name.textContent = cell.photo.name; // Shown until the thumbnail arrives.
  const marks = document.createElement('span');
  marks.className = 'cell-marks';
  const label = document.createElement('span');
  label.className = 'cell-label';
  cell.append(img, name, marks, label);
  drawMarks(cell);
}

function build(list) {
  shown = list;
  currentId = null;
  watcher.disconnect();
  queue.clear();
  cells.clear();
  filled.clear();
  // ponytail: one cell per photo, filled only once it scrolls into view. Fine for a few
  // thousand photos; a source with tens of thousands wants a windowed list.
  for (const photo of list) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.photo = photo;
    cell.setAttribute('aria-label', photo.name);
    cells.set(photo.id, cell);
  }
  box.replaceChildren(...cells.values());
  for (const cell of cells.values()) watcher.observe(cell);
}

// `onPick` gets the id of the photo whose thumbnail was tapped.
export function initGrid(container, onPick) {
  box = container;
  watcher = new IntersectionObserver((entries) => {
    for (const { target: cell, isIntersecting } of entries) {
      if (!isIntersecting) {
        queue.drop(cell); // Scrolled past before its turn: Lightroom is not asked for it.
        continue;
      }
      fill(cell);
      if (!cell.loading && !cell.classList.contains('loaded')) queue.want(cell);
    }
  }, { root: box, rootMargin: '200px 0px' });
  box.addEventListener('click', (event) => {
    const cell = event.target.closest('.cell');
    if (cell) onPick(cell.photo.id);
  });
}

// Cells are rebuilt only when the list itself was replaced (a folder opened, the filter
// switched); otherwise only the marks and the outline of the current photo are brought up to date.
export function renderGrid(list, photoId) {
  if (list !== shown) build(list);
  if (photoId !== currentId) {
    cells.get(currentId)?.classList.remove('current');
    cells.get(photoId)?.classList.add('current');
    currentId = photoId;
  }
  for (const cell of filled) drawMarks(cell);
}

export function revealInGrid() {
  cells.get(currentId)?.scrollIntoView({ block: 'center' });
}
