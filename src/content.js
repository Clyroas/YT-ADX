// Runs in the extension's isolated world on every YouTube page.
// The declarative rules block ad endpoints and inject.js strips ad data. What is left is the player:
// a break whose data did not go through either path still starts, so this script watches for it,
// silences it, runs it out, and counts what it did.
(function () {
  'use strict';

  const SKIP_ATTR = 'data-ytadclean-skip';
  const HIDE_ATTR = 'data-ytadclean-hide';
  const TICK_MS = 300;
  // A break that refuses to be skipped is left muted and playing rather than paused: a paused ad
  // stops the timeline the page uses to decide the break is over.
  const MUTE_MAX_MS = 120000;
  // One counter bump per break, not one per tick.
  const REPORT_GAP_MS = 3000;

  const DEFAULTS = { enabled: true, skip: true, mute: true, hide: true, count: true };
  let wasAdShowing = false;
  function syncEnabledFlag() { try { window.localStorage.setItem('ytadclean_enabled', settings.enabled === false ? '0' : '1'); } catch {} }

  let settings = { ...DEFAULTS };
  let observer = null;
  let timer = null;
  let mutedByUs = false;
  let savedMute = false;
  let muteStartedAt = 0;
  let lastSkipAt = 0;
  let lastReportAt = 0;

  function player() {
    return document.getElementById('movie_player');
  }

  function isAdShowing() {
    const el = player();
    if (!el) return false;
    if (el.classList.contains('ad-showing')) return true;
    if (el.classList.contains('ad-interrupting')) return true;
    return false;
  }

  function activeVideo() {
    const el = player();
    if (el) {
      const video = el.querySelector('video');
      if (video) return video;
    }
    return document.querySelector('video');
  }

  function clickSkip() {
    const el = player();
    if (!el) return false;
    const button =
      el.querySelector('.ytp-skip-ad-button') ||
      el.querySelector('.ytp-ad-skip-button-modern') ||
      el.querySelector('.ytp-ad-skip-button');
    if (!button) return false;
    const now = Date.now();
    if (now - lastSkipAt < 500) return false;
    lastSkipAt = now;
    button.click();
    return true;
  }

  // A break can be skip-proof if the player never offers the button, so the video is also nudged
  // towards its end. That is only safe while an ad is actually showing, which is checked first.
  function nudgeToEnd(video) {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const target = Math.max(0, video.duration - 0.1);
    if (video.currentTime < target - 0.3) {
      try {
        video.currentTime = target;
      } catch {
        // A seek the browser refuses is not worth retrying.
      }
    }
  }

  function muteForAd(video) {
    if (!video || mutedByUs) return;
    savedMute = video.muted;
    video.muted = true;
    mutedByUs = true;
    muteStartedAt = Date.now();
    if (video.paused) {
      const played = video.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    }
  }

  function unmuteAfterAd(video) {
    if (!mutedByUs) return;
    mutedByUs = false;
    if (video) video.muted = savedMute;
  }

  function setAttr(node, name, on) {
    if (!node) return;
    if (on) node.setAttribute(name, '1');
    else node.removeAttribute(name);
  }

  function report() {
    if (!settings.count) return;
    const now = Date.now();
    if (now - lastReportAt < REPORT_GAP_MS) return;
    lastReportAt = now;
    try {
      chrome.runtime.sendMessage({ type: 'ad-skipped' }, () => void chrome.runtime.lastError);
    } catch {
      // The extension was reloaded and this script is orphaned. Nothing to report to.
    }
  }

  function tick() {
    const video = activeVideo();
    if (settings.enabled === false) { wasAdShowing = false; setAttr(document.documentElement, SKIP_ATTR, false); if (mutedByUs) unmuteAfterAd(video); return; }
    const showing = settings.skip && isAdShowing();

    if (!showing) {
      wasAdShowing = false;
      setAttr(document.documentElement, SKIP_ATTR, false);
      if (mutedByUs) unmuteAfterAd(video);
      return;
    }

    setAttr(document.documentElement, SKIP_ATTR, true);

    if (mutedByUs && Date.now() - muteStartedAt > MUTE_MAX_MS) unmuteAfterAd(video);

    const skipped = clickSkip();
    if (video) {
      if (settings.mute) muteForAd(video);
      nudgeToEnd(video);
    }
    // The counter moves once when a break starts, not on every tick it lasts.
    if (!wasAdShowing) { wasAdShowing = true; report(); }
  }

  // The timer does the work; the observer only makes the first tick after a break starts sooner,
  // and re-attaches when navigation rebuilds the player.
  function watchPlayer() {
    if (observer) observer.disconnect();
    const el = player() || document.body;
    if (!el) return;
    observer = new MutationObserver(() => {
      if (isAdShowing()) tick();
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  }

  function applyHide() {
    setAttr(document.documentElement, HIDE_ATTR, settings.enabled !== false && Boolean(settings.hide));
  }

  function start() {
    syncEnabledFlag();
    applyHide();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
    watchPlayer();
    tick();
  }

  document.addEventListener('yt-navigate-finish', () => {
    unmuteAfterAd(activeVideo());
    setAttr(document.documentElement, SKIP_ATTR, false);
    applyHide();
    watchPlayer();
  });

  document.addEventListener('yt-page-data-updated', watchPlayer);
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'ytadclean-inject') return;
    if (settings.enabled === false || !settings.count) return;
    const count = Number(event.data.count) || 1;
    try {
      chrome.runtime.sendMessage({ type: 'ad-skipped', count }, () => void chrome.runtime.lastError);
    } catch {}
  });

  try {
    chrome.storage.local.get(DEFAULTS, (stored) => {
      settings = { ...DEFAULTS, ...stored };
      start();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, change] of Object.entries(changes)) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) settings[key] = change.newValue;
      }
      syncEnabledFlag();
      applyHide();
      tick();
    });
  } catch {
    start();
  }
})();
