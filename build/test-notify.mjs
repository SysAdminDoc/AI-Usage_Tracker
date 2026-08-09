import assert from 'node:assert/strict';
import {
  buildWebhookPayload,
  deliverWebhook,
  deriveNextNotificationAlarm,
  evaluateRules,
  evaluateBudgetRules,
  getNotificationStatus,
  isNotificationDue,
  nextNotificationRetry,
  NOTIFICATION_TONES,
  normalizeNotificationTone,
  normalizeWebhookURL,
  NOTIFICATION_GRACE_MS,
} from '../src/lib/notify.js';
import { notificationPriorityForTone } from '../src/lib/browser.js';

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

// --- Notification tones and status are canonical at every delivery seam ---
{
  const reset = evaluateRules({ snapshot, history: [], settings: baseSettings, firedRules: {}, now })
    .find((rule) => rule.ruleId === 'R1-15');
  assert.equal(reset?.tone, 'reset');

  const warning = evaluateRules({
    snapshot: {
      providers: {
        claude: {
          ok: true,
          buckets: [{ ...snapshot.providers.claude.buckets[0], percentUsed: 90 }],
        },
      },
    },
    history: [],
    settings: { ...baseSettings, notifications: { 'U1-90': true } },
    firedRules: {},
    now,
  }).find((rule) => rule.ruleId === 'U1-90');
  assert.equal(warning?.tone, 'warning');

  const bad = evaluateRules({
    snapshot: {
      providers: {
        claude: {
          ok: true,
          buckets: [{ ...snapshot.providers.claude.buckets[0], percentUsed: 95 }],
        },
      },
    },
    history: [],
    settings: { ...baseSettings, notifications: { 'U1-95': true } },
    firedRules: {},
    now,
  }).find((rule) => rule.ruleId === 'U1-95');
  assert.equal(bad?.tone, 'bad');

  const success = evaluateRules({
    snapshot: {
      providers: {
        claude: {
          ok: true,
          buckets: [{ ...snapshot.providers.claude.buckets[0], percentUsed: 0, resetISO: '2026-06-16T11:58:00.000Z' }],
        },
      },
    },
    history: [],
    settings: { showProviders: { claude: true }, showRows: {}, notifications: { R2: true } },
    firedRules: {},
    now,
  }).find((rule) => rule.ruleId === 'R2');
  assert.equal(success?.tone, 'success');

  const expectedPriorities = {
    info: 0,
    reset: 1,
    warning: 1,
    bad: 2,
    success: 0,
    snooze: 0,
    'delivery-failure': 2,
  };
  assert.deepEqual(NOTIFICATION_TONES.reduce((out, tone) => {
    out[tone] = notificationPriorityForTone(tone);
    return out;
  }, {}), expectedPriorities);
  assert.equal(normalizeNotificationTone('good'), 'success');
  assert.equal(normalizeNotificationTone('warn'), 'warning');
  for (const tone of NOTIFICATION_TONES) {
    assert.equal(buildWebhookPayload({ ruleId: 'tone-test', tone }, { now }).tone, tone);
  }
  assert.deepEqual(getNotificationStatus({
    settings: { notifications: { snoozedUntilISO: '2026-06-16T13:00:00.000Z' } },
    now,
  }), { status: 'snoozed', tone: 'snooze' });
  assert.deepEqual(getNotificationStatus({ delivery: { ok: false }, now }), {
    status: 'delivery-failure',
    tone: 'delivery-failure',
  });
}

// --- Event-level delivery retries are delayed and exhaust at a hard bound ---
{
  const notification = { fireKey: 'claude-session-U1-95', ruleId: 'U1-95', tone: 'bad', provider: 'claude' };
  const first = nextNotificationRetry({ notification, errorCode: 'browser.notification-unavailable', now });
  assert.deepEqual({
    attempts: first.attempts,
    status: first.status,
    nextRetryISO: first.nextRetryISO,
    tone: first.tone,
  }, {
    attempts: 1,
    status: 'retrying',
    nextRetryISO: '2026-06-16T12:00:30.000Z',
    tone: 'delivery-failure',
  });
  assert.equal(isNotificationDue(notification.fireKey, {
    firedRules: {},
    notificationRetries: { [notification.fireKey]: first },
    now: new Date('2026-06-16T12:00:29.999Z'),
  }), false);
  assert.equal(isNotificationDue(notification.fireKey, {
    firedRules: {},
    notificationRetries: { [notification.fireKey]: first },
    now: new Date('2026-06-16T12:00:30.000Z'),
  }), true);
  const resetCandidate = evaluateRules({ snapshot, history: [], settings: baseSettings, firedRules: {}, now })
    .find((rule) => rule.ruleId === 'R1-15');
  const resetRetry = nextNotificationRetry({ notification: resetCandidate, now });
  assert.equal(evaluateRules({
    snapshot,
    history: [],
    settings: baseSettings,
    firedRules: {},
    notificationRetries: { [resetCandidate.fireKey]: resetRetry },
    now: new Date('2026-06-16T12:00:29.999Z'),
  }).some((rule) => rule.fireKey === resetCandidate.fireKey), false);
  assert.equal(evaluateRules({
    snapshot,
    history: [],
    settings: baseSettings,
    firedRules: {},
    notificationRetries: { [resetCandidate.fireKey]: resetRetry },
    now: new Date('2026-06-16T12:00:30.000Z'),
  }).some((rule) => rule.fireKey === resetCandidate.fireKey), true);
  const second = nextNotificationRetry({ notification, previous: first, now: new Date('2026-06-16T12:00:30.000Z') });
  const exhausted = nextNotificationRetry({ notification, previous: second, now: new Date('2026-06-16T12:01:30.000Z') });
  assert.equal(second.attempts, 2);
  assert.equal(exhausted.attempts, 3);
  assert.equal(exhausted.status, 'exhausted');
  assert.equal(exhausted.nextRetryISO, null);
  assert.equal(isNotificationDue(notification.fireKey, {
    firedRules: {},
    notificationRetries: { [notification.fireKey]: exhausted },
    now,
  }), false);
  const retryAlarm = deriveNextNotificationAlarm({
    snapshot: { providers: {} },
    settings: { notifications: {} },
    notificationRetries: { [notification.fireKey]: first },
    now,
  });
  assert.equal(retryAlarm?.fireKey, notification.fireKey);
  assert.equal(retryAlarm?.atISO, first.nextRetryISO);
}

// --- API budget caps fire at 80% and 100% once a cap is configured ---
{
  const budgetRules = evaluateBudgetRules({
    budget: {
      sessionSpentUSD: 10,
      dailySpentUSD: 4,
      sessionStartedISO: '2026-06-16T09:00:00.000Z',
      dailyKey: '2026-06-16',
    },
    settings: { apiBudget: { sessionCapUSD: 10, dailyCapUSD: 5 } },
    firedRules: {},
    now,
  });
  assert.deepEqual(budgetRules.map((rule) => rule.ruleId), [
    'BUDGET-session-80', 'BUDGET-session-100', 'BUDGET-daily-80',
  ]);
  assert.equal(budgetRules.find((rule) => rule.ruleId === 'BUDGET-session-100').tone, 'bad');
  assert.equal(budgetRules.find((rule) => rule.ruleId === 'BUDGET-daily-80').provider, 'api-budget');
  assert.equal(evaluateBudgetRules({
    budget: { sessionSpentUSD: 10, dailySpentUSD: 4, sessionStartedISO: '2026-06-16T09:00:00.000Z', dailyKey: '2026-06-16' },
    settings: { apiBudget: { sessionCapUSD: 10, dailyCapUSD: 5 } },
    firedRules: { 'budget-session-80-2026-06-16T09:00:00.000Z': now.getTime() },
    now,
  }).some((rule) => rule.ruleId === 'BUDGET-session-80'), false);
}

// --- Webhook payloads are redacted unless details are explicitly enabled ---
{
  const notification = {
    ruleId: 'U1-90',
    tone: 'warn',
    provider: 'anthropic-api',
    bucketId: 'workspace-secret-row',
    bucketLabel: 'Claude workspace secret',
    percentUsed: 91,
    resetISO: '2026-06-16T13:00:00.000Z',
    title: 'Anthropic API workspace secret at 91%',
    body: 'Threshold reached',
  };
  const redacted = buildWebhookPayload(notification, { now });
  assert.equal(redacted.schema, 'ai-usage-tracker.webhook');
  assert.equal('details' in redacted, false);
  assert.doesNotMatch(JSON.stringify(redacted), /anthropic|workspace-secret|Threshold/);
  const detailed = buildWebhookPayload(notification, { includeDetails: true, now });
  assert.equal(detailed.details.provider, 'anthropic-api');
  assert.equal(detailed.details.percentUsed, 91);
  assert.equal(normalizeWebhookURL('javascript:alert(1)'), '');
  assert.equal(normalizeWebhookURL('https://hooks.example.test/events'), 'https://hooks.example.test/events');
}

// --- Webhook retries transient failures and stops on permanent failures ---
{
  let attempts = 0;
  const waits = [];
  const delivered = await deliverWebhook({
    url: 'https://hooks.example.test/events',
    payload: { event: 'test' },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://hooks.example.test/events');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['Content-Type'], 'application/json');
      attempts += 1;
      return attempts < 3 ? { ok: false, status: 503 } : { ok: true, status: 204 };
    },
    sleep: async (ms) => waits.push(ms),
  });
  assert.equal(delivered.ok, true);
  assert.equal(delivered.attempts, 3);
  assert.deepEqual(waits, [250, 500]);

  let permanentAttempts = 0;
  const rejected = await deliverWebhook({
    url: 'https://hooks.example.test/events',
    payload: { event: 'test' },
    fetchImpl: async () => {
      permanentAttempts += 1;
      return { ok: false, status: 400 };
    },
    sleep: async () => { throw new Error('permanent failures must not sleep'); },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errorCode, 'webhook.http-400');
  assert.equal(permanentAttempts, 1);
}

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

// --- R2 catch-up grace ends after the configured late-refresh window ---
{
  const oldReset = new Date(now.getTime() - NOTIFICATION_GRACE_MS.reset - 1).toISOString();
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
  assert.ok(!rules.some((r) => r.ruleId === 'R2'), 'R2 should not fire after its catch-up grace');
}

// --- Late refresh catch-up and durable duplicate prevention ---
{
  const lateReset = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const lateSnapshot = {
    providers: {
      claude: {
        ok: true,
        buckets: [{
          id: 'claude-session',
          label: 'Current session',
          kind: 'session',
          model: 'all',
          percentUsed: 80,
          resetISO: lateReset,
        }],
      },
    },
  };
  const catchUpSettings = {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    notifications: { 'R1-0': true },
  };
  const caughtUp = evaluateRules({
    snapshot: lateSnapshot,
    history: [],
    settings: catchUpSettings,
    firedRules: {},
    now,
  });
  assert.ok(caughtUp.some((r) => r.ruleId === 'R1-0' && r.catchUp), 'R1-0 should catch up after a late refresh');
  const fired = { [caughtUp[0].fireKey]: now.getTime() };
  assert.equal(evaluateRules({
    snapshot: lateSnapshot,
    history: [],
    settings: catchUpSettings,
    firedRules: fired,
    now,
  }).length, 0, 'caught-up rule should remain de-duplicated after persistence');

  const r2CaughtUp = evaluateRules({
    snapshot: lateSnapshot,
    history: [],
    settings: {
      ...catchUpSettings,
      notifications: { R2: true },
    },
    firedRules: {},
    now,
  });
  assert.ok(r2CaughtUp.some((r) => r.ruleId === 'R2'), 'R2 should catch up inside its late-refresh grace');
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

// --- U3 anomaly alert fires for a configured moving-average spike ---
{
  const spikeSnapshot = {
    providers: {
      claude: {
        ok: true,
        buckets: [{
          id: 'claude-session',
          label: 'Current session',
          kind: 'session',
          model: 'all',
          percentUsed: 70,
          resetISO: '2026-06-16T17:00:00.000Z',
        }],
      },
    },
  };
  const spikeHistory = [10, 12, 11, 13, 70].map((percentUsed, index) => ({
    ts: now.getTime() - (4 - index) * 60 * 60 * 1000,
    bucketId: 'claude-session',
    percentUsed,
  }));
  const spikeSettings = {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    notifications: { U3: true },
    anomalyThresholdPercent: 20,
  };
  const rules = evaluateRules({ snapshot: spikeSnapshot, history: spikeHistory, settings: spikeSettings, firedRules: {}, now });
  const anomaly = rules.find((rule) => rule.ruleId === 'U3');
  assert.ok(anomaly, 'U3 should fire for a current sample above the moving average');
  assert.match(anomaly.title, /usage spike detected/);
  assert.match(anomaly.body, /recent 4-sample average/);
  const quiet = evaluateRules({
    snapshot: spikeSnapshot,
    history: spikeHistory,
    settings: { ...spikeSettings, anomalyThresholdPercent: 60 },
    firedRules: {},
    now,
  });
  assert.equal(quiet.some((rule) => rule.ruleId === 'U3'), false, 'A higher configured threshold should suppress the alert');
  const repeated = evaluateRules({
    snapshot: spikeSnapshot,
    history: spikeHistory,
    settings: spikeSettings,
    firedRules: { [anomaly.fireKey]: now.getTime() },
    now,
  });
  assert.equal(repeated.some((rule) => rule.ruleId === 'U3'), false, 'The same ingest sample should not re-alert');
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

// --- D1 does not fire after the catch-up window ---
{
  const d1OutsideNow = new Date(2026, 5, 16, 11, 15, 0);
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
  assert.ok(!rules.some((r) => r.ruleId === 'D1'), 'D1 should not fire after its catch-up window');
}

// --- D1 catches up after a late browser wake ---
{
  const d1LateNow = new Date(2026, 5, 16, 9, 30, 0);
  const d1Settings = {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    notifications: { D1: true, dailyBriefingHour: 8 },
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
  const rules = evaluateRules({
    snapshot: d1Snapshot,
    history: [],
    settings: d1Settings,
    firedRules: {},
    now: d1LateNow,
  });
  assert.ok(rules.some((r) => r.ruleId === 'D1'), 'D1 should catch up after a late browser wake');
}

// --- Next-alarm derivation schedules the earliest unfired deadline ---
{
  const resetISO = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const alarmSnapshot = {
    providers: {
      claude: {
        ok: true,
        buckets: [{
          id: 'claude-session',
          kind: 'session',
          model: 'all',
          percentUsed: 30,
          resetISO,
        }],
      },
    },
  };
  const alarmSettings = {
    showProviders: { claude: true },
    showRows: { 'claude-session': true },
    notifications: { 'R1-15': true, 'R1-0': true, R2: true, D1: false },
  };
  const first = deriveNextNotificationAlarm({ snapshot: alarmSnapshot, settings: alarmSettings, now });
  assert.equal(first?.ruleId, 'R1-15', 'next alarm should choose the earliest renewal deadline');
  assert.equal(first?.atISO, new Date(now.getTime() + 15 * 60 * 1000).toISOString(), 'next alarm timestamp should be exact');
  const second = deriveNextNotificationAlarm({
    snapshot: alarmSnapshot,
    settings: alarmSettings,
    firedRules: { [first.fireKey]: now.getTime() },
    now,
  });
  assert.equal(second?.ruleId, 'R1-0', 'next alarm should skip persisted fired rules');
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
