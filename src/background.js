'use strict';

const RULE_SET_ID = 'ads';
// Keep in sync with DEFAULTS in src/content.js and src/ui.js (no shared module in MV3 plain scripts).
const DEFAULTS = { enabled: true, skip: true, mute: true, hide: true, count: true };
const BUCKETS = ['stripped', 'skipped', 'muted'];
// A break reported from the player carries its own measured length. A renderer removed before the
// player ever saw it has no measurable length, so it is credited a nominal figure rather than a
// guess, and the popup states that assumption next to the number.
const NOMINAL_STRIPPED_SECONDS = 20;
// A backgrounded tab can leave the player reporting one enormous break forever.
const MAX_COUNTED_SECONDS = 600;
let writeQueue = Promise.resolve();

function emptyStats() {
  const stats = { blocked: 0, savedSeconds: 0, creditedSeconds: 0 };
  for (const bucket of BUCKETS) stats[bucket] = 0;
  return stats;
}

function boundedSeconds(value) {
  const seconds = Math.round(Number(value) || 0);
  if (seconds <= 0) return 0;
  return Math.min(seconds, MAX_COUNTED_SECONDS);
}

function applyEvent(stats, message) {
  const kind = BUCKETS.includes(message.kind) ? message.kind : 'skipped';
  // The data layer can clear several renderers from one response: many removals, but one event,
  // so the two counters answer different questions on purpose.
  stats.blocked += Math.max(1, Math.min(20, Number(message.count) || 1));
  stats[kind] += 1;
  if (kind === 'stripped') {
    stats.creditedSeconds += NOMINAL_STRIPPED_SECONDS;
    return stats;
  }
  const measured = boundedSeconds(message.seconds);
  stats.savedSeconds += measured;
  stats.creditedSeconds += measured;
  return stats;
}

async function syncRules() {
  try {
    const { enabled } = await chrome.storage.local.get({ enabled: true });
    const active = await chrome.declarativeNetRequest.getEnabledRulesets();
    const isOn = active.includes(RULE_SET_ID);
    if (enabled && !isOn) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [RULE_SET_ID] });
    } else if (!enabled && isOn) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: [RULE_SET_ID] });
    }
  } catch {
    // DNR unavailable or rejected: leave the ruleset as-is rather than failing the worker.
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set(stored);
  const { stats } = await chrome.storage.local.get({ stats: emptyStats() });
  await chrome.storage.local.set({ stats: { ...emptyStats(), ...stats } });
  await syncRules();
});

chrome.runtime.onStartup.addListener(syncRules);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) syncRules();
});

// One message shape for every layer: ad-event, carrying kind, seconds and count. The player
// measures its own break; the data layer reports a count with no duration. Neither is trusted and
// both are clamped, because a stuck player must not be able to inflate the total forever.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'ad-event') return false;
  let responded = false;
  const respond = (payload) => {
    if (responded) return;
    responded = true;
    try { sendResponse(payload); } catch {}
  };
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get({ stats: emptyStats() });
    const next = applyEvent({ ...emptyStats(), ...stored.stats }, message);
    await chrome.storage.local.set({ stats: next });
    respond({ ok: true, stats: next });
  }).catch(() => {
    // A failed storage operation must not poison the queue or strand later messages.
    respond({ ok: false });
  });
  return true;
});