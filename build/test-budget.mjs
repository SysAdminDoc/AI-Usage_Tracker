import assert from 'node:assert/strict';
import {
  collectApiSpend,
  defaultBudgetLedger,
  forgetApiProvider,
  normalizeBudgetCap,
  resetSessionBudget,
  updateBudgetLedger,
} from '../src/lib/budget.js';

const firstNow = new Date('2026-08-03T12:00:00.000Z');
const snapshot = (anthropicCost, openRouterUsage = null, source = 'official') => ({
  providers: {
    'anthropic-api': {
      ok: true,
      totals: { costUSD: anthropicCost },
      buckets: [{ metric: { costSource: source, costUSD: anthropicCost } }],
    },
    openrouter: openRouterUsage == null ? null : {
      ok: true,
      totals: { usageUSD: openRouterUsage },
      buckets: [],
    },
  },
});

assert.equal(normalizeBudgetCap(-1), 0);
assert.equal(normalizeBudgetCap('2.345'), 2.35);
assert.equal(normalizeBudgetCap(2_000_000), 1_000_000);
assert.deepEqual(collectApiSpend(snapshot(1.25, 4.5)), {
  'anthropic-api': { amountUSD: 1.25, source: 'official' },
  openrouter: { amountUSD: 4.5, source: 'official' },
});

let ledger = defaultBudgetLedger(firstNow);
let update = updateBudgetLedger(ledger, snapshot(10), { now: firstNow });
ledger = update.ledger;
assert.equal(update.deltaUSD, 0, 'first observation should establish a baseline');
assert.equal(ledger.sessionSpentUSD, 0);

update = updateBudgetLedger(ledger, snapshot(12.75), { now: new Date('2026-08-03T12:05:00.000Z') });
ledger = update.ledger;
assert.equal(update.deltaUSD, 2.75);
assert.equal(ledger.sessionSpentUSD, 2.75);
assert.equal(ledger.dailySpentUSD, 2.75);

update = updateBudgetLedger(ledger, snapshot(2), { now: new Date('2026-08-03T12:10:00.000Z') });
ledger = update.ledger;
assert.equal(update.deltaUSD, 2, 'a provider counter reset should count the new counter value');
assert.equal(ledger.sessionSpentUSD, 4.75);

update = updateBudgetLedger(ledger, snapshot(3.5), { now: new Date('2026-08-04T12:10:00.000Z') });
ledger = update.ledger;
assert.equal(update.deltaUSD, 1.5);
assert.equal(ledger.dailySpentUSD, 1.5, 'daily spend should reset at the local day boundary');
assert.equal(ledger.sessionSpentUSD, 6.25);

const sourceChange = updateBudgetLedger(ledger, snapshot(5, null, 'estimated'), {
  now: new Date('2026-08-04T12:15:00.000Z'),
});
assert.equal(sourceChange.deltaUSD, 0, 'pricing provenance changes should rebaseline without double counting');

const reset = resetSessionBudget(ledger, snapshot(5), { now: new Date('2026-08-04T13:00:00.000Z') });
assert.equal(reset.sessionSpentUSD, 0);
assert.equal(reset.sessionStartedISO, '2026-08-04T13:00:00.000Z');
assert.equal(reset.lastTotals['anthropic-api'].amountUSD, 5);
assert.equal(forgetApiProvider(reset, 'anthropic-api').lastTotals['anthropic-api'], undefined);

console.log('budget ledger smoke: OK');
