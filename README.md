# Page Brightness (Local)

A small Chrome extension that dims or brightens web pages and adds a warm tint, per site or for all sites, with an optional night schedule. Everything stays on your machine: no network requests, no analytics, no remote code.

![Popup](docs/popup.png)

## Features

- **Brightness** from 10% to 200% and **warmth** (a sepia tint) from 0% to 100%.
- **Per-site settings**, plus a **default for all sites** that applies to every site without its own setting.
- **Night schedule**: a time window (it may cross midnight) with its own brightness and warmth. It layers on top of each page's setting: brightness multiplies and the stronger warmth wins. It switches on the clock minute.
- **Toolbar badge** showing the tab's current brightness (or `warm` when only warmth is set). It turns purple while the night schedule is active.
- **Saved sites** list with per-site delete and a two-click "Clear all site settings".
- **Site name normalization**: `www.example.com` and `example.com` share one setting. `localhost` and IP addresses keep their port, so `localhost:3000` and `localhost:8080` are separate.
- Follows your system light/dark theme, with labelled, keyboard-accessible controls.

## Install

Works in Chrome, Edge and Brave (Manifest V3).

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the **`extension/`** folder.

Or grab the zip from the [Releases](../../releases) page, unzip it, and load the unzipped folder the same way.

Firefox is not supported as packaged: the manifest uses a service worker, so Firefox would need its own manifest with `background.scripts`.

## Usage

Click the toolbar icon, then:

- Drag **Brightness** or **Warmth**. Dim 60%, Bright 130% and Reset are quick presets.
- Tick **Default for all sites** to edit the setting that applies to every site without its own. If no default exists yet, ticking it turns this site's values into the default, which affects every other site immediately. Unticking while the popup is still open undoes that; once the popup has been closed, the default stays (clear it with Reset while the box is ticked).
- Open **Night schedule** to set the window and the night brightness and warmth.
- Open **Saved sites** to review or delete per-site settings.

## Privacy

- Only the `storage` permission is requested. Settings live in `chrome.storage.local` on your machine.
- The content script runs on all pages (`<all_urls>`) solely to set a CSS `filter` on `<html>`. It sends the background script a short message (the badge text) and answers the popup with the site name it uses for settings.
- No network access, no remote code, no analytics.

## Known limitations

- The extension can't run on `chrome://` pages, the Chrome Web Store or the PDF viewer, and `file://` pages need "Allow access to file URLs" enabled on the extensions page. In those cases the popup says the page can't be adjusted.
- After the extension is updated or reloaded, tabs that were already open keep their last filter but stop following changes until you reload them. If the popup says "This page can't be adjusted" on an ordinary site, reload the tab.
- Pages may paint at full brightness for a frame before the saved setting loads.
- Warmth is a CSS sepia filter. It tints the page; it is not a blue-light filter and makes no health claims.
- The night schedule applies to every site; there is no per-site opt-out yet.
- Tested against a mocked `chrome` API. Real-browser checks (badge behaviour across navigation, fullscreen video, the night boundary) are worth doing before relying on it.

## Development

```
npm install
npm test        # 82 checks: jsdom + a mocked chrome API, plus lint rules for the manifest and popup
npm run package # builds dist/page-brightness-v<version>.zip from extension/
```

Layout:

```
extension/   the extension itself (load this folder unpacked)
  manifest.json  background.js  content.js  popup.html  popup.js  shared.js  icons/
test/run.js  test suite
```

- `shared.js` holds the pure logic (host keys, normalization, schedule, filter string) used by the content script, popup and background worker.
- Storage schema (`chrome.storage.local`): `global` and `site:<host>` hold `{b, w}` (brightness, warmth); `schedule` holds `{on, start, end, b, w}`. A bare number is read as a legacy brightness value.

## Authors

- **Gavin Darius J** (<gavindarius2005@gmail.com>): main author
- **Claude** (Anthropic): co-author

## License

[MIT](LICENSE) © 2026 Gavin Darius J
