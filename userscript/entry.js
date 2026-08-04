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
import { openInlineSettings as showInlineSettings } from '../src/ui/inline-settings.js';
import { isClaudeHost, isSupportedHost } from '../src/lib/hosts.js';

const REFRESH_MS_DEFAULT = 5 * 60 * 1000;
const MOBILE_LAYOUT_MAX_WIDTH = 640;

let mobileLayout = false;

(async function main() {
  if (!isSupportedHost(location.hostname)) return;

  mobileLayout = isMobileViewport();

  installClaudeStreamInterceptor();

  // CSS for shadow DOM is inlined at build time as globals.
  // (build/build-userscript.mjs sets __AUT_THEME_CSS__ + __AUT_WIDGET_CSS__).

  await mountWidget({
    onRefresh: () => refreshNow().then(() => refreshWidget()),
    onOpenSettings: openInlineSettings,
    mobile: mobileLayout,
  });

  await refreshNow();
  startClaudeContextCounter({
    readState: loadState,
    writeState: saveState,
    onChange: () => refreshWidget(),
  });
  scheduleNext();

  window.addEventListener('resize', handleViewportResize, { passive: true });

  // Re-render widget every 5s so countdowns tick + "Updated Xs ago" stays fresh.
  setInterval(() => refreshWidget(), 5_000);
})();

function isMobileViewport() {
  const narrow = Number(window.innerWidth) > 0 && window.innerWidth <= MOBILE_LAYOUT_MAX_WIDTH;
  const coarse = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  return narrow || coarse;
}

function handleViewportResize() {
  const next = isMobileViewport();
  if (next === mobileLayout) return;
  mobileLayout = next;
  refreshWidget({ mobile: mobileLayout }).catch((error) => {
    console.warn('AUT mobile layout refresh failed', error);
  });
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
  state.history  = recordSnapshot(state.history || [], snapshot, {
    now,
    retentionDays: state.settings?.historyRetentionDays,
  });

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
  if (!isClaudeHost(location.hostname)) return;
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
  state.history = recordSnapshot(state.history || [], snapshot, {
    now,
    retentionDays: state.settings?.historyRetentionDays,
  });

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
  const nowISO = new Date().toISOString();
  if (next && next.ok) {
    return {
      ...next,
      lastSuccessISO: nowISO,
      lastSuccessSource: next.source || 'unknown',
      lastErrorISO: previous?.lastErrorISO || null,
      lastErrorDetail: previous?.lastErrorDetail || null,
      lastErrorCode: previous?.lastErrorCode || null,
      stale: false,
    };
  }
  if (previous && previous.ok) {
    return {
      ...previous,
      lastErrorISO: nowISO,
      lastErrorDetail: next?.error || 'unknown',
      lastErrorCode: next?.errorCode || null,
      stale: true,
    };
  }
  return {
    ...next,
    lastErrorISO: nowISO,
    lastErrorDetail: next?.error || 'unknown',
    lastErrorCode: next?.errorCode || null,
    stale: true,
  };
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
  await showInlineSettings({ onSaved: () => refreshWidget() });
}
