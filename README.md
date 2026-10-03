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

1. Open Lightroom Classic
2. `npm start`; the terminal prints your tailnet address and a QR code
3. Scan it with the iPhone or iPad (Tailscale must be on). In Safari, use "Add to Home Screen" for a full-screen app

## Controls

- Swipe left or right, or tap the left or right side of the photo, to move between photos
- Pick and reject jump to the next photo; stars and labels stay on the current one
- Tap an active flag, star or label again to clear it
- The top-right switch toggles between unmarked photos only and all photos

Deleting photos is out of scope on purpose: mark them as rejected on the phone, then use Lightroom's `Photo > Delete Rejected Photos` on the computer.

## Troubleshooting

- The page says Lightroom is not running: check that Lightroom is open and the plugin shows "Installed and running". If it still fails, use `Library > Plug-in Extras > Remote Cull: start bridge` to restart the plugin's connection
- Plugin log: `%TEMP%\lr-remote-cull-plugin.log` records start, exit and failed commands
- Opening `https://<machine>.ts.net` on the computer itself may time out when Windows does not resolve MagicDNS names; phones and tablets are not affected

## Development

- `npm test`
- Design: `docs/superpowers/specs/`
- Implementation plans: `docs/superpowers/plans/`
- Branches: `main` is stable, `dev` integrates, features on `feat/*`, fixes on `fix/*`

## Known limitations

- The photo list is a snapshot taken when you open a folder or collection. Changes made in Lightroom or on another device appear after going back and opening it again (automatic refresh is planned for the next version)
- Previews are cached in `.cache/previews/` and do not refresh after you re-edit a photo in Lightroom; delete that folder to refresh
- The "Lightroom is busy" rollback is covered by automated tests only: in practice dialogs such as Preferences and Export did not block writes, so it could not be reproduced by hand
- Only Lightroom's five default colour labels are recognised: photos labelled through a custom label set appear unmarked, and tapping a colour replaces that label
- Online only for now; offline caching is planned

## License

MIT
