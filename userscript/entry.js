// Userscript entry. Runs in the page context via Tampermonkey/Violentmonkey.
// Best-effort parity with the extension: mounts the widget, polls while the
// tab is open, fires web Notifications, persists to GM.setValue.

import { mountWidget, refreshWidget } from '../src/ui/widget.js';
import { fetchClaude, parseClaudeUsageApi } from '../src/scrapers/claude.js';
import { fetchCodex } from '../src/scrapers/codex.js';
import { loadState, saveState, defaultState } from '../src/lib/storage.js';
import { recordSnapshot } from '../src/lib/history.js';
import { evaluateRules } from '../src/lib/notify.js';
import { notify } from '../src/lib/browser.js';
import { installClaudeMessageLimitInterceptor } from '../src/lib/claude-stream.js';
import { startClaudeContextCounter } from '../src/lib/context-counter.js';
import { extractClaudeCacheTimer, mergeCacheTimer } from '../src/lib/cache-timer.js';

const REFRESH_MS_DEFAULT = 5 * 60 * 1000;

(async function main() {
  if (!isHostOk()) return;

  installClaudeStreamInterceptor();

  // CSS for shadow DOM is inlined at build time as globals.
  // (build/build-userscript.mjs sets __AUT_THEME_CSS__ + __AUT_WIDGET_CSS__).

  await mountWidget({
    onRefresh: () => refreshNow().then(() => refreshWidget()),
    onOpenSettings: openInlineSettings,
  });

  await refreshNow();
  startClaudeContextCounter({
    readState: loadState,
    writeState: saveState,
    onChange: () => refreshWidget(),
  });
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

  const prevProviders = state.snapshot?.providers || {};
  const snapshot = {
    fetchedAtISO: now.toISOString(),
    providers: {
      claude: keepPreviousSuccess(prevProviders.claude, claude),
      codex: keepPreviousSuccess(prevProviders.codex, codex),
    },
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

function installClaudeStreamInterceptor() {
  if (!/(^|\.)claude\.ai$/.test(location.hostname)) return;
  const target = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  installClaudeMessageLimitInterceptor({
    target,
    emit(messageLimit) {
      ingestClaudeUsageWindows(messageLimit, { source: 'stream' })
        .then(() => refreshWidget())
        .catch((e) => console.warn('AUT Claude stream ingest failed', e));
    },
    emitRateLimit(rateLimit) {
      ingestClaudeUsageWindows(rateLimit, { source: 'headers' })
        .then(() => refreshWidget())
        .catch((e) => console.warn('AUT Claude header ingest failed', e));
    },
  });
}

async function ingestClaudeUsageWindows(messageLimit, { source = 'stream' } = {}) {
  const now = new Date();
  const cacheTimer = extractClaudeCacheTimer(messageLimit, { now, source });
  const parsed = parseClaudeUsageApi({ message_limit: messageLimit }, { now });
  if (!parsed.ok) {
    if (cacheTimer) await saveState(mergeCacheTimer((await loadState()) || defaultState(), cacheTimer));
    return;
  }

  let state = (await loadState()) || defaultState();
  const previous = state.snapshot?.providers?.claude;
  const providers = state.snapshot?.providers || {};
  state = mergeCacheTimer(state, cacheTimer);
  const snapshot = {
    fetchedAtISO: now.toISOString(),
    providers: {
      ...providers,
      claude: mergeProviderBuckets(previous, { ...parsed, source }),
    },
  };
  state.snapshot = snapshot;
  state.history = recordSnapshot(state.history || [], snapshot, { now });

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
      body: n.body,
      tone: n.tone,
    });
    if (fired) state.firedRules[n.fireKey] = Date.now();
  }
  await saveState(state);
}

function keepPreviousSuccess(previous, next) {
  if (next && next.ok) return next;
  if (previous && previous.ok) return previous;
  return next;
}

function mergeProviderBuckets(previous, next) {
  if (!previous?.ok) return next;
  const buckets = new Map();
  for (const bucket of previous.buckets || []) buckets.set(bucket.id, bucket);
  for (const bucket of next.buckets || []) buckets.set(bucket.id, bucket);
  return {
    ...previous,
    ...next,
    plan: next.plan || previous.plan || null,
    orgId: next.orgId || previous.orgId || null,
    buckets: [...buckets.values()],
  };
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
  // Future: build a proper in-page modal mirroring options.html.
}
