// Build the optional QuotaGlass bridge channel. Default packages intentionally
// omit the nativeMessaging permission; this profile adds it explicitly.
import { buildExtension } from './build-extension.mjs';
import { clean, DIST } from './common.mjs';

await clean(DIST);
await buildExtension({ target: 'chrome', bridge: true });
await buildExtension({ target: 'firefox', bridge: true });

console.log('\n[build] Optional bridge targets built.');
