# lr-remote-cull

English | [简体中文](README.zh-CN.md)

Cull Lightroom Classic photos from an iPhone or iPad: set pick/reject flags, star ratings and colour labels on the catalog that lives on your computer. Every write goes through Lightroom's official SDK; this tool never opens the catalog file directly, and each mark made on the phone shows up in Lightroom as a normal step you can undo with `Edit > Undo`.

## How it fits together

- `plugin/lr-remote-cull.lrplugin`: Lightroom plugin that long-polls the local companion server and runs its commands
- `server/`: companion server (Node.js 24) on your computer, listening on `127.0.0.1` only
- `web/`: the page you open on the phone or tablet
- `spike/`: the preview performance experiment from development; results in `docs/spike-results.md`

The page is published to your own devices with `tailscale serve` over HTTPS. It is reachable only inside your tailnet, never on the public internet. The same address works at home (Tailscale connects directly over your LAN) and away.

## One-time setup

1. `npm install`
2. Lightroom Classic: `File > Plug-in Manager > Add`, choose `plugin/lr-remote-cull.lrplugin`
3. Tailscale: sign the computer, iPhone and iPad in to the same account; in `https://login.tailscale.com/admin/dns` enable MagicDNS and HTTPS Certificates
4. `tailscale serve --bg 47800` (exposes only the web port to your tailnet; persists across reboots)

## Daily use

1. Open Lightroom Classic. On Windows the plugin starts the companion server by itself, in the background with no window, and the server leaves about a minute after Lightroom quits. This needs `node` on the PATH and the plugin left inside this folder (it finds the server beside itself). Its output goes to `.cache/server.log`
2. To pair a device, choose `Library > Plug-in Extras > Remote Cull: show address and QR code` in Lightroom. Your browser opens the settings page with the tailnet address and a QR code
3. Scan it with the iPhone or iPad (Tailscale must be on). In Safari, use "Add to Home Screen" for a full-screen app

On macOS, or whenever you prefer a terminal, run `npm start` after opening Lightroom: it prints the same address and QR code, and the plugin uses a server that is already running instead of starting another.

## Controls

- Swipe left or right, or tap the left or right side of the photo, to move between photos
- Swipe up to pick, swipe down to reject. While you drag, the photo follows your finger and a hint shows what releasing will do; let go early and nothing happens. A gesture never clears a flag: repeating it on a photo that already has that flag just moves on
- Tap the middle of the photo (the central half) to hide or show the mark pill and the filename tag; a short message confirms which
- Pick and reject jump to the next photo; stars and labels stay on the current one (settings can make every mark advance, or none)
- Tap an active flag, star or label again to clear it
- The filter switch shows both "unmarked" and "all" with live counts; switching keeps you on the current photo when it is in the new list
- Marks refresh from Lightroom automatically, so changes made on another device or undone in Lightroom show up within a few seconds
- In landscape the controls move to a slim rail on the right: pick over the stars, reject over the colour labels (on the left with left-hand mode in settings)
- On the home page, search filters folders and collections as you type (the × button clears it); sort folders by name or import order and choose the photo order (capture time or filename). Rows with children expand and collapse. In landscape the search and sort controls stay in a column on the left while the list scrolls on the right
- "最近打开" (recently opened) at the top of the home page lists the last five folders or collections opened on this device
- Each folder or collection remembers the photo you were on (per device), so going back and reopening it resumes there

## Working offline

- Each row in "最近打开" (recently opened) on the home page ends with a `缓存` (cache) button. It opens a dialog where you choose unmarked photos or all of them; the buttons show the photo count and estimated size. Keep the page in the foreground while it runs; if it is interrupted, tap again and it continues where it stopped. When the run completes the dialog closes, the button reads `已缓存 N`, and cached folders in the list get a small check next to their count. Opening it again shows how many photos are still missing and disables a choice that is fully cached. If caching is too slow, cancel, lower the preview quality in settings and continue: high-quality previews already downloaded stay in use and only the missing ones are fetched
- To cache a folder you have not opened yet, open it once and it appears under recently opened
- When the phone and the computer are on the same local network, opening a folder caches its unmarked photos automatically (500 at most by default; switch it off or change the limit in settings)
- When the computer cannot be reached, cached folders still browse and mark as usual. The top bar reads `离线，待同步 N 条` (offline, N marks waiting) and the mark pill shows a cloud icon; marks are stored on the device and survive closing the page
- Once the connection is back the marks sync to Lightroom in the order you made them. The same happens when Lightroom is closed: marks wait and are delivered when it opens
- Settings (top right of the home page): preview quality, whether a mark advances to the next photo, whether a folder opens on unmarked or all photos, left-hand mode, automatic caching, cache usage and clearing, connection details. Clearing the cache removes previews and photo lists only, never marks that have not synced

Deleting photos is out of scope on purpose: mark them as rejected on the phone, then use Lightroom's `Photo > Delete Rejected Photos` on the computer.

## Troubleshooting

- The page says Lightroom is not running: check that Lightroom is open and the plugin shows "Installed and running". If it still fails, use `Library > Plug-in Extras > Remote Cull: start bridge` to restart the plugin's connection
- Plugin log: `%TEMP%\lr-remote-cull-plugin.log` records start, exit and failed commands
- Opening `https://<machine>.ts.net` on the computer itself may time out when Windows does not resolve MagicDNS names; phones and tablets are not affected
- In Safari, swiping from the left screen edge is the browser's Back gesture and leaves the page. Open the app from the Home Screen icon to avoid it

## Development

- `npm test`
- To test without touching the server in daily use: with the environment variable `LRC_DEV=1`, `npm start` runs a second instance on `47810/47811`; `node spike/stand-in-plugin.mjs` then plays the Lightroom plugin (fake photos, marks kept in memory)
- Design: `docs/superpowers/specs/`
- Implementation plans: `docs/superpowers/plans/`
- Branches: `main` is stable, `dev` integrates, features on `feat/*`, fixes on `fix/*`

## Known limitations

- Marks refresh from Lightroom while a folder or collection is open (every 5 seconds, longer for very large folders); photos added to or removed from it appear after going back and opening it again
- Previews are cached in `.cache/previews/` and do not refresh after you re-edit a photo in Lightroom; delete that folder to refresh
- When Lightroom is busy a mark stays queued and is retried; this path is covered by automated tests only: in practice dialogs such as Preferences and Export did not block writes, so it could not be reproduced by hand
- Only Lightroom's five default colour labels are recognised: photos labelled through a custom label set appear unmarked, and tapping a colour replaces that label
- Offline data lives in the browser: Safari, Chrome and the Home Screen app each keep their own copy. Only the Home Screen app is exempt from iOS clearing that data after 7 days without a visit
- Offline use was verified item by item in Chrome on iOS (iPhone and iPad, 2026-10-04). Safari and the Home Screen app run on the same browser engine and are expected to behave the same, but have not been verified item by item
- With no network at all, a cold start takes a few seconds (the page shell and the connection probe each wait for a timeout)
- Previews cached on the device do not follow later edits in Lightroom either; clear the cache in settings and cache again

## License

MIT; see `LICENSE`. Third-party components are listed in `THIRD-PARTY.md`.

Adobe and Lightroom are either registered trademarks or trademarks of Adobe in the United States and/or other countries. This project is not affiliated with, endorsed by or sponsored by Adobe.
