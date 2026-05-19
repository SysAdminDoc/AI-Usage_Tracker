// Service worker. Runs in Chrome MV3 + Firefox MV3.
//
// Refresh strategy:
//   1) Fast path: direct authenticated API fetch(). Claude uses
//      /api/organizations/{orgId}/usage; Codex uses /backend-api/wham/usage
//      with the logged-in ChatGPT session's bearer token/account id.
//   2) Live path: an analytics-scraper.js content script that runs whenever
//      the user is on either analytics page. When it scrapes a stable
//      snapshot from the rendered DOM, it ships the result here via
//      `aut/scraped` and we persist it.
//   3) On alarm: if the fast path returned no data and we have stale
//      cached data, optionally open a silent background tab to force a
//      live scrape. Enabled via settings.silentTabRefresh (default true).

import { fetchClaude } from './scrapers/claude.js';
import { fetchCodex }  from './scrapers/codex.js';
import { loadState, saveState, defaultState } from './lib/storage.js';
import { recordSnapshot } from './lib/history.js';
import { evaluateRules } from './lib/notify.js';
import { notify, schedule, onMessage } from './lib/browser.js';

const ALARM_NAME = 'aut-refresh';

const STALE_MS = 10 * 60 * 1000;   // only force a silent-tab refresh if cached data is older than this

init();

function init() {
  bindMessageHandlers();
  bindAlarm();
}

function bindMessageHandlers() {
  onMessage(async (msg) => {
    if (!msg || !msg.type) return null;

    if (msg.type === 'aut/refresh') {
      await refreshNow({ allowSilentTab: true });
      return { ok: true };
    }
    if (msg.type === 'aut/reschedule') {
      await reschedule();
      return { ok: true };
    }
    if (msg.type === 'aut/get-snapshot') {
      return await loadState();
    }
    if (msg.type === 'aut/open-analytics') {
      await openAnalyticsTabs(msg.provider);
      return { ok: true };
    }
    if (msg.type === 'aut/scraped') {
      // Live snapshot from analytics-scraper.js running on the analytics page.
      await ingestProviderSnapshot(msg.parsed, { source: 'live' });
      return { ok: true };
    }
    return null;
  });
}

async function bindAlarm() {
  const state = await loadState();
  const minutes = state?.settings?.refreshMinutes ?? 5;
  schedule({
    name: ALARM_NAME,
    minutes,
    onFire: () => refreshNow({ allowSilentTab: true }).catch(console.error),
  });
}

async function reschedule() {
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    await new Promise((r) => chrome.alarms.clear(ALARM_NAME, r));
  } else if (typeof browser !== 'undefined' && browser.alarms) {
    await browser.alarms.clear(ALARM_NAME);
  }
  await bindAlarm();
}

async function refreshNow({ allowSilentTab = false } = {}) {
  const now = new Date();
  let state = (await loadState()) || defaultState();

  // 1) Best-effort direct fetch. If either side is SSR'd we get a free win.
  const [claude, codex] = await Promise.all([
    fetchClaude({ now }).catch((e) => ({ ok: false, provider: 'claude', error: String(e) })),
    fetchCodex({ now }).catch((e) =>  ({ ok: false, provider: 'codex',  error: String(e) })),
  ]);
  state = await mergeSnapshot(state, claude, { source: 'fetch', now });
  state = await mergeSnapshot(state, codex,  { source: 'fetch', now });

  // 2) For any provider that's still stale, ask a silent tab to refresh.
  if (allowSilentTab) {
    const needsClaude = needsSilentRefresh(state, 'claude', now);
    const needsCodex  = needsSilentRefresh(state, 'codex',  now);
    if (needsClaude) await silentTabRefresh('claude');
    if (needsCodex)  await silentTabRefresh('codex');
    // The content script in those tabs will message `aut/scraped` back —
    // we don't await it here. Notifications will evaluate on that ingest.
  }

  await fireNotifications(state, now);
  return state;
}

function needsSilentRefresh(state, provider, now) {
  const ps = state?.snapshot?.providers?.[provider];
  if (!ps || !ps.ok) return true;
  const ts = state.snapshot.fetchedAtISO ? new Date(state.snapshot.fetchedAtISO).getTime() : 0;
  return (now.getTime() - ts) > STALE_MS;
}

async function silentTabRefresh(provider) {
  const ns = (typeof chrome !== 'undefined' && chrome.tabs)
          || (typeof browser !== 'undefined' && browser.tabs);
  if (!ns || !ns.create) return;

  const url = provider === 'claude'
    ? 'https://claude.ai/settings/usage'
    : 'https://chatgpt.com/codex/cloud/settings/analytics#usage';

  let tab;
  try {
    tab = await new Promise((resolve, reject) => {
      try {
        const cb = (t) => (chrome.runtime?.lastError ? reject(chrome.runtime.lastError) : resolve(t));
        const result = ns.create({ url, active: false }, cb);
        if (result && typeof result.then === 'function') result.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  } catch (e) {
    console.warn('[AUT] silent tab open failed', provider, e);
    return;
  }

  // Auto-close after 20s — the content script's stable-snapshot push should
  // have fired well before then.
  setTimeout(() => {
    try {
      if (ns.remove && tab && tab.id != null) ns.remove(tab.id);
    } catch { /* tab may already be closed by the user */ }
  }, 20_000);
}

async function ingestProviderSnapshot(parsed, { source, now = new Date() } = {}) {
  if (!parsed || !parsed.provider) return;
  let state = (await loadState()) || defaultState();
  state = await mergeSnapshot(state, parsed, { source, now });
  await fireNotifications(state, now);
}

async function mergeSnapshot(state, providerSnapshot, { source, now }) {
  if (!providerSnapshot || !providerSnapshot.provider) return state;
  const next = { ...state };
  next.snapshot = next.snapshot || { fetchedAtISO: null, providers: {} };
  // If we already have a successful snapshot and the new one failed,
  // keep the previous one rather than overwriting it with an error.
  const prev = next.snapshot.providers[providerSnapshot.provider];
  if (!providerSnapshot.ok && prev && prev.ok) {
    // Keep prev; do not overwrite.
  } else {
    next.snapshot.providers[providerSnapshot.provider] = providerSnapshot;
  }
  next.snapshot.fetchedAtISO = now.toISOString();
  next.history = recordSnapshot(next.history || [], next.snapshot, { now });
  await saveState(next);
  return next;
}

async function fireNotifications(state, now) {
  const toFire = evaluateRules({
    snapshot: state.snapshot,
    history:  state.history,
    settings: state.settings,
    firedRules: state.firedRules || {},
    now,
  });
  for (const n of toFire) {
    const ok = await notify({ id: n.fireKey, title: n.title, body: n.body, tone: n.tone });
    if (ok) state.firedRules[n.fireKey] = Date.now();
  }
  state.firedRules = pruneFired(state.firedRules, now);
  await saveState(state);
}

async function openAnalyticsTabs(which = 'both') {
  const ns = (typeof chrome !== 'undefined' && chrome.tabs)
          || (typeof browser !== 'undefined' && browser.tabs);
  if (!ns || !ns.create) return;
  const urls = [];
  if (which === 'both' || which === 'claude') urls.push('https://claude.ai/settings/usage');
  if (which === 'both' || which === 'codex')  urls.push('https://chatgpt.com/codex/cloud/settings/analytics#usage');
  for (const url of urls) {
    try { ns.create({ url, active: true }); } catch (e) { console.warn(e); }
  }
}

function pruneFired(firedRules, now) {
  const cutoff = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  const out = {};
  for (const [k, ts] of Object.entries(firedRules || {})) {
    if (typeof ts === 'number' && ts < cutoff) continue;
    out[k] = ts;
  }
  return out;
}
