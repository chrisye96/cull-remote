// Writes every Cull Remote logo file: the SVG sources in docs/brand and the icons the page
// serves from web/icons. The shapes and colours of the logo live here and nowhere else.
//
//   node brand-assets.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { capHeight, loadFont, outlineText } from './outline-text.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const brand = path.join(repo, 'docs', 'brand');
const icons = path.join(repo, 'web', 'icons');

const inter = (weight) => loadFont(path.join(import.meta.dirname, 'node_modules', '@fontsource', 'inter', 'files', `inter-latin-${weight}-normal.woff`));
const bold = await inter(700);
const regular = await inter(400);

const gradient = (id, top, bottom) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
const BG = gradient('bg', '#242426', '#0c0c0d');
const PAPER = gradient('paper', '#f1f2f4', '#dcdee2');
const KEEPER = gradient('keeper', '#3abfeb', '#1da7d5');

// The three frames on a 100 unit square, back to front: right, middle (the keeper), left.
const FRAMES =
  '<rect x="50" y="24" width="42" height="28" rx="4" fill="url(#paper)"/>' +
  '<rect x="29" y="36" width="42" height="28" rx="4" fill="url(#keeper)"/>' +
  '<rect x="8" y="48" width="42" height="28" rx="4" fill="url(#paper)"/>';
// The frames alone fill this box.
const MARK_BOX = { x: 6, y: 22, w: 88, h: 56 };

const svg = (viewBox, width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">${body}</svg>\n`;

// Tile: the frames on the dark background. `radius` rounds the corners, `scale` shrinks the frames.
const tile = ({ radius = 0, scale = 1 } = {}) => {
  const frames = scale === 1 ? FRAMES : `<g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${FRAMES}</g>`;
  return svg('0 0 100 100', 512, 512, `<defs>${BG}${PAPER}${KEEPER}</defs><rect width="100" height="100" rx="${radius}" fill="url(#bg)"/>${frames}`);
};

const { x, y, w, h } = MARK_BOX;
const markBox = `${x} ${y} ${w} ${h}`;
const mark = svg(markBox, w * 4, h * 4, `<defs>${PAPER}${KEEPER}</defs>${FRAMES}`);

// Single colour versions leave a gap where a frame passes behind the one in front of it.
const GAPS =
  '<mask id="under-left" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/><rect x="5" y="45" width="48" height="34" rx="7" fill="#000"/></mask>' +
  '<mask id="under-middle" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/><rect x="26" y="33" width="48" height="34" rx="7" fill="#000"/></mask>';
const monoLine = svg(markBox, w * 4, h * 4, `<defs>${GAPS}</defs>` +
  '<g fill="none" stroke="currentColor" stroke-width="4.5">' +
  '<rect x="52.25" y="26.25" width="37.5" height="23.5" rx="1.75" mask="url(#under-middle)"/>' +
  '<rect x="10.25" y="50.25" width="37.5" height="23.5" rx="1.75"/></g>' +
  '<rect x="29" y="36" width="42" height="28" rx="4" fill="currentColor" mask="url(#under-left)"/>');
const monoTone = svg(markBox, w * 4, h * 4, `<defs>${GAPS}</defs><g fill="currentColor">` +
  '<rect x="50" y="24" width="42" height="28" rx="4" opacity=".45" mask="url(#under-middle)"/>' +
  '<rect x="29" y="36" width="42" height="28" rx="4" mask="url(#under-left)"/>' +
  '<rect x="8" y="48" width="42" height="28" rx="4" opacity=".45"/></g>');

// Wordmark as outlines: "Cull" bold, "Remote" regular, tracked in by 0.02 em, with the
// capitals centred on `centre`.
const TRACKING = -0.02;
function wordmark(left, centre, size) {
  const baseline = centre + capHeight(bold, size) / 2;
  const cull = outlineText(bold, 'Cull', { x: left, baseline, size, tracking: TRACKING });
  const remote = outlineText(regular, ' Remote', { x: cull.right + TRACKING * size, baseline, size, tracking: TRACKING });
  return { d: cull.d + remote.d, right: remote.right };
}

const SIZE = 29;
const GAP = 13;
// On dark backgrounds the frames stand on their own, 40 units high.
const markWidth = (40 * w) / h;
const onDark = wordmark(markWidth + GAP, 20, SIZE);
const lockupDark = svg(`0 0 ${Math.ceil(onDark.right)} 40`, Math.ceil(onDark.right) * 4, 160,
  `<defs>${PAPER}${KEEPER}</defs><svg viewBox="${markBox}" width="${markWidth.toFixed(2)}" height="40">${FRAMES}</svg><path d="${onDark.d}" fill="#f2f2f2"/>`);
// On light backgrounds the frames need the dark tile behind them, 52 units square.
const onLight = wordmark(52 + GAP, 26, SIZE);
const lockupLight = svg(`0 0 ${Math.ceil(onLight.right)} 52`, Math.ceil(onLight.right) * 4, 208,
  `<defs>${BG}${PAPER}${KEEPER}</defs><svg viewBox="0 0 100 100" width="52" height="52"><rect width="100" height="100" rx="22.4" fill="url(#bg)"/>${FRAMES}</svg><path d="${onLight.d}" fill="#111111"/>`);

// GitHub social preview, 1280 by 640: the dark lockup with one line under it.
const SCALE = 3.4;
const lockupWidth = onDark.right * SCALE;
const TAGLINE = 'Cull Lightroom Classic photos from your iPhone or iPad';
const taglineWidth = outlineText(regular, TAGLINE, { size: 30 }).right;
const social = svg('0 0 1280 640', 1280, 640,
  `<defs>${BG}${PAPER}${KEEPER}</defs><rect width="1280" height="640" fill="url(#bg)"/>` +
  `<g transform="translate(${((1280 - lockupWidth) / 2).toFixed(1)} 212) scale(${SCALE})"><svg viewBox="${markBox}" width="${markWidth.toFixed(2)}" height="40">${FRAMES}</svg><path d="${onDark.d}" fill="#f2f2f2"/></g>` +
  `<path d="${outlineText(regular, TAGLINE, { x: (1280 - taglineWidth) / 2, baseline: 432, size: 30 }).d}" fill="#8e8e93"/>`);

const png = (source, width) => new Resvg(source, { fitTo: { mode: 'width', value: width } }).render().asPng();

const square = tile();
const rounded = tile({ radius: 22.4 });
const files = [
  [brand, 'icon.svg', square],
  [brand, 'mark.svg', mark],
  [brand, 'mark-mono-line.svg', monoLine],
  [brand, 'mark-mono-tone.svg', monoTone],
  [brand, 'lockup-dark.svg', lockupDark],
  [brand, 'lockup-light.svg', lockupLight],
  [brand, 'social-preview.png', png(social, 1280)],
  [icons, 'favicon.svg', rounded],
  [icons, 'favicon-32.png', png(rounded, 32)],
  // iOS rounds the corners itself and shows black where an icon is transparent.
  [icons, 'apple-touch-icon.png', png(square, 180)],
  [icons, 'icon-192.png', png(rounded, 192)],
  [icons, 'icon-512.png', png(rounded, 512)],
  // Android crops a maskable icon to a circle 80% across, so the frames shrink to fit inside it.
  [icons, 'icon-maskable-512.png', png(tile({ scale: 0.78 }), 512)],
];
await mkdir(brand, { recursive: true });
await mkdir(icons, { recursive: true });
for (const [dir, name, data] of files) {
  await writeFile(path.join(dir, name), data);
  console.log(path.relative(repo, path.join(dir, name)));
}
