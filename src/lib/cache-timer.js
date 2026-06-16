export const CLAUDE_CACHE_WINDOW_MS = 5 * 60 * 1000;

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
  return {
    ...state,
    cache: {
      ...(state?.cache || {}),
      [timer.provider]: timer,
    },
  };
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
