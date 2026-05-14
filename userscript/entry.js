// Userscript entry. Runs in the page context via Tampermonkey/Violentmonkey.
// Best-effort parity with the extension: mounts the widget, polls while the
// tab is open, fires web Notifications, persists to GM.setValue.

import { mountWidget, refreshWidget } from '../src/ui/widget.js';
import { fetchClaude } from '../src/scrapers/claude.js';
import { fetchCodex } from '../src/scrapers/codex.js';
import { loadState, saveState, defaultState } from '../src/lib/storage.js';
import { recordSnapshot } from '../src/lib/history.js';
import { evaluateRules } from '../src/lib/notify.js';
import { notify } from '../src/lib/browser.js';

const REFRESH_MS_DEFAULT = 5 * 60 * 1000;

(async function main() {
  if (!isHostOk()) return;

  // CSS for shadow DOM is inlined at build time as globals.
  // (build/build-userscript.mjs sets __AUT_THEME_CSS__ + __AUT_WIDGET_CSS__).

  await mountWidget({
    onRefresh: () => refreshNow().then(() => refreshWidget()),
    onOpenSettings: openInlineSettings,
  });

  await refreshNow();
  scheduleNext();

  // Re-render widget every 5s so countdowns tick + "Updated Xs ago" stays fresh.
  setInterval(() => refreshWidget(), 5_000);
})();

function isHostOk() {
  const host = location.hostname;
  return /(^|\.)claude\.ai$/.test(host) || /(^|\.)chatgpt\.com$/.test(host) || /(^|\.)openai\.com$/.test(host);
}

async function refreshNow() {
  const now = new Date();
  const state = (await loadState()) || defaultState();

  const [claude, codex] = await Promise.all([
    fetchClaude({ now }),
    fetchCodex({ now }),
  ]);

  const snapshot = {
    fetchedAtISO: now.toISOString(),
    providers: { claude, codex },
  };
  state.snapshot = snapshot;
  state.history  = recordSnapshot(state.history || [], snapshot, { now });

  const toFire = evaluateRules({
    snapshot,
    history: state.history,
    settings: state.settings,
    firedRules: state.firedRules || {},
    now,
  });
  for (const n of toFire) {
    const fired = await notify({
      id: n.fireKey,
      title: n.title,
      body:  n.body,
      tone:  n.tone,
    });
    if (fired) state.firedRules[n.fireKey] = Date.now();
  }
  await saveState(state);
}

async function scheduleNext() {
  const state = await loadState();
  const minutes = state?.settings?.refreshMinutes ?? 5;
  const ms = Math.max(60_000, minutes * 60_000);
  setTimeout(async () => {
    try { await refreshNow(); } catch (e) { console.warn('AUT refresh failed', e); }
    scheduleNext();
  }, ms);
}

// Userscript has no options page — open a minimal in-page modal.
async function openInlineSettings() {
  const url = 'https://github.com/SysAdminDoc/AI-Usage_Tracker#settings';
  window.open(url, '_blank');
  // v0.2.0: build a proper in-page modal mirroring options.html.
}
