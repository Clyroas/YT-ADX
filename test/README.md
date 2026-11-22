# Bench

Real Chromium, real extension, no internet. The browser is launched with the unpacked extension and
told that `www.youtube.com` and `*.youtube.com` resolve to `127.0.0.1:8443`, where a local HTTPS
server answers with a page that mimics the parts of YouTube the extension touches. The extension
therefore runs on its own declared origin, with its content scripts active, while every byte comes
from the bench.

## Run

```bash
node bench-server.js 8443 &
node bench.js
```

`bench.js` needs `playwright-core` and a full Chromium build — the headless shell Playwright
downloads by default cannot load extensions, which is why it takes `executablePath` explicitly.
`--ignore-certificate-errors` is there because `cert.pem` is self-signed.

## What is proven

| Layer | Assertion |
| --- | --- |
| 1 network | a `fetch` to `ad.doubleclick.net` is refused (`ERR_BLOCKED_BY_CLIENT`), and the request that reaches the network log is the blocked one |
| 2 data, fetch | every ad renderer is gone from the feed response; the four real videos survive; unrelated data is untouched; ad entries are spliced out rather than left as `null` |
| 2 data, xhr | `adPlacements`, `adSlots`, `playerAds`, `adBreakHeartbeatParams` are gone from the player response; `videoDetails` and `streamingData` intact |
| 2 data, boot | both `ytInitialPlayerResponse` and `ytInitialData` are stripped as they are written, and their non-ad subtrees survive |
| 3 player | the skip button is clicked; an unskippable break is muted and run to its end; `pause()` is never called |
| 4 surface | the hide attribute is set, masthead and feed slots compute to `display:none`, and the ad's own overlay chrome is hidden while a break is marked |
| state | the counter moves, the rule set is enabled, the console is clean |

## Two things worth knowing

- The first run failed 21 of 23 assertions because the extension never loaded: Playwright's default
  headless shell has no extension support. `executablePath` points at the full Chromium build.
- A fake `currentTime` planted on the `<video>` element by the page is invisible to the content
  script. Instance-level property shadowing does not cross the JavaScript world boundary, so the
  isolated world kept reading the element's own `NaN` duration. The bench serves a real 90-second WAV
  instead, so the timeline is genuine and the seek is observable.
