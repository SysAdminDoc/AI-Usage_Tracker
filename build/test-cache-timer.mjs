import assert from 'node:assert/strict';
import {
  CLAUDE_CACHE_WINDOW_MS,
  CACHE_REUSE_DAY_MS,
  CACHE_REUSE_WEEK_MS,
  cacheReuseStats,
  extractClaudeCacheTimer,
  mergeCacheTimer,
} from '../src/lib/cache-timer.js';

const now = new Date('2026-06-16T12:00:00.000Z');

const fallback = extractClaudeCacheTimer({ windows: { '5h': { utilization: 0.2 } } }, { now, source: 'stream' });
assert.equal(fallback.cachedUntilISO, '2026-06-16T12:05:00.000Z');
assert.equal(fallback.windowMs, CLAUDE_CACHE_WINDOW_MS);
assert.equal(fallback.source, 'stream:observed');

const explicit = extractClaudeCacheTimer({ cache: { cached_until: '2026-06-16T12:03:30.000Z' } }, { now, source: 'stream' });
assert.equal(explicit.cachedUntilISO, '2026-06-16T12:03:30.000Z');
assert.equal(explicit.source, 'stream:explicit');

const ttl = extractClaudeCacheTimer({ cache_ttl_seconds: 90 }, { now, source: 'stream' });
assert.equal(ttl.cachedUntilISO, '2026-06-16T12:01:30.000Z');
assert.equal(ttl.source, 'stream:ttl');

const ignoredHeaders = extractClaudeCacheTimer({ windows: { '5h': { utilization: 0.2 } } }, { now, source: 'headers' });
assert.equal(ignoredHeaders, null);

const state = mergeCacheTimer({ snapshot: {} }, fallback);
assert.equal(state.cache.claude.cachedUntilISO, fallback.cachedUntilISO);
assert.equal(state.snapshot !== undefined, true);
assert.equal(state.cache.claude.reuseEvents.length, 1);
assert.equal(state.cache.claude.reuseEvents[0].reused, false);

const reusedAt = new Date('2026-06-16T12:02:00.000Z');
const reusedTimer = extractClaudeCacheTimer({ windows: { '5h': { utilization: 0.3 } } }, { now: reusedAt, source: 'stream' });
const reusedState = mergeCacheTimer(state, reusedTimer);
assert.equal(reusedState.cache.claude.reuseEvents.at(-1).reused, true, 'an event inside the prior cache window should count as reuse');

const missAt = new Date('2026-06-16T12:08:00.000Z');
const missTimer = extractClaudeCacheTimer({ windows: { '5h': { utilization: 0.4 } } }, { now: missAt, source: 'stream' });
const missState = mergeCacheTimer(reusedState, missTimer);
assert.equal(missState.cache.claude.reuseEvents.at(-1).reused, false, 'an event after expiry should start a new cache window');

const dayStats = cacheReuseStats(missState.cache.claude.reuseEvents, { now: missAt, windowMs: CACHE_REUSE_DAY_MS });
assert.equal(dayStats.eventCount, 3);
assert.equal(dayStats.reuseCount, 1);
assert.equal(dayStats.reuseRatio, 1 / 3);
const weekStats = cacheReuseStats(missState.cache.claude.reuseEvents, { now: missAt, windowMs: CACHE_REUSE_WEEK_MS });
assert.equal(weekStats.eventCount, 3);

const oldEventStats = cacheReuseStats([
  { sampledAtISO: '2026-06-01T12:00:00.000Z', reused: true },
  ...missState.cache.claude.reuseEvents,
], { now: missAt, windowMs: CACHE_REUSE_DAY_MS });
assert.equal(oldEventStats.eventCount, 3, 'events outside a rolling window should be excluded');

console.log('cache timer smoke: OK');
