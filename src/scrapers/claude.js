// Claude usage scraper. Primary path is the same JSON endpoint used by
// Claude Ultimate Enhancer:
//   GET /api/organizations -> org id
//   GET /api/organizations/{org_id}/usage -> usage windows
//
// The settings-page DOM and raw-HTML parsers stay as fallbacks for endpoint
// drift or logged-out/shell responses. All paths return:
//   { ok, provider:'claude', plan, source, buckets[] }

import { parseResetString } from '../lib/countdown.js';
import {
  isSchemaDrift,
  sourceDisagreement,
  supportedSchema,
  unsupportedSchema,
} from '../lib/schema-sentinel.js';

export const CLAUDE_URL = 'https://claude.ai/settings/usage';
export const CLAUDE_ORGS_URL = 'https://claude.ai/api/organizations';

const ORG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let orgCache = { id: null, ts: 0 };

function claudeFailure(source, errorCode, error, extra = {}) {
  return {
    ok: false,
    provider: 'claude',
    source,
    error,
    errorCode: `claude.${errorCode}`,
    ...extra,
  };
}

export async function fetchClaude({ now = new Date(), fetchImpl = null } = {}) {
  const api = await fetchClaudeApi({ now, fetchImpl });
  if (api.ok) return api;

  const page = await fetchClaudeUsagePage({ now, fetchImpl });
  if (page.ok && isSchemaDrift(api)) return sourceDisagreement('claude', api, page);
  if (page.ok) return page;

  // API errors are more actionable than hydration-shell page errors, so keep
  // them at the surface while retaining the fallback error for diagnostics.
  return { ...api, fallbackError: page.error };
}

export async function fetchClaudeApi({ now = new Date(), fetchImpl = null } = {}) {
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return claudeFailure('api', 'fetch.unavailable', 'fetch-unavailable');

  const org = await getClaudeOrgId({ fetchImpl: doFetch });
  if (!org.ok) return { ...org, provider: 'claude', source: 'api' };

  try {
    const res = await doFetch(`${CLAUDE_ORGS_URL}/${encodeURIComponent(org.orgId)}/usage`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return claudeFailure('api', 'usage.http', `usage-http-${res.status}`, { status: res.status, orgId: org.orgId });
    }
    const data = await res.json();
    return parseClaudeUsageApi(data, { now, orgId: org.orgId });
  } catch (err) {
    return claudeFailure('api', 'usage.fetch-failed', `usage-fetch-failed: ${String(err)}`, { orgId: org.orgId });
  }
}

export async function getClaudeOrgId({ fetchImpl = null } = {}) {
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return claudeFailure('account', 'account.fetch-unavailable', 'fetch-unavailable');

  const nowTs = Date.now();
  if (orgCache.id && nowTs - orgCache.ts < ORG_CACHE_TTL_MS) {
    return { ok: true, orgId: orgCache.id, source: 'cache' };
  }

  try {
    const res = await doFetch(CLAUDE_ORGS_URL, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return claudeFailure('account', 'account.http', `orgs-http-${res.status}`, { status: res.status });

    const data = await res.json();
    const orgs = normalizeOrgList(data);
    const org = pickClaudeOrg(orgs);
    const orgId = org?.uuid || org?.id;
    if (!orgId) return claudeFailure('account', 'account.missing', 'org-id-not-found');

    orgCache = { id: orgId, ts: nowTs };
    return { ok: true, orgId, source: 'organizations' };
  } catch (err) {
    return claudeFailure('account', 'account.fetch-failed', `orgs-fetch-failed: ${String(err)}`);
  }
}

export function clearClaudeOrgCache() {
  orgCache = { id: null, ts: 0 };
}

export function parseClaudeUsageApi(data, { now = new Date(), orgId = null } = {}) {
  const root = data?.usage || data?.message_limit || data;
  if (!hasSupportedClaudeShape(root)) {
    return claudeSchemaFailure('api', 'missing-supported-usage-window', root, { orgId });
  }
  const buckets = [];

  for (const [key, info, opts] of extractUsageEntries(root)) {
    const bucket = usageInfoToBucket(key, info, { now, ...opts });
    if (bucket) buckets.push(bucket);
  }

  // Some streaming payloads nest the same windows under message_limit.windows.
  if (root?.windows && typeof root.windows === 'object') {
    for (const [key, info] of Object.entries(root.windows)) {
      const bucket = usageInfoToBucket(key, info, { now, fractionalUtilization: true });
      if (bucket && !buckets.some((b) => b.id === bucket.id)) buckets.push(bucket);
    }
  }

  if (buckets.length === 0) {
    return claudeSchemaFailure('api', 'supported-window-without-usable-utilization', root, { orgId });
  }

  return {
    ok: true,
    provider: 'claude',
    source: 'api',
    ...supportedSchema('claude', 'api', 'usage-windows'),
    orgId,
    plan: extractPlanFromUsageApi(data),
    buckets,
  };
}

async function fetchClaudeUsagePage({ now, fetchImpl }) {
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return claudeFailure('html', 'page.fetch-unavailable', 'fetch-unavailable');

  try {
    const res = await doFetch(CLAUDE_URL, { credentials: 'include' });
    if (!res.ok) return claudeFailure('html', 'page.http', `HTTP ${res.status}`, { status: res.status });
    const html = await res.text();
    const parsed = parseClaude(html, { now });
    return parsed.ok ? { ...parsed, source: 'html' } : { ...parsed, source: 'html' };
  } catch (err) {
    return claudeFailure('html', 'page.fetch-failed', String(err));
  }
}

function resolveFetch(fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  return null;
}

function normalizeOrgList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.organizations)) return data.organizations;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function pickClaudeOrg(orgs) {
  return orgs.find((o) => o?.active || o?.is_active || o?.is_default || o?.is_primary)
    || orgs.find((o) => o?.uuid || o?.id)
    || null;
}

function extractUsageEntries(root) {
  if (!root || typeof root !== 'object') return [];
  const entries = [];

  if (root.windows && typeof root.windows === 'object') {
    entries.push(...Object.entries(root.windows).map(([key, value]) => [key, value, { fractionalUtilization: true }]));
  }
  for (const [key, value] of Object.entries(root)) {
    if (key === 'windows') continue;
    if (isUsageInfo(value)) entries.push([key, value, { fractionalUtilization: false }]);
  }
  return entries;
}

function isUsageInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return firstNumber(value, [
    'utilization',
    'percent_used',
    'percentUsed',
    'used_percent',
    'usage_percent',
    'percentage',
  ]) != null
    || (firstNumber(value, ['used', 'used_count', 'current']) != null
      && firstNumber(value, ['limit', 'cap', 'maximum', 'max']) != null)
    || (firstNumber(value, ['remaining', 'remaining_count']) != null
      && firstNumber(value, ['limit', 'cap', 'maximum', 'max']) != null);
}

function usageInfoToBucket(key, info, { now, fractionalUtilization = false }) {
  if (!isUsageInfo(info)) return null;

  const descriptor = describeClaudeUsageWindow(key, info);
  const percentUsed = normalizePercent(info, { fractionalUtilization });
  if (percentUsed == null) return null;

  const resetValue = firstDefined(info, [
    'resets_at',
    'reset_at',
    'resetsAt',
    'resetAt',
    'next_reset_at',
    'nextResetAt',
    'reset_time',
    'resetTime',
  ]);
  const resetISO = normalizeResetISO(resetValue, { now });
  const rawResetText = firstString(info, ['reset_text', 'resetText', 'rawResetText'])
    || (resetISO ? `Resets ${new Date(resetISO).toLocaleString()}` : null);

  return {
    id: descriptor.id,
    label: descriptor.label,
    kind: descriptor.kind,
    model: descriptor.model,
    percentUsed,
    resetISO,
    rawResetText,
  };
}

function describeClaudeUsageWindow(key, info) {
  const rawLabel = firstString(info, ['label', 'name', 'display_name', 'displayName', 'title']);
  const normalizedKey = String(key || rawLabel || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const labelText = `${key} ${rawLabel || ''}`.toLowerCase();

  const isSession = normalizedKey === '5h'
    || normalizedKey === 'five_hour'
    || /(^|_)5h($|_)/.test(normalizedKey)
    || /five_?hour|session/.test(normalizedKey);

  const model = isSession ? 'all' : inferClaudeModel(labelText);
  const kind = isSession ? 'session' : 'weekly';
  const id = kind === 'session' ? 'claude-session' : `claude-weekly-${model}`;

  return {
    id,
    kind,
    model,
    label: rawLabel || defaultClaudeLabel(kind, model),
  };
}

function inferClaudeModel(text) {
  if (/opus/.test(text)) return 'opus';
  if (/sonnet/.test(text)) return 'sonnet';
  if (/haiku/.test(text)) return 'haiku';
  if (/design/.test(text)) return 'design';
  if (/all/.test(text)) return 'all';
  return 'all';
}

function defaultClaudeLabel(kind, model) {
  if (kind === 'session') return 'Session (5h)';
  if (model === 'all') return 'All models';
  return model.charAt(0).toUpperCase() + model.slice(1);
}

function normalizePercent(info, { fractionalUtilization = false } = {}) {
  let value = firstNumber(info, ['utilization']);
  if (value != null) {
    if (fractionalUtilization && value >= 0 && value <= 1) value *= 100;
    return Math.max(0, Math.min(100, value));
  }

  value = firstNumber(info, [
    'percent_used',
    'percentUsed',
    'used_percent',
    'usage_percent',
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

  if (value == null || !Number.isFinite(value)) return null;
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
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return normalizeResetISO(Number(text), { now });
  }

  if (/^resets\b/i.test(text)) {
    return parseResetString(text, { now });
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function extractPlanFromUsageApi(data) {
  const direct = firstString(data, ['plan', 'plan_name', 'planName', 'tier', 'subscription_tier']);
  if (direct) return direct;

  const nested = data?.organization || data?.account || data?.subscription || data?.billing;
  if (nested && typeof nested === 'object') {
    const nestedPlan = firstString(nested, ['plan', 'plan_name', 'planName', 'tier', 'name']);
    if (nestedPlan) return nestedPlan;
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

// - PRIMARY: live DOM ------------------------------------------------------

export function parseClaudeDoc(doc, { now = new Date() } = {}) {
  if (!doc) return claudeFailure('dom', 'dom.no-document', 'no-document');

  // Wait-state check -- the React tree may not be done hydrating yet.
  const sessionH3 = findHeadingContaining(doc, 'Plan usage limits');
  const weeklyH3  = findHeadingContaining(doc, 'Weekly limits');
  if (!sessionH3 && !weeklyH3) {
    return claudeFailure('dom', 'dom.unhydrated', 'unhydrated');
  }

  const plan = extractPlanFromHeading(sessionH3);
  const buckets = [];

  if (sessionH3) {
    const section = closestSection(sessionH3);
    for (const r of extractRowsFromSection(section, { now })) {
      buckets.push({ ...r, kind: 'session', model: 'all', id: 'claude-session' });
    }
  }
  if (weeklyH3) {
    const section = closestSection(weeklyH3);
    for (const r of extractRowsFromSection(section, { now })) {
      const model = modelSlug(r.label);
      buckets.push({ ...r, kind: 'weekly', model, id: `claude-weekly-${model}` });
    }
  }

  if (buckets.length === 0) {
    return claudeSchemaFailure('dom', 'usage-headings-without-rows', {
      sessionHeading: !!sessionH3,
      weeklyHeading: !!weeklyH3,
    });
  }
  return {
    ok: true,
    provider: 'claude',
    source: 'dom',
    ...supportedSchema('claude', 'dom', 'usage-progress-bars'),
    plan,
    buckets,
  };
}

function findHeadingContaining(doc, text) {
  for (const h of doc.querySelectorAll('h1, h2, h3, h4')) {
    if (h.textContent && h.textContent.includes(text)) return h;
  }
  return null;
}

function closestSection(el) {
  return el.closest('section') || el.parentElement?.parentElement || el.parentElement;
}

function extractPlanFromHeading(h3) {
  if (!h3) return null;
  // Look for a sibling/inner span that holds the plan label (e.g. "Max (20x)").
  const spans = h3.querySelectorAll('span');
  for (const span of spans) {
    const txt = (span.textContent || '').trim();
    if (!txt) continue;
    if (/Plan usage limits/.test(txt)) continue;
    if (txt.length < 40 && /\(/.test(txt)) return txt;
    if (txt.length < 40 && /\d/.test(txt) && /max|pro|free|team|enterprise/i.test(txt)) return txt;
  }
  return null;
}

function extractRowsFromSection(section, { now }) {
  if (!section) return [];
  const rows = [];
  const bars = section.querySelectorAll('[role="progressbar"]');
  for (const bar of bars) {
    const rowEl = bar.closest('div.flex.w-full')
      || bar.closest('[class*="flex-row"]')
      || bar.parentElement?.parentElement?.parentElement;
    if (!rowEl) continue;

    const labelEl = rowEl.querySelector('span.text-body.text-primary')
      || rowEl.querySelector('span.text-body')
      || rowEl.querySelector('span');
    const label = labelEl ? (labelEl.textContent || '').trim() : '';
    if (!label) continue;

    let rawResetText = null;
    for (const s of rowEl.querySelectorAll('span')) {
      const t = (s.textContent || '').trim();
      if (/^Resets\b/.test(t)) { rawResetText = t; break; }
    }
    const resetISO = rawResetText ? parseResetString(rawResetText, { now }) : null;
    const percentUsed = parseFloat(bar.getAttribute('aria-valuenow') || '0') || 0;

    rows.push({ label, percentUsed, resetISO, rawResetText });
  }
  return rows;
}

// - FALLBACK: raw HTML over fetch() ----------------------------------------

export function parseClaude(html, { now = new Date() } = {}) {
  if (!/Plan usage limits|Weekly limits/.test(html)) {
    return claudeFailure('html', 'html.shell', 'shell-response');
  }

  // The page may be a hydration shell -- the strings can appear in the JS
  // bundle without the data being rendered. We only succeed if we find at
  // least one progressbar value AND a matching label.
  const plan = extractPlanFromHtml(html);
  const sessionStart = html.indexOf('Plan usage limits');
  const weeklyStart  = html.indexOf('Weekly limits');
  const sessionHtml = sessionStart >= 0
    ? html.slice(sessionStart, weeklyStart >= 0 ? weeklyStart : html.length)
    : '';
  const weeklyHtml  = weeklyStart >= 0 ? html.slice(weeklyStart) : '';

  const buckets = [];
  for (const r of extractRowsInBlock(sessionHtml, { now })) {
    buckets.push({ ...r, kind: 'session', model: 'all', id: 'claude-session' });
  }
  for (const r of extractRowsInBlock(weeklyHtml, { now })) {
    const model = modelSlug(r.label);
    buckets.push({ ...r, kind: 'weekly', model, id: `claude-weekly-${model}` });
  }

  if (buckets.length === 0) {
    return claudeSchemaFailure('html', 'usage-headings-without-rows', {
      hasSessionHeading: sessionStart >= 0,
      hasWeeklyHeading: weeklyStart >= 0,
    });
  }
  return {
    ok: true,
    provider: 'claude',
    source: 'html',
    ...supportedSchema('claude', 'html', 'usage-progress-bars'),
    plan,
    buckets,
  };
}

function claudeSchemaFailure(source, reason, observed, extra = {}) {
  return {
    ...unsupportedSchema('claude', source, reason, observed),
    ...extra,
  };
}

function hasSupportedClaudeShape(root) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return false;
  return extractUsageEntries(root).some(([key, info]) => isSupportedClaudeWindow(key, info));
}

function isSupportedClaudeWindow(key, info) {
  if (!isUsageInfo(info)) return false;
  const text = `${String(key || '')} ${firstString(info, ['label', 'name', 'display_name', 'displayName', 'title']) || ''}`
    .toLowerCase();
  return /5\s*h|five[_ -]?hour|session|7\s*d|seven[_ -]?day|weekly|opus|sonnet|haiku|design|all[_ -]?model|model/.test(text);
}

function extractPlanFromHtml(html) {
  const m = /Plan usage limits[\s\S]{0,200}?<span[^>]*>([^<]{1,40})<\/span>/.exec(html);
  if (!m) return null;
  const candidate = m[1].trim();
  if (!candidate || /Plan usage limits/.test(candidate)) return null;
  return candidate;
}

function extractRowsInBlock(block, { now }) {
  if (!block) return [];
  const rows = [];
  const labelRe = /<span[^>]*text-body[^>]*text-primary[^>]*>([^<]+)<\/span>/g;
  let match;
  while ((match = labelRe.exec(block))) {
    const label = (match[1] || '').trim();
    if (!label) continue;
    const tail = block.slice(match.index, match.index + 2000);
    const resetMatch = /<span[^>]*>(Resets[^<]*)<\/span>/.exec(tail);
    const valueMatch = /aria-valuenow=\\?"(\d+(?:\.\d+)?)\\?"/.exec(tail);
    if (!valueMatch) continue;
    const rawResetText = resetMatch ? resetMatch[1].trim() : null;
    const resetISO = rawResetText ? parseResetString(rawResetText, { now }) : null;
    const percentUsed = parseFloat(valueMatch[1]);
    rows.push({ label, percentUsed, resetISO, rawResetText });
  }
  return rows;
}

function modelSlug(label) {
  if (/all models/i.test(label)) return 'all';
  if (/sonnet/i.test(label))     return 'sonnet';
  if (/opus/i.test(label))       return 'opus';
  if (/haiku/i.test(label))      return 'haiku';
  if (/design/i.test(label))     return 'design';
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
