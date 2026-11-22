// Runs in YouTube's own JavaScript world, before its scripts parse the page.
// Two jobs: strip ads out of the JSON the page fetches, and strip them out of the two globals
// YouTube writes into the document before the player boots.
(function () {
  'use strict';

  function isEnabled() { try { return window.localStorage.getItem('ytadclean_enabled') !== '0'; } catch { return true; } }

  // Every field YouTube has used to carry an ad, in the player response and in the feed responses.
  // Removing a field the page does not expect is harmless; leaving one in is the ad.
  const AD_KEYS = [
    'adPlacements',
    'adSlots',
    'playerAds',
    'adBreakHeartbeatParams',
    'adBreakServiceRenderer',
    'adDurationRemaining',
    'adIneligibleResponse',
    'adThumbnailRemovalMap',
    'promotedSparklesWebRenderer',
    'promotedSparklesTextFormRenderer',
    'compactPromotedVideoRenderer',
    'promotedVideoRenderer',
    'displayAdRenderer',
    'adSlotRenderer',
    'inFeedAdLayoutRenderer',
    'videoMastheadAdV3Renderer',
    'mastheadAdV3Renderer',
    'bannerPromoRenderer',
    'statementBannerRenderer',
    'primetimePromoRenderer',
    'brandVideoShelfRenderer',
    'brandVideoSingletonRenderer',
    'searchPyvRenderer',
    'adFederatedCommentRenderer',
    'adHoverTextButtonRenderer',
    'adInfoRenderer',
    'clientSideAdRenderer',
    'engagementPanelSectionListRendererAd',
    'feedNudgeRenderer',
    'mealbarPromoRenderer',
    'youThereRenderer',
  ];

  const AD_KEY_SET = new Set(AD_KEYS);
  // Cheap pre-check so the vast majority of responses are never parsed.
  const MARKERS = ['"adPlacements"', '"adSlots"', '"playerAds"', '"adBreakHeartbeatParams"', '"promotedSparkles', '"displayAdRenderer"', '"adSlotRenderer"', '"inFeedAdLayoutRenderer"', '"primetimePromoRenderer"', '"statementBannerRenderer"', '"searchPyvRenderer"', '"brandVideoShelfRenderer"', '"mealbarPromoRenderer"', '"youThereRenderer"'];
  const MAX_DEPTH = 40;

    const COUNTED_KEYS = new Set([
    'adPlacements', 'adSlots', 'playerAds', 'adBreakServiceRenderer',
    'adSlotRenderer', 'promotedSparklesWebRenderer', 'promotedVideoRenderer',
    'compactPromotedVideoRenderer', 'inFeedAdLayoutRenderer', 'displayAdRenderer',
    'videoMastheadAdV3Renderer', 'mastheadAdV3Renderer', 'searchPyvRenderer'
  ]);
  function notifyStripped(removed) {
    if (removed > 0) {
      try { window.postMessage({ source: 'ytadclean-inject', count: removed }, '*'); } catch {}
    }
  }
  function stripRoot(node) {
    const stats = { count: 0 };
    stripAds(node, 0, stats);
    notifyStripped(stats.count);
    return node;
  }
  function mightHoldAd(text) {
    for (let i = 0; i < MARKERS.length; i += 1) if (text.indexOf(MARKERS[i]) !== -1) return true;
    return false;
  }

  // Walks the tree in place. Objects are mutated, arrays are compacted, nothing is cloned, so the
  // page keeps the identity of the objects it already holds.
  function stripAds(node, depth, stats) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return node;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) {
        const item = node[i];
        if (item && typeof item === 'object') {
          const keys = Object.keys(item);
          const isAdWrapper = keys.some((k) => AD_KEY_SET.has(k)) && keys.every((k) => AD_KEY_SET.has(k) || k === 'trackingParams');
          if (isAdWrapper) {
            if (stats && keys.some((k) => COUNTED_KEYS.has(k))) stats.count += 1;
            node.splice(i, 1);
            continue;
          }
        }
        stripAds(item, depth + 1, stats);
      }
      return node;
    }
    for (const key of Object.keys(node)) {
      if (AD_KEY_SET.has(key)) {
        if (stats && COUNTED_KEYS.has(key)) stats.count += 1;
        delete node[key];
        continue;
      }
      stripAds(node[key], depth + 1, stats);
    }
    return node;
  }

  // The text form, used by XHR and by anything else that hands over a string.
  function stripText(text) {
    if (!isEnabled()) return text;
    if (typeof text !== 'string' || text.length < 32 || !mightHoldAd(text)) return text;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return text;
    }
    stripRoot(data);
    try {
      return JSON.stringify(data);
    } catch {
      return text;
    }
  }

  // ---- fetch ---------------------------------------------------------------------------------

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : '';
      const promise = nativeFetch.call(this, input, init);
      if (!isEnabled() || url.indexOf('/youtubei/v1/') === -1) return promise;
      return promise.then((response) => {
        let type = '';
        try {
          type = response.headers.get('content-type') || '';
        } catch {
          return response;
        }
        if (type.indexOf('json') === -1) return response;
        return response
          .clone()
          .text()
          .then((text) => {
            if (!mightHoldAd(text)) return response;
            const rewritten = stripText(text);
            if (rewritten === text) return response;
            return new Response(rewritten, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          })
          .catch(() => response);
      });
    };
  }

  // ---- XMLHttpRequest ------------------------------------------------------------------------
  // The page may attach its own load handler before it calls send, so a listener added here would
  // run second and the page would already have read the raw body. Instead the two read-back
  // properties are redefined on the instance and do the work lazily, whoever reads them.

  const rawText = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
  const rawResponse = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');

  function patchXhrInstance(xhr) {
    if (rawText && rawText.get) {
      Object.defineProperty(xhr, 'responseText', {
        configurable: true,
        get() {
          const text = rawText.get.call(this);
          if (this.readyState !== 4) return text;
          return stripText(text);
        },
      });
    }
    if (rawResponse && rawResponse.get) {
      Object.defineProperty(xhr, 'response', {
        configurable: true,
        get() {
          const value = rawResponse.get.call(this);
          if (this.readyState !== 4 || !isEnabled()) return value;
          if (typeof value === 'string') return stripText(value);
          if (value && typeof value === 'object' && this.responseType === 'json') return stripRoot(value);
          return value;
        },
      });
    }
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      const text = String(url);
      if (text.indexOf('/youtubei/v1/') !== -1) patchXhrInstance(this);
    } catch {
      // A URL that cannot be read is one this script has nothing to do with.
    }
    return nativeOpen.apply(this, arguments);
  };

  // ---- the two globals YouTube writes before the player boots --------------------------------

  let playerValue;
  let dataValue;

  function defineStripped(name, onSet) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() {
          return onSet.get();
        },
        set(value) {
          onSet.set(value);
        },
      });
    } catch {
      // Already defined and not configurable: leave the page alone.
    }
  }

  defineStripped('ytInitialPlayerResponse', {
    get: () => playerValue,
    set: (value) => {
      playerValue = isEnabled() && value && typeof value === 'object' ? stripRoot(value) : value;
    },
  });

  defineStripped('ytInitialData', {
    get: () => dataValue,
    set: (value) => {
      dataValue = isEnabled() && value && typeof value === 'object' ? stripRoot(value) : value;
    },
  });

  window.DsxYtAdStrip = { stripAds, stripText };
})();
