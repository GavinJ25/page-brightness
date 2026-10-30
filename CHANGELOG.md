# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [1.2.2] - 2026-10-29

### Fixed
- Pages that set no background on `<html>` or `<body>` kept a bright white wherever nothing
  else covered it, such as a header with a transparent background (seen on Stripe's careers
  page). The browser paints its default page background behind `<html>`, so a filter on
  `<html>` never reached it. The extension now gives `<html>` that default colour as a real
  background, so it is dimmed, brightened or warmed with the rest of the page.
- This is applied only when neither `<html>` nor `<body>` has a background of its own, and is
  re-checked as the page changes (theme toggles, late-loading CSS). Pages that do set one are
  left exactly as before, and dark colour schemes stay dark.

### Testing
- Real-browser cases for each background setup (none, on `<body>`, on `<html>`, dark colour
  scheme, added or removed after load, toggled by a class) and unit tests for the check
  (101 checks in `npm test`). Verified against a page reproducing the reported structure; not
  yet confirmed on the live Stripe page itself.

## [1.2.1] - 2026-10-25

### Fixed
- Headers, menus and video players built from the browser's "top layer" (popovers, modal
  dialogs and fullscreen elements) stayed at full brightness, because a filter on `<html>`
  does not reach them. The same filter is now applied to them directly, including fullscreen
  video. Pages the extension hasn't touched still get no changes at all.

### Testing
- Added a real-browser regression test (`test/browser/`) that loads the unpacked extension into
  Chromium and checks screenshot pixels for fixed, sticky, popover, modal-dialog and
  fullscreen elements, and the toolbar badge.
- Added unit tests for the new stylesheet handling (91 checks in `npm test`).

## [1.2.0] - 2026-10-14

First public release.

### Features
- Brightness (10-200%) and warmth (0-100%, a sepia filter), per site or as a default for all sites.
- Toolbar badge showing the current brightness for the tab; purple while the night schedule is active.
- Night schedule: a time window (may cross midnight) with its own brightness and warmth,
  layered on top of each page's setting and aligned to the clock.
- Saved-sites list with per-site delete and "Clear all site settings".
- Site names are normalized (`www.` stripped; `localhost` and IP addresses keep their port).

### Behaviour and robustness
- Re-applies the filter if a page rewrites `<html style>`, backing off if a page keeps fighting it.
- Untouched pages receive no DOM writes and no messages.
- Slider writes are throttled so open tabs follow live without a write storm.
- Tabs left over from an extension update stop their timers instead of failing noisily.

### Platform
- Manifest V3 service worker only (Chrome, Edge, Brave). Firefox is not supported as packaged.
- Only the `storage` permission is requested. The popup asks the page's content script for its
  site name instead of reading the tab URL.
- Popup follows light/dark mode and has labelled, keyboard-accessible controls.

### Development history (unreleased)
- 1.0.x: per-site and global brightness; fixes for site overrides, reset scope and the
  "apply to all sites" checkbox.
- 1.1.x: warmth, night schedule, badge, saved sites, hostname normalization, undoable
  default-for-all-sites toggle, icons.
