import { buildExtension } from './build-extension.mjs';
buildExtension({ target: 'chrome' }).catch((e) => { console.error(e); process.exit(1); });
