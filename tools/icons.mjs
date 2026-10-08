// Copies the Lucide icons the app uses into web/index.html, as one hidden sprite that the
// page refers to by fragment (`#i-name`). When the icons lived in a separate file, the whole
// library, 1,800 icons and half a megabyte, was downloaded again every time a script drew one.
//
// Usage, from the repository root, after adding or removing an icon:
//   node tools/icons.mjs
// It needs no dependencies of its own. `npm test` fails while the sprite and the icons in
// use differ.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = path.join(root, 'web', 'index.html');
export const START = '<!-- icons:start (written by tools/icons.mjs from lucide-static; do not edit by hand) -->';
export const END = '<!-- icons:end -->';

// name -> the icon's shapes on one line.
async function library() {
  const sprite = await readFile(path.join(root, 'node_modules', 'lucide-static', 'sprite.svg'), 'utf8');
  const symbols = new Map();
  for (const [, name, body] of sprite.matchAll(/<symbol id="([^"]+)" viewBox="0 0 24 24">([\s\S]*?)<\/symbol>/g)) {
    symbols.set(name, body.replace(/\s*\r?\n\s*/g, '').replace(/ \/>/g, '/>'));
  }
  return symbols;
}

// Every icon the app mentions: `#i-name` in the markup, and in the scripts any quoted Lucide
// name inside an icon(...) call, after `icon:`, or in the KIND_ICON map.
export async function usedIcons() {
  const symbols = await library();
  const html = await readFile(page, 'utf8');
  const blockAt = html.indexOf(START);
  const markup = blockAt === -1 ? html : html.slice(0, blockAt) + html.slice(html.indexOf(END));
  const names = new Set([...markup.matchAll(/href="#i-([a-z0-9-]+)"/g)].map((match) => match[1]));
  const dir = path.join(root, 'web', 'js');
  for (const file of await readdir(dir)) {
    const code = await readFile(path.join(dir, file), 'utf8');
    const spots = [...code.matchAll(/\bicon\(([^()]*)\)/g), ...code.matchAll(/\bicon: ('[a-z0-9-]+')/g), ...code.matchAll(/KIND_ICON = \{([^}]*)\}/g)];
    for (const [, text] of spots) {
      for (const [, name] of text.matchAll(/'([a-z0-9-]+)'/g)) if (symbols.has(name)) names.add(name);
    }
  }
  return [...names].sort();
}

// The sprite as it stands in the page, with `\n` line ends.
export async function spriteBlock(names) {
  const symbols = await library();
  const lines = names.map((name) => {
    if (!symbols.has(name)) throw new Error(`Lucide has no icon called "${name}"`);
    return `    <symbol id="i-${name}" viewBox="0 0 24 24">${symbols.get(name)}</symbol>`;
  });
  return [`  ${START}`, '  <svg id="icons" aria-hidden="true" hidden>', ...lines, '  </svg>', `  ${END}`].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = await readFile(page, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const html = raw.split(eol).join('\n');
  const names = await usedIcons();
  const block = await spriteBlock(names);
  const from = html.indexOf(`  ${START}`);
  const next = from === -1
    ? html.replace(/(<body[^>]*>\n)/, (open) => `${open}${block}\n`)
    : html.slice(0, from) + block + html.slice(html.indexOf(END) + END.length);
  if (next === html && from === -1) throw new Error('web/index.html has no <body> line to put the sprite after');
  await writeFile(page, next.split('\n').join(eol));
  console.log(`${names.length} icons in web/index.html: ${names.join(' ')}`);
}
