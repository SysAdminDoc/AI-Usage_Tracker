import assert from 'node:assert/strict';
import {
  HISTORY_ARCHIVE_MAX_BYTES,
  HISTORY_ARCHIVE_MAX_SAMPLES,
  HISTORY_ARCHIVE_SCHEMA,
  HISTORY_ARCHIVE_VERSION,
  archiveByteSize,
  createHistoryArchive,
  historyArchiveStats,
  mergeHistoryArchives,
  parseHistoryArchive,
} from '../src/lib/history-archive.js';

const now = new Date('2026-08-09T12:00:00.000Z');
const hour = 60 * 60 * 1000;
const samples = Array.from({ length: 20 }, (_, index) => ({
  ts: now.getTime() - (19 - index) * hour,
  bucketId: index % 2 ? 'codex-weekly-all' : 'claude-session',
  percentUsed: index * 4,
}));

const archive = createHistoryArchive(samples, { now, channel: 'extension' });
assert.equal(archive.schema, HISTORY_ARCHIVE_SCHEMA);
assert.equal(archive.schemaVersion, HISTORY_ARCHIVE_VERSION);
assert.equal(archive.source.redacted, true);
assert.equal(archive.source.channel, 'extension');
assert.equal(archive.freshness.sampleCount, samples.length);
assert.equal(archive.freshness.bucketCount, 2);
assert.ok(archiveByteSize(archive) <= HISTORY_ARCHIVE_MAX_BYTES);
assert.deepEqual(parseHistoryArchive(JSON.stringify(archive)), archive, 'archive JSON should round-trip');
assert.deepEqual(historyArchiveStats(archive), {
  sampleCount: 20,
  bucketCount: 2,
  oldestISO: archive.freshness.oldestISO,
  newestISO: archive.freshness.newestISO,
  byteCount: archiveByteSize(archive),
  maxBytes: HISTORY_ARCHIVE_MAX_BYTES,
});

const compactA = createHistoryArchive(samples, { now, channel: 'extension' });
const compactB = createHistoryArchive([...samples].reverse(), { now, channel: 'extension' });
assert.deepEqual(compactA, compactB, 'archive compaction should be deterministic');

const malformed = structuredClone(archive);
malformed.samples[0].percentUsed = 101;
assert.throws(() => parseHistoryArchive(malformed), /sample 1 is invalid/);

const wrongSampleType = structuredClone(archive);
wrongSampleType.samples[0].ts = String(wrongSampleType.samples[0].ts);
assert.throws(() => parseHistoryArchive(wrongSampleType), /sample 1 is invalid/);

const wrongDateType = structuredClone(archive);
wrongDateType.exportedAtISO = '2026-08-09';
assert.throws(() => parseHistoryArchive(wrongDateType), /exportedAtISO is invalid/);

const secretField = structuredClone(archive);
secretField.samples[0].credential = 'must-not-enter-archive';
assert.throws(() => parseHistoryArchive(secretField), /duplicate|invalid/);

const extraState = structuredClone(archive);
extraState.settings = { apiCredential: 'must-not-enter-archive' };
assert.throws(() => parseHistoryArchive(extraState), /unsupported or missing fields/);

const oversized = ' '.repeat(HISTORY_ARCHIVE_MAX_BYTES + 1);
assert.throws(() => parseHistoryArchive(oversized), /byte safety limit/);

const manySamples = Array.from({ length: HISTORY_ARCHIVE_MAX_SAMPLES + 1 }, (_, index) => ({
  ts: now.getTime() - index,
  bucketId: 'too-many',
  percentUsed: index % 100,
}));
const bounded = createHistoryArchive(manySamples, { now, channel: 'extension' });
assert.ok(bounded.samples.length <= HISTORY_ARCHIVE_MAX_SAMPLES);
assert.ok(archiveByteSize(bounded) <= HISTORY_ARCHIVE_MAX_BYTES);

const merged = mergeHistoryArchives(archive, createHistoryArchive([
  { ts: now.getTime() + hour, bucketId: 'claude-session', percentUsed: 90 },
], { now, channel: 'userscript' }), { now });
assert.equal(merged.source.channel, 'merged');
assert.ok(merged.samples.some((sample) => sample.percentUsed === 90));
assert.ok(merged.samples.length >= archive.samples.length);

const previousChrome = globalThis.chrome;
const store = new Map([['aut.api-credentials.v1.profile.default', { 'anthropic-api': 'live-secret' }]]);
globalThis.chrome = {
  extension: { inIncognitoContext: false },
  runtime: { id: 'archive-test-extension', lastError: null },
  storage: {
    local: {
      get(key, callback) {
        callback({ [key]: store.get(key) });
      },
      set(values, callback) {
        for (const [key, value] of Object.entries(values)) store.set(key, value);
        callback();
      },
      remove(key, callback) {
        store.delete(key);
        callback();
      },
    },
  },
};

try {
  const storage = await import('../src/lib/storage.js?history-archive-boundary');
  const saved = await storage.saveHistoryArchive(archive);
  assert.deepEqual(saved, archive);
  assert.deepEqual(await storage.loadHistoryArchive(), archive);
  assert.deepEqual(store.get('aut.api-credentials.v1.profile.default'), { 'anthropic-api': 'live-secret' });
  assert.ok(store.has(storage.profileHistoryArchiveStorageKey('default')));

  const state = storage.defaultState();
  await storage.saveState(state);
  const savedState = store.get(storage.profileStateStorageKey('default'));
  assert.equal(Object.prototype.hasOwnProperty.call(savedState, 'historyArchive'), false);
  assert.deepEqual(await storage.loadHistoryArchive(), archive);

  await storage.clearHistoryArchive();
  assert.equal(await storage.loadHistoryArchive(), null);
  console.log('history archive schema, compaction, redaction, and storage boundary: OK');
} finally {
  if (previousChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = previousChrome;
}
