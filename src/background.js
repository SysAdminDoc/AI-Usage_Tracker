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
//   3) On alarm: if the fast path returned no data and the opt-in fallback
//      is enabled, open a silent background tab to force a live scrape.

import { fetchClaude, parseClaudeUsageApi, clearClaudeOrgCache } from './scrapers/claude.js';
import { fetchCodex }  from './scrapers/codex.js';
import { isIncognitoContext, loadState, saveState, defaultState } from './lib/storage.js';
import { recordSnapshot } from './lib/history.js';
import {
  buildWebhookPayload,
  deliverWebhook,
  deriveNextNotificationAlarm,
  evaluateRules,
} from './lib/notify.js';
import { cancelSchedule, invokeWebExtension, notify, schedule, scheduleAt, onMessage } from './lib/browser.js';
import { pushSnapshot } from './lib/bridge.js';
import { updateToolbarBadge } from './lib/badge.js';
import { extractClaudeCacheTimer, mergeCacheTimer } from './lib/cache-timer.js';
import { forgetApiProvider, updateBudgetLedger } from './lib/budget.js';
import { loadApiCredential } from './lib/storage.js';
import { API_PROVIDER_IDS } from './providers/api-contract.js';
import { fetchProviderUsage } from './providers/registry.js';

const ALARM_NAME = 'aut-refresh';
const NOTIFICATION_ALARM_NAME = 'aut-notification';

const STALE_MS = 10 * 60 * 1000;   // only force a silent-tab refresh if cached data is older than this

init();

function init() {
  bindMessageHandlers();
  bindAlarm();
  refreshToolbarBadge().catch(console.error);
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
    if (msg.type === 'aut/settings-updated') {
      await refreshToolbarBadge();
      return { ok: true };
    }
    if (msg.type === 'aut/profile-updated') {
      await reschedule();
      await refreshToolbarBadge();
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
    if (msg.type === 'aut/claude-message-limit') {
      await ingestClaudeUsageWindows(msg.messageLimit, { source: 'stream' });
      return { ok: true };
    }
    if (msg.type === 'aut/claude-rate-limit-headers') {
      await ingestClaudeUsageWindows(msg.rateLimit, { source: 'headers' });
      return { ok: true };
    }
    if (msg.type === 'aut/reset-claude-org') {
      clearClaudeOrgCache();
      await refreshNow({ allowSilentTab: false });
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
  await scheduleNotificationAlarm(state, new Date());
}

async function reschedule() {
  await cancelSchedule(ALARM_NAME);
  await bindAlarm();
}

async function refreshNow({ allowSilentTab = false } = {}) {
  const now = new Date();
  let state = (await loadState()) || defaultState();
  const apiCredentials = await Promise.all(API_PROVIDER_IDS.map((provider) => loadApiCredential(provider)));

  // 1) Best-effort direct fetch. If either side is SSR'd we get a free win.
  const [claude, codex] = await Promise.all([
    fetchClaude({ now }).catch((e) => ({ ok: false, provider: 'claude', error: String(e) })),
    fetchCodex({ now }).catch((e) =>  ({ ok: false, provider: 'codex',  error: String(e) })),
  ]);
  const apiSnapshots = await Promise.all(API_PROVIDER_IDS.map((provider, index) => {
    const credential = apiCredentials[index];
    if (!credential) return null;
    return fetchProviderUsage(provider, {
      credential,
      settings: state.settings,
      now,
    }).catch(() => ({
      ok: false,
      provider,
      error: 'api-refresh-failed',
      errorCode: `${provider}.refresh.failed`,
    }));
  }));
  state = await mergeSnapshot(state, claude, { source: 'fetch', now });
  state = await mergeSnapshot(state, codex,  { source: 'fetch', now });
  for (const [index, provider] of API_PROVIDER_IDS.entries()) {
    if (!apiCredentials[index]) {
      state.snapshot.providers[provider] = null;
      state.budget = forgetApiProvider(state.budget, provider, now);
    }
    else state = await mergeSnapshot(state, apiSnapshots[index], { source: 'api-key', now });
  }
  state.budget = updateBudgetLedger(state.budget, state.snapshot, { now }).ledger;
  await saveState(state);

  // 2) For any provider that's still stale, optionally ask a silent tab to refresh.
  if (allowSilentTab && state.settings?.silentTabRefresh === true) {
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
  // Use per-provider freshness timestamp if available, else fall back to snapshot-level.
  const providerTs = ps.lastSuccessISO ? new Date(ps.lastSuccessISO).getTime() : 0;
  const snapshotTs = state.snapshot.fetchedAtISO ? new Date(state.snapshot.fetchedAtISO).getTime() : 0;
  const ts = providerTs || snapshotTs;
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
    tab = await invokeWebExtension(ns, 'create', [{ url, active: false }]);
  } catch (e) {
    console.warn('[AUT] silent tab open failed', provider, e);
    return;
  }

  // Auto-close after 20s — the content script's stable-snapshot push should
  // have fired well before then.
  setTimeout(() => {
    if (ns.remove && tab && tab.id != null) {
      invokeWebExtension(ns, 'remove', [tab.id]).catch(() => {});
    }
  }, 20_000);
}

async function ingestProviderSnapshot(parsed, { source, now = new Date() } = {}) {
  if (!parsed || !parsed.provider) return;
  let state = (await loadState()) || defaultState();
  state = await mergeSnapshot(state, parsed, { source, now });
  await fireNotifications(state, now);
}

async function ingestClaudeUsageWindows(messageLimit, { source = 'stream', now = new Date() } = {}) {
  const cacheTimer = extractClaudeCacheTimer(messageLimit, { now, source });
  const parsed = parseClaudeUsageApi({ message_limit: messageLimit }, { now });
  if (!parsed.ok) {
    if (cacheTimer) await saveState(mergeCacheTimer((await loadState()) || defaultState(), cacheTimer));
    return;
  }

  let state = (await loadState()) || defaultState();
  const previous = state.snapshot?.providers?.claude;
  const merged = mergeProviderBuckets(previous, { ...parsed, source });
  state = mergeCacheTimer(state, cacheTimer);
  state = await mergeSnapshot(state, merged, { source, now });
  await fireNotifications(state, now);
}

async function mergeSnapshot(state, providerSnapshot, { source, now }) {
  if (!providerSnapshot || !providerSnapshot.provider) return state;
  const next = { ...state };
  const providerKey = providerSnapshot.provider;
  next.snapshot = next.snapshot || { fetchedAtISO: null, providers: {} };

  const prev = next.snapshot.providers[providerKey];
  const nowISO = now.toISOString();

  if (!providerSnapshot.ok && prev && prev.ok) {
    // Keep previous successful data, but stamp error freshness so the UI
    // can show that the latest fetch failed while displaying preserved data.
    next.snapshot.providers[providerKey] = {
      ...prev,
      lastErrorISO: nowISO,
      lastErrorDetail: providerSnapshot.error || 'unknown',
      lastErrorCode: providerSnapshot.errorCode || null,
      stale: true,
    };
  } else if (providerSnapshot.ok) {
    next.snapshot.providers[providerKey] = {
      ...providerSnapshot,
      lastSuccessISO: nowISO,
      lastSuccessSource: source || providerSnapshot.source || 'unknown',
      lastErrorISO: prev?.lastErrorISO || null,
      lastErrorDetail: prev?.lastErrorDetail || null,
      lastErrorCode: prev?.lastErrorCode || null,
      stale: false,
    };
  } else {
    // No previous success and new fetch failed.
    next.snapshot.providers[providerKey] = {
      ...providerSnapshot,
      lastErrorISO: nowISO,
      lastErrorDetail: providerSnapshot.error || 'unknown',
      lastErrorCode: providerSnapshot.errorCode || null,
      stale: true,
    };
  }

  next.snapshot.fetchedAtISO = nowISO;
  next.history = recordSnapshot(next.history || [], next.snapshot, {
    now,
    retentionDays: next.settings?.historyRetentionDays,
  });
  await saveState(next);
  await updateToolbarBadge(next);
  // Forward to QuotaGlass desktop widget (no-op if NMH not installed).
  try {
    const version = chrome.runtime?.getManifest?.()?.version;
    if (!isIncognitoContext()) pushSnapshot(next, version);
  } catch (e) {
    // Bridge failures must never break the extension's own data path.
    console.info('[AUT] bridge push failed:', e?.message || e);
  }
  return next;
}

async function refreshToolbarBadge() {
  await updateToolbarBadge(await loadState());
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

async function fireNotifications(state, now) {
  const toFire = evaluateRules({
    snapshot: state.snapshot,
    history:  state.history,
    settings: state.settings,
    budget: state.budget,
    firedRules: state.firedRules || {},
    now,
  });
  state.firedRules = state.firedRules || {};
  for (const n of toFire) {
    const ok = await notify({ id: n.fireKey, title: n.title, body: n.body, tone: n.tone });
    let webhook = { ok: false, skipped: true };
    if (state.settings?.notifications?.webhookEnabled === true) {
      webhook = await deliverWebhook({
        url: state.settings.notifications.webhookURL,
        payload: buildWebhookPayload(n, {
          includeDetails: state.settings.notifications.webhookIncludeDetails === true,
          now,
        }),
      });
      recordWebhookStatus(state, webhook, now);
    }
    if (ok || webhook.ok) state.firedRules[n.fireKey] = Date.now();
  }
  state.firedRules = pruneFired(state.firedRules, now);
  await saveState(state);
  await scheduleNotificationAlarm(state, now);
}

function recordWebhookStatus(state, result, now) {
  const notifications = { ...(state.settings?.notifications || {}) };
  notifications.webhookLastAttemptISO = now.toISOString();
  notifications.webhookLastAttempts = Number(result.attempts) || 0;
  if (result.ok) {
    notifications.webhookLastSuccessISO = now.toISOString();
    notifications.webhookLastErrorCode = null;
  } else {
    notifications.webhookLastErrorCode = result.errorCode || 'webhook.delivery-failed';
  }
  state.settings = { ...(state.settings || {}), notifications };
}

async function scheduleNotificationAlarm(state, now) {
  const next = deriveNextNotificationAlarm({
    snapshot: state?.snapshot,
    settings: state?.settings || {},
    firedRules: state?.firedRules || {},
    now,
  });
  if (!next) {
    cancelSchedule(NOTIFICATION_ALARM_NAME);
    return;
  }
  scheduleAt({
    name: NOTIFICATION_ALARM_NAME,
    when: next.at,
    onFire: async () => {
      const current = await loadState();
      await fireNotifications(current || defaultState(), new Date());
    },
  });
}

async function openAnalyticsTabs(which = 'both') {
  const ns = (typeof chrome !== 'undefined' && chrome.tabs)
          || (typeof browser !== 'undefined' && browser.tabs);
  if (!ns || !ns.create) return;
  const urls = [];
  if (which === 'both' || which === 'claude') urls.push('https://claude.ai/settings/usage');
  if (which === 'both' || which === 'codex')  urls.push('https://chatgpt.com/codex/cloud/settings/analytics#usage');
  for (const url of urls) {
    invokeWebExtension(ns, 'create', [{ url, active: true }]).catch((error) => console.warn(error));
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
