// Runtime support is a release contract, not an informal README claim.
// Keep the documented floors aligned with esbuild targets and the APIs used by
// the extension adapter.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFESTS, ROOT } from './common.mjs';

export const RUNTIME_MATRIX = Object.freeze({
  chrome: Object.freeze({
    label: 'Chrome / Chromium browsers',
    minimum: '111',
    manifestField: 'minimum_chrome_version',
    apiFloor: ['Manifest V3', 'storage.local', 'alarms', 'notifications', 'tabs', 'runtime messaging'],
  }),
  firefox: Object.freeze({
    label: 'Firefox',
    minimum: '115',
    manifestField: 'browser_specific_settings.gecko.strict_min_version',
    apiFloor: ['Manifest V3', 'storage.local', 'alarms', 'notifications', 'tabs', 'runtime messaging'],
  }),
  userscript: Object.freeze({
    label: 'Userscript managers',
    minimum: 'Chrome/Chromium 111+ or Firefox 115+',
    manifestField: null,
    apiFloor: ['GM.getValue / GM.setValue', 'GM.notification or Notification'],
  }),
});

const USED_API_ASSERTIONS = [
  ['storage.local', /storage/],
  ['alarms', /alarms/],
  ['notifications', /notifications/],
  ['tabs', /tabs/],
  ['runtime messaging', /sendMessage|onMessage/],
];

export async function validateRuntimeMatrix() {
  const [chrome, firefox, readme, browserSource, userscriptSource] = await Promise.all([
    readJSON(path.join(MANIFESTS, 'chrome.json')),
    readJSON(path.join(MANIFESTS, 'firefox.json')),
    fs.readFile(path.join(ROOT, 'README.md'), 'utf8'),
    fs.readFile(path.join(ROOT, 'src', 'lib', 'browser.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'userscript', 'header.txt'), 'utf8'),
  ]);

  assert.equal(chrome.minimum_chrome_version, RUNTIME_MATRIX.chrome.minimum, 'Chrome manifest floor drifted');
  assert.equal(
    majorVersion(firefox.browser_specific_settings?.gecko?.strict_min_version),
    RUNTIME_MATRIX.firefox.minimum,
    'Firefox manifest floor drifted',
  );
  assert.match(readme, /Chrome \/ Edge \/ Brave \/ any Chromium 111\+/i, 'README Chromium floor drifted');
  assert.match(readme, /Firefox 115\+/i, 'README Firefox floor drifted');
  assert.match(readme, /Chrome\/Chromium 111\+ or Firefox 115\+/i, 'README userscript floor missing');
  assert.match(userscriptSource, /@grant\s+GM\.getValue/i, 'userscript storage grant missing');

  for (const [api, pattern] of USED_API_ASSERTIONS) {
    assert.match(browserSource, pattern, `browser adapter no longer declares ${api}`);
  }
  return RUNTIME_MATRIX;
}

async function readJSON(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function majorVersion(value) {
  return String(value || '').match(/^\d+/)?.[0] || '';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateRuntimeMatrix();
  console.log('runtime matrix validation: OK');
}
