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

const anthroCostFixture = {
  data: [{
    starting_at: '2026-08-01T00:00:00Z',
    ending_at: '2026-08-02T00:00:00Z',
    results: [{
      amount: '123.45',
      currency: 'USD',
      cost_type: 'tokens',
      description: 'claude-sonnet-4-6 tokens',
      model: 'claude-sonnet-4-6',
      workspace_id: 'wrkspc_1234567890',
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

const copilotSeatFixture = {
  plan_type: 'business',
  last_activity_at: '2026-08-03T11:30:00Z',
  last_authenticated_at: '2026-08-03T11:00:00Z',
  last_activity_editor: 'vscode/1.99.0/copilot/1.250.0',
  assignee: { login: 'octocat' },
};

const cursorDailyFixture = {
  data: [{
    date: 1785758400000,
    isActive: true,
    subscriptionIncludedReqs: 12,
    apiKeyReqs: 1,
    usageBasedReqs: 3,
    agentRequests: 10,
    mostUsedModel: 'composer-2',
  }],
  period: { startDate: 1785542400000, endDate: 1785782400000 },
};

const cursorSpendFixture = {
  teamMemberSpend: [{
    spendCents: 2450,
    fastPremiumRequests: 4,
    name: 'Alex',
    email: 'alex@example.com',
    role: 'owner',
    hardLimitOverrideDollars: 100,
  }],
  subscriptionCycleStart: 1785542400000,
  totalMembers: 1,
  totalPages: 1,
};

const geminiOutputFixture = {
  timeSeries: [{
    metric: { labels: { model: 'gemini-3.5-flash' } },
    points: [{
      interval: { endTime: '2026-08-02T12:00:00Z' },
      value: { int64Value: '800' },
    }],
  }],
};

const geminiRequestFixture = {
  timeSeries: [{
    metric: { labels: { model: 'gemini-3.5-flash' } },
    points: [{
      interval: { endTime: '2026-08-02T12:00:00Z' },
      value: { int64Value: '5' },
    }],
  }],
};

const openRouterKeyFixture = {
  data: {
    usage: 25.5,
    usage_monthly: 25.5,
    usage_daily: 3.25,
    usage_weekly: 12.5,
    limit: 100,
    limit_remaining: 74.5,
    limit_reset: 'monthly',
    label: 'Local usage key',
  },
};

const openRouterCreditsFixture = {
  data: {
    total_credits: 100.5,
    total_usage: 25.75,
  },
};

const { parseAnthropicUsage } = await import('../src/providers/anthropic.js');
const { parseOpenAIUsage } = await import('../src/providers/openai.js');
const { parseGitHubCopilotUsage } = await import('../src/providers/github-copilot.js');
const { parseCursorUsage } = await import('../src/providers/cursor.js');
const { parseGeminiUsage } = await import('../src/providers/gemini.js');
const { parseOpenRouterUsage } = await import('../src/providers/openrouter.js');
const { API_PROVIDER_IDS, readJSONPages } = await import('../src/providers/api-contract.js?pagination-test');
const {
  fetchProviderUsage,
  getProviderPlugin,
  listProviderPlugins,
} = await import('../src/providers/registry.js?plugin-contract-test');
const {
  defineProviderPlugin,
  normalizeProviderSnapshot,
  runProviderPlugin,
} = await import('../src/providers/plugin-api.js?plugin-contract-test');
const {
  exportSettings,
  defaultState,
  getApiCredentialStatus,
  loadApiCredential,
  removeApiCredential,
  saveApiCredential,
} = await import('../src/lib/storage.js?api-provider-test');

const fixedNow = new Date('2026-08-03T12:00:00.000Z');
assert.deepEqual(listProviderPlugins().map((plugin) => plugin.id), API_PROVIDER_IDS);
for (const plugin of listProviderPlugins()) {
  assert.equal(typeof plugin.auth, 'function');
  assert.equal(typeof plugin.fetch, 'function');
  assert.equal(typeof plugin.parse, 'function');
  assert.equal(typeof plugin.normalize, 'function');
  assert.equal(getProviderPlugin(plugin.id), plugin);
}
let fixtureParseSawSecret = false;
const fixturePlugin = defineProviderPlugin({
  id: 'fixture-provider',
  meta: {
    label: 'Fixture provider',
    capabilities: {
      tokenUsage: false,
      requestUsage: true,
      cost: false,
      quotaWindows: false,
      dimensions: ['fixture'],
    },
    accuracy: {
      usage: 'official',
      cost: 'unavailable',
      reset: 'unavailable',
      freshness: 'realtime',
      caveat: 'Local fixture data is deterministic and contains no provider credentials.',
    },
  },
  auth: ({ credential }) => ({ ok: true, provider: 'fixture-provider', apiKey: credential, scope: 'fixture' }),
  fetch: ({ auth }) => ({ ok: true, provider: 'fixture-provider', data: { value: 3 }, meta: { source: 'fixture' } }),
  parse: (data, context) => {
    fixtureParseSawSecret = context.auth?.apiKey != null;
    return {
      ok: true,
      provider: 'fixture-provider',
      source: 'api-key',
      buckets: [{
        id: 'fixture-row', label: `Value ${data.value}`, kind: 'api', model: null,
        percentUsed: data.value, resetISO: null, metric: { kind: 'requests', requests: data.value },
      }],
    };
  },
  normalize: (snapshot) => normalizeProviderSnapshot(snapshot, 'fixture-provider'),
});
const fixtureResult = await runProviderPlugin(fixturePlugin, { credential: 'fixture-secret' });
assert.equal(fixtureResult.ok, true);
assert.equal(fixtureResult.buckets[0].metric.requests, 3);
assert.equal(fixtureParseSawSecret, false);
let anthropicRequests = [];
const anthropic = await fetchProviderUsage('anthropic-api', {
  credential: 'sk-ant-test-secret',
  now: fixedNow,
  fetchImpl: async (url, options) => {
    anthropicRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => url.includes('/cost_report') ? anthroCostFixture : anthroFixture };
  },
});
assert.equal(anthropic.ok, true);
assert.equal(anthropic.provider, 'anthropic-api');
assert.equal(anthropic.buckets[0].metric.totalTokens, 1775);
assert.equal(anthropic.buckets[0].metric.costUSD, 1.2345);
assert.equal(anthropic.buckets[0].metric.costSource, 'official');
assert.equal(anthropic.totals.costUSD, 1.2345);
assert.equal(anthropicRequests.length, 2);
assert.ok(anthropicRequests.every(({ options }) => options.headers['x-api-key'] === 'sk-ant-test-secret'));
assert.ok(anthropicRequests.some(({ url }) => /usage_report\/messages/.test(url)));
assert.ok(anthropicRequests.some(({ url }) => /cost_report/.test(url)));
assert.ok(anthropicRequests.some(({ url }) => url.includes('group_by%5B%5D=description')));

let openAIRequests = [];
const openAI = await fetchProviderUsage('openai-api', {
  credential: 'sk-admin-test-secret',
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
assert.equal(openAIUsageBucket.metric.costUSD, 0.01535);
assert.equal(openAIUsageBucket.metric.costSource, 'pricing-table');
assert.equal(openAIUsageBucket.metric.pricingVersion, '2026-08-03');
assert.equal(openAICostBucket.metric.costUSD, 1.25);
assert.equal(openAICostBucket.metric.costSource, 'official');
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
const anthropicFallback = parseAnthropicUsage(anthroFixture);
assert.equal(anthropicFallback.buckets[0].metric.costSource, 'pricing-table');
assert.equal(anthropicFallback.buckets[0].metric.pricingVersion, '2026-08-03');

let paginationRequests = [];
const paged = await readJSONPages(async (url) => {
  paginationRequests.push(url);
  const page = new URL(url).searchParams.get('page');
  return {
    ok: true,
    status: 200,
    json: async () => page ? { data: [{ id: 'second' }] } : {
      data: [{ id: 'first' }], has_more: true, next_page: 'opaque-next-token',
    },
  };
}, 'https://example.test/report?limit=1', {}, 'test-provider', 'report');
assert.deepEqual(paged.data.data.map((row) => row.id), ['first', 'second']);
assert.equal(paginationRequests.length, 2);
assert.match(paginationRequests[1], /page=opaque-next-token/);

let copilotRequest;
const copilot = await fetchProviderUsage('github-copilot', {
  credential: 'github-token-never-export-this',
  settings: { githubCopilotOrganization: 'acme-tools', githubCopilotUsername: 'octocat' },
  fetchImpl: async (url, options) => {
    copilotRequest = { url, options };
    return { ok: true, status: 200, json: async () => copilotSeatFixture };
  },
});
assert.equal(copilot.ok, true);
assert.equal(copilot.provider, 'github-copilot');
assert.equal(copilot.plan, 'Copilot Business');
assert.equal(copilot.buckets[0].metric.kind, 'activity');
assert.equal(copilot.buckets[0].metric.lastActivityEditor, copilotSeatFixture.last_activity_editor);
assert.match(copilotRequest.url, /api\.github\.com\/orgs\/acme-tools\/members\/octocat\/copilot/);
assert.equal(copilotRequest.options.headers.Authorization, 'Bearer github-token-never-export-this');
assert.equal(copilotRequest.options.headers['X-GitHub-Api-Version'], '2026-03-10');
assert.equal(parseGitHubCopilotUsage({}, { organization: 'acme', username: 'user' }).ok, false);
assert.equal((await getApiCredentialStatus())['github-copilot'].configured, false);

let cursorRequests = [];
const cursor = await fetchProviderUsage('cursor', {
  credential: 'key_cursor-test-secret',
  now: fixedNow,
  fetchImpl: async (url, options) => {
    cursorRequests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => url.includes('/teams/spend') ? cursorSpendFixture : cursorDailyFixture,
    };
  },
});
assert.equal(cursor.ok, true);
assert.equal(cursor.provider, 'cursor');
assert.equal(cursor.plan, 'Cursor team');
assert.equal(cursor.totals.spendUSD, 24.5);
assert.equal(cursor.totals.premiumRequests, 4);
assert.equal(cursor.buckets.find((bucket) => bucket.id === 'cursor-requests').metric.requests, 16);
assert.equal(cursor.buckets.find((bucket) => bucket.id === 'cursor-spend').metric.costUSD, 24.5);
assert.match(cursor.buckets[0].resetISO, /^2026-09-01/);
assert.equal(cursorRequests.length, 2);
assert.ok(cursorRequests.every(({ options }) => options.method === 'POST'));
assert.ok(cursorRequests.every(({ options }) => options.headers.Authorization === `Basic ${Buffer.from('key_cursor-test-secret:').toString('base64')}`));
assert.ok(cursorRequests.some(({ url }) => url.endsWith('/teams/daily-usage-data')));
assert.ok(cursorRequests.some(({ url }) => url.endsWith('/teams/spend')));
assert.equal(parseCursorUsage({ daily: {}, spend: {} }).ok, false);
assert.equal((await getApiCredentialStatus()).cursor.configured, false);

let geminiRequests = [];
const gemini = await fetchProviderUsage('gemini', {
  credential: 'ya29-gemini-test-token',
  settings: { geminiProjectId: 'my-gemini-project' },
  now: fixedNow,
  fetchImpl: async (url, options) => {
    geminiRequests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => url.includes('generate_requests_per_model') ? geminiRequestFixture : geminiOutputFixture,
    };
  },
});
assert.equal(gemini.ok, true);
assert.equal(gemini.provider, 'gemini');
assert.equal(gemini.plan, 'Gemini API');
assert.equal(gemini.totals.outputTokens, 800);
assert.equal(gemini.totals.requests, 5);
assert.equal(gemini.buckets[0].metric.totalTokens, 800);
assert.equal(gemini.buckets[0].metric.requests, 5);
assert.equal(gemini.buckets[0].dimensions.projectId, 'my-gemini-project');
assert.equal(geminiRequests.length, 2);
assert.ok(geminiRequests.every(({ options }) => options.headers.Authorization === 'Bearer ya29-gemini-test-token'));
assert.ok(geminiRequests.every(({ url }) => url.includes('/v3/projects/my-gemini-project/timeSeries')));
assert.equal(parseGeminiUsage({ output: {}, requests: {} }).ok, false);
assert.equal((await getApiCredentialStatus()).gemini.configured, false);

let openRouterRequests = [];
const openRouter = await fetchProviderUsage('openrouter', {
  credential: 'sk-or-v1-test-secret',
  now: fixedNow,
  fetchImpl: async (url, options) => {
    openRouterRequests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => url.endsWith('/key') ? openRouterKeyFixture : openRouterCreditsFixture,
    };
  },
});
assert.equal(openRouter.ok, true);
assert.equal(openRouter.provider, 'openrouter');
assert.equal(openRouter.plan, 'OpenRouter');
assert.equal(openRouter.totals.usageUSD, 25.5);
assert.equal(openRouter.totals.totalCreditsUSD, 100.5);
assert.equal(openRouter.buckets.find((bucket) => bucket.id === 'openrouter-key-usage').percentUsed, 25.5);
assert.equal(openRouter.buckets.find((bucket) => bucket.id === 'openrouter-credits').metric.remainingCreditsUSD, 74.75);
assert.match(openRouter.buckets.find((bucket) => bucket.id === 'openrouter-key-usage').resetISO, /^2026-09-01/);
assert.equal(openRouterRequests.length, 2);
assert.ok(openRouterRequests.every(({ options }) => options.headers.Authorization === 'Bearer sk-or-v1-test-secret'));
assert.ok(openRouterRequests.some(({ url }) => url.endsWith('/api/v1/key')));
assert.ok(openRouterRequests.some(({ url }) => url.endsWith('/api/v1/credits')));
assert.equal(parseOpenRouterUsage({ key: {}, credits: {} }).ok, false);
assert.equal((await getApiCredentialStatus()).openrouter.configured, false);

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
