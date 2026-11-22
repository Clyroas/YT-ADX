# YT-ADX
An MV3 extension that removes YouTube's ad breaks and ad surfaces. Zero dependencies, no build step, no remote code.
## Layers
1. **Network (`rules/ads.json`):** Blocks DoubleClick, Syndication, and Google Ad Services hosts plus YouTube ad endpoints (`/api/stats/ads`, `/pagead/`, `/get_midroll_info`, `/pagead/lvz`), while keeping playback telemetry (`/ptracking`, `/api/stats/delayplay`, `/api/stats/atr`) intact.
2. **Data (`src/inject.js`):** Runs in the `MAIN` world at `document_start`, stripping ad breaks and promo slots from `fetch`, XHR, `ytInitialPlayerResponse`, and `ytInitialData`, while preserving `clarificationRenderer` context panels.
3. **Player (`src/content.js`):** Watches `#movie_player` on a 300 ms tick for `ad-showing` / `ad-interrupting`, clicks skip buttons, nudges unskippable ads to `duration - 0.1`, mutes/restores audio, and never calls `pause()`.
4. **Surface (`src/content.css`):** Hides ad slots and enforcement backdrops when `html[data-ytadclean-hide="1"]` is set, and suppresses ad chrome during active skips (`html[data-ytadclean-skip="1"]`).
## Install & Verify
- Load unpacked in `brave://extensions` or `chrome://extensions` from `F:\Project\extension\yt-adblock`.
- Run automated tests: `node --test test/verify.js`