import assert from 'node:assert/strict';

const anthroFixture = {
  data: [{
    starting_at: '2026-08-01T00:00:00Z',
    ending_at: '2026-08-02T00:00:00Z',
    results: [{
      model: 'claude-sonnet-4-6',
      workspace_id: 'wrkspc_1234567890',
      uncached_input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 200,
      cache_creation: { ephemeral_5m_input_tokens: 50, ephemeral_1h_input_tokens: 25 },
      server_tool_use: { web_search_requests: 2 },
    }],
  }],
};

const openAIUsageFixture = {
  data: [{
    start_time: 1785542400,
    end_time: 1785628800,
    results: [{
      model: 'gpt-5.4',
      project_id: 'proj_1234567890',
      api_key_id: 'key_1234567890',
      input_tokens: 2000,
      output_tokens: 750,
      input_cached_tokens: 400,
      num_model_requests: 7,
    }],
  }],
};

const openAICostFixture = {
  data: [{
    start_time: 1785542400,
    end_time: 1785628800,
    results: [{
      amount: { value: 1.25, currency: 'usd' },
      line_item: 'Text generation',
      project_id: 'proj_1234567890',
      api_key_id: 'key_1234567890',
    }],
  }],
};

const { fetchAnthropicUsage, parseAnthropicUsage } = await import('../src/providers/anthropic.js');
const { fetchOpenAIUsage, parseOpenAIUsage } = await import('../src/providers/openai.js');
const {
  exportSettings,
  defaultState,
  getApiCredentialStatus,
  loadApiCredential,
  removeApiCredential,
  saveApiCredential,
} = await import('../src/lib/storage.js?api-provider-test');

const fixedNow = new Date('2026-08-03T12:00:00.000Z');
let anthropicRequest;
const anthropic = await fetchAnthropicUsage({
  apiKey: 'sk-ant-test-secret',
  now: fixedNow,
  fetchImpl: async (url, options) => {
    anthropicRequest = { url, options };
    return { ok: true, status: 200, json: async () => anthroFixture };
  },
});
assert.equal(anthropic.ok, true);
assert.equal(anthropic.provider, 'anthropic-api');
assert.equal(anthropic.buckets[0].metric.totalTokens, 1775);
assert.equal(anthropicRequest.options.headers['x-api-key'], 'sk-ant-test-secret');
assert.match(anthropicRequest.url, /usage_report\/messages/);
assert.match(anthropicRequest.url, /group_by%5B%5D=model/);

let openAIRequests = [];
const openAI = await fetchOpenAIUsage({
  apiKey: 'sk-admin-test-secret',
  now: fixedNow,
  fetchImpl: async (url, options) => {
    openAIRequests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => url.includes('/costs') ? openAICostFixture : openAIUsageFixture,
    };
  },
});
assert.equal(openAI.ok, true);
assert.equal(openAI.provider, 'openai-api');
const openAIUsageBucket = openAI.buckets.find((bucket) => bucket.metric.totalTokens === 2750);
const openAICostBucket = openAI.buckets.find((bucket) => bucket.metric.kind === 'currency');
assert.ok(openAIUsageBucket);
assert.ok(openAICostBucket);
assert.equal(openAIUsageBucket.metric.requests, 7);
assert.equal(openAICostBucket.metric.costUSD, 1.25);
assert.equal(openAI.totals.costUSD, 1.25);
assert.equal(openAIRequests.length, 2);
assert.ok(openAIRequests.every(({ options }) => options.headers.Authorization === 'Bearer sk-admin-test-secret'));
assert.ok(openAIRequests.some(({ url }) => url.includes('/organization/usage/completions')));
assert.ok(openAIRequests.some(({ url }) => url.includes('/organization/costs')));

const parsed = parseOpenAIUsage(openAIUsageFixture, {
  costs: openAICostFixture,
  range: { startISO: fixedNow.toISOString(), endISO: fixedNow.toISOString() },
});
const parsedUsageBucket = parsed.buckets.find((bucket) => bucket.metric.totalTokens === 2750);
assert.equal(parsedUsageBucket.dimensions.projectId, 'proj_1234567890');
assert.equal(parsedUsageBucket.dimensions.apiKeyId, 'key_1234567890');
assert.equal(parseAnthropicUsage({ data: [] }).ok, false);

globalThis.__AUT_ALLOW_LOCALSTORAGE__ = true;
const backing = new Map();
globalThis.localStorage = {
  getItem: (key) => backing.has(key) ? backing.get(key) : null,
  setItem: (key, value) => backing.set(key, value),
};
await saveApiCredential('anthropic-api', 'sk-ant-never-export-this');
assert.equal((await getApiCredentialStatus())['anthropic-api'].configured, true);
assert.equal(await loadApiCredential('anthropic-api'), 'sk-ant-never-export-this');
const serialized = JSON.stringify(exportSettings(defaultState()));
assert.doesNotMatch(serialized, /never-export-this/);
await removeApiCredential('anthropic-api');
assert.equal((await getApiCredentialStatus())['anthropic-api'].configured, false);

console.log('API provider contracts and credential boundary: OK');
