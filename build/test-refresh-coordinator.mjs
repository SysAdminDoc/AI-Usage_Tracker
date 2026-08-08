import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const {
  API_PROVIDER_FRESH_TTL_MS,
  API_RETRY_BACKOFF_BASE_MS,
  API_RETRY_BACKOFF_MAX_MS,
  computeRetryBackoff,
  createInFlightRegistry,
  decideProviderRefresh,
  isRetryableProviderError,
} = await import('../src/lib/refresh-coordinator.js?refresh-coordinator');

const now = new Date('2026-08-08T12:00:00.000Z');
const recent = new Date(now.getTime() - API_PROVIDER_FRESH_TTL_MS + 1).toISOString();
const old = new Date(now.getTime() - API_PROVIDER_FRESH_TTL_MS - 1).toISOString();

assert.deepEqual(decideProviderRefresh({ lastSuccessISO: recent }, { now }), {
  refresh: false,
  reason: 'fresh',
  ageMs: API_PROVIDER_FRESH_TTL_MS - 1,
});
assert.equal(decideProviderRefresh({ lastSuccessISO: old }, { now }).refresh, true);
assert.equal(decideProviderRefresh({ lastSuccessISO: recent }, { now, force: true }).reason, 'manual');

const retryAt = new Date(now.getTime() + 20_000).toISOString();
const backoffDecision = decideProviderRefresh({ nextRetryISO: retryAt }, { now });
assert.equal(backoffDecision.refresh, false);
assert.equal(backoffDecision.reason, 'backoff');
assert.equal(backoffDecision.retryInMs, 20_000);

const firstBackoff = computeRetryBackoff(0, now);
assert.equal(firstBackoff.level, 1);
assert.equal(firstBackoff.delayMs, API_RETRY_BACKOFF_BASE_MS);
const serverBackoff = computeRetryBackoff(1, now, { retryAfterMs: 90_000 });
assert.equal(serverBackoff.delayMs, 90_000);
const cappedBackoff = computeRetryBackoff(5, now, { retryAfterMs: API_RETRY_BACKOFF_MAX_MS * 2 });
assert.equal(cappedBackoff.delayMs, API_RETRY_BACKOFF_MAX_MS);
assert.equal(computeRetryBackoff(2, now, { retryable: false }).nextRetryISO, null);

assert.equal(isRetryableProviderError({ status: 429 }), true);
assert.equal(isRetryableProviderError({ status: 503 }), true);
assert.equal(isRetryableProviderError({ errorCode: 'provider.fetch.timeout' }), true);
assert.equal(isRetryableProviderError({ status: 400 }), false);

const registry = createInFlightRegistry();
let calls = 0;
const task = () => {
  calls += 1;
  return new Promise((resolve) => setTimeout(() => resolve('shared'), 5));
};
const first = registry.getOrCreate('profile:provider', 'identity-a', task);
const second = registry.getOrCreate('profile:provider', 'identity-a', task);
assert.deepEqual(await Promise.all([first, second]), ['shared', 'shared']);
assert.equal(calls, 1, 'concurrent callers should share one provider request');
assert.equal(registry.size, 0, 'completed requests should leave the registry');
await registry.getOrCreate('profile:provider', 'identity-b', task);
assert.equal(calls, 2, 'a changed credential/settings identity should start a new request');

const background = await fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8');
assert.match(background, /decideProviderRefresh\(state\.snapshot\?\.providers\?\.\[provider\]/);
assert.match(background, /apiRefreshInFlight\.getOrCreate\(key, identity/);
assert.match(background, /refreshNow\(\{ allowSilentTab: true, force: true \}\)/);
assert.match(background, /refreshSkippedReason: retry\.nextRetryISO \? 'backoff' : null/);

console.log('provider refresh coordination smoke: OK');
