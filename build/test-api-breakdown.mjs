import assert from 'node:assert/strict';
import { apiBreakdownToCSV, buildApiBreakdown } from '../src/lib/api-breakdown.js';

const snapshot = {
  providers: {
    'anthropic-api': {
      ok: true,
      buckets: [{
        metric: { kind: 'tokens', totalTokens: 2500, costUSD: 2.5, costSource: 'official' },
        dimensions: { model: 'claude-sonnet-4-6', workspaceId: 'workspace-secret-1234' },
      }],
    },
    'openai-api': {
      ok: true,
      buckets: [{
        metric: { kind: 'tokens', totalTokens: 1500, requests: 12, costUSD: 0.75, costSource: 'pricing-table' },
        dimensions: { model: 'gpt-5.4', projectId: 'project-secret-5678', apiKeyId: 'key-secret-9012' },
      }],
    },
    'github-copilot': { ok: true, buckets: [{ metric: { kind: 'activity' } }] },
  },
};

const breakdown = buildApiBreakdown(snapshot);
assert.equal(breakdown.schema, 'ai-usage-tracker.api-breakdown');
assert.equal(breakdown.version, 1);
assert.equal(breakdown.rows.length, 3, 'API rows should remain available for a complete provider breakdown');
assert.equal(breakdown.rows[0].workspace, 'wo…34');
assert.equal(breakdown.rows[1].project, 'pr…78');
assert.equal(breakdown.rows[1].apiKey, 'ke…12');
assert.match(breakdown.rows[1].group, /project pr…78.*key ke…12/);

const csv = apiBreakdownToCSV(breakdown);
assert.match(csv, /provider,providerLabel,group/);
assert.match(csv, /wo…34/);
assert.match(csv, /ke…12/);
assert.doesNotMatch(csv, /workspace-secret-1234|project-secret-5678|key-secret-9012/);
assert.doesNotMatch(csv, /api-key|Bearer|sk-/i);

console.log('API breakdown redaction smoke: OK');
