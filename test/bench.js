// Drives the real extension in a real Chromium.
// Traffic for www.youtube.com is intercepted by the browser and answered by the local bench, so the
// extension sees a page on its own declared origin while nothing touches the internet.
const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/user/.npm/_npx/f0a362733743bae2/node_modules/playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8443;
const results = [];
let failures = 0;

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

(async () => {
  const userDataDir = fs.mkdtempSync('/tmp/ytadbench-');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: undefined,
    executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      '--ignore-certificate-errors',
      '--no-sandbox',
      '--host-resolver-rules=MAP www.youtube.com 127.0.0.1:8443, MAP youtube.com 127.0.0.1:8443, MAP *.youtube.com 127.0.0.1:8443',
    ],
  });

  // The service worker is the extension being alive at all.
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  check('extension service worker started', Boolean(worker), worker ? worker.url().split('/').pop() : 'no worker');

  const requests = [];
  context.on('request', (req) => requests.push({ url: req.url(), type: req.resourceType() }));

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto(`https://www.youtube.com/watch?v=realvideo`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__benchReady === true, { timeout: 15000 });

  // ---- Layer 2: data stripping -------------------------------------------------------------
  const feed = await page.evaluate(() => window.__feedResult);
  const player = await page.evaluate(() => window.__playerResult);
  const boot = await page.evaluate(() => ({
    player: window.ytInitialPlayerResponse,
    data: window.ytInitialData,
  }));

  const feedText = JSON.stringify(feed);
  check(
    'feed: every ad renderer removed by the fetch wrapper',
    !/adSlotRenderer|promotedSparklesWebRenderer|displayAdRenderer|inFeedAdLayoutRenderer|compactPromotedVideoRenderer/.test(feedText),
    feedText.match(/adSlotRenderer|promotedSparklesWebRenderer|displayAdRenderer|inFeedAdLayoutRenderer|compactPromotedVideoRenderer/g)?.join(',') || 'none left',
  );
  check(
    'feed: the four real videos survive',
    ['real-a', 'real-b', 'real-c', 'real-d'].every((id) => feedText.includes(id)),
    (feedText.match(/real-[a-d]/g) || []).join(','),
  );
  check(
    'feed: unrelated data untouched',
    feed.trackingParams === 'keep-me',
    String(feed.trackingParams),
  );
  check(
    'feed: ad entries spliced out, not left as holes',
    !/null/.test(JSON.stringify(feed.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents)),
    JSON.stringify(feed.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents.map((n) => Object.keys(n)[0])),
  );

  check(
    'player (XHR): ad fields gone',
    !['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'].some((k) => k in player),
    Object.keys(player).join(','),
  );
  check('player (XHR): video details intact', player.videoDetails && player.videoDetails.videoId === 'realvideo', JSON.stringify(player.videoDetails && player.videoDetails.videoId));
  check('player (XHR): streaming data intact', Boolean(player.streamingData && player.streamingData.formats), 'streamingData present');

  check(
    'boot global ytInitialPlayerResponse stripped',
    !['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'].some((k) => k in boot.player),
    Object.keys(boot.player).join(','),
  );
  check('boot global ytInitialData stripped', !('adSlots' in boot.data), Object.keys(boot.data).join(','));
  check('boot global keeps its non-ad subtree', Boolean(boot.data.contents && boot.data.contents.keep === 'yes'), JSON.stringify(boot.data.contents));

  // ---- Layer 4: surface hiding --------------------------------------------------------------
  let state = await page.evaluate(() => window.__benchState());
  check('hide attribute set on html', state.hideAttr === '1', `data-ytadclean-hide=${state.hideAttr}`);
  check('masthead ad hidden', state.mastheadDisplay === 'none', state.mastheadDisplay);
  check('feed ad slot hidden', state.adSlotDisplay === 'none', state.adSlotDisplay);

  // ---- Layer 3: player -------------------------------------------------------------------
  await page.evaluate(() => window.__benchStartAd());
  await page.waitForTimeout(1200);
  state = await page.evaluate(() => window.__benchState());
  check('skip button clicked by the content script', state.skipClicked === true, `skipClicked=${state.skipClicked}`);
  check('skip attribute set while a break shows', state.skipAttr === '1' || state.adShowing === false, `skipAttr=${state.skipAttr}`);
  check('page handler ended the break after the click', state.adShowing === false, `adShowing=${state.adShowing}`);

  // A break with no skip button: the video must be muted, run to its end, and never paused.
  await page.evaluate(() => {
    document.querySelector('.ytp-skip-ad-button').remove();
    window.__skipClicked = false;
  });
  await page.evaluate(() => window.__benchStartAd());
  await page.waitForTimeout(1500);
  state = await page.evaluate(() => window.__benchState());
  check('unskippable break is muted', state.muted === true, `muted=${state.muted}`);
  check(
    'unskippable break is run to its end',
    state.currentTime >= state.duration - 0.6 && state.duration > 0,
    `currentTime=${state.currentTime} duration=${state.duration}`,
  );
  check('the script never calls pause() on an ad', state.pauseCalls === 0, `pause() calls=${state.pauseCalls}`);
  check('skip attribute marks the break', state.skipAttr === '1', `skipAttr=${state.skipAttr}`);

  // ---- Layer 1: the declarative rules ------------------------------------------------------
  const adHost = await page.evaluate(() => window.__adHostResult);
  check('request to an ad host is refused by the rules', String(adHost).startsWith('blocked'), String(adHost));

  // The ad's own chrome must not be visible while the break is marked.
  check(
    'ad overlay chrome hidden while a break is marked',
    state.overlayDisplay === 'none',
    `overlay display=${state.overlayDisplay}`,
  );

  // ---- counter ----------------------------------------------------------------------------
  if (worker) {
    const counted = await worker.evaluate(async () => {
      const { blocked } = await chrome.storage.local.get({ blocked: 0 });
      const rules = await chrome.declarativeNetRequest.getEnabledRulesets();
      return { blocked, rules };
    });
    check('counter incremented by the content script', counted.blocked > 0, `blocked=${counted.blocked}`);
    check('declarative rule set enabled', counted.rules.includes('ads'), counted.rules.join(',') || 'none');
  }

  // ---- console ---------------------------------------------------------------------------
  const extensionNoise = consoleErrors.filter((line) => !/favicon|net::ERR_CERT|Failed to load resource/i.test(line));
  check('no console errors from the page or the scripts', extensionNoise.length === 0, extensionNoise.slice(0, 3).join(' | ') || 'clean');

  // ---- screenshot ------------------------------------------------------------------------
  await page.screenshot({ path: path.join(__dirname, 'bench.png'), fullPage: true });

  console.log('\nrequests seen:');
  for (const r of requests) console.log(`  ${r.type.padEnd(12)} ${r.url.slice(0, 90)}`);

  console.log(`\n${results.length - failures}/${results.length} passed`);
  await context.close();
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('BENCH ERROR', err.message);
  process.exit(2);
});
