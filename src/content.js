// Runs in the extension's isolated world on every YouTube page.
// The declarative rules block ad endpoints and inject.js strips ad data. What is left is the player:
// a break whose data did not go through either path still starts, so this script watches for it,
// silences it, runs it out, and counts what it did.
(function () {
  'use strict';

  const SKIP_ATTR = 'data-ytadclean-skip';
  const HIDE_ATTR = 'data-ytadclean-hide';
  const TICK_MS = 750;
  // A break that refuses to be skipped is left muted and playing rather than paused: a paused ad
  // stops the timeline the page uses to decide the break is over.
  const MUTE_MAX_MS = 120000;
  // A break is never held silent past its plausible length: past this the ad is left alone rather
  // than fought, so a misread player state cannot park a video in silence indefinitely.
  const AD_PLAY_LIMIT_MS = 45000;
  // One counter bump per break, not one per tick.
  const REPORT_GAP_MS = 3000;
  // Anything shorter is the player flickering, not a break worth telling anyone about.
  const MIN_REPORTABLE_MS = 250;
  // The data layer runs before the player boots, so its report always wins the race.
  const STRIP_DEDUPE_MS = 2000;

  // Keep in sync with DEFAULTS in src/background.js and src/ui.js (no shared module in MV3 plain scripts).
  const DEFAULTS = { enabled: true, skip: true, mute: true, hide: true, count: true };
  let wasAdShowing = false;
  function syncEnabledFlag() { try { window.localStorage.setItem('ytadclean_enabled', settings.enabled === false ? '0' : '1'); } catch {} }

  let settings = { ...DEFAULTS };
  let observer = null;
  let timer = null;
  let observerTimer = null;
  let mutedByUs = false;
  let savedMute = false;
  let adStartTs = 0;
  let adPausedByUs = false;
  let userPausedBeforeAd = false;
  let muteStartedAt = 0;
  let lastSkipAt = 0;
  let lastReportAt = 0;
  let lastStripAt = 0;
  let suppressOwnReport = false;

  // #movie_player only exists on the watch page. Embeds and Shorts render the same player element
  // without that wrapper, so the class is the fallback — both carry ad-showing / ad-interrupting.
  function player() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  function isAdShowing() {
    const el = player();
    if (!el) return false;
    if (el.classList.contains('ad-showing')) return true;
    if (el.classList.contains('ad-interrupting')) return true;
    if (el.classList.contains('ad-overlay')) return true;
    // These overlay containers may exist as empty player scaffolding outside ad playback.
    // Only the explicit player classes or API adBreak state above count as an active ad.
    try {
      const api = el.getVideoData ? el.getVideoData() : null;
      if (api && api.adBreak) return true;
    } catch {}
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
      el.querySelector('.ytp-skip-ad-button-modern') ||
      el.querySelector('.ytp-ad-skip-button-modern') ||
      el.querySelector('.ytp-ad-skip-button') ||
      el.querySelector('button.ytp-ad-skip-button');
    if (!button) return false;
    const now = Date.now();
    if (now - lastSkipAt < 500) return false;
    lastSkipAt = now;
    try {
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    } catch {}
    button.click();
    return true;
  }

  // Muting and resuming are separate ownerships: a break can be silenced without being nudged to
  // play, and a break can be nudged to play without being silenced. Each pair saves its own prior
  // state and restores only what it changed, so turning either setting off cannot strand the
  // player in a state we introduced.

  function muteAd(video) {
    if (!video || mutedByUs) return;
    savedMute = video.muted;
    video.muted = true;
    mutedByUs = true;
    muteStartedAt = Date.now();
  }

  function unmuteAd(video) {
    if (!mutedByUs) return;
    mutedByUs = false;
    if (video) video.muted = savedMute;
  }

  function forcePlayAd(video) {
    if (!video || !video.paused) return;
    // The timeline only advances while the ad plays, and a paused ad never reports itself over.
    // We are nudging it forward, so the viewer's own silence takes priority over ours.
    adPausedByUs = true;
    try {
      const played = video.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    } catch {}
  }

  // We only restore playback we started. A viewer who paused mid-break keeps their pause.
  function restoreAdPlayback(video) {
    if (!adPausedByUs) return;
    adPausedByUs = false;
    if (video) {
      try { video.pause(); } catch {}
    }
  }

  function endBreak(video) {
    if (adStartTs && wasAdShowing) {
      const elapsed = Date.now() - adStartTs;
      // The data layer already counted this break if it reported one within the last two seconds:
      // one event per break, from whichever layer saw it first.
      if (!suppressOwnReport && elapsed > MIN_REPORTABLE_MS) report(elapsed);
      suppressOwnReport = false;
    }
    wasAdShowing = false;
    adStartTs = 0;
    userPausedBeforeAd = false;
    setAttr(document.documentElement, SKIP_ATTR, false);
    unmuteAd(video);
    restoreAdPlayback(video);
  }

  function setAttr(node, name, on) {
    if (!node) return;
    if (on) node.setAttribute(name, '1');
    else node.removeAttribute(name);
  }

  function send(payload) {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        void chrome.runtime.lastError;
        if (response && response.stats) showHud(response.stats);
      });
    } catch {
      // The extension was reloaded and this script is orphaned. Nothing to report to.
    }
  }

  function report(seconds) {
    const kind = mutedByUs ? 'muted' : 'skipped';
    send({ type: 'ad-event', kind, seconds: Math.round(seconds / 1000) });
    lastReportAt = Date.now();
  }

  // The action bar is the only surface the viewer is already looking at, so the running total lives
  // there rather than on a toolbar badge a page action cannot paint in MV3.
  function showHud(stats) {
    if (!settings.count) return;
    const bar = document.querySelector('ytd-topbar-menu-button-renderer, #end');
    if (!bar) return;
    let hud = document.getElementById('ytadx-hud');
    if (!hud) {
      hud = document.createElement('span');
      hud.id = 'ytadx-hud';
      hud.setAttribute('style', 'align-self:center;margin:0 12px;padding:5px 11px;border-radius:999px;'
        + 'font:600 12px/1.2 system-ui,sans-serif;color:#f3f4f6;white-space:nowrap;pointer-events:none;'
        + 'background:linear-gradient(160deg,rgba(255,255,255,0.16),rgba(255,255,255,0.06));'
        + 'border:1px solid rgba(255,255,255,0.22);box-shadow:inset 0 1px 0 rgba(255,255,255,0.18),0 6px 18px rgba(0,0,0,0.35);'
        + 'backdrop-filter:blur(12px) saturate(160%);-webkit-backdrop-filter:blur(12px) saturate(160%);transition:opacity .3s ease');
      bar.insertBefore(hud, bar.firstChild);
    }
    const s = Number(stats && stats.creditedSeconds) || 0;
    const human = s < 60 ? s + 's' : (s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm');
    hud.textContent = (Number(stats && stats.blocked) || 0) + ' removed · ' + human + ' back';
    clearTimeout(showHud.timer);
    showHud.timer = setTimeout(() => { if (hud) hud.remove(); }, 5000);
  }

  function tick() {
    const video = activeVideo();

    // The condition is one thing; skip, mute and seek are three separate decisions. Gating the
    // whole branch on `skip` used to disable silence for anyone who turned auto-skip off.
    const showing = isAdShowing();

    if (settings.enabled === false || !showing) {
      endBreak(video);
      return;
    }

    setAttr(document.documentElement, SKIP_ATTR, true);

    if (!wasAdShowing) {
      wasAdShowing = true;
      adStartTs = Date.now();
      suppressOwnReport = Date.now() - lastStripAt < STRIP_DEDUPE_MS;
      // Pausing at a break is the viewer saying "stop", not "play this for me".
      userPausedBeforeAd = video ? video.paused : false;
      if (!suppressOwnReport) report(0);
    }

    // Silence is independent of skipping: an unskippable break is exactly the case where it pays.
    if (settings.mute) muteAd(video);
    else if (mutedByUs) unmuteAd(video);

    if (settings.skip && clickSkip()) return;

    if (mutedByUs && Date.now() - muteStartedAt > MUTE_MAX_MS) unmuteAd(video);

    if (settings.skip && adStartTs && Date.now() - adStartTs > AD_PLAY_LIMIT_MS) forcePlayAd(video);
  }

  // The timer does the work; the observer only makes the first tick after a break starts sooner,
  // and re-attaches when navigation rebuilds the player.
  function watchPlayer() {
    if (observer) observer.disconnect();
    const el = player() || document.body;
    if (!el) return;
    observer = new MutationObserver(() => {
      // Coalesce YouTube's bursts of player DOM mutations into one check.
      if (observerTimer !== null) return;
      observerTimer = setTimeout(() => {
        observerTimer = null;
        tick();
      }, 200);
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
    endBreak(activeVideo());
    setAttr(document.documentElement, SKIP_ATTR, false);
    applyHide();
    watchPlayer();
  });

  document.addEventListener('yt-page-data-updated', watchPlayer);
  // Page-world messages are forgeable by YouTube/page scripts, so never use them
  // as trusted input for extension counters or player-state decisions.

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
