import assert from 'node:assert/strict';
import { buildSupportBundle } from '../src/lib/diagnostics.js';

const state = {
  snapshot: {
    fetchedAtISO: '2026-08-03T12:00:00.000Z',
    providers: {
      claude: {
        ok: false,
        stale: true,
        orgId: 'org-secret-1234',
        accountId: 'account-secret-5678',
        lastSuccessSource: 'api',
        lastSuccessISO: '2026-08-03T11:00:00.000Z',
        lastErrorISO: '2026-08-03T12:00:00.000Z',
        lastErrorCode: 'claude.usage.rate_limit',
        lastErrorDetail: 'Bearer token-secret should never be exported',
        buckets: [{
          id: 'claude-session',
          percentUsed: 91,
          resetISO: '2026-08-03T14:00:00.000Z',
          metric: { kind: 'tokens', costUSD: 1.25, costSource: 'pricing-table', pricingVersion: '2026-08-03' },
        }],
      },
    },
  },
  settings: { refreshMinutes: 5, theme: 'mocha', thresholds: { warnAt: 50, dangerAt: 80 } },
  history: [{ ts: 1, bucketId: 'secret-history', percentUsed: 50 }],
};
const bundle = buildSupportBundle({
  state,
  usage: { bytes: 321, quotaBytes: 5000, source: 'webext' },
  version: '0.2.3',
  channel: 'extension',
  manifest: { permissions: ['storage', 'notifications'], host_permissions: ['https://claude.ai/*'] },
});
assert.equal(bundle.schema, 'ai-usage-tracker.diagnostics');
assert.deepEqual(bundle.app.permissions.api, ['notifications', 'storage']);
assert.equal(bundle.snapshot.providers.claude.errorCode, 'claude.usage.rate_limit');
assert.equal(bundle.snapshot.providers.claude.identifiers.orgId, 'or…34');
assert.equal(bundle.snapshot.providers.claude.buckets[0].percentUsed, 91);
assert.equal(bundle.snapshot.providers.claude.buckets[0].metric.costSource, 'pricing-table');
assert.equal(bundle.snapshot.providers.claude.buckets[0].metric.pricingVersion, '2026-08-03');
const serialized = JSON.stringify(bundle);
assert.doesNotMatch(serialized, /token-secret|org-secret-1234|account-secret-5678|secret-history|lastErrorDetail/);
assert.equal(bundle.redaction.history, 'omitted');
console.log('redacted diagnostics smoke: OK');
