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
// The set of duplicated names is computed once per siblings array, so a siblings array
// must not be mutated after its first folderHint call.
const duplicatesCache = new WeakMap();

function duplicatedNames(siblings) {
  let cached = duplicatesCache.get(siblings);
  if (!cached) {
    const seen = new Set();
    cached = new Set();
    for (const { source } of siblings) {
      if (!source.id?.startsWith('f:')) continue;
      const lower = source.name.toLowerCase();
      if (seen.has(lower)) cached.add(lower);
      seen.add(lower);
    }
    duplicatesCache.set(siblings, cached);
  }
  return cached;
}

export function folderHint(node, siblings) {
  const { id, name } = node.source;
  if (!id?.startsWith('f:')) return '';
  if (!duplicatedNames(siblings).has(name.toLowerCase())) return '';
  const path = id.slice(2);
  return path.endsWith(name) ? path.slice(0, path.length - name.length) : '';
}

// The sources opened most recently on this device, newest first. `lastPhoto` maps a
// source id to the photo last shown there, in least-recent-first insertion order.
export function recentSources(sources, lastPhoto, limit) {
  const byId = new Map(sources.filter((source) => source.id).map((source) => [source.id, source]));
  const recent = [];
  for (const id of Object.keys(lastPhoto ?? {}).reverse()) {
    if (byId.has(id)) recent.push(byId.get(id));
    if (recent.length === limit) break;
  }
  return recent;
}
