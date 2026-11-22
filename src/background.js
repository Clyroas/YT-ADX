'use strict';

const RULE_SET_ID = 'ads';
const DEFAULTS = { enabled: true, skip: true, mute: true, hide: true, count: true, blocked: 0 };
let writeQueue = Promise.resolve();

async function syncRules() {
  const { enabled } = await chrome.storage.local.get({ enabled: true });
  const active = await chrome.declarativeNetRequest.getEnabledRulesets();
  const isOn = active.includes(RULE_SET_ID);
  if (enabled && !isOn) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [RULE_SET_ID] });
  } else if (!enabled && isOn) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: [RULE_SET_ID] });
  }
}

async function paintBadge(total) {
  const { count: showCount } = await chrome.storage.local.get({ count: true });
  if (!showCount) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const n = Number(total) || 0;
  const text = n > 999 ? `${Math.floor(n / 100) / 10}k` : n ? String(n) : '';
  chrome.action.setBadgeBackgroundColor({ color: '#ff2d55' });
  chrome.action.setBadgeText({ text });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set(stored);
  await syncRules();
  await paintBadge(stored.blocked);
});

chrome.runtime.onStartup.addListener(async () => {
  await syncRules();
  const { blocked } = await chrome.storage.local.get({ blocked: 0 });
  await paintBadge(blocked);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled) await syncRules();
  if (changes.blocked) await paintBadge(changes.blocked.newValue);
  if (changes.count) {
    const { blocked } = await chrome.storage.local.get({ blocked: 0 });
    await paintBadge(blocked);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'ad-skipped') return false;
  const delta = Math.max(1, Math.min(20, Number(message.count) || 1));
  writeQueue = writeQueue.then(async () => {
    const { blocked, count: shouldCount } = await chrome.storage.local.get({ blocked: 0, count: true });
    if (!shouldCount) {
      sendResponse({ ok: true, blocked });
      return;
    }
    const next = (Number(blocked) || 0) + delta;
    await chrome.storage.local.set({ blocked: next });
    sendResponse({ ok: true, blocked: next });
  });
  return true;
});