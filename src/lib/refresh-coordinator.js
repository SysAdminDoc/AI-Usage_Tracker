// Provider-local refresh policy. The background worker owns orchestration,
// while this module keeps freshness, retry, and in-flight behavior testable.

export const API_PROVIDER_FRESH_TTL_MS = 2 * 60 * 1000;
export const API_RETRY_BACKOFF_BASE_MS = 30 * 1000;
export const API_RETRY_BACKOFF_MAX_MS = 15 * 60 * 1000;
export const API_RETRY_BACKOFF_MAX_LEVEL = 6;

export function decideProviderRefresh(snapshot, {
  now = new Date(),
  force = false,
  ttlMs = API_PROVIDER_FRESH_TTL_MS,
} = {}) {
  const nowTs = now.getTime();
  if (force) return { refresh: true, reason: 'manual' };

  const lastSuccessTs = toTimestamp(snapshot?.lastSuccessISO);
  const ttl = boundedMilliseconds(ttlMs, API_PROVIDER_FRESH_TTL_MS);
  if (lastSuccessTs != null && nowTs - lastSuccessTs < ttl) {
    return { refresh: false, reason: 'fresh', ageMs: Math.max(0, nowTs - lastSuccessTs) };
  }

  const retryAtTs = toTimestamp(snapshot?.nextRetryISO);
  if (retryAtTs != null && retryAtTs > nowTs) {
    return {
      refresh: false,
      reason: 'backoff',
      retryAtISO: new Date(retryAtTs).toISOString(),
      retryInMs: retryAtTs - nowTs,
    };
  }

  return { refresh: true, reason: lastSuccessTs == null ? 'initial' : 'stale' };
}

export function isRetryableProviderError(result) {
  const status = Number(result?.status);
  if ([408, 425, 429].includes(status) || status >= 500) return true;
  const code = String(result?.errorCode || '').toLowerCase();
  return code.includes('.timeout') || code.includes('.fetch-failed');
}

export function computeRetryBackoff(previousLevel, now = new Date(), {
  retryable = true,
  retryAfterMs = 0,
} = {}) {
  if (!retryable) return { level: 0, nextRetryISO: null, delayMs: 0 };
  const prior = Number.isInteger(Number(previousLevel)) ? Number(previousLevel) : 0;
  const level = Math.min(API_RETRY_BACKOFF_MAX_LEVEL, Math.max(1, prior + 1));
  const exponentialDelayMs = API_RETRY_BACKOFF_BASE_MS * (2 ** (level - 1));
  const serverDelayMs = boundedMilliseconds(retryAfterMs, 0);
  const delayMs = Math.min(API_RETRY_BACKOFF_MAX_MS, Math.max(exponentialDelayMs, serverDelayMs));
  return {
    level,
    delayMs,
    nextRetryISO: new Date(now.getTime() + delayMs).toISOString(),
  };
}

export function createInFlightRegistry() {
  const entries = new Map();

  return {
    getOrCreate(key, identity, task) {
      const existing = entries.get(key);
      if (existing && existing.identity === identity) return existing.promise;

      const promise = Promise.resolve().then(task);
      const tracked = promise.finally(() => {
        if (entries.get(key)?.promise === tracked) entries.delete(key);
      });
      entries.set(key, { identity, promise: tracked });
      return tracked;
    },
    get size() {
      return entries.size;
    },
  };
}

function toTimestamp(value) {
  if (typeof value !== 'string' || !value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function boundedMilliseconds(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
