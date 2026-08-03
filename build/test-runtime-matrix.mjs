import { validateRuntimeMatrix, RUNTIME_MATRIX } from './runtime-matrix.mjs';

await validateRuntimeMatrix();
if (RUNTIME_MATRIX.chrome.minimum !== '114' || RUNTIME_MATRIX.firefox.minimum !== '115') {
  throw new Error('unexpected runtime floor');
}
console.log('runtime matrix smoke: OK');
