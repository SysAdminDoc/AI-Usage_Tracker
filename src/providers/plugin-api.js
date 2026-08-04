// @ts-check

import { apiFailure } from './api-contract.js';

/**
 * Versioned provider extension seam.
 *
 * A provider plugin has four intentionally separate phases:
 *
 * - auth({ credential, settings, now }) -> an opaque, request-only auth context
 * - fetch({ auth, settings, now, fetchImpl }) -> { ok, data, meta }
 * - parse(data, { auth, meta, settings, now }) -> a provider snapshot candidate
 * - normalize(snapshot, context) -> the canonical ProviderSnapshot shape
 *
 * `auth` is the only phase that receives the stored credential. `fetch` may
 * use the returned auth context, but `parse` and `normalize` must not need the
 * raw credential. A plugin must keep secrets out of `data`, `meta`, errors,
 * snapshots, and dimensions.
 */
export const PROVIDER_PLUGIN_API_VERSION = 1;

const REQUIRED_PLUGIN_METHODS = Object.freeze(['auth', 'fetch', 'parse', 'normalize']);
const MAX_TEXT_LENGTH = 240;

/**
 * @typedef {Object} ProviderPlugin
 * @property {number} apiVersion
 * @property {string} id
 * @property {Record<string, unknown>} meta
 * @property {(input: ProviderAuthInput) => Promise<ProviderAuthResult>|ProviderAuthResult} auth
 * @property {(input: ProviderFetchInput) => Promise<ProviderFetchResult>|ProviderFetchResult} fetch
 * @property {(data: unknown, context: ProviderContext) => Promise<unknown>|unknown} parse
 * @property {(snapshot: unknown, context: ProviderContext) => Promise<unknown>|unknown} normalize
 */

/** @typedef {{ credential?: unknown, settings?: Record<string, unknown>, now?: Date }} ProviderAuthInput */
/** @typedef {ProviderAuthInput & { auth: ProviderAuthResult }} ProviderFetchInput */
/** @typedef {ProviderAuthInput & { auth?: ProviderAuthResult, meta?: Record<string, unknown> }} ProviderContext */
/** @typedef {{ ok: true, provider: string, apiKey: string, [key: string]: unknown } | Record<string, unknown>} ProviderAuthResult */
/** @typedef {{ ok: boolean, provider: string, data?: unknown, meta?: Record<string, unknown>, [key: string]: unknown }} ProviderFetchResult */

/**
 * Validate a plugin before it enters the registry.
 * @param {unknown} candidate
 * @returns {{ ok: true, plugin: ProviderPlugin } | { ok: false, error: string, errorCode: string }}
 */
export function validateProviderPlugin(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, error: 'provider-plugin-invalid', errorCode: 'provider-plugin.shape-invalid' };
  }
  const plugin = /** @type {Record<string, unknown>} */ (candidate);
  const id = typeof plugin.id === 'string' ? plugin.id.trim() : '';
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return { ok: false, error: 'provider-plugin-id-invalid', errorCode: 'provider-plugin.id-invalid' };
  }
  if (plugin.apiVersion !== PROVIDER_PLUGIN_API_VERSION) {
    return { ok: false, error: 'provider-plugin-version-unsupported', errorCode: 'provider-plugin.version-unsupported' };
  }
  for (const method of REQUIRED_PLUGIN_METHODS) {
    if (typeof plugin[method] !== 'function') {
      return { ok: false, error: `provider-plugin-${method}-missing`, errorCode: `provider-plugin.${method}-missing` };
    }
  }
  return { ok: true, plugin: /** @type {ProviderPlugin} */ (candidate) };
}

/**
 * Define an immutable plugin and fail early on contract mistakes.
 * @param {Omit<ProviderPlugin, 'apiVersion'> & { apiVersion?: number }} definition
 * @returns {ProviderPlugin}
 */
export function defineProviderPlugin(definition) {
  const candidate = {
    ...definition,
    apiVersion: definition.apiVersion ?? PROVIDER_PLUGIN_API_VERSION,
    id: String(definition.id || '').trim(),
    meta: Object.freeze({ ...(definition.meta || {}) }),
  };
  const validation = validateProviderPlugin(candidate);
  if (!validation.ok) throw new TypeError(`${validation.errorCode}: ${validation.error}`);
  return Object.freeze(candidate);
}

/**
 * Execute a plugin's phases while preserving a stable failure shape.
 * @param {ProviderPlugin} plugin
 * @param {ProviderAuthInput} input
 */
export async function runProviderPlugin(plugin, input = {}) {
  const validation = validateProviderPlugin(plugin);
  if (!validation.ok) return apiFailure(String(input.provider || 'unknown'), 'plugin.invalid', validation.error);
  const provider = plugin.id;
  const phaseInput = {
    settings: input.settings || {},
    now: input.now || new Date(),
    fetchImpl: input.fetchImpl || null,
  };
  let auth;
  try {
    auth = await plugin.auth({ ...input });
  } catch {
    return apiFailure(provider, 'auth.failed', 'provider-auth-failed');
  }
  if (!auth || auth.ok !== true) {
    return auth && typeof auth === 'object'
      ? { ...auth, provider: auth.provider || provider }
      : apiFailure(provider, 'auth.invalid', 'provider-auth-invalid');
  }

  let fetched;
  try {
    fetched = await plugin.fetch({ ...phaseInput, auth });
  } catch {
    return apiFailure(provider, 'fetch.failed', 'provider-fetch-failed');
  }
  if (!fetched || fetched.ok !== true) {
    return fetched && typeof fetched === 'object'
      ? { ...fetched, provider: fetched.provider || provider }
      : apiFailure(provider, 'fetch.invalid', 'provider-fetch-invalid');
  }

  const context = { ...phaseInput, auth: publicAuthContext(auth), meta: fetched.meta || {} };
  let parsed;
  try {
    parsed = await plugin.parse(fetched.data, context);
  } catch {
    return apiFailure(provider, 'parse.failed', 'provider-parse-failed');
  }
  try {
    const normalized = await plugin.normalize(parsed, context);
    return normalized && typeof normalized === 'object'
      ? { ...normalized, provider: normalized.provider || provider }
      : apiFailure(provider, 'normalize.invalid', 'provider-normalize-invalid');
  } catch {
    return apiFailure(provider, 'normalize.failed', 'provider-normalize-failed');
  }
}

/**
 * Shared credential auth phase for providers with a single API token.
 * @param {string} provider
 * @param {(settings: Record<string, unknown>) => Record<string, unknown>} [getConfig]
 */
export function credentialAuth(provider, getConfig = () => ({})) {
  return ({ credential, settings = {} } = {}) => {
    const apiKey = String(credential || '').trim();
    if (!apiKey) return apiFailure(provider, 'credentials.missing', 'credential-not-configured');
    return { ok: true, provider, apiKey, ...getConfig(settings || {}) };
  };
}

/**
 * Normalize a parsed result into the shared provider snapshot shape.
 * Providers may preserve additional provider-specific fields, but bucket
 * identity, labels, reset values, percentages, metrics, and dimensions are
 * bounded here before they reach storage and UI code.
 * @param {unknown} snapshot
 * @param {string} provider
 * @returns {unknown}
 */
export function normalizeProviderSnapshot(snapshot, provider) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return apiFailure(provider, 'normalize.snapshot-invalid', 'snapshot-invalid');
  }
  const candidate = /** @type {Record<string, unknown>} */ (snapshot);
  if (candidate.ok !== true) return { ...candidate, provider: candidate.provider || provider };
  if (candidate.provider && candidate.provider !== provider) {
    return apiFailure(provider, 'normalize.provider-mismatch', 'provider-mismatch');
  }
  if (!Array.isArray(candidate.buckets)) {
    return apiFailure(provider, 'normalize.buckets-invalid', 'buckets-invalid');
  }

  const buckets = [];
  for (const bucket of candidate.buckets) {
    const normalized = normalizeBucket(bucket);
    if (!normalized) return apiFailure(provider, 'normalize.bucket-invalid', 'bucket-invalid');
    buckets.push(normalized);
  }
  return {
    ...candidate,
    provider,
    source: typeof candidate.source === 'string' ? candidate.source : 'api-key',
    buckets,
  };
}

function normalizeBucket(bucket) {
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return null;
  const source = /** @type {Record<string, unknown>} */ (bucket);
  const id = boundedText(source.id, 160);
  const label = boundedText(source.label, MAX_TEXT_LENGTH);
  if (!id || !label || !Number.isFinite(Number(source.percentUsed))) return null;
  if (source.metric != null && (typeof source.metric !== 'object' || Array.isArray(source.metric))) return null;
  if (source.dimensions != null && (typeof source.dimensions !== 'object' || Array.isArray(source.dimensions))) return null;
  return {
    ...source,
    id,
    label,
    kind: boundedText(source.kind, 64) || 'api',
    model: source.model == null ? null : boundedText(source.model, 160),
    percentUsed: Math.max(0, Math.min(100, Number(source.percentUsed))),
    resetISO: validISO(source.resetISO),
    rawResetText: source.rawResetText == null ? null : boundedText(source.rawResetText, MAX_TEXT_LENGTH),
    metric: source.metric && typeof source.metric === 'object' ? { ...source.metric } : undefined,
    dimensions: source.dimensions && typeof source.dimensions === 'object'
      ? Object.fromEntries(Object.entries(source.dimensions).slice(0, 32).map(([key, value]) => [
        boundedText(key, 80), value == null ? null : boundedText(value, MAX_TEXT_LENGTH),
      ]))
      : undefined,
  };
}

function boundedText(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, max);
}

function validISO(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function publicAuthContext(auth) {
  if (!auth || typeof auth !== 'object') return {};
  const safe = { ...auth };
  delete safe.apiKey;
  delete safe.credential;
  delete safe.token;
  return safe;
}
