import assert from 'node:assert/strict';
import {
  CLAUDE_CACHE_WINDOW_MS,
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

console.log('cache timer smoke: OK');
