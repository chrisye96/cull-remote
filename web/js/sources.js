import { $, icon } from './dom.js';
import { getSources } from './api.js';
import { readPref, writePref } from './prefs.js';
import { buildTree, sortTree, filterTree, folderHint } from './tree.js';

let cached = null;
let onPickSource = () => {};
let query = '';
const expanded = readPref('expanded', {}); // node key -> true/false, only for nodes the user toggled

// While searching every match is shown; otherwise the user's choice wins and the
// first level is open by default.
const isOpen = (node) => (query.trim() ? true : expanded[node.key] ?? node.source.depth === 0);

function toggle(node) {
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

function row(node, siblings) {
  const { source } = node;
  const item = document.createElement('li');
  item.style.paddingInlineStart = `${source.depth * 16}px`;
  const line = document.createElement('div');
  line.className = 'source-row';

  if (node.children.length) {
    const open = isOpen(node);
    const twisty = document.createElement('button');
    twisty.type = 'button';
    twisty.className = 'twisty';
    twisty.setAttribute('aria-expanded', String(open));
    twisty.setAttribute('aria-label', open ? `折叠 ${source.name}` : `展开 ${source.name}`);
    twisty.append(icon(open ? 'chevron-down' : 'chevron-right'));
    twisty.addEventListener('click', () => toggle(node));
    line.append(twisty);
  } else {
    line.append(span('twisty-spacer', ''));
  }

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'source-main';
  main.append(span('source-name', source.name));
  const hint = folderHint(node, siblings);
  if (hint) main.append(span('source-hint', hint));
  if (source.kind !== 'set') main.append(span('source-count', String(source.count)));
  // Collection sets cannot be opened; their row just expands or collapses.
  main.addEventListener('click', () => (source.id ? onPickSource(source) : toggle(node)));
  line.append(main);

  item.append(line);
  return item;
}

function appendNodes(list, nodes) {
  for (const node of nodes) {
    list.append(row(node, nodes));
    if (node.children.length && isOpen(node)) appendNodes(list, node.children);
  }
}

function groupHeading(text) {
  const item = document.createElement('li');
  item.className = 'source-group';
  item.textContent = text;
  return item;
}

function renderList() {
  const list = $('source-list');
  list.textContent = '';
  if (!cached) return;
  const tree = filterTree(sortTree(buildTree(cached), readPref('folderSort', 'name-desc')), query);
  const groups = [
    ['文件夹', tree.filter((node) => node.source.kind === 'folder')],
    ['收藏夹', tree.filter((node) => node.source.kind !== 'folder')],
  ];
  for (const [title, nodes] of groups) {
    if (!nodes.length) continue;
    list.append(groupHeading(title));
    appendNodes(list, nodes);
  }
  if (!list.children.length) {
    const empty = document.createElement('li');
    empty.className = 'source-empty';
    empty.textContent = query.trim() ? '没有匹配的文件夹或收藏夹' : '这个目录里还没有文件夹或收藏夹';
    list.append(empty);
  }
}

// Bind the search box and the two sort selects. Call once at page load.
export function initSources() {
  $('source-search').addEventListener('input', (event) => {
    query = event.target.value;
    renderList();
  });
  const folderSort = $('folder-sort');
  folderSort.value = readPref('folderSort', 'name-desc');
  folderSort.addEventListener('change', () => {
    writePref('folderSort', folderSort.value);
    renderList();
  });
  const photoSort = $('photo-sort');
  photoSort.value = readPref('photoSort', 'time-asc');
  photoSort.addEventListener('change', () => writePref('photoSort', photoSort.value));
}

// The source tree is fetched once per page load; Back reuses it, the refresh button forces it.
export async function showSources(onPick, { force = false } = {}) {
  onPickSource = onPick;
  if (force || !cached) cached = await getSources();
  renderList();
}
