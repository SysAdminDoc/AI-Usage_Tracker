import assert from 'node:assert/strict';
import {
  buildPlanRecommendations,
  providerLimitSignal,
  usageBasedSignal,
} from '../src/lib/optimization.js';

const readyEntry = (provider, projectedUSD, observedUSD = 40, extra = {}) => ({
  provider,
  label: provider,
  projectedUSD,
  observedUSD,
  observedDays: 14,
  source: 'official',
  confidence: 'high',
  confidenceLabel: 'High',
  stale: false,
  ...extra,
});

const highCapSnapshot = {
  providers: {
    openrouter: {
      ok: true,
      buckets: [{ metric: { kind: 'currency', limitUSD: 100 } }],
    },
  },
};
assert.deepEqual(providerLimitSignal(highCapSnapshot.providers.openrouter), { limitUSD: 100, source: 'bucket' });

let result = buildPlanRecommendations(highCapSnapshot, {
  providers: [readyEntry('openrouter', 95, 50)],
});
assert.equal(result.status, 'ready');
assert.equal(result.recommendations[0].type, 'higher-cap');
assert.match(result.recommendations[0].title, /higher-cap/i);
assert.match(result.recommendations[0].uncertainty, /prices/i);

result = buildPlanRecommendations(highCapSnapshot, {
  providers: [readyEntry('openrouter', 20, 8)],
});
assert.equal(result.recommendations[0].type, 'lower-cost');
assert.match(result.recommendations[0].detail, /reported.*limit/i);

const cursor = {
  ok: true,
  buckets: [{ metric: {
    kind: 'requests',
    subscriptionIncludedReqs: 10,
    usageBasedReqs: 4,
  } }],
};
assert.equal(Math.round(usageBasedSignal(cursor).usageBasedShare * 100), 29);
result = buildPlanRecommendations({ providers: { cursor } }, {
  providers: [readyEntry('cursor', 40, 20)],
});
assert.equal(result.recommendations[0].type, 'higher-cap');
assert.match(result.recommendations[0].detail, /usage-based/i);

result = buildPlanRecommendations(highCapSnapshot, {
  providers: [readyEntry('openrouter', 95, 50, { observedDays: 6 })],
});
assert.equal(result.status, 'insufficient-coverage');
assert.equal(result.recommendations.length, 0);

result = buildPlanRecommendations(highCapSnapshot, {
  providers: [readyEntry('openrouter', 95, 50, { stale: true })],
});
assert.equal(result.status, 'insufficient-coverage');
assert.equal(result.recommendations.length, 0);

result = buildPlanRecommendations({ providers: {} }, { providers: [] });
assert.equal(result.status, 'no-data');

console.log('plan optimization smoke: OK');
