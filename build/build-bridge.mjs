// Build the optional native-messaging channel. Default packages intentionally
// omit the nativeMessaging permission; this profile adds it explicitly.
import path from 'node:path';

import { buildExtension } from './build-extension.mjs';
import { zipDir } from './build-extension.mjs';
import { ROOT, DIST, VERSION, clean, copyFile, ensureDir } from './common.mjs';

await clean(DIST);
await buildExtension({ target: 'chrome', bridge: true });
await buildExtension({ target: 'firefox', bridge: true });

const nativeSource = path.join(ROOT, 'native');
const nativeStage = path.join(DIST, 'native-scheduler');
await clean(nativeStage);
await ensureDir(nativeStage);
await copyFile(path.join(nativeSource, 'ai_usage_tracker_scheduler.py'), path.join(nativeStage, 'ai_usage_tracker_scheduler.py'));
await copyFile(path.join(nativeSource, 'register_scheduler_host.py'), path.join(nativeStage, 'register_scheduler_host.py'));
await copyFile(path.join(nativeSource, 'build_scheduler_host.ps1'), path.join(nativeStage, 'build_scheduler_host.ps1'));
await zipDir(nativeStage, path.join(DIST, `AI-Usage-Tracker-native-scheduler-v${VERSION}.zip`));

console.log('\n[build] Optional bridge targets and native scheduler bundle built.');
