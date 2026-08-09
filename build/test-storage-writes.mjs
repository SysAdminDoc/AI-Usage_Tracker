import assert from 'node:assert/strict';

const previousChrome = globalThis.chrome;
const localStore = new Map();
const syncStore = new Map();
let localWrites = 0;
let syncWrites = 0;
let failSyncWrites = false;

function readArea(store) {
  return {
    get(key, callback) {
      callback({ [key]: store.get(key) });
    },
    set(values, callback) {
      if (store === localStore) localWrites += 1;
      else syncWrites += 1;
      if (store === syncStore && failSyncWrites) {
        globalThis.chrome.runtime.lastError = { message: 'sync quota exceeded' };
        callback();
        globalThis.chrome.runtime.lastError = null;
        return;
      }
      for (const [key, value] of Object.entries(values)) store.set(key, value);
      callback();
    },
    remove(key, callback) {
      store.delete(key);
      callback();
    },
    getBytesInUse(key, callback) {
      callback(JSON.stringify(store.get(key) || null).length);
    },
    QUOTA_BYTES: 100_000,
  };
}

globalThis.chrome = {
  extension: { inIncognitoContext: false },
  runtime: { id: 'storage-writes-test', lastError: null },
  storage: {
    local: readArea(localStore),
    sync: readArea(syncStore),
  },
};

try {
  const storage = await import('../src/lib/storage.js?storage-writes-contract');
  const settings = { ...storage.defaultSettings(), syncSettings: true, theme: 'latte' };

  storage.resetStorageWriteDiagnostics();
  const concurrent = await Promise.all([
    storage.saveSyncedSettings(settings, 'default'),
    storage.saveSyncedSettings(settings, 'default'),
  ]);
  assert.equal(syncWrites, 1, 'concurrent identical sync writes should coalesce');
  assert.equal(concurrent.filter((result) => result.synced).length, 1);
  const firstStats = storage.getStorageWriteDiagnostics();
  assert.deepEqual(firstStats.sync, {
    attempts: 1,
    successes: 1,
    failures: 0,
    bytes: firstStats.sync.bytes,
    lastBytes: firstStats.sync.lastBytes,
  });
  assert.ok(firstStats.sync.bytes > 0, 'sync diagnostics should expose payload bytes');

  failSyncWrites = true;
  const changed = { ...settings, theme: 'mocha' };
  await assert.rejects(
    () => storage.saveSyncedSettings(changed, 'default'),
    (error) => error?.message === 'sync quota exceeded',
  );
  const failedStats = storage.getStorageWriteDiagnostics();
  assert.equal(failedStats.sync.attempts, 2);
  assert.equal(failedStats.sync.successes, 1);
  assert.equal(failedStats.sync.failures, 1, 'partial sync failure should be observable');

  failSyncWrites = false;
  const recovered = await storage.saveSyncedSettings(changed, 'default');
  assert.equal(recovered.synced, true, 'a later sync attempt should recover after quota failure');

  storage.resetStorageWriteDiagnostics();
  await storage.saveState(storage.defaultState());
  const stateStats = storage.getStorageWriteDiagnostics();
  assert.equal(stateStats.state.attempts, 1, 'one state commit should have one state write attempt');
  assert.equal(stateStats.state.successes, 1);
  assert.equal(stateStats.state.failures, 0);
  assert.ok(stateStats.state.bytes > 0, 'state diagnostics should expose payload bytes');
  const usage = await storage.getStorageUsage(storage.defaultState());
  assert.equal(usage.writes.state.successes, 1);
  assert.equal(usage.writes.sync.attempts, 0);

  console.log('storage write observability smoke: OK');
} finally {
  if (previousChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = previousChrome;
}
