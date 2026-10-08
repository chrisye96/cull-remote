<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup-dark.svg">
    <img src="docs/brand/lockup-light.svg" alt="Cull Remote" width="320">
  </picture>
</p>

# Cull Remote for Adobe Lightroom Classic

English | [简体中文](README.zh-CN.md)

Cull Lightroom Classic photos from an iPhone or iPad: set pick and reject flags, star ratings and colour labels on the catalog that lives on your computer.

Every write goes through Lightroom's official SDK. This tool never opens the catalog file directly, and each mark made on the phone shows up in Lightroom as a normal step you can undo with `Edit > Undo`.

## What you need

- A Windows or macOS computer with Lightroom Classic 10 or later
- [Node.js](https://nodejs.org) 24 or later on that computer
- [Tailscale](https://tailscale.com) on the computer and on each phone or tablet, all signed in to the same account

## Set up once

1. Get the files: download **Source code (zip)** from the [latest release](https://github.com/chrisye96/cull-remote/releases/latest) and unzip it somewhere it can stay, or clone this repository. Lightroom runs the plug-in from inside this folder
2. In that folder, run `npm install`
3. In Lightroom Classic, choose `File > Plug-in Manager > Add` and select `plugin/cull-remote.lrplugin`
4. In the Tailscale admin console, on the [DNS page](https://login.tailscale.com/admin/dns), enable MagicDNS and HTTPS Certificates
5. Run `tailscale serve --bg 47800`. It exposes only the web port, only to your tailnet, and persists across reboots

## Every day

1. Open Lightroom Classic.
   - On Windows the plug-in starts the companion server by itself, in the background with no window. The server leaves about a minute after Lightroom quits. This needs `node` on the PATH and the plug-in left inside this folder, because it finds the server beside itself. The server's output goes to `.cache/server.log`
   - On macOS, or whenever you prefer a terminal, run `npm start` after opening Lightroom. The plug-in uses a server that is already running instead of starting another
2. To pair a device, choose `Library > Plug-in Extras > Cull Remote: show address and QR code` in Lightroom. Your browser opens the settings page with the tailnet address and a QR code. `npm start` prints the same address and code in the terminal
3. Scan the code with the iPhone or iPad, with Tailscale switched on. In Safari, use "Add to Home Screen" for a full-screen app

The same address works at home and away. At home Tailscale connects directly over your local network.

## Controls

### In the viewer

| Do this | To |
|---|---|
| Swipe left or right, or tap the left or right side of the photo | Move between photos |
| Swipe up | Pick |
| Swipe down | Reject |
| Tap a flag, a star or a colour | Set it; tap an active one again to clear it |
| Tap the middle of the photo (the central half) | Hide or show everything laid over the photo: the mark pill, the filename tag and the photo info |
| Tap the photo info panel | Fold it down to an icon; tap the icon to open it again |
| Tap the grid button beside Back | Open the thumbnail grid. The button then shows a single photo; tap it again to return |
| Tap "Unmarked" or "All" | Switch the filter; both show live counts |
| Tap the funnel beside the grid button | Choose a mark filter: picks, rejects, a minimum rating or one colour label |

- While you drag up or down, the photo follows your finger and a hint shows what releasing will do. Let go early and nothing happens
- A gesture never clears a flag: repeating it on a photo that already has that flag just moves on
- Pick and reject jump to the next photo; stars and labels stay on the current one. Settings can make every mark advance, or none
- Switching the filter keeps you on the current photo when it is in the new list
- A mark filter shows one kind of photo at a time, for a second or third pass. Its menu lists how many photos each choice would show. While one is on, the funnel turns into that mark; tap "Unmarked" or "All" to leave it
- Marks refresh from Lightroom automatically, so changes made on another device or undone in Lightroom show up within a few seconds
- In landscape the controls move to a slim rail on the right: pick over the stars, reject over the colour labels. Left-hand mode in settings puts the rail on the left
- Each folder or collection remembers the photo you were on, per device, so going back and reopening it resumes there
- The photo info panel shows a histogram of the preview, then shutter speed, aperture and ISO, then focal length and lens. It lies over the top right corner of the photo area; on a tablet in landscape it sits in the rail instead and covers nothing. Settings choose which of the three parts appear

### Thumbnail grid

The grid gives an overview of a folder and a way to jump to a photo. It only shows: marking is done on the single photo.

- It lists the same photos as the viewer and follows the "Unmarked" or "All" filter
- Each thumbnail carries the photo's marks: a flag or a reject sign, a star with its count, and the colour label as a strip along the bottom edge. Rejected photos are dimmed
- Tap a thumbnail to open that photo. Back in the grid, the photo you came from is outlined and scrolled into view
- The grid button takes you back to the single photo
- Thumbnails load as they scroll into view. In a folder Lightroom has no previews for yet, each one takes a few seconds, and the file name stands in until it arrives

### With a keyboard

The viewer takes the keys Lightroom uses.

| Key | Does |
|---|---|
| Left and right arrows | Previous and next photo |
| `P` | Pick |
| `X` | Reject |
| `U` | Remove the flag |
| `1` to `5` | Set the star rating |
| `0` | Clear the rating |
| `6` to `9` | Red, yellow, green and blue label |
| `G` | Open or close the thumbnail grid |
| `Esc` | Leave the grid |

While the grid is open the marking keys do nothing.

### On the home page

- Search filters folders and collections as you type; the × button clears it
- Sort folders by name or by import order, and choose the photo order: capture time or filename
- Rows with children expand and collapse
- "Recently opened" at the top lists the last five folders or collections opened on this device
- In landscape the search and sort controls stay in a column on the left while the list scrolls on the right

### Settings

Settings is at the top right of the home page: language, preview quality, whether a mark advances to the next photo, whether a folder opens on unmarked or all photos, left-hand mode, which parts of the photo info to show, automatic caching, cache usage and clearing, and connection details.

## Languages

The interface follows the device language: English, Simplified Chinese, Japanese, German, French or Spanish. Settings has a switch for it.

Flags, ratings, labels, folders and collections are named as Lightroom names them in each language.

## Working offline

**Caching a folder**

- Each row under "Recently opened" on the home page ends with a `Cache` button. It opens a dialog where you choose unmarked photos or all of them; the buttons show the photo count and the estimated size
- Keep the page in the foreground while it runs. If it is interrupted, tap again and it continues where it stopped
- When the run completes the dialog closes, the button reads `Cached N`, and cached folders in the list get a small check next to their count
- Opening the dialog again shows how many photos are still missing and disables a choice that is fully cached
- If caching is too slow, cancel, lower the preview quality in settings and continue. High-quality previews already downloaded stay in use and only the missing ones are fetched
- To cache a folder you have not opened yet, open it once and it appears under "Recently opened"

**Automatic caching**

When the phone and the computer are on the same local network, opening a folder caches its unmarked photos automatically, 500 at most by default. Settings can switch this off or change the limit.

**While the computer cannot be reached**

- Cached folders still browse and mark as usual
- The top bar reads `Offline, N waiting to sync` and the mark pill shows a cloud icon
- Marks are stored on the device and survive closing the page
- Once the connection is back the marks sync to Lightroom in the order you made them. The same happens when Lightroom is closed: marks wait and are delivered when it opens

Clearing the cache in settings removes previews and photo lists only, never marks that have not synced.

## Deleting photos

Deleting is out of scope on purpose. Mark photos as rejected on the phone, then use Lightroom's `Photo > Delete Rejected Photos` on the computer.

## Troubleshooting

- **The page says Lightroom is not running.** Check that Lightroom is open and the plug-in shows "Installed and running". If it still fails, use `Library > Plug-in Extras > Cull Remote: start bridge` to restart the plug-in's connection
- **Plug-in log.** `%TEMP%\cull-remote-plugin.log` records start, exit and failed commands
- **The address times out on the computer itself.** Opening `https://<machine>.ts.net` there may time out when Windows does not resolve MagicDNS names. Phones and tablets are not affected
- **A swipe leaves the page in Safari.** Swiping from the left screen edge is the browser's Back gesture. Open the app from the Home Screen icon to avoid it

## How it fits together

| Folder | What it is |
|---|---|
| `plugin/cull-remote.lrplugin` | Lightroom plug-in that long-polls the local companion server and runs its commands |
| `server/` | Companion server (Node.js 24) on your computer, listening on `127.0.0.1` only |
| `web/` | The page you open on the phone or tablet |
| `tools/` | Scripts that generate the logo files and the Lightroom glossary; see `tools/README.md` |
| `spike/` | The preview performance experiment from development; results in `docs/spike-results.md` |

The page is published to your own devices with `tailscale serve` over HTTPS. It is reachable only inside your tailnet, never on the public internet.

## Development

- Run the tests with `npm test`
- To test without touching the server in daily use, set the environment variable `LRC_DEV=1`: `npm start` then runs a second instance on ports `47810` and `47811`, and `node spike/stand-in-plugin.mjs` plays the Lightroom plug-in with fake photos and marks kept in memory
- All interface text is in `web/js/strings.js`, one table per language with English as the reference. To add a language, add a table there and its name to `LANGUAGES` in `web/js/i18n.js`. `npm test` fails while a key or a placeholder is missing
- `tools/lightroom-terms.json` lists what Lightroom calls each thing in all of its languages
- The logo and icons are generated: `docs/brand/` and `web/icons/` come from a script described in `tools/README.md`
- Branches: `main` is stable, `dev` integrates, features go on `feat/*` and fixes on `fix/*`

## Known limitations

**Marks and previews**

- Marks refresh from Lightroom while a folder or collection is open, every 5 seconds and less often for very large folders. Photos added to or removed from it appear after going back and opening it again
- Previews are cached on the computer in `.cache/previews/` and do not refresh after you re-edit a photo in Lightroom. Delete that folder to refresh them
- Previews cached on the device do not follow later edits in Lightroom either. Clear the cache in settings and cache again
- Only Lightroom's five default colour labels are recognised. Photos labelled through a custom label set appear unmarked, and tapping a colour replaces that label
- When Lightroom is busy a mark stays queued and is retried. This path is covered by automated tests only: in practice dialogs such as Preferences and Export did not block writes, so it could not be reproduced by hand
- The histogram is counted from the preview on screen, not from the raw file, and from a reduced copy of it, so a handful of clipped pixels may not show
- A folder cached for offline use by an earlier version shows no exposure or lens details until it has been opened once with a connection
- Grid thumbnails come from Lightroom larger than asked for, about 60 KB each, which adds up on mobile data

**Offline**

- Offline data lives in the browser: Safari, Chrome and the Home Screen app each keep their own copy. Only the Home Screen app is exempt from iOS clearing that data after 7 days without a visit
- Offline use was verified item by item in Chrome on iOS (iPhone and iPad, 2026-10-04). Safari and the Home Screen app run on the same browser engine and are expected to behave the same, but have not been verified item by item
- With no network at all, a cold start takes a few seconds, because the page shell and the connection probe each wait for a timeout
- Thumbnails are not cached themselves. Offline, the grid is meant to draw from the cached previews; this has not been verified on a device yet

**Platforms and languages**

- Android is untested: the page ships a web manifest and icons so Chrome can install it to the home screen, but nothing has been tried on an Android device
- Japanese, German, French and Spanish were machine translated. The words shared with Lightroom were taken from Lightroom itself; the sentences around them have not been read by a native speaker, and corrections are welcome

## License

MIT; see `LICENSE`. Third-party components are listed in `THIRD-PARTY.md`.

Adobe and Lightroom are either registered trademarks or trademarks of Adobe in the United States and/or other countries. This project is not affiliated with, endorsed by or sponsored by Adobe.
