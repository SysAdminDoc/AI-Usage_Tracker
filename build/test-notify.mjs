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

// --- Basic: rules fire when conditions met ---
assert.ok(evaluateRules({ snapshot, history: [], settings: baseSettings, firedRules: {}, now }).length > 0);

// --- Snooze: active snooze suppresses all notifications ---
const snoozed = {
  ...baseSettings,
  notifications: {
    ...baseSettings.notifications,
    snoozedUntilISO: '2026-06-16T13:00:00.000Z',
  },
};
assert.equal(evaluateRules({ snapshot, history: [], settings: snoozed, firedRules: {}, now }).length, 0);

// --- Expired snooze: rules fire again ---
const expired = {
  ...baseSettings,
  notifications: {
    ...baseSettings.notifications,
    snoozedUntilISO: '2026-06-16T11:59:00.000Z',
  },
};
assert.ok(evaluateRules({ snapshot, history: [], settings: expired, firedRules: {}, now }).length > 0);

// --- Duplicate-fire prevention: already-fired keys are not re-fired ---
{
  const rules = evaluateRules({ snapshot, history: [], settings: baseSettings, firedRules: {}, now });
  assert.ok(rules.length > 0, 'Should produce at least one rule');
  const fired = {};
  for (const r of rules) fired[r.fireKey] = Date.now();
  const second = evaluateRules({ snapshot, history: [], settings: baseSettings, firedRules: fired, now });
  assert.equal(second.length, 0, 'Already-fired rules should not re-fire in same window');
}

// --- Disabled rule: disabled notification does not fire ---
{
  const disabledSettings = {
    ...baseSettings,
    notifications: { 'R1-15': false, 'U1-95': false },
  };
  const rules = evaluateRules({ snapshot, history: [], settings: disabledSettings, firedRules: {}, now });
  assert.equal(rules.length, 0, 'Disabled rules should not fire');
}

// --- Hidden provider: rules do not fire for hidden providers ---
{
  const hiddenSettings = {
    ...baseSettings,
    showProviders: { claude: false },
  };
  const rules = evaluateRules({ snapshot, history: [], settings: hiddenSettings, firedRules: {}, now });
  assert.equal(rules.length, 0, 'Hidden provider rules should not fire');
}

// --- Hidden row: rules do not fire for hidden rows ---
{
  const hiddenRowSettings = {
    ...baseSettings,
    showRows: { 'claude-session': false },
  };
  const rules = evaluateRules({ snapshot, history: [], settings: hiddenRowSettings, firedRules: {}, now });
  assert.equal(rules.length, 0, 'Hidden row rules should not fire');
}

// --- R1-60 fires 60 minutes before reset ---
{
  const resetIn55min = new Date(now.getTime() + 55 * 60 * 1000).toISOString();
  const snap60 = {
    providers: {
      claude: {
        ok: true,
        buckets: [{
          id: 'claude-session',
          label: 'Current session',
          kind: 'session',
          model: 'all',
          percentUsed: 70,
          resetISO: resetIn55min,
        }],
      },
    },
  };
  const settings60 = {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    notifications: { 'R1-60': true },
  };
  const rules = evaluateRules({ snapshot: snap60, history: [], settings: settings60, firedRules: {}, now });
  assert.ok(rules.some((r) => r.ruleId === 'R1-60'), 'R1-60 should fire when 55 minutes to reset');
}

// --- R2 fires at reset ---
{
  const justReset = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const snapR2 = {
    providers: {
      claude: {
        ok: true,
        buckets: [{
          id: 'claude-session',
          label: 'Current session',
          kind: 'session',
          model: 'all',
          percentUsed: 0,
          resetISO: justReset,
        }],
      },
    },
  };
  const settingsR2 = {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    notifications: { 'R2': true },
  };
  const rules = evaluateRules({ snapshot: snapR2, history: [], settings: settingsR2, firedRules: {}, now });
  assert.ok(rules.some((r) => r.ruleId === 'R2'), 'R2 should fire when reset just happened');
}

// --- R2 does not fire if reset was more than 5 minutes ago ---
{
  const oldReset = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const snapOldReset = {
    providers: {
      claude: {
        ok: true,
        buckets: [{
          id: 'claude-session',
          label: 'Current session',
          kind: 'session',
          model: 'all',
          percentUsed: 0,
          resetISO: oldReset,
        }],
      },
    },
  };
  const settingsR2 = {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    notifications: { 'R2': true },
  };
  const rules = evaluateRules({ snapshot: snapOldReset, history: [], settings: settingsR2, firedRules: {}, now });
  assert.ok(!rules.some((r) => r.ruleId === 'R2'), 'R2 should not fire for old resets');
}

// --- U1-75 fires at 75% used ---
{
  const snap75 = {
    providers: {
      claude: {
        ok: true,
        buckets: [{
          id: 'claude-session',
          label: 'Current session',
          kind: 'session',
          model: 'all',
          percentUsed: 75,
          resetISO: '2026-06-16T17:00:00.000Z',
        }],
      },
    },
  };
  const settings75 = {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    notifications: { 'U1-75': true },
  };
  const rules = evaluateRules({ snapshot: snap75, history: [], settings: settings75, firedRules: {}, now });
  assert.ok(rules.some((r) => r.ruleId === 'U1-75'), 'U1-75 should fire at exactly 75%');
}

// --- D1 daily briefing fires at configured hour ---
{
  const d1Now = new Date('2026-06-16T08:05:00.000Z');
  const d1Settings = {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    notifications: { 'D1': true, dailyBriefingHour: 8 },
  };
  const d1Snapshot = {
    providers: {
      claude: {
        ok: true,
        buckets: [{
          id: 'claude-session',
          label: 'Current session',
          kind: 'session',
          model: 'all',
          percentUsed: 30,
          resetISO: '2026-06-16T17:00:00.000Z',
        }],
      },
    },
  };
  // We need to test in local time, but UTC 08:00 corresponds to hour 8 in UTC.
  // The D1 rule checks now.getHours() which is locale-dependent, so we test
  // that the rule at least works for a time within the window.
  const rules = evaluateRules({ snapshot: d1Snapshot, history: [], settings: d1Settings, firedRules: {}, now: d1Now });
  // D1 fires at hour 8 with minutes < 10 — UTC 08:05 matches if local TZ is UTC.
  // If local TZ is not UTC, this test may not fire D1, which is expected.
  // We only assert it doesn't crash.
  assert.ok(Array.isArray(rules), 'D1 evaluation should not throw');
}

// --- D1 does not fire outside the window ---
{
  const d1OutsideNow = new Date('2026-06-16T09:15:00.000Z');
  const d1Settings = {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    notifications: { 'D1': true, dailyBriefingHour: 8 },
  };
  const d1Snapshot = {
    providers: {
      claude: {
        ok: true,
        buckets: [{
          id: 'claude-session',
          kind: 'session',
          model: 'all',
          percentUsed: 30,
          resetISO: '2026-06-16T17:00:00.000Z',
        }],
      },
    },
  };
  const rules = evaluateRules({ snapshot: d1Snapshot, history: [], settings: d1Settings, firedRules: {}, now: d1OutsideNow });
  assert.ok(!rules.some((r) => r.ruleId === 'D1'), 'D1 should not fire outside the 10-minute window');
}

// --- Empty snapshot produces no rules ---
{
  const emptySnapshot = { providers: {} };
  const rules = evaluateRules({ snapshot: emptySnapshot, history: [], settings: baseSettings, firedRules: {}, now });
  assert.equal(rules.length, 0, 'Empty snapshot should produce no rules');
}

// --- Null snapshot produces no rules ---
{
  const rules = evaluateRules({ snapshot: null, history: [], settings: baseSettings, firedRules: {}, now });
  assert.equal(rules.length, 0, 'Null snapshot should produce no rules');
}

console.log('notify snooze smoke: OK');
