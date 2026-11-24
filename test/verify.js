'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

test('manifest is MV3 and every referenced file exists', () => {
  const m = json('manifest.json');
  assert.equal(m.manifest_version, 3);
  assert.equal(m.background.service_worker, 'src/background.js');
  const refs = [
    'src/background.js', 'src/ui.html', 'src/ui.js', 'src/inject.js',
    'src/content.js', 'src/content.css', 'rules/ads.json',
    'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
  ];
  for (const rel of refs) assert.ok(fs.existsSync(path.join(root, rel)), rel + ' missing');
  assert.deepEqual(m.permissions.sort(), ['declarativeNetRequest', 'storage']);
});

test('DNR ruleset is valid: unique ids, block actions, pagead filters present', () => {
  const rules = json('rules/ads.json');
  assert.equal(rules.length, 5);
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
  for (const r of rules) {
    assert.equal(r.action.type, 'block');
    assert.deepEqual(r.condition.initiatorDomains, ['youtube.com']);
  }
  const filters = rules.map((r) => r.condition.urlFilter || '').join(' ');
  assert.match(filters, /youtube\.com\/pagead\//);
  assert.match(filters, /pagead\/lvz/);
  // Playback telemetry must never be blocked by this ruleset.
  assert.doesNotMatch(JSON.stringify(rules), /ptracking|delayplay|stats\/atr/);
});

test('background clamps counted seconds and serializes stats writes', () => {
  const src = read('src/background.js');
  assert.match(src, /MAX_COUNTED_SECONDS = 600/);
  assert.match(src, /writeQueue = writeQueue(?:\.catch\(\(\) => \{\}\))?\.then/);
  assert.match(src, /async function syncRules\(\) \{[\s\S]*?try \{/);
});

test('content restores mute state and removes the HUD pill', () => {
  const src = read('src/content.js');
  assert.match(src, /unmuteAd\(video\);/);
  assert.match(src, /hud\.remove\(\)/);
  assert.doesNotMatch(src, /ytd-topbar-menu-button-renderer, ytd-topbar-menu-button-renderer/);
});

test('YouTube enforcement notice is not hidden when playback is blocked', () => {
  const css = read('src/content.css');
  assert.doesNotMatch(css, /ytd-enforcement-message-view-model|tp-yt-iron-overlay-backdrop/);
});

test('inject caches XHR reads and gates the debug handle', () => {
  const src = read('src/inject.js');
  assert.match(src, /cachedTextReady/);
  assert.match(src, /cachedResponseReady/);
  assert.match(src, /ytadclean_debug/);
  assert.doesNotMatch(src, /window\\.postMessage/);
  assert.doesNotMatch(read('src/content.js'), /ytadclean-inject/);
});