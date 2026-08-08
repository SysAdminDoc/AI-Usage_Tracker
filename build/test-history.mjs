import assert from 'node:assert/strict';
import {
  compactHistory,
  compactHistoryToBudget,
  detectAnomaly,
  forecastExhaustion,
  historyStats,
  historyBudgetStatus,
  historyToCSV,
  paceMarkerPoint,
  paceProjection,
  pruneHistory,
  recordSnapshot,
  sparklineFor,
  sparklineSamplesFor,
} from '../src/lib/history.js';

// --- sparkline tests (existing) ---
const history = [
  { ts: 1000, bucketId: 'a', percentUsed: 10.2 },
  { ts: 2000, bucketId: 'b', percentUsed: 99 },
  { ts: 3000, bucketId: 'a', percentUsed: 25.5 },
  { ts: 4000, bucketId: 'a', percentUsed: 48.25 },
  { ts: 5000, bucketId: 'a', percentUsed: 101 },
];

const samples = sparklineSamplesFor(history, 'a', { n: 3 });
assert.deepEqual(samples.map((sample) => sample.ts), [1000, 3000, 4000]);
assert.deepEqual(samples.map((sample) => sample.percentUsed), [10.2, 25.5, 48.25]);
assert.deepEqual(sparklineFor(history, 'a', { n: 3 }), [10.2, 25.5, 48.25]);

const clamped = sparklineSamplesFor(history, 'a', { n: 8 });
assert.equal(clamped[3].percentUsed, 100);
assert.equal(sparklineSamplesFor(history, 'missing').length, 0);

// --- recordSnapshot: trims history older than 30 days ---
{
  const now = new Date('2026-06-16T12:00:00Z');
  const old = now.getTime() - 31 * 24 * 60 * 60 * 1000; // 31 days ago
  const recent = now.getTime() - 1 * 60 * 60 * 1000;     // 1 hour ago
  const existingHistory = [
    { ts: old, bucketId: 'claude-session', percentUsed: 10 },
    { ts: recent, bucketId: 'claude-session', percentUsed: 50 },
  ];
  const snapshot = {
    providers: {
      claude: { ok: true, buckets: [{ id: 'claude-session', percentUsed: 60 }] },
    },
  };
  const result = recordSnapshot(existingHistory, snapshot, { now });
  // Old sample should be trimmed, recent and new should remain.
  assert.equal(result.filter((h) => h.ts === old).length, 0, 'Old history sample should be pruned');
  assert.equal(result.filter((h) => h.ts === recent).length, 1, 'Recent history sample should remain');
  assert.equal(result.filter((h) => h.ts === now.getTime()).length, 1, 'New sample should be added');
}

// --- recordSnapshot: skips failed providers ---
{
  const now = new Date('2026-06-16T12:00:00Z');
  const snapshot = {
    providers: {
      claude: { ok: false, error: 'test error' },
      codex: { ok: true, buckets: [{ id: 'codex-5h-all', percentUsed: 30 }] },
    },
  };
  const result = recordSnapshot([], snapshot, { now });
  assert.equal(result.length, 1, 'Only successful provider buckets should be recorded');
  assert.equal(result[0].bucketId, 'codex-5h-all');
}

// --- forecastExhaustion: basic linear prediction ---
{
  const now = new Date('2026-06-16T12:00:00Z');
  const t = now.getTime();
  const h = 60 * 60 * 1000;
  const rising = [
    { ts: t - 4 * h, bucketId: 'test', percentUsed: 20 },
    { ts: t - 3 * h, bucketId: 'test', percentUsed: 35 },
    { ts: t - 2 * h, bucketId: 'test', percentUsed: 50 },
    { ts: t - 1 * h, bucketId: 'test', percentUsed: 65 },
    { ts: t,         bucketId: 'test', percentUsed: 80 },
  ];
  const eta = forecastExhaustion(rising, 'test', { now });
  assert.ok(eta, 'Should predict exhaustion');
  assert.ok(eta.getTime() > t, 'Exhaustion should be in the future');
  // Rising ~15%/hr from 80%, should exhaust in ~1.3hrs
  const hoursUntil = (eta.getTime() - t) / h;
  assert.ok(hoursUntil > 0.5 && hoursUntil < 3, `Expected ~1.3h, got ${hoursUntil.toFixed(1)}h`);
}

// --- paceProjection: projected usage marker at reset ---
{
  const now = new Date('2026-06-16T12:00:00Z');
  const t = now.getTime();
  const h = 60 * 60 * 1000;
  const bucket = {
    id: 'pace-test',
    percentUsed: 80,
    resetISO: new Date(t + 2 * h).toISOString(),
  };
  const rising = [
    { ts: t - 4 * h, bucketId: 'pace-test', percentUsed: 20 },
    { ts: t - 3 * h, bucketId: 'pace-test', percentUsed: 35 },
    { ts: t - 2 * h, bucketId: 'pace-test', percentUsed: 50 },
    { ts: t - 1 * h, bucketId: 'pace-test', percentUsed: 65 },
    { ts: t,         bucketId: 'pace-test', percentUsed: 80 },
  ];
  const projection = paceProjection(rising, bucket, { now });
  assert.ok(projection, 'A rising quota should expose a pace projection');
  assert.equal(projection.markerPercent, 100, 'Quota exhaustion before reset should pin the marker to 100%');
  assert.equal(projection.reachesLimitBeforeReset, true);
  assert.equal(paceProjection(rising, { ...bucket, resetISO: null }, { now }), null, 'Missing reset should hide the marker');
  assert.deepEqual(paceMarkerPoint(0, { center: 22, radius: 18 }), { x: 22, y: 4 });
}

// --- detectAnomaly: current ingest versus recent moving average ---
{
  const now = new Date('2026-06-16T12:00:00Z');
  const t = now.getTime();
  const h = 60 * 60 * 1000;
  const samples = [10, 12, 11, 13, 70].map((percentUsed, index) => ({
    ts: t - (4 - index) * h,
    bucketId: 'spike-test',
    percentUsed,
  }));
  const anomaly = detectAnomaly(samples, 'spike-test', { now, thresholdPercent: 20 });
  assert.ok(anomaly, 'A current upward jump should produce an anomaly');
  assert.equal(anomaly.baselineSampleCount, 4);
  assert.equal(anomaly.currentPercent, 70);
  assert.ok(anomaly.jumpPercent > 50, 'Anomaly should report the jump above the moving average');
  assert.equal(detectAnomaly(samples, 'spike-test', { now: new Date(t + h), thresholdPercent: 20 }), null,
    'An old sample must not trigger a later notification pass');
  assert.equal(detectAnomaly(samples.map((sample) => ({ ...sample, percentUsed: 8 })), 'spike-test', { now, thresholdPercent: 1 }), null,
    'A downward change must not trigger a spike alert');
}

// --- forecastExhaustion: handles reset (usage drops) ---
{
  const now = new Date('2026-06-16T12:00:00Z');
  const t = now.getTime();
  const h = 60 * 60 * 1000;
  const resetHistory = [
    { ts: t - 5 * h, bucketId: 'test', percentUsed: 90 },
    { ts: t - 4 * h, bucketId: 'test', percentUsed: 95 },
    // Reset happened here
    { ts: t - 3 * h, bucketId: 'test', percentUsed: 5 },
    { ts: t - 2 * h, bucketId: 'test', percentUsed: 15 },
    { ts: t - 1 * h, bucketId: 'test', percentUsed: 25 },
    { ts: t,         bucketId: 'test', percentUsed: 35 },
  ];
  const eta = forecastExhaustion(resetHistory, 'test', { now });
  assert.ok(eta, 'Should predict exhaustion after reset');
  // Should use only post-reset samples (5->35 over 3hrs = ~10%/hr)
  // From 35%, need 65% more at ~10%/hr = ~6.5hrs
  const hoursUntil = (eta.getTime() - t) / h;
  assert.ok(hoursUntil > 4 && hoursUntil < 10, `Expected ~6.5h, got ${hoursUntil.toFixed(1)}h`);
}

// --- forecastExhaustion: returns null for flat/declining usage ---
{
  const now = new Date('2026-06-16T12:00:00Z');
  const t = now.getTime();
  const h = 60 * 60 * 1000;
  const flat = [
    { ts: t - 3 * h, bucketId: 'test', percentUsed: 50 },
    { ts: t - 2 * h, bucketId: 'test', percentUsed: 50 },
    { ts: t - 1 * h, bucketId: 'test', percentUsed: 50 },
    { ts: t,         bucketId: 'test', percentUsed: 50 },
  ];
  assert.equal(forecastExhaustion(flat, 'test', { now }), null, 'Flat usage should not predict exhaustion');
}

// --- forecastExhaustion: returns null for too few samples ---
{
  const now = new Date('2026-06-16T12:00:00Z');
  const t = now.getTime();
  const h = 60 * 60 * 1000;
  const twoSamples = [
    { ts: t - 1 * h, bucketId: 'test', percentUsed: 50 },
    { ts: t,         bucketId: 'test', percentUsed: 60 },
  ];
  assert.equal(forecastExhaustion(twoSamples, 'test', { now }), null, 'Too few samples should return null');
}

// --- sparklineFor: negative percent clamped to 0 ---
{
const negHistory = [
    { ts: 1, bucketId: 'neg', percentUsed: -5 },
    { ts: 2, bucketId: 'neg', percentUsed: 50 },
  ];
  const spark = sparklineFor(negHistory, 'neg', { n: 10 });
  assert.equal(spark[0], 0, 'Negative percentUsed clamped to 0');
}

console.log('history sparkline smoke: OK');

// --- retention, compaction, stats, and CSV export ---
{
  const now = new Date('2026-06-16T12:00:00Z');
  const t = now.getTime();
  const h = 60 * 60 * 1000;
  const samples = Array.from({ length: 10 }, (_, i) => ({
    ts: t - (9 - i) * h,
    bucketId: 'compact-me',
    percentUsed: i * 10,
  }));
  samples.push({ ts: t - 8 * 24 * 60 * 60 * 1000, bucketId: 'old', percentUsed: 20 });
  const retained = pruneHistory(samples, { now, retentionDays: 7 });
  assert.equal(retained.some((sample) => sample.bucketId === 'old'), false, 'retention should remove old samples');
  const compacted = compactHistory(samples, { now, retentionDays: 30, maxSamplesPerBucket: 4 });
  const compactBucket = compacted.filter((sample) => sample.bucketId === 'compact-me');
  assert.equal(compactBucket.length, 4, 'compaction should cap each bucket');
  assert.equal(compactBucket[0].percentUsed, 0, 'compaction should keep the first sample');
  assert.equal(compactBucket.at(-1).percentUsed, 90, 'compaction should keep the last sample');
  assert.deepEqual(historyStats(compacted), {
    sampleCount: 5,
    bucketCount: 2,
    oldestTs: t - 8 * 24 * 60 * 60 * 1000,
    newestTs: t,
  });
  const csv = historyToCSV([{ ts: t, bucketId: 'bucket,one', percentUsed: 12.5 }]);
  assert.match(csv, /timestampISO,bucketId,percentUsed/);
  assert.match(csv, /"bucket,one",12\.50/);
}

console.log('history controls smoke: OK');

// --- hard sample/byte budgets preserve deterministic endpoints and newest data ---
{
  const now = new Date('2026-06-16T12:00:00Z');
  const large = Array.from({ length: 600 }, (_, index) => ({
    ts: now.getTime() - (600 - index) * 60_000,
    bucketId: index % 3 === 0 ? 'claude-session' : index % 3 === 1 ? 'codex-5h-all' : 'codex-weekly-all',
    percentUsed: index % 101,
  }));
  const bounded = compactHistoryToBudget(large, {
    now,
    retentionDays: null,
    maxSamples: 40,
    maxBytes: 4_000,
  });
  assert.ok(bounded.length <= 40, 'sample budget should be hard');
  assert.ok(historyBudgetStatus(bounded, { maxSamples: 40, maxBytes: 4_000 }).degraded === false);
  assert.ok(bounded.some((sample) => sample.ts === large.at(-1).ts), 'newest sample must survive');
  assert.deepEqual(
    compactHistoryToBudget(large, { now, retentionDays: null, maxSamples: 40, maxBytes: 4_000 }),
    bounded,
    'budget compaction should be deterministic',
  );

  const corrupt = compactHistoryToBudget([
    { ts: 'not-a-timestamp', bucketId: 'bad', percentUsed: 50 },
    { ts: now.getTime(), bucketId: 'x'.repeat(1000), percentUsed: 50 },
  ], { now, retentionDays: null, maxBytes: 500 });
  assert.equal(corrupt.length, 1, 'corrupt samples should not survive compaction');
  assert.ok(corrupt[0].bucketId.length <= 128, 'bucket identifiers should be bounded');
}

console.log('history budget smoke: OK');
