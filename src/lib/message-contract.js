import { isClaudeHost, isCodexHost } from './hosts.js';

export const MESSAGE_MAX_PAYLOAD_BYTES = 256 * 1024;
export const MESSAGE_MAX_AGE_MS = 5 * 60 * 1000;
export const MESSAGE_MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

const MAX_BUCKETS = 100;
const MAX_WINDOW_KEYS = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_TEXT_LENGTH = 512;

/**
 * Validate a snapshot sent by the analytics content script.
 * The sender and its tab URL are part of the trust boundary; the payload's
 * provider field is never trusted to choose the destination state by itself.
 */
export function validateScrapedMessage(message, sender, {
  runtimeId,
  now = new Date(),
} = {}) {
  const senderResult = validateContentSender(sender, { runtimeId });
  if (!senderResult.ok) return senderResult;

  const provider = analyticsProviderForURL(senderResult.url);
  if (!provider) return reject('sender.analytics-url');
  if (message?.provider !== provider) return reject('payload.provider-mismatch');

  const parsed = message?.parsed;
  if (!isRecord(parsed) || parsed.ok !== true) return reject('payload.snapshot-invalid');
  if (parsed.provider !== provider) return reject('payload.provider-mismatch');
  if (!withinPayloadLimit(message)) return reject('payload.too-large');

  const observed = validateObservedAt(message?.observedAtISO, now);
  if (!observed.ok) return observed;
  if (!Array.isArray(parsed.buckets) || parsed.buckets.length === 0 || parsed.buckets.length > MAX_BUCKETS) {
    return reject('payload.buckets-invalid');
  }
  for (const bucket of parsed.buckets) {
    const result = validateQuotaBucket(bucket);
    if (!result.ok) return result;
  }
  if (!boundedOptionalText(parsed.plan) || !boundedOptionalText(parsed.orgId)
      || !boundedOptionalText(parsed.accountId)) {
    return reject('payload.metadata-invalid');
  }

  return { ok: true, provider, observedAtISO: observed.value };
}

/** Validate a page-world Claude stream payload forwarded by page-bridge.js. */
export function validateClaudeBridgeMessage(message, sender, {
  runtimeId,
  now = new Date(),
  field,
} = {}) {
  if (message?.type !== field?.messageType) return reject('payload.type');

  const senderResult = validateContentSender(sender, { runtimeId });
  if (!senderResult.ok) return senderResult;
  if (!isClaudeHost(senderResult.url.hostname)) return reject('sender.provider-host');

  const observed = validateObservedAt(message?.observedAtISO, now);
  if (!observed.ok) return observed;

  const payload = message?.[field.payloadKey];
  if (!isRecord(payload)) return reject('payload.object-invalid');
  if (!withinPayloadLimit(message)) return reject('payload.too-large');
  const shape = validateClaudeWindowPayload(payload);
  if (!shape.ok) return shape;

  return { ok: true, provider: 'claude', observedAtISO: observed.value };
}

export function analyticsProviderForURL(url) {
  if (!url || typeof url !== 'object') return null;
  if (isClaudeHost(url.hostname) && /^\/settings\/usage\/?$/.test(url.pathname)) return 'claude';
  if (isCodexHost(url.hostname) && /^\/codex\/cloud\/settings\/analytics\/?$/.test(url.pathname)) return 'codex';
  return null;
}

function validateContentSender(sender, { runtimeId } = {}) {
  if (!sender || typeof sender !== 'object') return reject('sender.missing');
  if (!runtimeId || typeof runtimeId !== 'string') return reject('sender.runtime-unavailable');
  if (sender.id !== runtimeId) return reject('sender.extension-id');

  const tab = sender.tab;
  if (!tab || !Number.isInteger(tab.id) || tab.id < 0) return reject('sender.tab');
  const url = parseHTTPSURL(tab.url);
  if (!url) return reject('sender.tab-url');
  return { ok: true, url };
}

function validateObservedAt(value, now) {
  if (typeof value !== 'string' || !value) return reject('payload.observed-at-missing');
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return reject('payload.observed-at-invalid');
  const drift = now.getTime() - timestamp;
  if (drift > MESSAGE_MAX_AGE_MS) return reject('payload.observed-at-stale');
  if (drift < -MESSAGE_MAX_FUTURE_SKEW_MS) return reject('payload.observed-at-future');
  return { ok: true, value: new Date(timestamp).toISOString() };
}

function validateQuotaBucket(bucket) {
  if (!isRecord(bucket)) return reject('payload.bucket-object');
  if (!boundedText(bucket.id) || !boundedText(bucket.label) || !boundedText(bucket.kind)
      || !boundedOptionalText(bucket.model)) {
    return reject('payload.bucket-metadata');
  }
  if (typeof bucket.percentUsed !== 'number'
      || !Number.isFinite(bucket.percentUsed)
      || bucket.percentUsed < 0
      || bucket.percentUsed > 100) {
    return reject('payload.bucket-percent');
  }
  if (bucket.resetISO != null && !isValidDateString(bucket.resetISO)) {
    return reject('payload.bucket-reset');
  }
  if (!boundedOptionalText(bucket.rawResetText)) return reject('payload.bucket-reset-text');
  return { ok: true };
}

function validateClaudeWindowPayload(payload) {
  if (!boundedRecord(payload)) return reject('payload.window-root');
  if (payload.windows != null) {
    if (!isRecord(payload.windows)) return reject('payload.windows-object');
    const entries = Object.entries(payload.windows);
    if (entries.length === 0 || entries.length > MAX_WINDOW_KEYS) return reject('payload.windows-count');
    for (const [key, window] of entries) {
      if (!boundedText(key)) return reject('payload.window-entry');
      const result = validateWindow(window);
      if (!result.ok) return result;
    }
  }
  if (payload.cache_ttl_seconds != null
      && (!isFiniteNumber(payload.cache_ttl_seconds) || payload.cache_ttl_seconds < 0 || payload.cache_ttl_seconds > 86_400)) {
    return reject('payload.cache-ttl');
  }
  return { ok: true };
}

function validateWindow(window) {
  if (!isRecord(window)) return reject('payload.window-object');
  for (const key of ['utilization', 'percent_used', 'percentUsed', 'usage_percent', 'percentage']) {
    if (window[key] != null
        && (!isFiniteNumber(window[key]) || Number(window[key]) < 0 || Number(window[key]) > 100)) {
      return reject('payload.window-utilization');
    }
  }
  for (const key of ['reset_at', 'resetAt', 'resets_at', 'resetsAt', 'reset']) {
    if (window[key] == null) continue;
    const valid = typeof window[key] === 'number'
      ? Number.isFinite(window[key]) && window[key] > 0 && window[key] < 100_000_000_000_000
      : isValidDateString(window[key]);
    if (!valid) return reject('payload.window-reset');
  }
  if (window.status != null && !boundedText(window.status)) return reject('payload.window-status');
  return { ok: true };
}

function withinPayloadLimit(value) {
  try {
    return encodedByteLength(JSON.stringify(value)) <= MESSAGE_MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

function parseHTTPSURL(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isValidDateString(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH && Number.isFinite(new Date(value).getTime());
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundedRecord(value) {
  return isRecord(value) && Object.keys(value).length <= MAX_OBJECT_KEYS;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function boundedOptionalText(value) {
  return value == null || (typeof value === 'string' && value.length <= MAX_TEXT_LENGTH);
}

function encodedByteLength(value) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(String(value)).byteLength;
  return String(value).length;
}

function reject(errorCode) {
  return { ok: false, errorCode: `message.${errorCode}` };
}
