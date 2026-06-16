import assert from 'node:assert/strict';
import { normalizeThresholds, ringColor } from '../src/lib/countdown.js';
import { badgeTone, pickBadgeBucket } from '../src/lib/badge.js';

const thresholds = normalizeThresholds({ warnAt: 70, dangerAt: 90 });
assert.deepEqual(thresholds, { warnAt: 70, dangerAt: 90 });
assert.deepEqual(normalizeThresholds({ warnAt: 99, dangerAt: 20 }), { warnAt: 98, dangerAt: 99 });

assert.equal(ringColor(69, thresholds), 'var(--aut-green)');
assert.equal(ringColor(70, thresholds), 'var(--aut-amber)');
assert.equal(ringColor(90, thresholds), 'var(--aut-red)');

assert.equal(badgeTone(86, thresholds), 'warn');
assert.equal(badgeTone(91, thresholds), 'bad');

const picked = pickBadgeBucket({
  settings: {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    thresholds,
  },
  snapshot: {
    providers: {
      claude: {
        ok: true,
        buckets: [{
          id: 'claude-session',
          label: 'Current session',
          percentUsed: 86,
          resetISO: '2026-06-16T13:00:00.000Z',
        }],
      },
    },
  },
});

assert.equal(picked.tone, 'warn');
assert.equal(picked.percentUsed, 86);

console.log('appearance threshold smoke: OK');
