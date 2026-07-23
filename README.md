# Rumble Toolkit

Browser extension to control **playback speed** and **video resolution**, and **download videos**, on [rumble.com](https://rumble.com), with a UI available in multiple languages.

## Features

- Set a custom playback speed (0.5x to 3x) that is automatically applied to every Rumble video you watch.
- Force a preferred video resolution (Auto, Highest available, Lowest available, or a specific target like 1080p/720p/480p/360p/240p) — useful on slow connections or to save data.
- Download button to save the video file directly — next to the channel's Follow button on a regular watch page, and next to the Comments action on the Shorts feed. Only shown for regular videos (VOD): live streams and live replays have no downloadable file behind them (they're served as a MediaSource/HLS stream), so the button stays hidden for those.
- Works across Rumble's single-page navigation: settings keep applying as you move from video to video without reloading the page.
- Small speed indicator shown under the player.
- Interface localized in: English, Português (Brasil), Español, 日本語, Русский and Français — automatically matches your browser's language, with English as fallback.

## Browser support

- Firefox
- Chrome
- Edge

## Installation (development / unpacked)

1. Clone or download this repository.
2. **Chrome / Edge**: go to `chrome://extensions` (or `edge://extensions`), enable "Developer mode", click "Load unpacked" and select this folder. It uses `manifest.json`.
3. **Firefox**: go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and select `manifest-firefox.json` (rename it to `manifest.json` in a copy of the folder, since Firefox expects that filename — see `firefox.bat`).

## Notes on resolution control

Rumble does not provide a public API to change video resolution, so the extension clicks the matching row in Rumble's own player quality menu on your behalf (matched by text, not by CSS class, since Rumble's menu markup has no classes at all). If Rumble changes how that menu is rendered, this feature may need updating; playback speed is unaffected either way since it's applied directly to the `<video>` element.

## Notes on the download button

Rumble has no "download" action of its own, so the button is inserted next to an existing one, using selectors picked for stability rather than styling class names (which tend to be build-hashed and change on every deploy):

- Watch page: anchored to `.js-media-subscribe` (the Follow button's functional JS-hook class).
- Shorts feed: anchored to the action rail item whose `<rum-icon name="shorts__comments">` identifies it as Comments (many Shorts cards are mounted at once, so each button is tied to its own card's `<video>`, not just "whatever video is on the page").

A video is only considered downloadable if its `duration` is finite (live streams report `Infinity`/`NaN`) and its `currentSrc` isn't a `blob:` URL (live streams and live replays are served as MediaSource/HLS, which has no real file behind it). If Rumble changes this markup, the button may stop appearing in one of these two places — it fails silently rather than throwing.

## Contributing translations

Translations live under `_locales/<locale>/messages.json` (one folder per language, using [Chrome's locale codes](https://developer.chrome.com/docs/extensions/reference/i18n/#locales)). Pull requests adding or improving a language are welcome.

## Building release packages

Run `chrome-edge.bat` or `firefox.bat` (Windows) — they call `build.ps1`, which packages the extension with the right manifest for each target and outputs a versioned zip under `dist/` (e.g. `dist/rumble-extension-chrome-1.0.0.zip`), ready to upload to the Chrome Web Store, Edge Add-ons, or Firefox Add-ons (AMO). No extra tools required (uses .NET's built-in zip APIs, with forward-slash paths so the archive extracts correctly on the stores' backends).

---

### Gostando da extensão? ❤️

Você pode apoiar doando Bitcoin:

```
bc1qrluvyjkatg9lezrxewe2vqh4ew6z9vl7xw0s6k
```

**Me siga**
- X: [@wiskton](https://x.com/wiskton)
- Twitch: [wiskton](https://twitch.tv/wiskton)
- Kick: [wiskton](https://kick.com/wiskton)

Desenvolvido por **wiskton**
