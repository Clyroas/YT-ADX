# YT-ADX
An MV3 extension that removes YouTube's ad breaks and ad surfaces. Zero dependencies, no build step, no remote code.
## Layers
1. **Network (`rules/ads.json`):** 5 declarativeNetRequest block rules covering DoubleClick, Syndication, and Google Ad Services hosts, plus YouTube/Google `pagead` endpoints (`youtube.com/pagead/`, `youtube.com/pagead/lvz`, `google.com/pagead/`, `google.com.my/pagead/`). Playback telemetry (`/ptracking`, `/api/stats/delayplay`, `/api/stats/atr`) is not listed, so it is never blocked.
2. **Data (`src/inject.js`):** Runs in the `MAIN` world at `document_start`, stripping ad breaks and promo slots from `fetch`, XHR, `ytInitialPlayerResponse`, and `ytInitialData`, while preserving `clarificationRenderer` context panels. XHR reads are cached per instance so repeated access cannot double-count.
3. **Player (`src/content.js`):** Watches `#movie_player` on a 750 ms tick for `ad-showing` / `ad-interrupting`, clicks skip buttons, nudges unskippable ads to `duration - 0.1`, mutes/restores audio, and never calls `pause()`. The running total is shown as an in-page HUD (MV3 cannot paint a toolbar badge).
4. **Surface (`src/content.css`):** Hides ad slots and enforcement backdrops when `html[data-ytadclean-hide="1"]` is set, and suppresses ad chrome during active skips (`html[data-ytadclean-skip="1"]`).
## Install & Verify
- Load unpacked in `brave://extensions` or `chrome://extensions` from this folder.
- Run automated tests: `npm test` (or `node --test test/verify.js`), and syntax checks: `npm run check`.
- The shipped package is only `manifest.json`, `src/`, `rules/`, and `icons/` — `test/`, `_metadata/`, and other artifacts are excluded (see `.gitignore`).