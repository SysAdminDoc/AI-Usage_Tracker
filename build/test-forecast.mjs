import assert from 'node:assert/strict';
import { extractProviderCost, forecastMonthEnd } from '../src/lib/forecast.js';

const now = new Date('2026-08-15T00:00:00.000Z');
const monthStart = '2026-08-01T00:00:00.000Z';

const official = {
  ok: true,
  provider: 'anthropic-api',
  range: { startISO: monthStart },
  lastSuccessISO: '2026-08-14T23:00:00.000Z',
  totals: { costUSD: 14, reportedModelCount: 1 },
  buckets: [],
};
const estimated = {
  ok: true,
  provider: 'openai-api',
  range: { startISO: '2026-08-10T00:00:00.000Z' },
  totals: { costUSD: 7, estimatedCostUSD: 7, pricedModelCount: 1 },
  buckets: [],
};

assert.deepEqual(extractProviderCost(official), { amountUSD: 14, source: 'official' });
assert.deepEqual(extractProviderCost(estimated), { amountUSD: 7, source: 'estimated' });
assert.deepEqual(extractProviderCost({
  ok: true,
  buckets: [{ metric: { kind: 'currency', costUSD: 3, costSource: 'official' } }],
}), { amountUSD: 3, source: 'official' });
assert.equal(extractProviderCost({ ok: true, buckets: [] }), null);

let forecast = forecastMonthEnd({
  providers: {
    'anthropic-api': official,
    'openai-api': estimated,
    'github-copilot': { ok: true, buckets: [{ metric: { kind: 'activity' } }] },
  },
}, { now });

assert.equal(forecast.providers.length, 2, 'only cost-bearing API providers should be forecast');
assert.equal(forecast.providers[0].projectedUSD, 31, 'official cost should be projected over the full month');
assert.equal(forecast.providers[0].confidence, 'high', 'two weeks of fresh official cost data is high confidence');
assert.equal(forecast.providers[1].projectedUSD, 43.4, 'provider ranges should control observed coverage');
assert.equal(forecast.providers[1].confidence, 'low', 'short estimated coverage should be low confidence');
assert.equal(forecast.total.projectedUSD, 74.4);
assert.equal(forecast.total.confidence, 'low');
assert.match(forecast.assumptions.join(' '), /daily run rate/i);

forecast = forecastMonthEnd({
  providers: {
    'anthropic-api': { ...official, stale: true },
  },
}, { now });
assert.equal(forecast.providers[0].confidence, 'low', 'stale provider data must lower confidence');
assert.equal(forecast.providers[0].stale, true);

forecast = forecastMonthEnd({
  providers: {
    'anthropic-api': { ...official, range: { startISO: '2026-08-14T18:00:00.000Z' } },
  },
}, { now });
assert.equal(forecast.providers[0].projectedUSD, null, 'less than one day of coverage should not produce a projection');
assert.equal(forecast.total.projectedUSD, null);
assert.match(forecast.providers[0].assumptions.join(' '), /1 day/i);

assert.equal(forecastMonthEnd({ providers: {} }, { now }).providers.length, 0);

console.log('month-end forecast smoke: OK');
