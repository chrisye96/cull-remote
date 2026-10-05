// Turns a line of text into SVG path data, so a logo keeps its shape on machines without
// the font. Works with any .ttf, .otf or .woff file; nothing here is specific to this project.
//
//   node outline-text.mjs <font file> <text> [size]
import { readFile } from 'node:fs/promises';
import opentype from 'opentype.js';

export async function loadFont(file) {
  const data = await readFile(file);
  return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

export const capHeight = (font, size) => (font.tables.os2.sCapHeight / font.unitsPerEm) * size;

// opentype.js throws on a font whose ccmp feature uses a lookup it does not support (Inter is
// one), so the glyphs are laid out by hand: advance, pair kerning, and tracking in em.
// ponytail: left to right only, no ligatures or complex scripts; those need a real shaper
// such as HarfBuzz.
export function outlineText(font, text, { x = 0, baseline = 0, size = 16, tracking = 0 } = {}) {
  const scale = size / font.unitsPerEm;
  const glyphs = [...text].map((char) => font.charToGlyph(char));
  let cursor = x;
  let d = '';
  glyphs.forEach((glyph, i) => {
    d += glyph.getPath(cursor, baseline, size).toPathData(2);
    const kerning = i + 1 < glyphs.length ? font.getKerningValue(glyph, glyphs[i + 1]) : 0;
    cursor += (glyph.advanceWidth + kerning) * scale + tracking * size;
  });
  // `right` is where the last glyph ends, without the tracking that would follow it.
  return { d, right: cursor - tracking * size };
}

if (import.meta.main) {
  const [file, text, size = '100'] = process.argv.slice(2);
  if (!file || !text) {
    console.error('usage: node outline-text.mjs <font file> <text> [size]');
    process.exit(1);
  }
  const font = await loadFont(file);
  const { d, right } = outlineText(font, text, { baseline: Number(size), size: Number(size) });
  console.log(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(right)} ${Math.ceil(Number(size) * 1.3)}"><path d="${d}"/></svg>`);
}
