import assert from 'node:assert/strict';
import { API_PROVIDER_HOSTS } from '../src/providers/api-contract.js';

const previousChrome = globalThis.chrome;
const granted = new Set();
const events = [];
let denyRequests = false;
globalThis.chrome = {
  runtime: { id: 'permission-test-extension', lastError: null },
  permissions: {
    contains({ origins }, callback) {
      callback(granted.has(origins[0]));
    },
    request({ origins }, callback) {
      events.push({ action: 'request', origin: origins[0] });
      if (denyRequests) {
        callback(false);
        return;
      }
      granted.add(origins[0]);
      callback(true);
    },
    remove({ origins }, callback) {
      events.push({ action: 'remove', origin: origins[0] });
      granted.delete(origins[0]);
      callback(true);
    },
  },
};

try {
  const browser = await import('../src/lib/browser.js?provider-permissions');
  for (const [provider, origin] of Object.entries(API_PROVIDER_HOSTS)) {
    const requested = await browser.requestApiProviderHostPermission(provider);
    assert.equal(requested.ok, true);
    assert.equal(requested.granted, true);
    assert.deepEqual(events.at(-1), { action: 'request', origin });
    assert.equal((await browser.getApiProviderHostPermission(provider)).ok, true);
    const removed = await browser.removeApiProviderHostPermission(provider);
    assert.equal(removed.ok, true);
    assert.equal((await browser.getApiProviderHostPermission(provider)).ok, false);
  }

  denyRequests = true;
  const denied = await browser.requestApiProviderHostPermission('openai-api');
  assert.equal(denied.ok, false);
  assert.equal(denied.errorCode, 'api.host-permission-denied');
  assert.equal((await browser.requestApiProviderHostPermission('unknown')).errorCode, 'api.host-unknown');
  assert.equal(events.some((event) => event.origin === 'https://*/*'), false, 'provider requests must stay exact');
  console.log('provider optional permission smoke: OK');
} finally {
  if (previousChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = previousChrome;
}
