import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { applyBridgeProfile } from './build-extension.mjs';

for (const target of ['chrome', 'firefox']) {
  const source = JSON.parse(await fs.readFile(new URL(`../manifests/${target}.json`, import.meta.url), 'utf8'));
  assert.equal(source.incognito, target === 'chrome' ? 'split' : 'not_allowed', `${target} incognito policy must fail closed`);
  assert.equal(source.permissions.includes('nativeMessaging'), false, `${target} default should not request native messaging`);
  const defaultManifest = applyBridgeProfile(source);
  assert.equal(defaultManifest.permissions.includes('nativeMessaging'), false, `${target} default profile should stay permission-minimized`);
  const bridgeManifest = applyBridgeProfile(source, { bridge: true });
  assert.equal(bridgeManifest.permissions.includes('nativeMessaging'), true, `${target} bridge should request native messaging`);
  assert.match(bridgeManifest.description, /QuotaGlass native-messaging companion/);
  assert.equal(source.permissions.includes('nativeMessaging'), false, `${target} source manifest must not be mutated`);
}

console.log('manifest bridge profile smoke: OK');
