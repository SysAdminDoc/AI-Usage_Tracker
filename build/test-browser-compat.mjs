import assert from 'node:assert/strict';

const callbackEvents = {
  notifications: [],
  alarms: [],
  tabs: [],
  messages: [],
  store: {},
};

let callbackMessageListener;
const callbackChrome = {
  runtime: {
    id: 'callback-extension',
    lastError: null,
    getURL: (path) => `chrome-extension://test/${path}`,
    sendMessage(message, callback) {
      callbackEvents.messages.push(message);
      queueMicrotask(() => callback({ ok: true, style: 'callback' }));
    },
    onMessage: {
      addListener(listener) { callbackMessageListener = listener; },
    },
  },
  notifications: {
    create(id, options, callback) {
      callbackEvents.notifications.push({ id, options });
      queueMicrotask(() => callback('notification-id'));
    },
  },
  alarms: {
    create(name, info, callback) {
      callbackEvents.alarms.push({ operation: 'create', name, info });
      queueMicrotask(() => callback());
    },
    clear(name, callback) {
      callbackEvents.alarms.push({ operation: 'clear', name });
      queueMicrotask(() => callback(true));
    },
    onAlarm: {
      addListener() {},
    },
  },
  tabs: {
    create(info, callback) {
      callbackEvents.tabs.push({ operation: 'create', info });
      queueMicrotask(() => callback({ id: 17, ...info }));
    },
    remove(id, callback) {
      callbackEvents.tabs.push({ operation: 'remove', id });
      queueMicrotask(() => callback());
    },
  },
  storage: {
    local: {
      get(key, callback) {
        callback({ [key]: callbackEvents.store[key] });
      },
      set(values, callback) {
        Object.assign(callbackEvents.store, values);
        callback();
      },
      getBytesInUse(_key, callback) {
        callback(321);
      },
      QUOTA_BYTES: 5_000_000,
    },
  },
};

globalThis.chrome = callbackChrome;
const callbackApi = await import('../src/lib/browser.js?callback-contract');
assert.equal(callbackApi.isPromiseStyle, false, 'Chrome namespace should use callback style');

assert.equal(
  await callbackApi.notify({ title: 'Callback notice', body: 'body', id: 'notice-1' }),
  true,
  'callback notifications should resolve true',
);
assert.equal(callbackEvents.notifications[0].options.message, 'body');

const callbackTab = await callbackApi.invokeWebExtension(callbackApi.tabs, 'create', [{ url: 'https://example.test', active: false }]);
assert.equal(callbackTab.id, 17, 'callback tabs.create should return its callback value');
await callbackApi.invokeWebExtension(callbackApi.tabs, 'remove', [callbackTab.id]);

const callbackSchedule = callbackApi.schedule({ name: 'callback-refresh', minutes: 5, onFire() {} });
assert.equal(callbackSchedule.type, 'alarm');
const callbackDeadline = callbackApi.scheduleAt({ name: 'callback-deadline', when: Date.now() + 60_000, onFire() {} });
assert.equal(callbackDeadline.type, 'alarm');
await callbackDeadline.cancel();
await callbackSchedule.cancel();
assert.ok(callbackEvents.alarms.some((entry) => entry.operation === 'create' && entry.name === 'callback-refresh'));
assert.ok(callbackEvents.alarms.some((entry) => entry.operation === 'clear' && entry.name === 'callback-deadline'));

assert.deepEqual(
  await callbackApi.send({ type: 'callback-message' }),
  { ok: true, style: 'callback' },
  'callback runtime.sendMessage should resolve its response',
);
callbackApi.onMessage(async (message) => ({ echo: message.type }));
let callbackResponse;
const callbackReturn = callbackMessageListener({ type: 'incoming' }, {}, (response) => { callbackResponse = response; });
assert.equal(callbackReturn, true, 'Chrome listeners should keep the callback channel open');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(callbackResponse, { echo: 'incoming' });

callbackChrome.runtime.lastError = { message: 'tab disappeared' };
await assert.rejects(
  callbackApi.invokeWebExtension(callbackApi.tabs, 'remove', [17]),
  (error) => error?.message === 'tab disappeared',
  'callback runtime.lastError should reject the adapter call',
);
callbackChrome.runtime.lastError = null;

// The storage adapter itself must work against Chrome's callback API, not only
// the standalone helper.
const callbackStorage = await import('../src/lib/storage.js?callback-contract');
const callbackState = callbackStorage.defaultState();
await callbackStorage.saveState(callbackState);
assert.equal(callbackStorage.storageType, 'webext');
assert.equal((await callbackStorage.loadState()).stateVersion, 2);
assert.deepEqual(await callbackStorage.getStorageUsage(), {
  bytes: 321,
  quotaBytes: 5_000_000,
  source: 'webext',
});

delete globalThis.chrome;
let promiseMessageListener;
const promiseEvents = { notifications: [], alarms: [], tabs: [], messages: [] };
globalThis.browser = {
  runtime: {
    id: 'promise-extension',
    getURL: (path) => `moz-extension://test/${path}`,
    sendMessage(message) {
      promiseEvents.messages.push(message);
      return Promise.resolve({ ok: true, style: 'promise' });
    },
    onMessage: {
      addListener(listener) { promiseMessageListener = listener; },
    },
  },
  notifications: {
    create(...args) {
      assert.equal(args.length, 2, 'Firefox notification calls should not receive a callback');
      promiseEvents.notifications.push(args);
      return Promise.resolve('notification-id');
    },
  },
  alarms: {
    create(name, info) {
      promiseEvents.alarms.push({ operation: 'create', name, info });
      return Promise.resolve();
    },
    clear(name) {
      promiseEvents.alarms.push({ operation: 'clear', name });
      return Promise.resolve(true);
    },
    onAlarm: {
      addListener() {},
    },
  },
  tabs: {
    create(info) {
      promiseEvents.tabs.push({ operation: 'create', info });
      return Promise.resolve({ id: 23, ...info });
    },
    remove(id) {
      promiseEvents.tabs.push({ operation: 'remove', id });
      return Promise.resolve(true);
    },
  },
};

const promiseApi = await import('../src/lib/browser.js?promise-contract');
assert.equal(promiseApi.isPromiseStyle, true, 'Firefox namespace should use promise style');
assert.equal(
  await promiseApi.notify({ title: 'Promise notice', body: 'body', id: 'notice-2' }),
  true,
  'promise notifications should resolve true',
);
const promiseTab = await promiseApi.invokeWebExtension(promiseApi.tabs, 'create', [{ url: 'https://example.test', active: false }]);
assert.equal(promiseTab.id, 23, 'promise tabs.create should return its promise value');
await promiseApi.invokeWebExtension(promiseApi.tabs, 'remove', [promiseTab.id]);
const promiseSchedule = promiseApi.schedule({ name: 'promise-refresh', minutes: 5, onFire() {} });
assert.equal(promiseSchedule.type, 'alarm');
await promiseSchedule.cancel();
assert.ok(promiseEvents.alarms.some((entry) => entry.operation === 'create' && entry.name === 'promise-refresh'));
assert.ok(promiseEvents.alarms.some((entry) => entry.operation === 'clear' && entry.name === 'promise-refresh'));
assert.deepEqual(
  await promiseApi.send({ type: 'promise-message' }),
  { ok: true, style: 'promise' },
  'promise runtime.sendMessage should resolve its response',
);
promiseApi.onMessage(async (message) => ({ echo: message.type }));
assert.deepEqual(
  await promiseMessageListener({ type: 'incoming' }, {}),
  { echo: 'incoming' },
  'Firefox listeners should return a promise response',
);

// Exercise the injectable seam directly with isolated fake APIs too. This
// keeps the contract explicit if a future runtime exposes a hybrid namespace.
const callbackOnlyTarget = { method(_value, callback) { callback('callback-value'); } };
const promiseOnlyTarget = { method(value) { return Promise.resolve(`promise-${value}`); } };
assert.equal(await promiseApi.invokeWebExtension(callbackOnlyTarget, 'method', ['value'], { promiseStyle: false }), 'callback-value');
assert.equal(await promiseApi.invokeWebExtension(promiseOnlyTarget, 'method', ['value'], { promiseStyle: true }), 'promise-value');

console.log('WebExtension callback/promise compatibility smoke: OK');
