import { buildExtension } from './build-extension.mjs';
buildExtension({ target: 'firefox' }).catch((e) => { console.error(e); process.exit(1); });
