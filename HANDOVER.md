# YT-ADX â€” Handover
**Status: complete and verified.** Single directory at `F:\Project\extension\yt-adblock`.
## Summary
- **Manifest (`manifest.json`):** MV3 (`minimum_chrome_version` 111), `permissions: ["declarativeNetRequest", "storage"]`, `host_permissions: ["*://*://*"]`, custom PNG icons (`icons/icon16.png`â€“`icon128.png`).
- **Network (`rules/ads.json`):** 7 DNR block rules (`excludedResourceTypes: ["main_frame"]`); `/ptracking`, `/api/stats/delayplay`, and `/api/stats/atr` are excluded so playback attestation never stalls streams.
- **Data (`src/inject.js`):** Strips ad keys and `{ adSlotRenderer, trackingParams }` wrappers, preserves `clarificationRenderer`, checks `localStorage.ytadclean_enabled`, and posts `ytadclean-inject` counts.
- **Player & Surface (`src/content.js`, `src/content.css`):** Triggers strictly on `ad-showing` / `ad-interrupting`, relays stripped counts to `background.js`, and syncs the master `enabled` switch.
- **UI & Worker (`src/ui.html`, `src/ui.js`, `src/background.js`):** Dark glassmorphic popup/options panel, serialized storage counter, and live badge.
## Verification
- Run `node --test test\verify.js` (4/4 suites passing). Keep `.pem` keys outside the extension folder (`..\yt-adblock-test.pem`).