'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- background.js ----------
function loadBackground() {
  const listeners = {};
  const store = {};
  let failNextSet = false;
  const dnr = { enabled: ['ads'] };
  const chromeStub = {
    runtime: {
      onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
      onStartup: { addListener: (fn) => { listeners.startup = fn; } },
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
    },
    storage: {
      local: {
        get: async (def) => {
          if (def && typeof def === 'object') {
            const out = {};
            for (const k of Object.keys(def)) out[k] = k in store ? store[k] : def[k];
            return out;
          }
          return { ...store };
        },
        set: async (obj) => {
          if (failNextSet) {
            failNextSet = false;
            throw new Error('simulated storage failure');
          }
          Object.assign(store, obj);
        },
      },
      onChanged: { addListener: (fn) => { listeners.storageChanged = fn; } },
    },
    declarativeNetRequest: {
      getEnabledRulesets: async () => [...dnr.enabled],
      updateEnabledRulesets: async (arg) => {
        if (arg.enableRulesetIds) for (const id of arg.enableRulesetIds) if (!dnr.enabled.includes(id)) dnr.enabled.push(id);
        if (arg.disableRulesetIds) dnr.enabled = dnr.enabled.filter((id) => !arg.disableRulesetIds.includes(id));
      },
    },
  };
  const sandbox = { console, Promise, chrome: chromeStub };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/background.js'), sandbox);
  const send = (msg) => new Promise((resolve) => { listeners.message(msg, {}, resolve); });
  return { listeners, store, dnr, send };
}

test('background: skipped event credits measured seconds and blocked count', async () => {
  const { send } = loadBackground();
  const res = await send({ type: 'ad-event', kind: 'skipped', seconds: 30, count: 2 });
  await wait(10);
  assert.equal(res.stats.blocked, 2);
  assert.equal(res.stats.skipped, 1);
  assert.equal(res.stats.savedSeconds, 30);
  assert.equal(res.stats.creditedSeconds, 30);
});

test('background: seconds clamped to 600, count clamped to 20, unknown kind falls back to skipped', async () => {
  const { send } = loadBackground();
  const res = await send({ type: 'ad-event', kind: 'bogus', seconds: 9999, count: 999 });
  await wait(10);
  assert.equal(res.stats.blocked, 20);
  assert.equal(res.stats.skipped, 1);
  assert.equal(res.stats.savedSeconds, 600);
});

test('background: stripped credits nominal 20s, never savedSeconds; negative seconds credit 0', async () => {
  const { send } = loadBackground();
  let res = await send({ type: 'ad-event', kind: 'stripped', count: 3 });
  await wait(10);
  assert.equal(res.stats.stripped, 1);
  assert.equal(res.stats.creditedSeconds, 20);
  assert.equal(res.stats.savedSeconds, 0);
  res = await send({ type: 'ad-event', kind: 'muted', seconds: -50 });
  await wait(10);
  assert.equal(res.stats.muted, 1);
  assert.equal(res.stats.savedSeconds, 0);
});

test('background: non ad-event messages ignored, onInstalled seeds defaults and syncs rules', async () => {
  const { listeners, store, dnr } = loadBackground();
  assert.equal(listeners.message({ type: 'other' }, {}, () => {}), false);
  await listeners.installed();
  assert.equal(store.enabled, true);
  assert.ok(store.stats && typeof store.stats.blocked === 'number');
  assert.ok(dnr.enabled.includes('ads'));
});

// ---------- inject.js ----------
class FakeXHR {
  open(method, url) { this._url = url; }
}
Object.defineProperty(FakeXHR.prototype, 'responseText', { configurable: true, get() { return this._text || ''; } });
Object.defineProperty(FakeXHR.prototype, 'response', { configurable: true, get() { return this._response !== undefined ? this._response : (this._text || ''); } });

function loadInject() {
  const messages = [];
  let enabledFlag = '1';
  const store = {};
  // Fresh XHR class per load: inject.js patches XMLHttpRequest.prototype.open, so sharing one
  // class across vm loads would chain wrappers and route notifications to stale closures.
  const FreshXHR = class { open(method, url) { this._url = url; } };
  Object.defineProperty(FreshXHR.prototype, 'responseText', { configurable: true, get() { return this._text || ''; } });
  Object.defineProperty(FreshXHR.prototype, 'response', { configurable: true, get() { return this._response !== undefined ? this._response : (this._text || ''); } });
  const sandbox = {
    console, Promise, JSON, Object, Array, Set, Map, Date, Math, Number, String, Boolean, RegExp, Error,
    XMLHttpRequest: FreshXHR,
    fetch: undefined,
    localStorage: {
      getItem: (k) => (k === 'ytadclean_enabled' ? enabledFlag : k === 'ytadclean_debug' ? '1' : (k in store ? store[k] : null)),
      setItem: (k, v) => { store[k] = String(v); },
    },
    postMessage: (msg) => messages.push(msg),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/inject.js'), sandbox);
  return { sandbox, messages, setEnabled: (v) => { enabledFlag = v; } };
}

test('inject: ytInitialPlayerResponse strips ads without page telemetry', () => {
  const { sandbox, messages } = loadInject();
  sandbox.ytInitialPlayerResponse = {
    videoDetails: { title: 'keep me' },
    adPlacements: [{ adSlotRenderer: {} }],
    clarificationRenderer: { trackingParams: 'keep' },
    nested: { adBreaks: [1, 2], other: 1 },
  };
  const out = sandbox.ytInitialPlayerResponse;
  assert.equal(out.videoDetails.title, 'keep me');
  assert.equal(out.adPlacements, undefined);
  assert.ok(out.clarificationRenderer);
  assert.equal(out.nested.adBreaks, undefined);
  assert.equal(out.nested.other, 1);
  assert.equal(messages.length, 0);
});

test('inject: stripText handles JSON, short strings, non-JSON, and disabled mode', () => {
  const { sandbox, setEnabled } = loadInject();
  const stripText = sandbox.DsxYtAdStrip.stripText;
  assert.ok(stripText, 'debug handle should exist when ytadclean_debug=1');
  const stripped = JSON.parse(stripText(JSON.stringify({ adSlots: [1], keep: 2, padding: 'a long enough payload to pass the length gate' })));
  assert.equal(stripped.adSlots, undefined);
  assert.equal(stripped.keep, 2);
  assert.equal(stripText('short'), 'short');
  assert.equal(stripText('not json at all, just a long plain string value here'), 'not json at all, just a long plain string value here');
  setEnabled('0');
  const raw = JSON.stringify({ adSlots: [1], keep: 2, padding: 'a long enough payload to pass the length gate' });
  assert.equal(stripText(raw), raw);
});

test('inject: XHR responseText is stripped and cached without page telemetry', () => {
  const { sandbox, messages } = loadInject();
  const xhr = new sandbox.XMLHttpRequest();
  xhr.open('GET', 'https://www.youtube.com/youtubei/v1/player');
  xhr._text = JSON.stringify({ adPlacements: [1], videoDetails: { title: 'x' } });
  xhr.readyState = 4;
  const first = xhr.responseText;
  const afterFirst = messages.length;
  const second = xhr.responseText;
  assert.equal(first, second);
  assert.equal(JSON.parse(first).adPlacements, undefined);
  assert.equal(afterFirst, 0);
  assert.equal(messages.length, 0);
});

test('inject: small array items carrying an ad key are removed entirely, pure items survive', () => {
  const { sandbox } = loadInject();
  sandbox.ytInitialData = { items: [{ adSlotRenderer: {}, trackingParams: 't' }, { videoRenderer: {}, adSlotRenderer: {} }, { videoRenderer: {} }] };
  const items = sandbox.ytInitialData.items;
  assert.equal(items.length, 1);
  assert.ok(items[0].videoRenderer);
  assert.equal(items[0].adSlotRenderer, undefined);
});

// ---------- content.js ----------
function loadContent() {
  const sent = [];
  const handlers = {};
  const attrs = {};
  let tickFn = null;
  let intervalMs = null;
  let hudEl = null;
  let hudRemoved = false;
  let clicks = 0;
  const videoEl = { muted: false, paused: false, play() { return Promise.resolve(); }, pause() {} };
  const skipBtn = { dispatchEvent() {}, click() { clicks += 1; } };
  const playerEl = {
    _classes: new Set(),
    classList: { contains: (c) => playerEl._classes.has(c) },
    querySelector: (sel) => {
      if (sel === 'video') return videoEl;
      if (sel.includes('skip')) return skipBtn;
      return null;
    },
    getVideoData: () => null,
  };
  const barEl = { firstChild: null, insertBefore() {} };
  const sandbox = {
    console, Promise, JSON, Object, Array, Set, Map, Date, Math, Number, String, Boolean, RegExp, Error,
    MouseEvent: class { constructor(type, opts) { this.type = type; Object.assign(this, opts); } },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: (fn, ms) => { tickFn = fn; intervalMs = ms; return 1; },
    clearInterval: () => {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    chrome: {
      storage: {
        local: { get: (def, cb) => cb({}) },
        onChanged: { addListener: (fn) => { handlers.storageChanged = fn; } },
      },
      runtime: {
        sendMessage: (payload, cb) => { sent.push(payload); if (cb) cb({ stats: { blocked: 1, creditedSeconds: 42 } }); },
        lastError: undefined,
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.localStorage = { _s: {}, getItem(k) { return k in this._s ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); } };
  sandbox.addEventListener = (type, fn) => { handlers['window:' + type] = fn; };
  sandbox.document = {
    documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } },
    body: {},
    getElementById: (id) => (id === 'movie_player' ? playerEl : id === 'ytadx-hud' ? hudEl : null),
    querySelector: (sel) => {
      if (sel === 'video') return videoEl;
      if (sel.includes('topbar') || sel === '#end') return barEl;
      if (sel.includes('html5-video-player')) return playerEl;
      return null;
    },
    createElement: () => {
      hudEl = { id: '', textContent: '', setAttribute() {}, remove() { hudRemoved = true; } };
      return hudEl;
    },
    addEventListener: (type, fn) => { handlers['doc:' + type] = fn; },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('src/content.js'), sandbox);
  return { sandbox, sent, handlers, attrs, videoEl, playerEl, getTick: () => tickFn, getIntervalMs: () => intervalMs, getClicks: () => clicks, isHudRemoved: () => hudRemoved };
}

test('content: starts on 750ms tick, syncs enabled flag, applies hide attr', () => {
  const { sandbox, attrs, getIntervalMs } = loadContent();
  assert.equal(getIntervalMs(), 750);
  assert.equal(sandbox.localStorage.getItem('ytadclean_enabled'), '1');
  assert.equal(attrs['data-ytadclean-hide'], '1');
});

test('content: empty overlay scaffolding does not trigger ad controls', () => {
  const ctx = loadContent();
  const query = ctx.playerEl.querySelector;
  ctx.playerEl.querySelector = (selector) => {
    if (selector === '.ytp-ad-player-overlay' || selector === '.ytp-ad-overlay-container') return {};
    return query(selector);
  };
  const before = ctx.sent.length;
  ctx.getTick()();
  assert.equal(ctx.videoEl.muted, false);
  assert.equal(ctx.getClicks(), 0);
  assert.equal(ctx.sent.length, before);
});

test('content: ad break mutes video, clicks skip, reports, then restores mute on end', () => {
  const ctx = loadContent();
  ctx.playerEl._classes.add('ad-showing');
  ctx.getTick()();
  assert.equal(ctx.videoEl.muted, true);
  assert.ok(ctx.getClicks() >= 1);
  assert.ok(ctx.sent.some((m) => m.type === 'ad-event'));
  ctx.playerEl._classes.delete('ad-showing');
  ctx.getTick()();
  assert.equal(ctx.videoEl.muted, false);
});

test('content: disabled mode does not mute or report', () => {
  const ctx = loadContent();
  ctx.handlers.storageChanged({ enabled: { newValue: false } }, 'local');
  assert.equal(ctx.sandbox.localStorage.getItem('ytadclean_enabled'), '0');
  ctx.playerEl._classes.add('ad-showing');
  const before = ctx.sent.length;
  ctx.getTick()();
  assert.equal(ctx.videoEl.muted, false);
  assert.equal(ctx.sent.length, before);
});
