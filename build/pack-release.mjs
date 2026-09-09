import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT, DIST, VERSION } from './common.mjs';
import { packCrx3, verifyCrx3 } from './crx3.mjs';
import { validateReleaseProvenance } from './release-provenance.mjs';

await validateReleaseProvenance({ checkBuiltArtifacts: true });
const originalZip = await fs.readFile(path.join(DIST, `AI-Usage-Tracker-chrome-v${VERSION}.zip`));
const bridge = spawnSync(process.execPath, [path.join(ROOT, 'build', 'build-bridge.mjs')], { stdio: 'inherit', windowsHide: true });
assert.equal(bridge.status, 0, 'Bridge packaging failed');
assert.ok(originalZip.equals(await fs.readFile(path.join(DIST, `AI-Usage-Tracker-chrome-v${VERSION}.zip`))), 'Bridge build changed the default package');
const pem = await fs.readFile(process.env.AUT_SIGNING_KEY || path.join(ROOT, 'aut-selfhost.pem'));
const artifacts = [];
for (const profile of ['chrome', 'chrome-bridge']) {
  const manifest = JSON.parse(await fs.readFile(path.join(DIST, profile, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, VERSION);
  const zipName = `AI-Usage-Tracker-${profile}-v${VERSION}.zip`;
  const zip = await fs.readFile(path.join(DIST, zipName));
  const crxName = zipName.replace(/\.zip$/, '.crx');
  await fs.writeFile(path.join(DIST, crxName), packCrx3(zip, pem, manifest.key));
  const verified = verifyCrx3(await fs.readFile(path.join(DIST, crxName)), manifest.key);
  assert.ok(verified.zip.equals(zip), 'Signed CRX payload differs from the install ZIP');
  artifacts.push(zipName, crxName);
}
const userscript = 'ai-usage-tracker.user.js';
await fs.copyFile(path.join(DIST, 'userscript', userscript), path.join(DIST, userscript));
artifacts.push(`AI-Usage-Tracker-native-scheduler-v${VERSION}.zip`, userscript);
const entries = [];
for (const name of artifacts) {
  const bytes = await fs.readFile(path.join(DIST, name));
  entries.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await fs.writeFile(path.join(DIST, 'SHA256SUMS.txt'), entries.map(entry => `${entry.sha256}  ${entry.name}`).join('\n') + '\n');
await fs.writeFile(path.join(DIST, 'RELEASE-ASSETS.json'), JSON.stringify({ version: VERSION, entries, excluded: 'Unsigned Firefox development XPIs are not publication assets.' }, null, 2) + '\n');
console.log(`Verified ${entries.length} release artifacts; unsigned Firefox development files excluded.`);
