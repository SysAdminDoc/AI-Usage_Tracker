import assert from 'node:assert/strict';
import {
  exportSettings,
  migrateState,
  parseSettingsImport,
  defaultState,
  defaultSettings,
  createProfile,
  deleteProfile,
  getApiCredentialStatus,
  getActiveProfile,
  loadProfileRegistry,
  loadState,
  renameProfile,
  saveApiCredential,
  saveState,
  switchProfile,
} from '../src/lib/storage.js';

// --- Test: fresh defaultState has current version ---
const fresh = defaultState();
assert.equal(fresh.stateVersion, 2, 'defaultState() should have stateVersion 2');
assert.ok(fresh.snapshot, 'defaultState() should have snapshot');
assert.ok(fresh.settings, 'defaultState() should have settings');
assert.equal(fresh.collaboration.enabled, false, 'collaboration dashboard should be opt-in by default');
assert.deepEqual(fresh.collaboration.ledger.contributions, [], 'collaboration ledger should start empty');
assert.equal(fresh.settings.historyRetentionDays, 30, 'history retention should default to 30 days');
assert.equal(fresh.settings.anomalyThresholdPercent, 20, 'anomaly threshold should default to 20 percentage points');
assert.equal(fresh.settings.notifications.U3, false, 'anomaly alerts should be opt-in');

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
assert.equal(migrated.collaboration.enabled, false, 'migration should add an opt-in collaboration state');

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

// --- Test: versioned settings backup omits history unless selected ---
const backupState = defaultState();
backupState.settings.theme = 'latte';
backupState.widget = { x: 42, y: 84, minimized: true };
backupState.history = [{ ts: 1234, bucketId: 'codex-5h-all', percentUsed: 67 }];
const settingsOnly = exportSettings(backupState);
assert.equal(settingsOnly.schema, 'ai-usage-tracker.settings');
assert.equal(Object.prototype.hasOwnProperty.call(settingsOnly, 'history'), false, 'history should be opt-in');
const withHistory = exportSettings(backupState, { includeHistory: true });
assert.equal(withHistory.history.length, 1, 'explicit history export should include samples');
assert.equal(parseSettingsImport(JSON.stringify(settingsOnly)).settings.theme, 'latte');
assert.equal(parseSettingsImport(withHistory, { includeHistory: true }).history[0].percentUsed, 67);
assert.throws(
  () => parseSettingsImport({ schema: 'wrong', schemaVersion: 1, settings: {} }),
  /Unsupported settings export schema/,
  'unknown export schemas must be rejected',
);
assert.throws(
  () => parseSettingsImport({ schema: 'ai-usage-tracker.settings', schemaVersion: 1, settings: {}, history: [{ ts: 'bad' }] }, { includeHistory: true }),
  /History sample 1 is invalid/,
  'invalid history must be rejected before import',
);

// --- Test: profiles migrate the legacy state and isolate state + credentials ---
const initialProfiles = await loadProfileRegistry();
assert.equal(initialProfiles.activeId, 'default', 'legacy storage should create the default profile');
const defaultStateForProfiles = await loadState();
defaultStateForProfiles.settings.theme = 'latte';
defaultStateForProfiles.history = [{ ts: 1234, bucketId: 'default-only', percentUsed: 12 }];
await saveState(defaultStateForProfiles);
await saveApiCredential('anthropic-api', 'default-secret');

const workProfile = await createProfile('Work Account');
assert.equal(workProfile.id, 'work-account');
const longProfileName = 'x'.repeat(48);
const longProfile = await createProfile(longProfileName);
const duplicateLongProfile = await createProfile(longProfileName);
assert.notEqual(longProfile.id, duplicateLongProfile.id, 'long duplicate profile names should still receive unique ids');
await deleteProfile(longProfile.id);
await deleteProfile(duplicateLongProfile.id);
await switchProfile(workProfile.id);
const workState = await loadState();
assert.equal(workState.settings.theme, 'mocha', 'new profiles should start from clean defaults');
assert.equal(workState.history.length, 0, 'new profiles should not inherit history');
assert.equal((await getApiCredentialStatus())['anthropic-api'].configured, false, 'API credentials should be profile-local');
workState.settings.theme = 'system';
workState.history = [{ ts: 5678, bucketId: 'work-only', percentUsed: 88 }];
await saveState(workState);
await saveApiCredential('anthropic-api', 'work-secret');

await switchProfile('default');
assert.equal((await getActiveProfile()).name, 'Default');
assert.equal((await loadState()).settings.theme, 'latte', 'default settings should remain isolated');
assert.equal((await loadState()).history[0].bucketId, 'default-only');
assert.equal((await getApiCredentialStatus())['anthropic-api'].configured, true);
await renameProfile('default', 'Personal');
assert.equal((await getActiveProfile()).name, 'Personal');

await switchProfile(workProfile.id);
assert.equal((await loadState()).settings.theme, 'system', 'work settings should survive switching back');
assert.equal((await loadState()).history[0].bucketId, 'work-only');
assert.equal((await getApiCredentialStatus())['anthropic-api'].configured, true);
await deleteProfile(workProfile.id);
const afterDelete = await loadProfileRegistry();
assert.equal(afterDelete.profiles.length, 1, 'deleting a profile should remove it from the registry');
assert.equal(afterDelete.activeId, 'default', 'deleting the active profile should select a remaining profile');
await assert.rejects(() => deleteProfile('missing'), /Unknown profile/);

// --- Test: incognito storage scope never reuses regular profile keys ---
const savedChrome = globalThis.chrome;
const privateStore = new Map();
globalThis.chrome = {
  extension: { inIncognitoContext: true },
  runtime: { lastError: null },
  storage: {
    local: {
      get(key, callback) { callback({ [key]: privateStore.get(key) }); },
      set(values, callback) {
        Object.entries(values).forEach(([key, value]) => privateStore.set(key, value));
        callback();
      },
      remove(key, callback) { privateStore.delete(key); callback(); },
    },
  },
};
const incognitoStorage = await import('../src/lib/storage.js?incognito-contract');
assert.equal(incognitoStorage.storageScope, 'incognito');
assert.equal(incognitoStorage.isIncognitoContext(), true);
assert.equal(incognitoStorage.getProfileRegistryStorageKey(), 'aut.incognito.aut.profiles.v1');
assert.equal(incognitoStorage.profileStateStorageKey('default'), 'aut.incognito.aut.state.v1.profile.default');
await incognitoStorage.loadState();
assert.equal(privateStore.has('aut.profiles.v1'), false, 'incognito initialization must not write regular registry keys');
assert.equal(privateStore.has('aut.incognito.aut.profiles.v1'), true, 'incognito registry must use a scoped key');
assert.equal(privateStore.has('aut.incognito.aut.state.v1.profile.default'), true, 'incognito state must use a scoped key');
if (savedChrome === undefined) delete globalThis.chrome;
else globalThis.chrome = savedChrome;

// --- Test: optional sync only writes an explicit settings allowlist ---
const syncChrome = globalThis.chrome;
const syncStore = new Map();
const makeSyncArea = () => ({
  get(key, callback) { callback({ [key]: syncStore.get(key) }); },
  set(values, callback) {
    Object.entries(values).forEach(([key, value]) => syncStore.set(key, value));
    callback();
  },
  remove(key, callback) { syncStore.delete(key); callback(); },
});
globalThis.chrome = {
  extension: { inIncognitoContext: false },
  runtime: { lastError: null },
  storage: { local: makeSyncArea(), sync: makeSyncArea() },
};
const syncStorage = await import('../src/lib/storage.js?sync-contract');
assert.equal(syncStorage.syncSettingsAvailable(), true);
const syncCandidate = {
  ...defaultSettings(),
  theme: 'latte',
  syncSettings: true,
  history: [{ bucketId: 'must-not-sync' }],
  apiKey: 'must-not-sync',
};
await syncStorage.saveSyncedSettings(syncCandidate, 'default');
const rawSyncRecord = syncStore.get('aut.sync.settings.v1');
assert.equal(rawSyncRecord.settings.theme, 'latte');
assert.equal(rawSyncRecord.settings.anomalyThresholdPercent, 20);
assert.equal(rawSyncRecord.settings.notifications.U3, false);
assert.equal(Object.prototype.hasOwnProperty.call(rawSyncRecord.settings, 'history'), false);
assert.equal(Object.prototype.hasOwnProperty.call(rawSyncRecord.settings, 'apiKey'), false);
assert.equal((await syncStorage.loadSyncedSettings('default')).theme, 'latte');
assert.equal(await syncStorage.loadSyncedSettings('work'), null, 'sync records must not cross profile ids');
await syncStorage.clearSyncedSettings();
assert.equal(syncStore.has('aut.sync.settings.v1'), false);
if (syncChrome === undefined) delete globalThis.chrome;
else globalThis.chrome = syncChrome;

console.log('storage migration smoke: OK');
