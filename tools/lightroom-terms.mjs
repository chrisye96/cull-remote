// Reads the wording Lightroom Classic itself uses, in every language it ships, for the
// things this app also names: flags, ratings, colour labels, folders, collections and so
// on. Writes lightroom-terms.json, the reference for translators: a term that means the
// same thing here as in Lightroom should read the same.
//
//   node lightroom-terms.mjs [Lightroom's Resources folder]
//
// Lightroom keeps one text file per language, `"$$$/Some/Key=Translation"` per line, and
// the keys are the same in all of them. English is built into the program and has no
// file, so the English wording below was typed in by hand.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_FOLDERS = [
  'C:/Program Files/Adobe/Adobe Lightroom Classic/Resources',
  'D:/Program Files/Adobe/Adobe Lightroom Classic/Resources',
  '/Applications/Adobe Lightroom Classic/Adobe Lightroom Classic.app/Contents/Resources',
];

// name: [English wording, Lightroom's key]. `^1` in a value stands for a number or a name.
const TERMS = {
  'library': ['Library', 'AgLibraryModule/ModuleTitle'],
  'catalog': ['Catalog', 'AgLibrary/BrowsePanel/CatalogHeader'],
  'folders': ['Folders', 'AgLibrary/BrowsePanel/FolderViewHeader'],
  'collections': ['Collections', 'AgLibrary/BrowsePanel/CollectionsHeader'],
  'collection': ['Collection', 'AgCollectionSource/GenericName'],
  'collectionSet.new': ['New Collection Set', 'AgLibrary/Menu/File/New/NewCollectionSet'],
  'smartCollection.new': ['New Smart Collection', 'AgLibrary/Menu/File/New/NewSmartCollection'],

  'flag': ['Flag', 'AgLibrary/Filter/FlagLabel'],
  'flag.flagged': ['Flagged', 'AgLibrary/MetadataFormatters/Pick/Flagged'],
  'flag.unflagged': ['Unflagged', 'AgLibrary/MetadataFormatters/Pick/Unflagged'],
  'flag.rejected': ['Rejected', 'AgLibrary/MetadataFormatters/Pick/Rejected'],
  'flag.setPick': ['Flag as Pick', 'AgLibrary/ActionTitle/SetFlagged'],
  'flag.setReject': ['Set as Rejected', 'AgLibrary/ActionTitle/Rejected'],
  'flag.remove': ['Remove Flag', 'AgLibrary/ActionTitle/SetUnflagged'],
  'flag.pickFlag': ['Set Pick Flag', 'AgLibrary/Help/Shortcuts/SetPick'],
  'flag.rejectFlag': ['Set Reject Flag', 'AgLibrary/Help/Shortcuts/SetReject'],
  'flag.deleteRejected': ['Delete Rejected Photos', 'AgLibrary/Menu/Library/DeleteRejects'],

  'rating': ['Rating', 'AgLibrary/Filter/RatingLabel'],
  'rating.set': ['Set Rating to ^1', 'AgLibrary/Bezel/RatingSet'],
  'rating.oneStar': ['1 Star', 'AgLibrary/Menu/Photo/SetRating/Win/Rating1'],
  'rating.twoStars': ['2 Stars', 'AgLibrary/Menu/Photo/SetRating/Win/Rating2'],
  'rating.none': ['None', 'AgLibrary/Menu/Photo/SetRating/None'],

  'label': ['Color Label', 'AgLibrary/Grid/Tooltip/Label'],
  'label.red': ['Red', 'AgLibrary/Menu/Collection/Label/Red'],
  'label.yellow': ['Yellow', 'AgLibrary/Menu/Collection/Label/Yellow'],
  'label.green': ['Green', 'AgLibrary/Menu/Collection/Label/Green'],
  'label.blue': ['Blue', 'AgLibrary/Menu/Collection/Label/Blue'],
  'label.purple': ['Purple', 'AgLibrary/Menu/Collection/Label/Purple'],
  'label.none': ['None', 'AgLibrary/Menu/Collection/Label/None'],
  'label.remove': ['Remove ^1 Label', 'AgLibrary/Bezel/RemoveColorLabel'],

  'sort.captureTime': ['Capture Time', 'AgLibrary/Menu/View/Sort/CapturedTime'],
  'sort.addedOrder': ['Added Order', 'AgLibrary/Menu/View/Sort/ImportOrder'],
  'sort.fileName': ['File Name', 'AgLibrary/Menu/View/Sort/FileName'],

  'filters.enable': ['Enable Filters', 'AgLibrary/Menu/Library/EnableFilters'],
  'previews': ['Previews', 'AgLibrary/Menu/Library/Previews'],
  'previews.standard': ['Build Standard-Sized Previews', 'AgLibrary/Menu/Library/Previews/RenderStandardPreviews'],
  'import': ['Import Photos and Video', 'AgLibrary/Menu/File/ImportPhotos'],
  'pluginManager': ['Plug-in Manager', 'Application/Menu/File/PluginManager'],
  'undo': ['Undo', 'Application/Menu/Edit/Undo'],
};

// Menu entries carry a keyboard accelerator, `&File` or `文件(&F)`, and a trailing ellipsis.
// Some characters are written as a code point, such as the star `^U+2605`.
const clean = (text) => text
  .replace(/\^U\+([0-9A-F]{4})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
  .replace(/\s*\(&\w\)/g, '').replace(/&/g, '').replace(/\s*(\.\.\.|…)\s*$/, '').trim();

const folder = process.argv[2] ?? DEFAULT_FOLDERS.find((candidate) => existsSync(candidate));
if (!folder) {
  console.error("Lightroom's Resources folder was not found. Pass it as the argument.");
  process.exit(1);
}

const languages = {};
for (const entry of await readdir(folder, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = (await readdir(path.join(folder, entry.name))).find((name) => /^TranslatedStrings_Lr_.+\.txt$/.test(name));
  if (!file) continue;
  const table = new Map();
  for (const line of (await readFile(path.join(folder, entry.name, file), 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^"\$\$\$\/([^=]+)=(.*)"$/);
    if (match) table.set(match[1], match[2]);
  }
  // TranslatedStrings_Lr_pt_BR.txt -> pt-BR
  languages[file.replace(/^TranslatedStrings_Lr_|\.txt$/g, '').replace('_', '-')] = table;
}

const terms = {};
const missing = [];
for (const [name, [en, key]] of Object.entries(TERMS)) {
  terms[name] = { en };
  for (const lang of Object.keys(languages).sort()) {
    const text = languages[lang].get(key);
    if (text === undefined) missing.push(`${name} (${key}) in ${lang}`);
    else terms[name][lang] = clean(text);
  }
}

await writeFile(path.join(import.meta.dirname, 'lightroom-terms.json'), `${JSON.stringify(terms, null, 2)}\n`);
console.log(`${Object.keys(terms).length} terms in ${Object.keys(languages).length} languages: ${Object.keys(languages).sort().join(', ')}`);
if (missing.length) {
  console.error(`Missing, probably renamed in this Lightroom version:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
