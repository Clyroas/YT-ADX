# YT-ADX — Handover
**Status: complete and verified.** Single directory for this extension.
## Summary
- **Manifest (`manifest.json`):** MV3 (`minimum_chrome_version` 111), `permissions: ["declarativeNetRequest", "storage"]`, `host_permissions: ["*://*.youtube.com/*"]`, custom PNG icons (`icons/icon16.png`–`icon128.png`).
- **Network (`rules/ads.json`):** 5 DNR block rules (IDs 1, 11, 16, 17, 18); the `pagead` rules exclude `main_frame`. Playback telemetry (`/ptracking`, `/api/stats/delayplay`, `/api/stats/atr`) is not listed, so playback attestation never stalls streams.
- **Data (`src/inject.js`):** Strips ad keys and `{ adSlotRenderer, trackingParams }` wrappers, preserves `clarificationRenderer`, checks `localStorage.ytadclean_enabled`, caches XHR reads per instance, and posts `ytadclean-inject` counts. The `DsxYtAdStrip` debug handle is only exposed when `localStorage.ytadclean_debug === '1'`.
- **Player & Surface (`src/content.js`, `src/content.css`):** 750 ms tick, triggers strictly on `ad-showing` / `ad-interrupting`, relays stripped counts to `background.js`, syncs the master `enabled` switch to `localStorage` for the MAIN world, and shows the running total as an in-page HUD that removes itself after 5 s.
- **UI & Worker (`src/ui.html`, `src/ui.js`, `src/background.js`):** Dark glassmorphic popup/options panel, serialized storage counter, and DNR ruleset sync on install/startup/settings change with error handling.
## Verification
- Run `npm test` (`node --test test/verify.js`) and `npm run check`. Keep test artifacts (`test/cert.pem`, `test/media.wav`, bench/probe scripts) and Chrome's `_metadata/` out of the shipped package.