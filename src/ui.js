'use strict';
// Keep in sync with DEFAULTS in src/background.js and src/content.js (no shared module in MV3 plain scripts).
const DEFAULTS = { enabled: true, skip: true, mute: true, hide: true, count: true };
const STATS = { blocked: 0, savedSeconds: 0, creditedSeconds: 0, stripped: 0, skipped: 0, muted: 0 };
const boxes = [...document.querySelectorAll('input[data-key]')];
function formatCount(n) { return (Number(n) || 0).toLocaleString(); }
// Under a minute we print the raw figure. Rounding forty seconds to "0m" makes a working
// extension look broken, which is worse than an imprecise number.
function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}
function paint(values) {
  for (const box of boxes) box.checked = Boolean(values[box.dataset.key]);
  const stats = { ...STATS, ...(values.stats || {}) };
  setText('saved', formatDuration(stats.creditedSeconds));
  setText('saved-sub', stats.savedSeconds
    ? `${formatDuration(stats.savedSeconds)} measured in the player, the rest credited at 20s each`
    : 'nothing measured yet');
  setText('blocked', formatCount(stats.blocked));
  setText('meter-count', formatCount(stats.blocked));
  setText('n-stripped', formatCount(stats.stripped));
  setText('n-skipped', formatCount(stats.skipped));
  setText('n-sat', formatCount(stats.muted));
  // Pip meter fills left-to-right as breaks are removed; caps at the pip count.
  const meter = document.getElementById('meter');
  if (meter) {
    const pips = meter.children;
    const on = Math.min(pips.length, Math.max(0, Number(stats.blocked) || 0));
    for (let i = 0; i < pips.length; i += 1) pips[i].classList.toggle('on', i < on);
  }
  const isEnabled = values.enabled !== false;
  document.body.classList.toggle('paused', !isEnabled);
  setText('status-text', isEnabled ? 'Active' : 'Paused');
}
function paintRules() {
  const node = document.getElementById('rules');
  if (!node) return;
  chrome.declarativeNetRequest.getEnabledRulesets().then((ids) => {
    const on = ids.includes('ads');
    node.textContent = on ? '● DNR rules active' : '○ DNR rules paused';
    node.className = on ? 'ok' : 'off';
  }).catch(() => {
    node.textContent = '○ Rules status unavailable';
    node.className = 'off';
  });
}
// Guard against overlapping loads: storage change bursts would otherwise stack
// async paints and flash stale numbers over fresh ones.
let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  try {
    const values = await chrome.storage.local.get({ ...DEFAULTS, stats: STATS });
    paint(values);
    paintRules();
  } catch {
    // Storage unavailable (e.g. context invalidated): keep the last painted state.
  } finally {
    loading = false;
    // Entrance animation runs once, on first paint only — never on repaints.
    document.body.classList.add('ready');
  }
}
for (const box of boxes) {
  box.addEventListener('change', async () => {
    await chrome.storage.local.set({ [box.dataset.key]: box.checked });
    load();
  });
}
document.getElementById('reset').addEventListener('click', async () => {
  await chrome.storage.local.set({ stats: { ...STATS } });
  load();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.stats || changes.enabled)) load();
});
const manifest = chrome.runtime.getManifest();
setText('version', `v${manifest.version}`);
load();
