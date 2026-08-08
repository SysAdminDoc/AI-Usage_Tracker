import assert from 'node:assert/strict';

const {
  readJSONPages,
  readJSONResponse,
} = await import('../src/providers/api-contract.js?bounded-contract');

let observedSignal;
const normal = await readJSONResponse(async (_url, options) => {
  observedSignal = options.signal;
  return new Response(JSON.stringify({ data: [{ id: 'ok' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}, 'https://example.test/normal', {}, 'test-provider', 'normal', { timeoutMs: 100 });
assert.equal(normal.ok, true);
assert.equal(normal.data.data[0].id, 'ok');
assert.ok(observedSignal, 'provider requests should receive an abort signal');

const retryAfter = await readJSONResponse(
  async () => new Response('', { status: 429, headers: { 'retry-after': '90' } }),
  'https://example.test/rate-limit', {}, 'test-provider', 'rate-limit',
);
assert.equal(retryAfter.status, 429);
assert.equal(retryAfter.retryAfterMs, 90_000);

const oversized = await readJSONResponse(
  async () => new Response('x'.repeat(32), { status: 200, headers: { 'content-length': '32' } }),
  'https://example.test/large', {}, 'test-provider', 'large', { maxResponseBytes: 16 },
);
assert.equal(oversized.errorCode, 'test-provider.large.response-too-large');

const invalid = await readJSONResponse(
  async () => new Response('{not-json', { status: 200 }),
  'https://example.test/invalid', {}, 'test-provider', 'invalid',
);
assert.equal(invalid.errorCode, 'test-provider.invalid.invalid-json');

const timedOut = await readJSONResponse(
  async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }),
  'https://example.test/slow', {}, 'test-provider', 'slow', { timeoutMs: 5 },
);
assert.equal(timedOut.errorCode, 'test-provider.slow.timeout');

const abortController = new AbortController();
const abortedPromise = readJSONResponse(
  async (_url, options) => new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }),
  'https://example.test/aborted', { signal: abortController.signal }, 'test-provider', 'aborted', { timeoutMs: 100 },
);
abortController.abort();
const aborted = await abortedPromise;
assert.equal(aborted.errorCode, 'test-provider.aborted.aborted');

let pageCalls = 0;
const paged = await readJSONPages(async (url) => {
  pageCalls += 1;
  const page = new URL(url).searchParams.get('page');
  return {
    ok: true,
    status: 200,
    json: async () => page
      ? { data: [{ id: 'second' }], has_more: true, next_page: 'third' }
      : { data: [{ id: 'first' }], has_more: true, next_page: 'second' },
  };
}, 'https://example.test/report', {}, 'test-provider', 'report', { maxPages: 2 });
assert.equal(paged.ok, true);
assert.equal(paged.truncated, true);
assert.equal(paged.data.data.length, 2);
assert.equal(pageCalls, 2);

const tooManyItems = await readJSONPages(
  async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 1 }, { id: 2 }] }) }),
  'https://example.test/items', {}, 'test-provider', 'items', { maxItems: 1 },
);
assert.equal(tooManyItems.errorCode, 'test-provider.items.response-items-too-many');

const tooManyBytes = await readJSONPages(
  async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'first' }], has_more: true, next_page: 'second' }) }),
  'https://example.test/total', {}, 'test-provider', 'total', {
    maxResponseBytes: 1024,
    maxTotalResponseBytes: 10,
  },
);
assert.equal(tooManyBytes.errorCode, 'test-provider.total.total-response-too-large');

console.log('API request bounds smoke: OK');
