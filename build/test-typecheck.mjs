import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const config = JSON.parse(await fs.readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'));
assert.equal(config.compilerOptions.strict, true);
assert.equal(config.compilerOptions.checkJs, true);
assert.ok(config.include.includes('src/types.ts'));
assert.ok(config.include.includes('src/type-contracts.ts'));
assert.ok(config.include.includes('src/lib/type-guards.js'));
const ratchetConfig = JSON.parse(await fs.readFile(new URL('../tsconfig.ratchet.json', import.meta.url), 'utf8'));
assert.deepEqual(ratchetConfig.include, [
  'src/types.ts',
  'src/type-contracts.ts',
  'src/background.js',
  'src/lib/message-contract.js',
  'src/lib/notify.js',
  'src/lib/storage.js',
  'src/providers/api-contract.js',
  'src/providers/registry.js',
]);
const baseline = JSON.parse(await fs.readFile(new URL('../build/typecheck-baseline.json', import.meta.url), 'utf8'));
assert.equal(baseline.schema, 'ai-usage-tracker.typecheck-baseline');
assert.deepEqual(baseline.coveredFiles, [...ratchetConfig.include].sort());
assert.ok(Object.keys(baseline.diagnostics).length > 0, 'ratchet baseline should record current debt');
console.log('TypeScript contract configuration smoke: OK');
