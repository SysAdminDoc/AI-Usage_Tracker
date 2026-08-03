import assert from 'node:assert/strict';
import { migrateState, defaultState, defaultSettings } from '../src/lib/storage.js';

// --- Test: fresh defaultState has current version ---
const fresh = defaultState();
assert.equal(fresh.stateVersion, 2, 'defaultState() should have stateVersion 2');
assert.ok(fresh.snapshot, 'defaultState() should have snapshot');
assert.ok(fresh.settings, 'defaultState() should have settings');
assert.equal(fresh.settings.historyRetentionDays, 30, 'history retention should default to 30 days');

// --- Test: migrate v1 (unversioned) state to v2 ---
const v1State = {
  snapshot: { fetchedAtISO: '2026-06-01T00:00:00Z', providers: { claude: null, codex: null } },
  history: [{ ts: 1000, bucketId: 'a', percentUsed: 50 }],
  firedRules: { 'foo': 123 },
  settings: {
    refreshMinutes: 3,
    silentTabRefresh: true,
    showProviders: { claude: true, codex: false },
    showRows: { 'claude-session': true },
    notifications: { 'R1-60': false },
    theme: 'latte',
  },
  widget: { x: 100, y: 200, minimized: true },
};

const { state: migrated, migrated: didMigrate } = migrateState(v1State);
assert.equal(didMigrate, true, 'v1 state should trigger migration');
assert.equal(migrated.stateVersion, 2, 'migrated state should be version 2');

// Preserves user values
assert.equal(migrated.settings.refreshMinutes, 3, 'refreshMinutes preserved');
assert.equal(migrated.settings.silentTabRefresh, true, 'silentTabRefresh preserved');
assert.equal(migrated.settings.showProviders.codex, false, 'codex disabled preserved');
assert.equal(migrated.settings.theme, 'latte', 'theme preserved');
assert.equal(migrated.settings.notifications['R1-60'], false, 'notification override preserved');
assert.equal(migrated.widget.x, 100, 'widget position preserved');
assert.equal(migrated.widget.minimized, true, 'widget minimized preserved');
assert.equal(migrated.history.length, 1, 'history preserved');
assert.equal(migrated.firedRules.foo, 123, 'firedRules preserved');

// Fills in missing defaults
assert.equal(migrated.settings.thresholds.warnAt, 50, 'missing thresholds filled in');
assert.equal(migrated.settings.thresholds.dangerAt, 80, 'missing dangerAt filled in');
assert.equal(migrated.settings.notifications.dailyBriefingHour, 8, 'missing dailyBriefingHour filled in');
assert.equal(migrated.settings.notifications['R1-15'], true, 'missing R1-15 filled in');
assert.equal(migrated.settings.notifications['U1-90'], true, 'missing U1-90 filled in');

// --- Test: already at current version is no-op ---
const { state: same, migrated: noMigrate } = migrateState(defaultState());
assert.equal(noMigrate, false, 'current-version state should not trigger migration');

// --- Test: completely corrupt state ---
const { state: recovered } = migrateState('this is not an object');
assert.equal(recovered.stateVersion, 2, 'corrupt state should fall back to defaults');
assert.ok(recovered.settings, 'corrupt state should have settings');

// --- Test: state missing settings entirely ---
const noSettings = {
  snapshot: { fetchedAtISO: null, providers: {} },
};
const { state: filled } = migrateState(noSettings);
assert.equal(filled.stateVersion, 2, 'settings-less state should be migrated');
assert.ok(filled.settings.notifications, 'settings should have notifications');
assert.equal(filled.settings.refreshMinutes, 5, 'default refreshMinutes filled');

// --- Test: state with null firedRules ---
const nullFired = {
  snapshot: { fetchedAtISO: null, providers: {} },
  firedRules: null,
  settings: { refreshMinutes: 10 },
};
const { state: fixedFired } = migrateState(nullFired);
assert.deepEqual(fixedFired.firedRules, {}, 'null firedRules replaced with empty object');
assert.equal(fixedFired.settings.refreshMinutes, 10, 'user setting preserved');

console.log('storage migration smoke: OK');
