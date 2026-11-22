// Local stand-in for the YouTube surface the extension touches.
// Serves an HTTPS page that mimics ytd-* renderers, the player element, and the two JSON endpoints
// the extension rewrites: a feed response and a player response.
const https = require('https');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const options = {
  key: fs.readFileSync(path.join(here, 'key.pem')),
  cert: fs.readFileSync(path.join(here, 'cert.pem')),
};

const feedResponse = {
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  { videoRenderer: { videoId: 'real-a', title: { simpleText: 'First real result' } } },
                  { adSlotRenderer: { adSlotMetadata: { slotId: 'slot-1' }, fulfillmentContent: { ads: [1] } } },
                  { videoRenderer: { videoId: 'real-b', title: { simpleText: 'Second real result' } } },
                  { promotedSparklesWebRenderer: { title: { simpleText: 'Buy this' } } },
                  { videoRenderer: { videoId: 'real-c', title: { simpleText: 'Third real result' } } },
                  { displayAdRenderer: { adLayoutMetadata: { layoutId: 'display-1' } } },
                  { inFeedAdLayoutRenderer: { layoutId: 'infeed-1' } },
                ],
              },
            },
            {
              itemSectionRenderer: {
                contents: [
                  { videoRenderer: { videoId: 'real-d', title: { simpleText: 'Fourth real result' } } },
                  { compactPromotedVideoRenderer: { videoId: 'promoted' } },
                ],
              },
            },
          ],
        },
      },
    },
  },
  trackingParams: 'keep-me',
};

const playerResponse = {
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: 'realvideo', title: 'A real video', lengthSeconds: '120' },
  streamingData: { formats: [{ itag: 18 }] },
  adPlacements: [
    { adPlacementRenderer: { renderer: { adBreakServiceRenderer: { preloadMilliseconds: '25000' } } } },
  ],
  adSlots: [{ adSlotRenderer: { adSlotMetadata: { slotId: 'mid-1' } } }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adBreakHeartbeatParams: 'heartbeat-token-should-be-gone',
};

function json(res, body) {
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Test bench</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div id="masthead-ad"><p>masthead ad</p></div>
<div id="page">
  <div id="movie_player" class="html5-video-player">
    <video id="video" muted playsinline preload="auto" src="/media.wav" width="360" height="200"></video>
    <div class="ytp-ad-module">
      <div class="ytp-ad-player-overlay" style="display:none">
        <div class="ytp-ad-text">ad</div>
        <button class="ytp-skip-ad-button" type="button">Skip</button>
      </div>
    </div>
  </div>
  <ytd-ad-slot-renderer><p>ad slot in the feed</p></ytd-ad-slot-renderer>
  <div id="feed"></div>
  <pre id="log"></pre>
</div>
<script>
  // YouTube writes its player response as a global before the player boots. The bench does it from
  // a script tag, which is the same order the real page uses.
  window.ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};
  window.ytInitialData = ${JSON.stringify({ contents: { adSlots: [{ id: 'x' }], keep: 'yes' } })};
</script>
<script src="/app.js"></script>
</body>
</html>`;

const appJs = `
const log = (line) => {
  const node = document.getElementById('log');
  node.textContent += line + '\\n';
};
window.__bench = { log };

// One request each way, at the two endpoints the extension wraps.
async function run() {
  const feed = await fetch('/youtubei/v1/search?prettyPrint=false', { method: 'POST' });
  const feedJson = await feed.json();
  window.__feedResult = feedJson;
  log('fetch feed slots: ' + countAds(feedJson));

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/youtubei/v1/player?prettyPrint=false');
  xhr.onload = () => {
    window.__playerResult = JSON.parse(xhr.responseText);
    log('xhr player ad keys: ' + adKeys(window.__playerResult).join(',') || 'none');
    window.__benchReady = true;
  };
  xhr.send();

  log('boot player ad keys: ' + adKeys(window.ytInitialPlayerResponse).join(','));
  log('boot data ad keys: ' + adKeys(window.ytInitialData).join(','));

  // Layer 1: a request to an ad host must be refused by the declarative rules before it leaves.
  try {
    await fetch('https://ad.doubleclick.net/ddm/ad?x=1', { mode: 'no-cors' });
    window.__adHostResult = 'reached';
  } catch (err) {
    window.__adHostResult = 'blocked: ' + (err && err.name ? err.name : String(err));
  }
}

function adKeys(obj) {
  const keys = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  return keys.filter((k) => Object.prototype.hasOwnProperty.call(obj || {}, k));
}

function countAds(feed) {
  const text = JSON.stringify(feed);
  const markers = ['adSlotRenderer', 'promotedSparklesWebRenderer', 'displayAdRenderer', 'inFeedAdLayoutRenderer', 'compactPromotedVideoRenderer'];
  return markers.filter((m) => text.includes(m));
}

// A break the player announces the way YouTube does: the class flips and the overlay appears.
window.__benchStartAd = () => {
  const player = document.getElementById('movie_player');
  const overlay = player.querySelector('.ytp-ad-player-overlay');
  overlay.style.display = '';
  player.classList.add('ad-showing');
  const video = document.getElementById('video');
  video.currentTime = 0;
  pauseCalls = 0;
  window.__adStart = Date.now();
};

// Counts JS-issued pause() calls only: the element's own end-of-media state does not go through
// this prototype, so a zero here means the extension never paused the ad.
const rawPause = HTMLMediaElement.prototype.pause;
let pauseCalls = 0;
HTMLMediaElement.prototype.pause = function () {
  pauseCalls += 1;
  return rawPause.apply(this, arguments);
};
window.__pauseCalls = () => pauseCalls;

window.__benchState = () => {
  const player = document.getElementById('movie_player');
  const video = document.getElementById('video');
  return {
    adShowing: player.classList.contains('ad-showing'),
    muted: video.muted,
    currentTime: video.currentTime,
    paused: video.paused,
    pauseCalls: pauseCalls,
    duration: video.duration,
    skipClicked: window.__skipClicked === true,
    skipAttr: document.documentElement.getAttribute('data-ytadclean-skip'),
    hideAttr: document.documentElement.getAttribute('data-ytadclean-hide'),
    mastheadDisplay: getComputedStyle(document.getElementById('masthead-ad')).display,
    adSlotDisplay: getComputedStyle(document.querySelector('ytd-ad-slot-renderer')).display,
    overlayDisplay: getComputedStyle(document.querySelector('.ytp-ad-player-overlay')).display,
  };
};

// Records that the skip button was pressed, the way the page would notice it.
document.querySelector('.ytp-skip-ad-button').addEventListener('click', () => {
  window.__skipClicked = true;
  document.getElementById('movie_player').classList.remove('ad-showing');
  document.querySelector('.ytp-ad-player-overlay').style.display = 'none';
  log('skip pressed by page handler');
});

run();
`;

const styles = `body{font:14px system-ui;margin:0;padding:20px}
#masthead-ad{height:60px;background:#c4302b;color:#fff;display:flex;align-items:center;justify-content:center}
ytd-ad-slot-renderer{display:block;height:80px;background:#eee}
#movie_player{width:360px;height:200px;background:#111;position:relative}
#log{white-space:pre-wrap;font-size:12px;background:#f6f6f6;padding:8px}`;

const server = https.createServer(options, (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/youtubei/v1/search') return json(res, JSON.stringify(feedResponse));
  if (url === '/youtubei/v1/player') return json(res, JSON.stringify(playerResponse));
  if (url === '/media.wav') {
    const file = fs.readFileSync(path.join(here, 'media.wav'));
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': file.length, 'accept-ranges': 'bytes' });
    return res.end(file);
  }
  if (url === '/styles.css') {
    res.writeHead(200, { 'content-type': 'text/css' });
    return res.end(styles);
  }
  if (url === '/app.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    return res.end(appJs);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
});

const port = Number(process.argv[2] || 8443);
server.listen(port, '0.0.0.0', () => {
  console.log(`bench listening on https://www.youtube.com:${port}`);
  console.log('expected feed ads (before): adSlotRenderer,promotedSparklesWebRenderer,displayAdRenderer,inFeedAdLayoutRenderer,compactPromotedVideoRenderer');
});
