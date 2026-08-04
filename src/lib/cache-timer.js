export const CLAUDE_CACHE_WINDOW_MS = 5 * 60 * 1000;
export const CACHE_REUSE_DAY_MS = 24 * 60 * 60 * 1000;
export const CACHE_REUSE_WEEK_MS = 7 * CACHE_REUSE_DAY_MS;
export const CACHE_REUSE_EVENT_RETENTION_MS = CACHE_REUSE_WEEK_MS;
const MAX_CACHE_REUSE_EVENTS = 512;

const EXPLICIT_CACHE_KEYS = [
  'cached_until',
  'cachedUntil',
  'cache_until',
  'cacheUntil',
  'cache_expires_at',
  'cacheExpiresAt',
  'expires_at',
  'expiresAt',
];

const TTL_KEYS = [
  'cache_ttl_seconds',
  'cacheTtlSeconds',
  'ttl_seconds',
  'ttlSeconds',
  'expires_in',
  'expiresIn',
];

export function extractClaudeCacheTimer(messageLimit, { now = new Date(), source = 'stream' } = {}) {
  if (!messageLimit || typeof messageLimit !== 'object' || source !== 'stream') return null;

  const explicit = findFirstDeep(messageLimit, EXPLICIT_CACHE_KEYS);
  const explicitISO = normalizeCacheExpiry(explicit);
  const ttl = findFirstDeep(messageLimit, TTL_KEYS);
  const ttlISO = normalizeCacheTtl(ttl, { now });
  const fallbackISO = new Date(now.getTime() + CLAUDE_CACHE_WINDOW_MS).toISOString();

  return {
    provider: 'claude',
    cachedUntilISO: explicitISO || ttlISO || fallbackISO,
    windowMs: CLAUDE_CACHE_WINDOW_MS,
    source: explicitISO ? `${source}:explicit` : ttlISO ? `${source}:ttl` : `${source}:observed`,
    sampledAtISO: now.toISOString(),
  };
}

export function mergeCacheTimer(state, timer) {
  if (!timer) return state;
  const sampledAt = new Date(timer.sampledAtISO || Date.now());
  const now = Number.isFinite(sampledAt.getTime()) ? sampledAt : new Date();
  const previous = state?.cache?.[timer.provider] || {};
  const previousExpiry = new Date(previous.cachedUntilISO || '').getTime();
  const priorEvents = pruneCacheReuseEvents(previous.reuseEvents, now);
  const event = {
    sampledAtISO: now.toISOString(),
    reused: Number.isFinite(previousExpiry) && now.getTime() < previousExpiry,
    source: String(timer.source || 'unknown').slice(0, 32),
  };
  return {
    ...state,
    cache: {
      ...(state?.cache || {}),
      [timer.provider]: {
        ...timer,
        reuseEvents: [...priorEvents, event].slice(-MAX_CACHE_REUSE_EVENTS),
      },
    },
  };
}

/**
 * Summarize inferred cache reuse for one rolling window. The provider does not
 * expose a billing-grade hit/miss counter, so this measures successive stream
 * observations against the last locally observed expiry instead.
 */
export function cacheReuseStats(events = [], { now = new Date(), windowMs = CACHE_REUSE_DAY_MS } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowTs = nowDate.getTime();
  const span = Math.max(1, Number(windowMs) || CACHE_REUSE_DAY_MS);
  const cutoff = nowTs - span;
  const samples = (events || [])
    .map((event) => ({
      ts: new Date(event?.sampledAtISO || '').getTime(),
      reused: event?.reused === true,
    }))
    .filter((event) => Number.isFinite(event.ts) && event.ts >= cutoff && event.ts <= nowTs)
    .sort((a, b) => a.ts - b.ts);
  const reuseCount = samples.filter((event) => event.reused).length;
  const eventCount = samples.length;
  return {
    windowMs: span,
    eventCount,
    reuseCount,
    reuseRatio: eventCount ? reuseCount / eventCount : null,
    reusePercent: eventCount ? (reuseCount / eventCount) * 100 : null,
    latestEventISO: eventCount ? new Date(samples.at(-1).ts).toISOString() : null,
  };
}

function pruneCacheReuseEvents(events, now) {
  const cutoff = now.getTime() - CACHE_REUSE_EVENT_RETENTION_MS;
  return (events || [])
    .filter((event) => {
      const ts = new Date(event?.sampledAtISO || '').getTime();
      return Number.isFinite(ts) && ts >= cutoff && ts <= now.getTime();
    })
    .map((event) => ({
      sampledAtISO: new Date(event.sampledAtISO).toISOString(),
      reused: event.reused === true,
      source: String(event.source || 'unknown').slice(0, 32),
    }))
    .slice(-MAX_CACHE_REUSE_EVENTS);
}

function normalizeCacheExpiry(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return validIso(ms);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return normalizeCacheExpiry(Number(text));
  return validIso(Date.parse(text));
}

function normalizeCacheTtl(value, { now }) {
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function validIso(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function findFirstDeep(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (value[key] != null) return value[key];
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findFirstDeep(child, keys);
      if (found != null) return found;
    }
  }
  return null;
}
