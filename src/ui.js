'use strict';
const DEFAULTS = { enabled: true, skip: true, mute: true, hide: true, count: true, blocked: 0 };
const boxes = [...document.querySelectorAll('input[data-key]')];
function formatCount(n) { return (Number(n) || 0).toLocaleString(); }
function paint(values) {
  for (const box of boxes) box.checked = Boolean(values[box.dataset.key]);
  document.getElementById('blocked').textContent = formatCount(values.blocked);
  const isEnabled = values.enabled !== false;
  document.body.classList.toggle('paused', !isEnabled);
  document.getElementById('status-text').textContent = isEnabled ? 'Active' : 'Paused';
}
function paintRules() {
  const node = document.getElementById('rules');
  chrome.declarativeNetRequest.getEnabledRulesets().then((ids) => {
    const on = ids.includes('ads');
    node.textContent = on ? '● DNR rules active' : '○ DNR rules paused';
    node.className = on ? 'ok' : 'off';
  });
}
async function load() {
  const values = await chrome.storage.local.get(DEFAULTS);
  paint(values);
  paintRules();
}
for (const box of boxes) {
  box.addEventListener('change', async () => {
    await chrome.storage.local.set({ [box.dataset.key]: box.checked });
    if (box.dataset.key === 'count' && !box.checked) chrome.action.setBadgeText({ text: '' });
    const values = await chrome.storage.local.get(DEFAULTS);
    paint(values);
    paintRules();
  });
}
document.getElementById('reset').addEventListener('click', async () => {
  await chrome.storage.local.set({ blocked: 0 });
  chrome.action.setBadgeText({ text: '' });
  document.getElementById('blocked').textContent = '0';
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.blocked) document.getElementById('blocked').textContent = formatCount(changes.blocked.newValue);
});
const manifest = chrome.runtime.getManifest();
document.getElementById('version').textContent = `v${manifest.version}`;
load();