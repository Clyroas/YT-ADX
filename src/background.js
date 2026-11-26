'use strict';
const RULE_SET_ID = 'ads';
const DEFAULTS = { enabled: true, skip: true, mute: true, hide: true };
async function syncRules() {
  try {
    const { enabled } = await chrome.storage.local.get({ enabled: true });
    const active = await chrome.declarativeNetRequest.getEnabledRulesets();
    const isOn = active.includes(RULE_SET_ID);
    if (enabled && !isOn) await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [RULE_SET_ID] });
    else if (!enabled && isOn) await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: [RULE_SET_ID] });
  } catch {}
}
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set(stored);

  await syncRules();
});
chrome.runtime.onStartup.addListener(syncRules);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.enabled) syncRules(); });
