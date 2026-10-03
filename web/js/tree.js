import { collator } from './state.js';

// Rebuild the nested tree from the plugin's flat, depth-first list. `order` remembers
// Lightroom's own order (import order for folders) so it can be offered as a sort mode.
export function buildTree(sources) {
  const roots = [];
  const stack = [];
  sources.forEach((source, order) => {
    stack.length = source.depth;
    const parent = stack[source.depth - 1];
    // Collection sets have no id; key them by their place in the tree.
    const key = source.id ?? `${parent ? parent.key : 'set'}/${source.name}`;
    const node = { source, order, key, children: [] };
    (parent ? parent.children : roots).push(node);
    stack[source.depth] = node;
  });
  return roots;
}

const setsFirst = (a, b) => Number(b.source.kind === 'set') - Number(a.source.kind === 'set');
const byOrder = (a, b) => a.order - b.order;
const COMPARE = {
  'name-asc': (a, b) => setsFirst(a, b) || collator.compare(a.source.name, b.source.name) || byOrder(a, b),
  'name-desc': (a, b) => setsFirst(a, b) || collator.compare(b.source.name, a.source.name) || byOrder(a, b),
  import: byOrder,
};

// Sort siblings on every level; parents keep their children. Returns new arrays.
export function sortTree(nodes, mode) {
  const compare = COMPARE[mode] ?? COMPARE['name-desc'];
  return nodes
    .slice()
    .sort(compare)
    .map((node) => ({ ...node, children: sortTree(node.children, mode) }));
}

// Keep nodes whose name contains the query, plus the ancestors that lead to them.
export function filterTree(nodes, query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return nodes;
  const kept = [];
  for (const node of nodes) {
    const children = filterTree(node.children, needle);
    if (children.length || node.source.name.toLocaleLowerCase().includes(needle)) kept.push({ ...node, children });
  }
  return kept;
}

// Same-named folders on one level (two drives both holding "Photos") get their parent
// path as a hint. Folder ids are 'f:' + full path, so the hint is the path minus the name.
export function folderHint(node, siblings) {
  const { id, name } = node.source;
  if (!id?.startsWith('f:')) return '';
  const twins = siblings.filter((other) => collator.compare(other.source.name, name) === 0);
  if (twins.length < 2) return '';
  const path = id.slice(2);
  return path.slice(0, path.length - name.length);
}
