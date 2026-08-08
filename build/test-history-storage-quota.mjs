import assert from 'node:assert/strict';

const previousChrome = globalThis.chrome;
const store = new Map();
let stateWriteAttempts = 0;
globalThis.chrome = {
  extension: { inIncognitoContext: false },
  runtime: { id: 'quota-test-extension', lastError: null },
  storage: {
    local: {
      get(key, callback) {
        callback({ [key]: store.get(key) });
      },
      set(values, callback) {
        const [[key, value]] = Object.entries(values);
        if (String(key).includes('aut.state.v1.profile.')) {
          stateWriteAttempts += 1;
          if (JSON.stringify(value).length > 180_000) throw new Error('QUOTA_BYTES');
        }
        store.set(key, value);
        callback();
      },
      remove(key, callback) {
        store.delete(key);
        callback();
      },
    },
  },
};

try {
  const storage = await import('../src/lib/storage.js?history-quota-contract');
  const state = storage.defaultState();
  state.history = Array.from({ length: 6_000 }, (_, index) => ({
    ts: Date.now() - (6_000 - index) * 1_000,
    bucketId: 'quota-test',
    percentUsed: index % 101,
  }));
  await storage.saveState(state);

  const saved = store.get('aut.state.v1.profile.default');
  assert.ok(stateWriteAttempts >= 2, 'a quota failure should trigger a tighter history retry');
  assert.ok(saved.history.length < 4_000, 'the quota retry should reduce the history payload');
  assert.equal((await storage.loadState()).history.at(-1).ts, state.history.at(-1).ts);
  console.log('history storage quota smoke: OK');
} finally {
  if (previousChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = previousChrome;
}
