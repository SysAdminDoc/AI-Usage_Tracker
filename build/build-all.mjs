// Build everything — Chrome, Firefox, userscript.
import { buildExtension } from './build-extension.mjs';
import { clean, DIST } from './common.mjs';
import { validateReleaseProvenance, writeReleaseChecksums } from './release-provenance.mjs';
import { validateHostMatrix } from './host-matrix.mjs';
import { validateRuntimeMatrix } from './runtime-matrix.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const typecheck = spawnSync(process.execPath, [path.join(__dirname, 'typecheck.mjs')], { stdio: 'inherit' });
  if (typecheck.status !== 0) process.exit(typecheck.status || 1);
  await validateHostMatrix();
  await validateRuntimeMatrix();
  await validateReleaseProvenance();
  await clean(DIST);

  await buildExtension({ target: 'chrome' });
  await buildExtension({ target: 'firefox' });

  // Userscript build is self-contained — run as separate process.
  const us = spawnSync(process.execPath, [path.join(__dirname, 'build-userscript.mjs')], {
    stdio: 'inherit',
  });
  if (us.status !== 0) process.exit(us.status || 1);

  await writeReleaseChecksums();
  console.log('\n[build] All targets built.');
}

main().catch((e) => { console.error(e); process.exit(1); });
