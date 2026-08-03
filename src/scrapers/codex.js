// Codex usage scraper. Primary path is the same WHAM JSON endpoint used by
// Codex CLI:
//   GET /api/auth/session -> ChatGPT access token + account id
//   GET /backend-api/wham/usage -> rate_limit windows
//
// The analytics-page DOM and raw-HTML parsers stay as fallbacks for endpoint
// drift or logged-out/shell responses. All paths return:
//   { ok, provider:'codex', plan, source, buckets[] }

import { parseResetString } from '../lib/countdown.js';

export const CODEX_URL = 'https://chatgpt.com/codex/cloud/settings/analytics#usage';
export const CODEX_AUTH_SESSION_URL = 'https://chatgpt.com/api/auth/session';
export const CODEX_USAGE_API_URL = 'https://chatgpt.com/backend-api/wham/usage';

function codexFailure(source, errorCode, error, extra = {}) {
  return {
    ok: false,
    provider: 'codex',
    source,
    error,
    errorCode: `codex.${errorCode}`,
    ...extra,
  };
}

export async function fetchCodex({ now = new Date(), fetchImpl = null } = {}) {
  const api = await fetchCodexApi({ now, fetchImpl });
  if (api.ok) return api;

  const page = await fetchCodexAnalyticsPage({ now, fetchImpl });
  if (page.ok) return page;

  return { ...api, fallbackError: page.error };
}

export async function fetchCodexApi({ now = new Date(), fetchImpl = null } = {}) {
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return codexFailure('api', 'fetch.unavailable', 'fetch-unavailable');

  const auth = await getChatGptAuthContext({ fetchImpl: doFetch });
  const headers = { Accept: 'application/json' };
  if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;
  if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId;

  try {
    const res = await doFetch(CODEX_USAGE_API_URL, {
      credentials: 'include',
      headers,
    });
    if (!res.ok) {
      return codexFailure('api', 'usage.http', `usage-http-${res.status}${auth.error ? `; ${auth.error}` : ''}`, {
        status: res.status,
        authErrorCode: auth.errorCode || null,
      });
    }
    const data = await res.json();
    return parseCodexUsageApi(data, { now, accountId: auth.accountId, authSource: auth.source });
  } catch (err) {
    return codexFailure('api', 'usage.fetch-failed', `usage-fetch-failed: ${String(err)}`, {
      authErrorCode: auth.errorCode || null,
    });
  }
}

export async function getChatGptAuthContext({ fetchImpl = null } = {}) {
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return codexFailure('auth', 'auth.fetch-unavailable', 'fetch-unavailable');

  try {
    const res = await doFetch(CODEX_AUTH_SESSION_URL, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return codexFailure('auth', 'auth.http', `auth-http-${res.status}`, { status: res.status });

    const data = await res.json();
    const accessToken = findFirstStringDeep(data, [
      'accessToken',
      'access_token',
      'token',
    ]);
    const claims = decodeJwtPayload(accessToken);
    const accountId = extractChatGptAccountId(data, claims);
    const plan = extractChatGptPlan(data, claims);

    return {
      ok: !!accessToken,
      provider: 'codex',
      source: 'session',
      accessToken,
      accountId,
      plan,
      error: accessToken ? null : 'auth-token-not-found',
      errorCode: accessToken ? null : 'codex.auth.missing-token',
    };
  } catch (err) {
    return codexFailure('auth', 'auth.fetch-failed', `auth-fetch-failed: ${String(err)}`);
  }
}

export function parseCodexUsageApi(data, { now = new Date(), accountId = null, authSource = null } = {}) {
  const root = data?.usage || data?.rate_limits || data;
  const buckets = [];

  const baseRateLimit = firstObject(root, ['rate_limit', 'rateLimit']) || root;
  addWindowBucket(buckets, firstObject(baseRateLimit, [
    'primary_window',
    'primaryWindow',
    'primary',
    'five_hour',
    'fiveHour',
    'five_hour_limit',
    'fiveHourLimit',
  ]), {
    now,
    kind: '5h',
    model: 'all',
    id: 'codex-5h-all',
    label: '5 hour usage limit',
  });
  addWindowBucket(buckets, firstObject(baseRateLimit, [
    'secondary_window',
    'secondaryWindow',
    'secondary',
    'weekly',
    'weekly_limit',
    'weeklyLimit',
  ]), {
    now,
    kind: 'weekly',
    model: 'all',
    id: 'codex-weekly-all',
    label: 'Weekly usage limit',
  });

  for (const details of getAdditionalRateLimits(root)) {
    const rate = firstObject(details, ['rate_limit', 'rateLimit']) || details;
    const limitName = firstString(details, ['limit_name', 'limitName', 'metered_feature', 'meteredFeature', 'name', 'label'])
      || 'model';
    const model = modelSlug(limitName);
    const labelBase = titleModel(model);
    addWindowBucket(buckets, firstObject(rate, [
      'primary_window',
      'primaryWindow',
      'primary',
      'five_hour',
      'fiveHour',
      'five_hour_limit',
      'fiveHourLimit',
    ]), {
      now,
      kind: '5h',
      model,
      id: `codex-5h-${model}`,
      label: `${labelBase} 5 hour usage limit`,
    });
    addWindowBucket(buckets, firstObject(rate, [
      'secondary_window',
      'secondaryWindow',
      'secondary',
      'weekly',
      'weekly_limit',
      'weeklyLimit',
    ]), {
      now,
      kind: 'weekly',
      model,
      id: `codex-weekly-${model}`,
      label: `${labelBase} Weekly usage limit`,
    });
  }

  addLooseNamedWindow(buckets, root, 'five_hour', {
    now,
    kind: '5h',
    model: 'all',
    id: 'codex-5h-all',
    label: '5 hour usage limit',
  });
  addLooseNamedWindow(buckets, root, 'weekly', {
    now,
    kind: 'weekly',
    model: 'all',
    id: 'codex-weekly-all',
    label: 'Weekly usage limit',
  });

  const uniqueBuckets = dedupeBuckets(buckets);
  if (uniqueBuckets.length === 0) {
    return codexFailure('api', 'usage.schema-empty', 'usage-schema-empty', { accountId, authSource });
  }

  return {
    ok: true,
    provider: 'codex',
    source: 'api',
    accountId,
    authSource,
    plan: extractCodexPlan(root),
    buckets: uniqueBuckets,
  };
}

async function fetchCodexAnalyticsPage({ now, fetchImpl }) {
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return codexFailure('html', 'page.fetch-unavailable', 'fetch-unavailable');

  try {
    const res = await doFetch(CODEX_URL, { credentials: 'include' });
    if (!res.ok) return codexFailure('html', 'page.http', `HTTP ${res.status}`, { status: res.status });
    const html = await res.text();
    const parsed = parseCodex(html, { now });
    return parsed.ok ? { ...parsed, source: 'html' } : { ...parsed, source: 'html' };
  } catch (err) {
    return codexFailure('html', 'page.fetch-failed', String(err));
  }
}

function resolveFetch(fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  return null;
}

function addWindowBucket(buckets, window, { now, kind, model, id, label }) {
  const normalized = normalizeUsageWindow(window, { now });
  if (!normalized) return;
  buckets.push({
    id,
    label,
    kind,
    model,
    percentUsed: normalized.percentUsed,
    resetISO: normalized.resetISO,
    rawResetText: normalized.rawResetText,
  });
}

function addLooseNamedWindow(buckets, root, key, descriptor) {
  const value = firstObject(root, [
    key,
    `${key}_limit`,
    key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
  ]);
  if (value && !buckets.some((bucket) => bucket.id === descriptor.id)) {
    addWindowBucket(buckets, value, descriptor);
  }
}

function normalizeUsageWindow(window, { now }) {
  if (!window || typeof window !== 'object') return null;
  const percentUsed = normalizePercent(window);
  if (percentUsed == null) return null;

  const resetISO = normalizeResetISO(firstDefined(window, [
    'reset_at',
    'resetAt',
    'resets_at',
    'resetsAt',
    'reset_time',
    'resetTime',
    'next_reset_at',
    'nextResetAt',
  ]), { now }) || normalizeResetAfter(firstDefined(window, [
    'reset_after_seconds',
    'resetAfterSeconds',
    'reset_after',
    'resetAfter',
  ]), { now });

  const rawResetText = firstString(window, ['reset_text', 'resetText', 'rawResetText'])
    || (resetISO ? `Resets ${new Date(resetISO).toLocaleString()}` : null);

  return { percentUsed, resetISO, rawResetText };
}

function normalizePercent(info) {
  let value = firstNumber(info, [
    'used_percent',
    'usedPercent',
    'percent_used',
    'percentUsed',
    'usage_percent',
    'usagePercent',
    'utilization',
    'percentage',
  ]);

  if (value == null) {
    const used = firstNumber(info, ['used', 'used_count', 'current']);
    const limit = firstNumber(info, ['limit', 'cap', 'maximum', 'max']);
    if (used != null && limit > 0) value = (used / limit) * 100;
  }

  if (value == null) {
    const remaining = firstNumber(info, ['remaining', 'remaining_count']);
    const limit = firstNumber(info, ['limit', 'cap', 'maximum', 'max']);
    if (remaining != null && limit > 0) value = 100 - (remaining / limit) * 100;
  }

  if (value == null) {
    const remainingPercent = firstNumber(info, ['remaining_percent', 'remainingPercent', 'percent_remaining', 'percentRemaining']);
    if (remainingPercent != null) value = 100 - remainingPercent;
  }

  if (value == null || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) value *= 100;
  return Math.max(0, Math.min(100, value));
}

function normalizeResetISO(value, { now }) {
  if (value == null || value === '') return null;

  if (typeof value === 'number') {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return normalizeResetISO(Number(text), { now });
  if (/^resets\b/i.test(text)) return parseResetString(text, { now });

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeResetAfter(value, { now }) {
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function getAdditionalRateLimits(root) {
  const direct = firstArray(root, ['additional_rate_limits', 'additionalRateLimits', 'additional']);
  if (direct) return direct.filter((item) => item && typeof item === 'object');

  const collections = firstArray(root?.rate_limit || root?.rateLimit, ['additional_rate_limits', 'additionalRateLimits', 'additional']);
  return (collections || []).filter((item) => item && typeof item === 'object');
}

function dedupeBuckets(buckets) {
  const seen = new Set();
  const out = [];
  for (const bucket of buckets) {
    if (seen.has(bucket.id)) continue;
    seen.add(bucket.id);
    out.push(bucket);
  }
  return out;
}

function extractCodexPlan(root) {
  const raw = firstString(root, ['plan_type', 'planType', 'plan', 'tier', 'subscription_tier', 'subscriptionTier']);
  return raw ? titleModel(raw) : null;
}

function extractChatGptAccountId(data, claims) {
  const direct = firstString(data, ['account_id', 'accountId', 'chatgpt_account_id', 'chatgptAccountId']);
  if (direct) return direct;

  const account = firstObject(data, ['account', 'currentAccount', 'selectedAccount', 'workspace']);
  const accountId = firstString(account, ['id', 'account_id', 'accountId']);
  if (accountId) return accountId;

  const accounts = firstArray(data, ['accounts', 'workspaces']);
  const firstAccountId = accounts
    ?.map((item) => firstString(item, ['id', 'account_id', 'accountId']))
    .find(Boolean);
  if (firstAccountId) return firstAccountId;

  const authClaim = claims?.['https://api.openai.com/auth'] || claims?.auth || {};
  const claimId = firstString(authClaim, ['chatgpt_account_id', 'account_id', 'accountId']);
  if (claimId) return claimId;

  const orgs = Array.isArray(authClaim.organizations) ? authClaim.organizations : [];
  return orgs.map((org) => firstString(org, ['id', 'account_id', 'accountId'])).find(Boolean) || null;
}

function extractChatGptPlan(data, claims) {
  const direct = firstString(data, ['plan_type', 'planType', 'plan', 'tier']);
  if (direct) return direct;
  const account = firstObject(data, ['account', 'currentAccount', 'selectedAccount', 'workspace']);
  const accountPlan = firstString(account, ['plan_type', 'planType', 'plan', 'tier']);
  if (accountPlan) return accountPlan;
  const authClaim = claims?.['https://api.openai.com/auth'] || claims?.auth || {};
  return firstString(authClaim, ['chatgpt_plan_type', 'plan_type', 'planType', 'plan', 'tier']);
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const json = typeof atob === 'function'
      ? atob(padded)
      : String.fromCharCode(...Uint8Array.from(Buffer.from(padded, 'base64')));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function findFirstStringDeep(value, keys) {
  if (!value || typeof value !== 'object') return null;
  const direct = firstString(value, keys);
  if (direct) return direct;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findFirstStringDeep(item, keys);
        if (found) return found;
      }
    } else if (child && typeof child === 'object') {
      const found = findFirstStringDeep(child, keys);
      if (found) return found;
    }
  }
  return null;
}

function firstString(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] != null) return obj[key];
  }
  return null;
}

function firstObject(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return null;
}

function firstArray(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

// - PRIMARY FALLBACK: live DOM ---------------------------------------------

export function parseCodexDoc(doc, { now = new Date() } = {}) {
  if (!doc) return codexFailure('dom', 'dom.no-document', 'no-document');

  const articles = doc.querySelectorAll('article');
  if (articles.length === 0) {
    return codexFailure('dom', 'dom.unhydrated', 'unhydrated');
  }

  const buckets = [];
  for (const art of articles) {
    const labelEl = art.querySelector('header p, p');
    if (!labelEl) continue;
    const label = (labelEl.textContent || '').trim();
    if (!/usage limit/i.test(label)) continue;        // skips "Credits remaining"

    // First "<digits>%" span is the percent-remaining big number.
    let percentRemaining = null;
    for (const s of art.querySelectorAll('span')) {
      const t = (s.textContent || '').trim();
      const m = /^(\d+(?:\.\d+)?)%$/.exec(t);
      if (m) { percentRemaining = parseFloat(m[1]); break; }
    }
    if (percentRemaining == null) continue;
    const percentUsed = Math.max(0, Math.min(100, 100 - percentRemaining));

    let rawResetText = null;
    for (const s of art.querySelectorAll('span')) {
      const t = (s.textContent || '').trim();
      if (/^Resets\b/.test(t)) { rawResetText = t; break; }
    }
    const resetISO = rawResetText ? parseResetString(rawResetText, { now }) : null;

    const kind = classifyKind(label);
    const model = extractModel(label);
    buckets.push({
      label, percentUsed, resetISO, rawResetText,
      kind, model, id: `codex-${kind}-${model}`,
    });
  }

  if (buckets.length === 0) {
    return codexFailure('dom', 'dom.no-rows', 'no-rows-rendered');
  }
  return { ok: true, provider: 'codex', source: 'dom', plan: null, buckets };
}

// - FALLBACK: raw HTML over fetch() ----------------------------------------

export function parseCodex(html, { now = new Date() } = {}) {
  if (!/Codex Analytics|usage limit/i.test(html)) {
    return codexFailure('html', 'html.shell', 'shell-response');
  }

  const buckets = [];
  const parts = html.split(/<article\b/).slice(1);
  for (const art of parts) {
    const end = art.indexOf('</article>');
    const body = end >= 0 ? art.slice(0, end) : art;

    const labelMatch = /<p[^>]*>([^<]+?)<\/p>/.exec(body);
    if (!labelMatch) continue;
    const label = labelMatch[1].trim();
    if (!/usage limit/i.test(label)) continue;

    const pctMatch = /<span[^>]*>(\d+(?:\.\d+)?)%<\/span>/.exec(body);
    if (!pctMatch) continue;
    const percentRemaining = parseFloat(pctMatch[1]);
    const percentUsed = Math.max(0, Math.min(100, 100 - percentRemaining));

    const resetMatch = /<span[^>]*>(Resets[^<]*)<\/span>/.exec(body);
    const rawResetText = resetMatch ? resetMatch[1].trim() : null;
    const resetISO = rawResetText ? parseResetString(rawResetText, { now }) : null;

    const kind = classifyKind(label);
    const model = extractModel(label);
    buckets.push({
      label, percentUsed, resetISO, rawResetText,
      kind, model, id: `codex-${kind}-${model}`,
    });
  }

  if (buckets.length === 0) {
    return codexFailure('html', 'html.shell', 'shell-response');
  }
  return { ok: true, provider: 'codex', plan: null, buckets };
}

function classifyKind(label) {
  if (/5\s*hour/i.test(label)) return '5h';
  if (/weekly/i.test(label))   return 'weekly';
  return 'unknown';
}

function extractModel(label) {
  const stripped = label.replace(/\s*(5\s*hour|weekly)\s*usage\s*limit/i, '').trim();
  if (!stripped) return 'all';
  return modelSlug(stripped);
}

function modelSlug(label) {
  const stripped = String(label || '')
    .replace(/^codex[_\s-]*/i, '')
    .replace(/[_\s-]*(rate[_\s-]*limit|usage[_\s-]*limit|limit)$/i, '')
    .trim();
  if (!stripped) return 'all';
  if (/^primary(_window)?$/i.test(stripped)) return 'all';
  if (/^secondary(_window)?$/i.test(stripped)) return 'all';
  return stripped.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';
}

function titleModel(model) {
  if (!model || model === 'all') return 'Codex';
  return String(model)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
