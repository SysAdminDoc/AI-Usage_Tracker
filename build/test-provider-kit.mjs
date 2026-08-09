import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  MAX_PROVIDER_FIXTURE_BYTES,
  PROVIDER_FIXTURE_SCHEMA,
  PROVIDER_FIXTURE_VERSION,
  readProviderFixture,
  validateProviderFixture,
} from './provider-fixture.mjs';
import {
  runProviderPlugin,
  validateProviderPlugin,
} from '../src/providers/plugin-api.js';
import {
  sampleProviderFixture,
  sampleProviderPlugin,
} from './fixtures/sample-provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'build', 'fixtures', 'provider-sample.json');
const loaded = await readProviderFixture(fixturePath);
assert.equal(loaded.schema, PROVIDER_FIXTURE_SCHEMA);
assert.equal(loaded.schemaVersion, PROVIDER_FIXTURE_VERSION);
assert.deepEqual(loaded.provider, sampleProviderFixture.provider);
assert.equal(validateProviderPlugin(sampleProviderPlugin).ok, true);

const result = await runProviderPlugin(sampleProviderPlugin, {
  credential: 'fixture-only-secret',
});
assert.equal(result.ok, true);
assert.equal(result.provider, 'sample-provider');
assert.equal(result.buckets[0].metric.totalTokens, 2048);
assert.equal(result.buckets[0].metric.requests, 12);
assert.doesNotMatch(JSON.stringify(result), /fixture-only-secret/);

const missingCapability = structuredClone(sampleProviderFixture);
delete missingCapability.provider.meta.capabilities.cost;
const capabilityResult = validateProviderFixture(missingCapability);
assert.equal(capabilityResult.ok, false);
assert.ok(capabilityResult.errors.some((error) => error.includes('capability-cost-missing')));

const secretPayload = structuredClone(sampleProviderFixture);
secretPayload.payload.authorization = 'Bearer fixture-only-secret';
const secretResult = validateProviderFixture(secretPayload);
assert.equal(secretResult.ok, false);
assert.ok(secretResult.errors.some((error) => error.includes('must be redacted')));

const invalidSnapshot = structuredClone(sampleProviderFixture);
invalidSnapshot.snapshot.buckets[0].percentUsed = 101;
const snapshotResult = validateProviderFixture(invalidSnapshot);
assert.equal(snapshotResult.ok, false);
assert.ok(snapshotResult.errors.some((error) => error.includes('percentUsed')));

const cli = spawnSync(process.execPath, [
  path.join(root, 'build', 'provider-fixture.mjs'),
  fixturePath,
], { encoding: 'utf8' });
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /provider fixture valid/);

const tempDir = await fs.mkdtemp(path.join(root, 'build', '.provider-kit-test-'));
try {
  const oversized = path.join(tempDir, 'oversized.json');
  await fs.writeFile(oversized, Buffer.alloc(MAX_PROVIDER_FIXTURE_BYTES + 1, 32));
  await assert.rejects(() => readProviderFixture(oversized), /exceeds/);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log('provider authoring kit and fixture boundary: OK');
