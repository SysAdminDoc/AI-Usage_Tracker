import assert from 'node:assert/strict';
import { evaluateRules } from '../src/lib/notify.js';

const now = new Date('2026-06-16T12:00:00.000Z');
const snapshot = {
  providers: {
    claude: {
      ok: true,
      buckets: [{
        id: 'claude-session',
        label: 'Current session',
        kind: 'session',
        model: 'all',
        percentUsed: 96,
        resetISO: '2026-06-16T12:15:00.000Z',
      }],
    },
  },
};
const baseSettings = {
  showProviders: { claude: true },
  showRows: { 'claude-session': true },
  notifications: { 'R1-15': true, 'U1-95': true },
};

assert.ok(evaluateRules({ snapshot, history: [], settings: baseSettings, firedRules: {}, now }).length > 0);

const snoozed = {
  ...baseSettings,
  notifications: {
    ...baseSettings.notifications,
    snoozedUntilISO: '2026-06-16T13:00:00.000Z',
  },
};
assert.equal(evaluateRules({ snapshot, history: [], settings: snoozed, firedRules: {}, now }).length, 0);

const expired = {
  ...baseSettings,
  notifications: {
    ...baseSettings.notifications,
    snoozedUntilISO: '2026-06-16T11:59:00.000Z',
  },
};
assert.ok(evaluateRules({ snapshot, history: [], settings: expired, firedRules: {}, now }).length > 0);

console.log('notify snooze smoke: OK');
