import { $, icon } from './dom.js';
import { getSources } from './api.js';
import { readPref, writePref, readChoice, FOLDER_SORTS, PHOTO_SORTS } from './prefs.js';
import { buildTree, sortTree, filterTree, folderHint, recentSources } from './tree.js';

let cached = null;
let onPickSource = () => {};
let query = '';
const storedExpanded = readPref('expanded', {});
// node key -> true/false, only for nodes the user toggled
const expanded = storedExpanded && typeof storedExpanded === 'object' && !Array.isArray(storedExpanded) ? storedExpanded : {};
const searching = () => query.trim() !== '';
const RECENT_LIMIT = 5;

// While searching every match is shown; otherwise the user's choice wins and the
// first level is open by default.
const isOpen = (node) => (searching() ? true : expanded[node.key] ?? node.source.depth === 0);

function toggle(node) {
  if (searching()) return; // Searching shows every match; the saved expand state stays untouched.
  expanded[node.key] = !isOpen(node);
  writePref('expanded', expanded);
  renderList();
}

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

const KIND_ICON = { folder: 'folder', set: 'layers' };

// The tappable part of a row: kind icon, name, optional path hint and photo count.
function sourceButton(source, hint, onActivate) {
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'source-main';
  const kind = icon(KIND_ICON[source.kind] ?? 'images');
  kind.setAttribute('class', 'icon source-kind');
  main.append(kind, span('source-name', source.name));
  if (hint) main.append(span('source-hint', hint));
  if (source.kind !== 'set') main.append(span('source-count', String(source.count)));
  main.addEventListener('click', onActivate);
  return main;
}

function rowShell(depth) {
  const item = document.createElement('li');
  item.className = 'source-item';
  const line = document.createElement('div');
  line.className = 'source-row';
  line.style.paddingInlineStart = `${depth * 16}px`;
  item.append(line);
  return { item, line };
}

function row(node, siblings) {
  const { source } = node;
  const { item, line } = rowShell(source.depth);

  if (node.children.length) {
    const open = isOpen(node);
    const twisty = document.createElement('button');
    twisty.type = 'button';
    twisty.className = 'twisty';
    twisty.disabled = searching();
    twisty.setAttribute('aria-expanded', String(open));
    twisty.setAttribute('aria-label', open ? `折叠 ${source.name}` : `展开 ${source.name}`);
    twisty.append(icon(open ? 'chevron-down' : 'chevron-right'));
    twisty.addEventListener('click', () => toggle(node));
    line.append(twisty);
  } else {
    line.append(span('twisty-spacer', ''));
  }

  // Collection sets cannot be opened; their row just expands or collapses.
  line.append(sourceButton(source, folderHint(node, siblings), () => (source.id ? onPickSource(source) : toggle(node))));
  return item;
}

// A flat row in the recently opened group: no indentation and no twisty.
function recentRow(source) {
  const { item, line } = rowShell(0);
  line.append(span('twisty-spacer', ''), sourceButton(source, '', () => onPickSource(source)));
  return item;
}

function appendNodes(list, nodes, rows) {
  for (const node of nodes) {
    const item = row(node, nodes);
    rows.push(item);
    list.append(item);
    if (node.children.length && isOpen(node)) appendNodes(list, node.children, rows);
  }
}

function groupHeading(text) {
  const item = document.createElement('li');
  item.className = 'source-group';
  item.textContent = text;
  return item;
}

// Round the outer corners of one group's panel.
function markGroup(rows) {
  rows[0]?.classList.add('group-start');
  rows.at(-1)?.classList.add('group-end');
}

function renderList() {
  const list = $('source-list');
  list.textContent = '';
  if (!cached) return;
  const tree = filterTree(sortTree(buildTree(cached), readChoice('folderSort', FOLDER_SORTS, 'name-desc')), query);
  if (!searching()) {
    const recent = recentSources(cached, readPref('lastPhoto', {}), RECENT_LIMIT);
    if (recent.length) {
      list.append(groupHeading('最近打开'));
      const rows = recent.map(recentRow);
      list.append(...rows);
      markGroup(rows);
    }
  }
  const groups = [
    ['文件夹', tree.filter((node) => node.source.kind === 'folder')],
    ['收藏夹', tree.filter((node) => node.source.kind !== 'folder')],
  ];
  for (const [title, nodes] of groups) {
    if (!nodes.length) continue;
    list.append(groupHeading(title));
    const rows = [];
    appendNodes(list, nodes, rows);
    markGroup(rows);
  }
  if (!list.children.length) {
    const empty = document.createElement('li');
    empty.className = 'source-empty';
    empty.textContent = searching() ? '没有匹配的文件夹或收藏夹' : '这个目录里还没有文件夹或收藏夹';
    list.append(empty);
  }
}

// Bind the search box and the two sort selects. Call once at page load.
export function initSources() {
  const search = $('source-search');
  const clear = $('search-clear');
  const syncClear = () => {
    clear.hidden = search.value === '';
  };
  const applySearch = () => {
    query = search.value;
    syncClear();
    renderList();
  };
  syncClear();
  search.addEventListener('input', (event) => {
    syncClear();
    if (event.isComposing) return; // Wait for the IME to commit; compositionend re-runs this.
    applySearch();
  });
  search.addEventListener('compositionend', applySearch);
  clear.addEventListener('click', () => {
    search.value = '';
    applySearch();
    search.focus();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) search.blur(); // Closes the iOS keyboard.
  });
  const folderSort = $('folder-sort');
  folderSort.value = readChoice('folderSort', FOLDER_SORTS, 'name-desc');
  folderSort.addEventListener('change', () => {
    writePref('folderSort', folderSort.value);
    renderList();
  });
  const photoSort = $('photo-sort');
  photoSort.value = readChoice('photoSort', PHOTO_SORTS, 'time-asc');
  photoSort.addEventListener('change', () => writePref('photoSort', photoSort.value));
}

// The source tree is fetched once per page load; Back reuses it, the refresh button forces it.
export async function showSources(onPick, { force = false } = {}) {
  onPickSource = onPick;
  if (force || !cached) cached = await getSources();
  renderList();
}
