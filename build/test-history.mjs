import assert from 'node:assert/strict';
import { sparklineFor, sparklineSamplesFor } from '../src/lib/history.js';

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

console.log('history sparkline smoke: OK');
