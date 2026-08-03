import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const config = JSON.parse(await fs.readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'));
assert.equal(config.compilerOptions.strict, true);
assert.equal(config.compilerOptions.checkJs, true);
assert.ok(config.include.includes('src/types.ts'));
assert.ok(config.include.includes('src/type-contracts.ts'));
assert.ok(config.include.includes('src/lib/type-guards.js'));
console.log('TypeScript contract configuration smoke: OK');
