import assert from 'node:assert/strict';
import {
  buildCollaborationContribution,
  buildCollaborationDashboard,
  buildCollaborationLedger,
  defaultCollaborationState,
  mergeCollaborationImport,
  normalizeCollaborationImport,
} from '../src/lib/collaboration.js';

const fixedNow = new Date('2026-08-15T00:00:00.000Z');
const snapshot = {
  fetchedAtISO: fixedNow.toISOString(),
  providers: {
    'anthropic-api': {
      ok: true,
      provider: 'anthropic-api',
      range: { startISO: '2026-08-01T00:00:00.000Z', endISO: fixedNow.toISOString() },
      totals: { costUSD: 12.5 },
      buckets: [{ metric: { kind: 'currency', costUSD: 12.5, costSource: 'official', requests: 18 } }],
      prompt: 'never-export-this-prompt',
      code: 'never-export-this-code',
    },
    'openai-api': {
      ok: true,
      provider: 'openai-api',
      range: { startISO: '2026-08-01T00:00:00.000Z', endISO: fixedNow.toISOString() },
      totals: { usageUSD: 7.25 },
      buckets: [{ metric: { kind: 'currency', costUSD: 7.25, costSource: 'pricing-table', totalTokens: 1000 } }],
    },
  },
};

const contribution = buildCollaborationContribution(snapshot, {
  teamName: 'Privacy Team',
  memberName: 'Ada',
  now: fixedNow,
});
assert.equal(contribution.schema, 'ai-usage-tracker.collaboration');
assert.equal(contribution.kind, 'contribution');
assert.equal(contribution.teamName, 'Privacy Team');
assert.equal(contribution.contribution.memberLabel, 'Ada');
assert.equal(contribution.contribution.providers.length, 2);
assert.equal(contribution.contribution.providers[0].costUSD, 12.5);
assert.doesNotMatch(JSON.stringify(contribution), /never-export-this-prompt|never-export-this-code/);
assert.equal(contribution.contribution.prompt, undefined);
assert.equal(contribution.contribution.code, undefined);

const secondContribution = buildCollaborationContribution(snapshot, {
  teamName: 'Privacy Team',
  memberName: 'Grace',
  now: new Date('2026-08-16T00:00:00.000Z'),
});
const merged = mergeCollaborationImport(
  mergeCollaborationImport(defaultCollaborationState(), contribution),
  secondContribution,
);
assert.equal(merged.enabled, true);
assert.equal(merged.ledger.contributions.length, 2);
assert.equal(mergeCollaborationImport(merged, contribution).ledger.contributions.length, 2,
  're-importing the same contribution should not duplicate it');

const dashboard = buildCollaborationDashboard(merged);
assert.equal(dashboard.status, 'ready');
assert.equal(dashboard.memberCount, 2);
assert.equal(dashboard.contributionCount, 2);
assert.equal(dashboard.total.costUSD, 39.5);
assert.equal(dashboard.providers.length, 2);
assert.equal(dashboard.providers[0].label, 'Anthropic API');
assert.equal(dashboard.providers[0].costUSD, 25);
assert.equal(dashboard.members[0].label, 'Ada');

const ledger = buildCollaborationLedger(merged);
assert.equal(ledger.kind, 'ledger');
assert.equal(normalizeCollaborationImport(ledger).contributions.length, 2);
assert.equal(buildCollaborationDashboard(defaultCollaborationState()).status, 'disabled');
assert.throws(() => normalizeCollaborationImport({ schema: 'wrong', version: 1, kind: 'ledger' }), /Unsupported collaboration schema/);
assert.throws(() => normalizeCollaborationImport({
  schema: 'ai-usage-tracker.collaboration',
  version: 1,
  kind: 'unknown',
}), /kind must be contribution or ledger/);

console.log('collaboration ledger smoke: OK');
