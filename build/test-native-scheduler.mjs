import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  NATIVE_SCHEDULER_HOST,
  NATIVE_SCHEDULER_SCHEMA_VERSION,
  buildNativeSchedulerMessage,
  configureNativeScheduler,
  disconnectNativeScheduler,
  nativeSchedulerStatus,
} from '../src/lib/native-scheduler.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostPath = path.join(ROOT, 'native', 'ai_usage_tracker_scheduler.py');
const registerPath = path.join(ROOT, 'native', 'register_scheduler_host.py');

assert.equal(NATIVE_SCHEDULER_HOST, 'com.sysadmindoc.ai_usage_tracker.scheduler');
assert.equal(NATIVE_SCHEDULER_SCHEMA_VERSION, 1);
const schedule = buildNativeSchedulerMessage({
  refreshMinutes: 15,
  notificationAtISO: '2030-01-02T03:04:05.000Z',
});
assert.deepEqual(schedule, {
  kind: 'schedule',
  schemaVersion: 1,
  refreshMinutes: 15,
  notificationAtISO: '2030-01-02T03:04:05.000Z',
}, 'scheduler payload should contain only bounded schedule metadata');
assert.throws(() => buildNativeSchedulerMessage({ refreshMinutes: 0 }), /refreshMinutes/);

const nativeMessages = [];
let nativeMessageListener = null;
let nativeDisconnectListener = null;
let nativeWakeCount = 0;
const fakeNativePort = {
  postMessage(message) { nativeMessages.push(message); },
  disconnect() {},
  onMessage: { addListener(listener) { nativeMessageListener = listener; } },
  onDisconnect: { addListener(listener) { nativeDisconnectListener = listener; } },
};
globalThis.chrome = {
  runtime: {
    lastError: null,
    connectNative(host) {
      assert.equal(host, NATIVE_SCHEDULER_HOST);
      return fakeNativePort;
    },
  },
};
const nativeStatus = configureNativeScheduler({
  enabled: true,
  refreshMinutes: 5,
  notificationAtISO: '2030-01-02T03:04:05.000Z',
  onWake: () => { nativeWakeCount += 1; },
});
assert.equal(nativeStatus.connected, true);
assert.deepEqual(nativeMessages[0], {
  kind: 'schedule',
  schemaVersion: 1,
  refreshMinutes: 5,
  notificationAtISO: '2030-01-02T03:04:05.000Z',
});
assert.deepEqual(Object.keys(nativeMessages[0]).sort(), ['kind', 'notificationAtISO', 'refreshMinutes', 'schemaVersion']);
nativeMessageListener({ kind: 'wake', schemaVersion: 1, reason: 'refresh' });
assert.equal(nativeWakeCount, 1);
assert.equal(nativeSchedulerStatus().enabled, true);
assert.equal(typeof nativeDisconnectListener, 'function');
disconnectNativeScheduler();
assert.equal(nativeSchedulerStatus().connected, false);
delete globalThis.chrome;

const python = findPython();
if (!python) {
  console.log('native scheduler protocol smoke: skipped (Python 3 is not installed)');
} else {
  const registration = spawnSync(python.command, [...python.args, registerPath, '--dry-run', '--browser', 'all', '--host-path', hostPath], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(registration.status, 0, registration.stderr);
  const plan = JSON.parse(registration.stdout);
  assert.equal(plan.hostName, NATIVE_SCHEDULER_HOST);
  assert.equal(plan.entries.length, 4);
  assert.deepEqual(plan.entries.find((entry) => entry.browser === 'chrome').manifest.allowed_origins, [
    'chrome-extension://olkdpcileldmdemjbiklkhompnhkhjeh/',
  ]);
  assert.deepEqual(plan.entries.find((entry) => entry.browser === 'firefox').manifest.allowed_extensions, [
    'ai-usage-tracker@sysadmindoc.dev',
  ]);

  await protocolSmoke(python);
  console.log('native scheduler protocol smoke: OK');
}

function findPython() {
  const candidates = process.platform === 'win32'
    ? [{ command: 'python', args: [] }, { command: 'py', args: ['-3'] }]
    : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, '--version'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (result.status === 0) return candidate;
  }
  return null;
}

async function protocolSmoke(python) {
  const child = spawn(python.command, [...python.args, hostPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let buffer = Buffer.alloc(0);
  const frames = [];
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) break;
      const payload = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      const frame = JSON.parse(payload.toString('utf8'));
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(frame);
      else frames.push(frame);
    }
  });

  try {
    sendFrame(child, { kind: 'ping' });
    const pong = await nextFrame(frames, waiters);
    assert.equal(pong.kind, 'pong');
    assert.equal(pong.schemaVersion, 1);
    assert.match(pong.ts, /T/);

    sendFrame(child, {
      kind: 'schedule',
      schemaVersion: 1,
      refreshMinutes: 30,
      notificationAtISO: new Date(Date.now() + 250).toISOString(),
    });
    const scheduled = await nextFrame(frames, waiters);
    assert.equal(scheduled.kind, 'scheduled');
    assert.equal(scheduled.schemaVersion, 1);
    assert.equal(scheduled.refreshMinutes, 30);
    assert.match(scheduled.notificationAtISO, /T/);
    const wake = await nextFrame(frames, waiters, 2000);
    assert.equal(wake.kind, 'wake');
    assert.equal(wake.schemaVersion, 1);
    assert.equal(wake.reason, 'notification');

    sendFrame(child, { kind: 'schedule', schemaVersion: 1, refreshMinutes: 0, notificationAtISO: null });
    assert.deepEqual(await nextFrame(frames, waiters), {
      kind: 'error',
      schemaVersion: 1,
      detail: 'refresh-minutes-out-of-range',
    });
    child.stdin.end();
    await waitForExit(child);
  } catch (error) {
    child.kill();
    throw error;
  }
}

function sendFrame(child, message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  child.stdin.write(Buffer.concat([header, payload]));
}

function nextFrame(frames, waiters, timeoutMs = 3000) {
  if (frames.length) return Promise.resolve(frames.shift());
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject,
    };
    const timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error('timed out waiting for native scheduler frame'));
    }, timeoutMs);
    waiters.push(waiter);
  });
}

function waitForExit(child) {
  if (child.exitCode != null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}
