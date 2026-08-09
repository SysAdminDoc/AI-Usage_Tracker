import { validateReleaseProvenance } from './release-provenance.mjs';
import { VERSION, stampVersion } from './common.mjs';
import { resolveAppVersion } from '../src/lib/version.js';

await validateReleaseProvenance();
if (stampVersion('v__AUT_VERSION__') !== `v${VERSION}`) {
  throw new Error('version template stamping drifted');
}
assertVersionResolution();
console.log('release provenance tests passed');

function assertVersionResolution() {
  const extensionRuntime = {
    chrome: { runtime: { getManifest: () => ({ version: VERSION }) } },
  };
  if (resolveAppVersion(extensionRuntime) !== VERSION) {
    throw new Error('extension runtime version resolution drifted');
  }

  const browserRuntime = {
    browser: { runtime: { getManifest: () => ({ version: VERSION }) } },
  };
  if (resolveAppVersion(browserRuntime) !== VERSION) {
    throw new Error('Firefox runtime version resolution drifted');
  }

  const userscriptRuntime = { __AUT_VERSION__: VERSION };
  if (resolveAppVersion(userscriptRuntime) !== VERSION) {
    throw new Error('userscript version injection resolution drifted');
  }

  const fallbackRuntime = {
    chrome: { runtime: { getManifest: () => { throw new Error('manifest unavailable'); } } },
    __AUT_VERSION__: VERSION,
  };
  if (resolveAppVersion(fallbackRuntime) !== VERSION) {
    throw new Error('version resolution fallback drifted');
  }
}
