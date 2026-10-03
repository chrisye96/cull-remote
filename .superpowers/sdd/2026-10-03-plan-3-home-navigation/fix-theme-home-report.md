# Fix report: theme and home review (Tasks 6 and 7)

Branch fix/theme-home-review, merged into dev with --no-ff.

All 11 findings applied as specified:
1. #badges line-height 1, #badges .part height 18px (stable pill height).
2. renderBadges only toggles pick/reject classes when a flag exists.
3. Landscape rail surface is var(--bg) with a left hairline; #back and #filter keep their own border/background (panel fill and #333 border on #111 read fine).
4. openViewer bumps lastPhoto (rememberCapped + writePref) after resume when a photo is showing; render() keeps its guarded write.
5. .row button:active no transform; .source-row:active background #26262a; .source-main/.twisty:active no transform.
6. Quiet flash uses Number(getComputedStyle(pull).opacity) > 0.5 with the armed class, read before hidePull().
7. aria-hidden on the five swatch check SVGs.
8. Landscape .home-side padding-top 12px when the status bar is visible.
9. .twisty and .source-main min-height 44px; .source-row stays 46px.
10. recentSources checks the limit before pushing; limit 0 test added (failed first, then passed).
11. pointerdown preventDefault on #search-clear; click handler kept.

Verification: npm test 72 pass, 0 fail; node --check passes on every web/js file. No browser or iOS check was done (no ops POSTs, no server touched).
