# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

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
