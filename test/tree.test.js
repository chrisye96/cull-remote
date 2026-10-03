import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, sortTree, filterTree, folderHint } from '../web/js/tree.js';

const flat = () => [
  { id: 'f:F:\\Photos', kind: 'folder', name: 'Photos', depth: 0, count: 0 },
  { id: 'f:F:\\Photos\\25.01.17_Canyon', kind: 'folder', name: '25.01.17_Canyon', depth: 1, count: 10 },
  { id: 'f:F:\\Photos\\250704_Stampede', kind: 'folder', name: '250704_Stampede', depth: 1, count: 20 },
  { id: 'f:F:\\Photos\\250704_Stampede\\raw', kind: 'folder', name: 'raw', depth: 2, count: 5 },
  { id: 'f:F:\\Photos\\24.09.15_zoo', kind: 'folder', name: '24.09.15_zoo', depth: 1, count: 7 },
  { id: 'f:D:\\Photos', kind: 'folder', name: 'Photos', depth: 0, count: 3 },
  { kind: 'set', name: '智能收藏夹', depth: 0, count: 0 },
  { id: 'c:14', kind: 'collection', name: '五星级', depth: 1, count: 0 },
  { id: 'c:99', kind: 'collection', name: 'best', depth: 0, count: 6 },
];
const names = (nodes) => nodes.map((node) => node.source.name);

test('buildTree nests by depth and keys every node', () => {
  const roots = buildTree(flat());
  assert.deepEqual(names(roots), ['Photos', 'Photos', '智能收藏夹', 'best']);
  assert.deepEqual(names(roots[0].children), ['25.01.17_Canyon', '250704_Stampede', '24.09.15_zoo']);
  assert.deepEqual(names(roots[0].children[1].children), ['raw']);
  assert.deepEqual(names(roots[2].children), ['五星级']);
  assert.equal(roots[0].key, 'f:F:\\Photos');
  assert.equal(roots[2].key, 'set/智能收藏夹');
  assert.equal(roots[3].children.length, 0);
});

test('sortTree orders siblings per level and leaves the input alone', () => {
  const roots = buildTree(flat());
  const desc = sortTree(roots, 'name-desc');
  assert.deepEqual(names(desc[0].children), ['250704_Stampede', '25.01.17_Canyon', '24.09.15_zoo']);
  const asc = sortTree(roots, 'name-asc');
  assert.deepEqual(names(asc[0].children), ['24.09.15_zoo', '25.01.17_Canyon', '250704_Stampede']);
  const imported = sortTree(roots, 'import');
  assert.deepEqual(names(imported[0].children), ['25.01.17_Canyon', '250704_Stampede', '24.09.15_zoo']);
  assert.deepEqual(names(roots[0].children), ['25.01.17_Canyon', '250704_Stampede', '24.09.15_zoo']);
});

test('sortTree compares names naturally and keeps collection sets first', () => {
  const roots = buildTree([
    { id: 'f:a10', kind: 'folder', name: 'a10', depth: 0, count: 1 },
    { id: 'f:a2', kind: 'folder', name: 'a2', depth: 0, count: 1 },
    { id: 'c:1', kind: 'collection', name: 'aaa', depth: 0, count: 1 },
    { kind: 'set', name: 'zzz', depth: 0, count: 0 },
  ]);
  assert.deepEqual(names(sortTree(roots, 'name-asc')), ['zzz', 'a2', 'a10', 'aaa']);
  assert.deepEqual(names(sortTree(roots, 'name-desc')), ['zzz', 'aaa', 'a10', 'a2']);
  assert.deepEqual(names(sortTree(roots, 'unknown-mode')), ['zzz', 'aaa', 'a10', 'a2']);
});

test('filterTree keeps matches with their ancestors, ignoring case', () => {
  const roots = buildTree(flat());
  const hit = filterTree(roots, 'STAM');
  assert.deepEqual(names(hit), ['Photos']);
  assert.deepEqual(names(hit[0].children), ['250704_Stampede']);
  assert.deepEqual(hit[0].children[0].children, []);
  assert.deepEqual(names(filterTree(roots, 'photos')), ['Photos', 'Photos']);
  assert.deepEqual(filterTree(roots, 'no such folder'), []);
  assert.equal(filterTree(roots, '   '), roots);
});

test('folderHint shows the parent path only for same-named siblings', () => {
  const roots = buildTree(flat());
  assert.equal(folderHint(roots[0], roots), 'F:\\');
  assert.equal(folderHint(roots[1], roots), 'D:\\');
  assert.equal(folderHint(roots[3], roots), '');
  assert.equal(folderHint(roots[0].children[0], roots[0].children), '');
  const cased = buildTree([
    { id: 'f:C:\\A\\Linkedin Photos', kind: 'folder', name: 'Linkedin Photos', depth: 0, count: 1 },
    { id: 'f:D:\\B\\LinkedIn Photos', kind: 'folder', name: 'LinkedIn Photos', depth: 0, count: 1 },
  ]);
  assert.equal(folderHint(cased[0], cased), 'C:\\A\\');
  assert.equal(folderHint(cased[1], cased), 'D:\\B\\');
});
