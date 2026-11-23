'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
test('manifest.json is valid MV3 with icons and clean host_permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, manifest.content_scripts[0].matches);
  for (const sz of ['16', '32', '48', '128']) {
    const rel = manifest.icons[sz];
    assert.ok(rel, `missing icon ${sz}`);
    const buf = fs.readFileSync(path.join(ROOT, rel));
    assert.equal(buf.subarray(0, 4).toString('hex'), '89504e47', `icon ${sz} is valid PNG`);
  }
});
test('rules/ads.json excludes main_frame and allows playback telemetry', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules/ads.json'), 'utf8'));
  assert.equal(rules.length, 5);
  for (const r of rules) {
    assert.ok(r.condition.excludedResourceTypes?.includes('main_frame'), `rule ${r.id} excludes main_frame`);
    const f = r.condition.urlFilter || '';
    assert.ok(!/ptracking|delayplay|\/atr\b/.test(f), `rule ${r.id} does not block playback telemetry`);
  }
});
test('inject.js strips ads, preserves clarificationRenderer, counts breaks, and respects enabled flag', () => {
  const code = fs.readFileSync(path.join(ROOT, 'src/inject.js'), 'utf8');
  const messages = [];
  const store = new Map();
  const sandbox = {
    window: {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
      },
      postMessage: (msg) => messages.push(msg),
    },
    XMLHttpRequest: { prototype: {} },
    Response: class Response { constructor(body) { this.body = body; } },
    Set, Object, Array, JSON, String,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const sample = {
    adPlacements: [{ adPlacementRenderer: {} }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    videoDetails: { videoId: 'abc123' },
    contents: [
      { videoRenderer: { videoId: 'keep1' } },
      { adSlotRenderer: { id: 1 }, trackingParams: 'xyz' },
      { clarificationRenderer: { title: 'Context info' } },
    ],
  };
  sandbox.window.ytInitialPlayerResponse = JSON.parse(JSON.stringify(sample));
  const cleaned = sandbox.window.ytInitialPlayerResponse;
  assert.equal(cleaned.adPlacements, undefined);
  assert.equal(cleaned.playerAds, undefined);
  assert.equal(cleaned.videoDetails.videoId, 'abc123');
  assert.equal(cleaned.contents.length, 2);
  assert.equal(cleaned.contents[1].clarificationRenderer.title, 'Context info');
  assert.equal(messages.at(-1).count, 3);
  store.set('ytadclean_enabled', '0');
  sandbox.window.ytInitialPlayerResponse = JSON.parse(JSON.stringify(sample));
  assert.ok(Array.isArray(sandbox.window.ytInitialPlayerResponse.adPlacements), 'bypasses when disabled');
});
test('player checks are throttled and do not seek the video timeline', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/content.js'), 'utf8');
  assert.match(source, /const TICK_MS = 750/);
  assert.match(source, /observerTimer !== null/);
  assert.doesNotMatch(source, /nudgeToEnd|video\\.currentTime\\s*=/);
});
test('all JS files parse cleanly and UI IDs match ui.js', () => {
  for (const rel of ['src/background.js', 'src/content.js', 'src/inject.js', 'src/ui.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    new vm.Script(src, { filename: rel });
  }
  const html = fs.readFileSync(path.join(ROOT, 'src/ui.html'), 'utf8');
  for (const id of ['status-text', 'blocked', 'reset', 'enabled', 'rules', 'version']) {
    assert.ok(html.includes(`id="${id}"`), `ui.html contains #${id}`);
  }
});