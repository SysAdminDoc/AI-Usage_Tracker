import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './common.mjs';

const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status || 1);
console.log('TypeScript model contracts: OK');
