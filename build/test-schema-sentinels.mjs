import assert from 'node:assert/strict';

import {
  clearClaudeOrgCache,
  fetchClaude,
  parseClaudeUsageApi,
} from '../src/scrapers/claude.js?schema-sentinel-test';
import { fetchCodex, parseCodexUsageApi } from '../src/scrapers/codex.js?schema-sentinel-test';
import { extractClaudeRateLimitHeaders } from '../src/lib/claude-stream.js?schema-sentinel-test';
import { mergeProviderResult } from '../src/lib/provider-state.js?schema-sentinel-test';
import { parseAnthropicResponse, parseAnthropicUsage } from '../src/providers/anthropic.js?schema-sentinel-test';
import { parseOpenAIResponse, parseOpenAIUsage } from '../src/providers/openai.js?schema-sentinel-test';
import { parseCursorUsage } from '../src/providers/cursor.js?schema-sentinel-test';
import { parseGeminiUsage } from '../src/providers/gemini.js?schema-sentinel-test';
import { parseGitHubCopilotUsage } from '../src/providers/github-copilot.js?schema-sentinel-test';
import { parseOpenRouterUsage } from '../src/providers/openrouter.js?schema-sentinel-test';

const now = new Date('2026-08-03T12:00:00.000Z');

const claudeKnown = parseClaudeUsageApi({ usage: { windows: {
  fiveHour: { utilization: 0.25, resetAt: '2026-08-03T17:00:00Z' },
  sevenDay: { utilization: 0.4, resetAt: '2026-08-10T17:00:00Z' },
} } }, { now });
assert.equal(claudeKnown.ok, true);
assert.equal(claudeKnown.schemaVersion, 1);
assert.equal(claudeKnown.schemaFingerprint, 'claude.api.v1.usage-windows');

const codexKnown = parseCodexUsageApi({ rate_limit: {
  primary_window: { used_percent: 25, reset_after_seconds: 3600 },
  secondary_window: { used_percent: 40, reset_after_seconds: 7200 },
} }, { now });
assert.equal(codexKnown.ok, true);
assert.equal(codexKnown.schemaVersion, 1);
assert.equal(codexKnown.schemaFingerprint, 'codex.api.v1.rate-limit-windows');

const unknownClaude = parseClaudeUsageApi({ usage: { windows: {
  renamed_window: { value: 25, resetAt: '2026-08-03T17:00:00Z' },
} } }, { now });
assertSchemaFailure(unknownClaude, 'claude.api.schema-unsupported');

const unknownCodex = parseCodexUsageApi({ rate_limits: {
  renamed_window: { value: 25, resetAt: '2026-08-03T17:00:00Z' },
} }, { now });
assertSchemaFailure(unknownCodex, 'codex.api.schema-unsupported');

const delayedHeaders = new Headers({
  'anthropic-ratelimit-unified-5h-status': 'allowed',
  'anthropic-ratelimit-unified-5h-reset': '2026-08-03T17:00:00Z',
});
assert.equal(extractClaudeRateLimitHeaders(delayedHeaders), null,
  'delayed headers without utilization must not create a guessed window');
assertSchemaFailure(parseClaudeUsageApi({ message_limit: { windows: {
  five_hour: { reset_at: '2026-08-03T17:00:00Z' },
} } }, { now }), 'claude.api.schema-unsupported');

assertSchemaFailure(parseAnthropicResponse({ usage: { data: [] } }, {
  usageTruncated: true,
}), 'anthropic-api.pagination.schema-unsupported');
assertSchemaFailure(parseOpenAIResponse({ usage: { data: [] } }, {
  costsTruncated: true,
}), 'openai-api.pagination.schema-unsupported');

const unknownApiCases = [
  [parseAnthropicUsage({ data: [{ results: [{ renamed_field: true }] }] }), 'anthropic-api.usage.schema-unsupported'],
  [parseOpenAIUsage({ data: [{ results: [{ renamed_field: true }] }] }), 'openai-api.usage.schema-unsupported'],
  [parseCursorUsage({ daily: { data: [{ renamed_field: true }] }, spend: {} }), 'cursor.usage.schema-unsupported'],
  [parseGeminiUsage({ output: { changed: [] }, requests: { changed: [] } }), 'gemini.usage.schema-unsupported'],
  [parseGitHubCopilotUsage({ renamed_field: true }), 'github-copilot.seat.schema-unsupported'],
  [parseOpenRouterUsage({ key: { data: { renamed_field: true } }, credits: { data: { renamed_field: true } } }), 'openrouter.usage.schema-unsupported'],
];
for (const [result, errorCode] of unknownApiCases) assertSchemaFailure(result, errorCode);

const pageClaudeHTML = [
  '<h2>Plan usage limits <span>Max (20x)</span></h2>',
  '<span class="text-body text-primary">Current session</span><div role="progressbar" aria-valuenow="42"></div>',
].join('');
clearClaudeOrgCache();
const claudeDisagreement = await fetchClaude({
  now,
  fetchImpl: async (url) => {
    if (String(url) === 'https://claude.ai/api/organizations') {
      return jsonResponse({ organizations: [{ id: 'org_schema_test', is_default: true }] });
    }
    if (String(url).includes('/api/organizations/') && String(url).endsWith('/usage')) {
      return jsonResponse({ usage: { windows: { renamed_window: { value: 25 } } } });
    }
    return textResponse(pageClaudeHTML);
  },
});
assert.equal(claudeDisagreement.ok, false);
assert.equal(claudeDisagreement.staleReason, 'source-disagreement');
assert.equal(claudeDisagreement.errorCode, 'claude.reconcile.schema-unsupported');

const pageCodexHTML = [
  '<div>Codex Analytics</div>',
  '<article><header><p>5 hour usage limit</p></header><span>25%</span><span>Resets in 1 hr</span></article>',
].join('');
const codexDisagreement = await fetchCodex({
  now,
  fetchImpl: async (url) => {
    if (String(url).includes('/api/auth/session')) return jsonResponse({ accessToken: 'schema-test-token' });
    if (String(url).includes('/wham/usage')) {
      return jsonResponse({ rate_limits: { renamed_window: { value: 25 } } });
    }
    return textResponse(pageCodexHTML);
  },
});
assert.equal(codexDisagreement.ok, false);
assert.equal(codexDisagreement.staleReason, 'source-disagreement');
assert.equal(codexDisagreement.errorCode, 'codex.reconcile.schema-unsupported');

const previous = {
  ok: true,
  provider: 'claude',
  buckets: [{ id: 'claude-session', percentUsed: 42 }],
  lastSuccessISO: '2026-08-03T11:00:00.000Z',
};
const preserved = mergeProviderResult(previous, unknownClaude, { now, source: 'fetch' });
assert.equal(preserved.ok, true, 'schema drift must preserve the last successful provider state');
assert.deepEqual(preserved.buckets, previous.buckets);
assert.equal(preserved.lastSuccessISO, previous.lastSuccessISO);
assert.equal(preserved.stale, true);
assert.equal(preserved.staleReason, 'schema-drift');
assert.equal(preserved.lastErrorCode, 'claude.api.schema-unsupported');
assert.equal(preserved.lastErrorSchemaVersion, 1);

console.log('provider schema sentinels, pagination guards, source disagreement, and last-good preservation: OK');

function assertSchemaFailure(result, errorCode) {
  assert.equal(result.ok, false, `expected ${errorCode} to fail closed`);
  assert.equal(result.error, 'unsupported-schema');
  assert.equal(result.errorCode, errorCode);
  assert.equal(result.schemaVersion, 1);
  assert.match(result.schemaFingerprint, /^shape-[0-9a-f]{8}$/);
  assert.ok(result.schemaExpectedFingerprint);
  assert.ok(result.schemaReason);
  assert.deepEqual(result.buckets, []);
}

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function textResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}
