# Tools

Scripts that maintain the repository but are not part of the app. They have their own `package.json`, so the app's `npm install` does not download their dependencies.

```bash
cd tools
npm install
```

| Script | What it does | Reusable elsewhere |
|---|---|---|
| `brand-assets.mjs` | Writes every logo file: the SVG sources in `docs/brand/` and the icons in `web/icons/` | No. The logo's shapes, colours and file list are written into it |
| `outline-text.mjs` | Turns a line of text into SVG path data, so the text keeps its shape without the font installed | Yes. Works with any `.ttf`, `.otf` or `.woff` file |
| `lightroom-terms.mjs` | Reads what Lightroom Classic calls flags, ratings, labels, folders and so on in each of its languages, and writes `lightroom-terms.json` | Yes, for any tool that talks about Lightroom. Edit the list of terms at the top |

## brand-assets.mjs

```bash
node brand-assets.mjs
```

The script is the single source of the logo. To change a colour or a proportion, edit it and run it again; never edit the files in `docs/brand/` or `web/icons/` by hand, because the next run overwrites them. The output is the same on every run, so after running it without changes `git status` shows nothing.

What each file is for:

| File | Use |
|---|---|
| `docs/brand/icon.svg` | The logo on its dark square, full bleed. Source of the iOS and Android icons |
| `docs/brand/mark.svg` | The three frames alone, for dark backgrounds |
| `docs/brand/mark-mono-tone.svg` | One colour in two strengths; the usual single-colour version |
| `docs/brand/mark-mono-line.svg` | One colour at one strength, for print or anywhere tints are not possible |
| `docs/brand/lockup-dark.svg`, `lockup-light.svg` | Logo with the name, for dark and for light backgrounds. The README header |
| `docs/brand/social-preview.png` | 1280 by 640. Uploaded by hand under the GitHub repository's Settings, Social preview |
| `web/icons/favicon.svg`, `favicon-32.png` | Browser tab |
| `web/icons/apple-touch-icon.png` | iOS Home Screen, 180 by 180, opaque and square because iOS rounds the corners itself |
| `web/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Android, listed in `web/manifest.webmanifest` |

The single-colour files use `currentColor`: pasted inline into a page they take the text colour, and loaded as an image they are black.

## lightroom-terms.mjs

```bash
node lightroom-terms.mjs
```

Needs Lightroom Classic installed; it has no other dependency. It looks in the usual install folders, or takes the `Resources` folder as its argument.

Lightroom keeps its interface text in one file per language, `Resources/<language>/TranslatedStrings_Lr_<locale>.txt`, one `"$$$/Key=Text"` per line, with the same keys in every language. The script looks up a short list of keys in all of them. English has no file because it is built into the program, so the English column was typed in by hand.

`lightroom-terms.json` is the result: 39 terms in the 15 languages Lightroom ships (German, Spanish, French, Italian, Japanese, Korean, Norwegian, Dutch, Polish, Brazilian Portuguese, Russian, Swedish, Thai, Simplified and Traditional Chinese). It is a reference for translators, not something the app loads.

How to use it when translating `web/js/strings.js`:

- A word that means the same here as in Lightroom takes Lightroom's wording: reject, the label colours, folders, collections, catalog, rating, capture time. A test compares the reject and pick words with this file
- Check what Lightroom already uses a word for before reusing it. German Lightroom calls a flag "Markierung" and a photo without one "Unmarkiert", so this app's wider idea of a mark (flag, stars or label) is "Kennzeichnung" there and its unmarked filter is "Offen"
- A button here is often shorter than Lightroom's menu entry. "Flag as Pick" becomes the name of the flag
- To add a term, find its key by searching one of Lightroom's files for the wording you see on screen, add it to `TERMS`, and run the script. It stops with a list if a key is missing, which is what a renamed key in a later Lightroom version looks like

## outline-text.mjs

```bash
node outline-text.mjs node_modules/@fontsource/inter/files/inter-latin-700-normal.woff "Cull" 100
```

Prints an SVG with the text as one path. From another script, import `loadFont` and `outlineText`; `outlineText` returns the path data and the x position where the text ends, which is what laying out two weights side by side needs.

It places glyphs one after another with pair kerning and optional tracking. That covers Latin text set left to right; it does not handle ligatures, right-to-left text or scripts that need shaping.

Fonts come from npm (`@fontsource/<name>`). Check the font's licence before using it in a logo: Inter is under the SIL Open Font License 1.1, which allows it.
