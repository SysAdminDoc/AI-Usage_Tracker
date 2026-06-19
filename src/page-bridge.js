import { send } from './lib/browser.js';

const SOURCE = 'ai-usage-tracker';

// Maximum size of a serialized bridge payload we accept (256 KB).  A normal
// message_limit or rate-limit-headers payload is under 2 KB; anything vastly
// larger is either malformed or an injection attempt.
const MAX_PAYLOAD_BYTES = 256 * 1024;

// Allowed origins — must match the provider site the content script runs on.
const ALLOWED_ORIGINS = [
  'https://claude.ai',
];

function isAllowedOrigin(eventOrigin) {
  try {
    const parsed = new URL(eventOrigin);
    return ALLOWED_ORIGINS.some(
      (allowed) => parsed.origin === allowed
        || parsed.hostname.endsWith(`.${new URL(allowed).hostname}`),
    );
  } catch { return false; }
}

function payloadTooLarge(data) {
  try {
    return JSON.stringify(data).length > MAX_PAYLOAD_BYTES;
  } catch { return true; }
}

function isValidISO(value) {
  if (typeof value !== 'string') return false;
  const d = new Date(value);
  return Number.isFinite(d.getTime());
}

/**
 * Validate that a message_limit payload has the expected shape and values.
 * Returns true if safe to forward.
 */
function validateMessageLimit(messageLimit) {
  if (!messageLimit || typeof messageLimit !== 'object') return false;
  // Reject arrays, functions, Proxy-wrapped objects that aren't plain.
  if (Array.isArray(messageLimit)) return false;

  // We accept the messageLimit object if it has any recognizable sub-keys
  // (windows, cache, cache_ttl_seconds, etc.) and no unexpected types.
  const known = ['windows', 'cache', 'cache_ttl_seconds', 'type'];
  const keys = Object.keys(messageLimit);
  if (keys.length === 0) return false;
  if (keys.length > 50) return false; // unreasonable breadth

  // If windows present, validate utilization/reset values are in range.
  if (messageLimit.windows && typeof messageLimit.windows === 'object') {
    const windowKeys = Object.keys(messageLimit.windows);
    if (windowKeys.length > 20) return false;
    for (const wk of windowKeys) {
      const w = messageLimit.windows[wk];
      if (!w || typeof w !== 'object') return false;
      if (w.utilization != null) {
        const u = Number(w.utilization);
        if (!Number.isFinite(u) || u < 0 || u > 100) return false;
      }
      if (w.reset_at != null) {
        const r = typeof w.reset_at === 'number'
          ? Number.isFinite(w.reset_at)
          : isValidISO(String(w.reset_at));
        if (!r) return false;
      }
    }
  }
  return true;
}

/**
 * Validate that a rate-limit headers payload has the expected shape.
 */
function validateRateLimit(rateLimit) {
  if (!rateLimit || typeof rateLimit !== 'object') return false;
  if (Array.isArray(rateLimit)) return false;
  const keys = Object.keys(rateLimit);
  if (keys.length === 0) return false;
  if (keys.length > 50) return false;

  if (rateLimit.windows && typeof rateLimit.windows === 'object') {
    const windowKeys = Object.keys(rateLimit.windows);
    if (windowKeys.length > 20) return false;
    for (const wk of windowKeys) {
      const w = rateLimit.windows[wk];
      if (!w || typeof w !== 'object') return false;
      if (w.utilization != null) {
        const u = Number(w.utilization);
        if (!Number.isFinite(u) || u < 0 || u > 100) return false;
      }
    }
  }
  return true;
}

if (/(^|\.)claude\.ai$/.test(location.hostname)) {
  window.addEventListener('message', (event) => {
    // Origin validation: only accept messages from the same provider origin.
    if (event.source !== window) return;
    if (!isAllowedOrigin(event.origin)) return;

    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== 'claude-message-limit') return;
    if (!data.messageLimit || typeof data.messageLimit !== 'object') return;
    if (payloadTooLarge(data)) return;
    if (!validateMessageLimit(data.messageLimit)) return;

    const observedAtISO = isValidISO(data.observedAtISO) ? data.observedAtISO : new Date().toISOString();
    // Reject timestamps more than 5 minutes in the future or past.
    const drift = Math.abs(Date.now() - new Date(observedAtISO).getTime());
    if (drift > 5 * 60 * 1000) return;

    send({
      type: 'aut/claude-message-limit',
      messageLimit: data.messageLimit,
      observedAtISO,
    });
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!isAllowedOrigin(event.origin)) return;

    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== 'claude-rate-limit-headers') return;
    if (!data.rateLimit || typeof data.rateLimit !== 'object') return;
    if (payloadTooLarge(data)) return;
    if (!validateRateLimit(data.rateLimit)) return;

    const observedAtISO = isValidISO(data.observedAtISO) ? data.observedAtISO : new Date().toISOString();
    const drift = Math.abs(Date.now() - new Date(observedAtISO).getTime());
    if (drift > 5 * 60 * 1000) return;

    send({
      type: 'aut/claude-rate-limit-headers',
      rateLimit: data.rateLimit,
      observedAtISO,
    });
  });
}
