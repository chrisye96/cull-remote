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

## outline-text.mjs

```bash
node outline-text.mjs node_modules/@fontsource/inter/files/inter-latin-700-normal.woff "Cull" 100
```

Prints an SVG with the text as one path. From another script, import `loadFont` and `outlineText`; `outlineText` returns the path data and the x position where the text ends, which is what laying out two weights side by side needs.

It places glyphs one after another with pair kerning and optional tracking. That covers Latin text set left to right; it does not handle ligatures, right-to-left text or scripts that need shaping.

Fonts come from npm (`@fontsource/<name>`). Check the font's licence before using it in a logo: Inter is under the SIL Open Font License 1.1, which allows it.
