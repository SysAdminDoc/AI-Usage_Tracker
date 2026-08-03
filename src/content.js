// Content script — mounts the widget on claude.ai and chatgpt.com.
// Sends refresh requests to the background; renders from cached state.

import { mountWidget, refreshWidget } from './ui/widget.js';
import { loadState, saveState } from './lib/storage.js';
import { send } from './lib/browser.js';
import { startClaudeContextCounter } from './lib/context-counter.js';
import { isSupportedHost } from './lib/hosts.js';

(async function main() {
  // Some sub-paths of these origins are full-screen experiences (e.g. inline
  // assistants in third-party embeds). Only mount on the primary chat origins.
  if (!isSupportedHost(location.hostname)) return;

  await mountWidget({
    onRefresh: async () => {
      await send({ type: 'aut/refresh' });
      // Give the background ~600ms to write the new snapshot.
      setTimeout(() => refreshWidget({ onRefresh: () => send({ type: 'aut/refresh' }), onOpenSettings: openOptions }), 800);
    },
    onOpenSettings: openOptions,
  });

  // Re-render every 5s so percent rings and footer "Updated Xs ago" stay fresh
  // even when the background hasn't fetched.
  setInterval(() => refreshWidget({ onRefresh: () => send({ type: 'aut/refresh' }), onOpenSettings: openOptions }), 5_000);

  // Listen for storage changes pushed by the background (cross-context sync).
  watchStorage(() => refreshWidget({ onRefresh: () => send({ type: 'aut/refresh' }), onOpenSettings: openOptions }));

  startClaudeContextCounter({
    readState: loadState,
    writeState: saveState,
    onChange: () => refreshWidget({ onRefresh: () => send({ type: 'aut/refresh' }), onOpenSettings: openOptions }),
  });
})();

function openOptions() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.openOptionsPage) {
    browser.runtime.openOptionsPage();
  } else {
    window.open('options.html', '_blank');
  }
}

function watchStorage(handler) {
  const api = (typeof chrome !== 'undefined' && chrome.storage)
           || (typeof browser !== 'undefined' && browser.storage);
  if (!api || !api.onChanged) return;
  api.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes && changes['aut.state.v1']) handler();
  });
}
