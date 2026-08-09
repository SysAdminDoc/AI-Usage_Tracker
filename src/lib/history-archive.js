// Explicit long-horizon history archive boundary. Archive data is separate
// from operational TrackerState history and contains only bounded samples.

export const HISTORY_ARCHIVE_SCHEMA = 'ai-usage-tracker.history-archive';
export const HISTORY_ARCHIVE_VERSION = 1;
export const HISTORY_ARCHIVE_MAX_SAMPLES = 25_000;
export const HISTORY_ARCHIVE_MAX_BYTES = 2 * 1024 * 1024;
export const HISTORY_ARCHIVE_MAX_BUCKET_ID_LENGTH = 128;
export const HISTORY_ARCHIVE_CHANNELS = Object.freeze(['extension', 'userscript', 'merged', 'unknown']);
export const HISTORY_ARCHIVE_SAMPLE_FRESHNESS = Object.freeze(['fresh', 'stale', 'unknown']);

const ARCHIVE_FIELDS = Object.freeze(['schema', 'schemaVersion', 'exportedAtISO', 'source', 'freshness', 'samples']);
const SOURCE_FIELDS = Object.freeze(['kind', 'channel', 'redacted']);
const FRESHNESS_FIELDS = Object.freeze(['oldestISO', 'newestISO', 'ageMs', 'coverageDays', 'sampleCount', 'bucketCount']);
const SAMPLE_FIELDS = Object.freeze(['ts', 'bucketId', 'percentUsed', 'provider', 'source', 'freshness']);
const MAX_SAMPLES_PER_BUCKET = 2_000;

/** @typedef {{ts: number, bucketId: string, percentUsed: number, provider?: string, source?: string, freshness?: string}} ArchiveSample */
/** @typedef {{kind: 'local-history', channel: string, redacted: true}} ArchiveSource */
/** @typedef {{oldestISO: string|null, newestISO: string|null, ageMs: number|null, coverageDays: number, sampleCount: number, bucketCount: number}} ArchiveFreshness */
/** @typedef {{schema: string, schemaVersion: number, exportedAtISO: string, source: ArchiveSource, freshness: ArchiveFreshness, samples: ArchiveSample[]}} HistoryArchive */

/**
 * Build a canonical archive from operational samples. Invalid operational
 * samples are ignored because the live state boundary already owns repair;
 * imported files use the strict parser below.
 * @param {unknown[]} [history=[]]
 * @param {{now?: Date|string|number, channel?: string}} [options={}]
 * @returns {HistoryArchive}
 */
export function createHistoryArchive(history = [], {
  now = new Date(),
  channel = 'unknown',
} = {}) {
  const exportedAtISO = toISO(now);
  if (!exportedAtISO) throw new Error('Archive export time is invalid');
  const samples = compactHistoryArchive(history, {
    maxSamples: HISTORY_ARCHIVE_MAX_SAMPLES,
    maxBytes: HISTORY_ARCHIVE_MAX_BYTES,
  });
  const source = /** @type {ArchiveSource} */ ({
    kind: 'local-history',
    channel: normalizeChannel(channel),
    redacted: true,
  });
  return fitArchiveBudget(assembleArchive(samples, { exportedAtISO, source }), {
    maxBytes: HISTORY_ARCHIVE_MAX_BYTES,
  });
}

/**
 * Parse an archive from an object or JSON string. This is intentionally
 * strict: malformed, secret-bearing, oversized, or schema-mismatched files
 * are rejected before any storage write can occur.
 * @param {unknown} input
 * @returns {HistoryArchive}
 */
export function parseHistoryArchive(input) {
  const raw = parseArchiveInput(input);
  assertExactKeys(raw, ARCHIVE_FIELDS, 'archive');
  if (raw.schema !== HISTORY_ARCHIVE_SCHEMA) throw new Error('Unsupported history archive schema');
  if (raw.schemaVersion !== HISTORY_ARCHIVE_VERSION) throw new Error('Unsupported history archive version');
  if (!validISO(raw.exportedAtISO)) throw new Error('History archive exportedAtISO is invalid');

  validateSource(raw.source);
  validateFreshness(raw.freshness);
  if (!Array.isArray(raw.samples)) throw new Error('History archive samples must be an array');
  if (raw.samples.length > HISTORY_ARCHIVE_MAX_SAMPLES) {
    throw new Error('History archive exceeds the sample safety limit');
  }
  const samples = normalizeArchiveSamples(raw.samples, { strict: true });
  if (samples.length !== raw.samples.length) throw new Error('History archive contains duplicate samples');

  const expected = assembleArchive(samples, {
    exportedAtISO: /** @type {string} */ (raw.exportedAtISO),
    source: /** @type {ArchiveSource} */ (raw.source),
  });
  if (JSON.stringify(expected.freshness) !== JSON.stringify(raw.freshness)) {
    throw new Error('History archive freshness metadata does not match its samples');
  }
  if (archiveByteSize(expected) > HISTORY_ARCHIVE_MAX_BYTES) {
    throw new Error('History archive exceeds the byte safety limit');
  }
  return expected;
}

/**
 * Merge two already validated archives. Only archive samples are combined;
 * settings, snapshots, credentials, notification ledgers, and budgets have
 * no representation in this function or its return value.
 * @param {unknown|null} current
 * @param {unknown} incoming
 * @param {{now?: Date|string|number}} [options={}]
 * @returns {HistoryArchive}
 */
export function mergeHistoryArchives(current, incoming, {
  now = new Date(),
} = {}) {
  const left = current == null ? null : parseHistoryArchive(current);
  const right = parseHistoryArchive(incoming);
  const samples = [...(left?.samples || []), ...right.samples];
  return createHistoryArchive(samples, { now, channel: 'merged' });
}

/**
 * Deterministically compact archive samples while retaining each bucket's
 * first and last point whenever the global sample budget permits.
 * @param {unknown[]} [samples=[]]
 * @param {{maxSamples?: number, maxBytes?: number, maxSamplesPerBucket?: number}} [options={}]
 * @returns {ArchiveSample[]}
 */
export function compactHistoryArchive(samples = [], {
  maxSamples = HISTORY_ARCHIVE_MAX_SAMPLES,
  maxBytes = HISTORY_ARCHIVE_MAX_BYTES,
  maxSamplesPerBucket = MAX_SAMPLES_PER_BUCKET,
} = {}) {
  const sampleLimit = boundedLimit(maxSamples, HISTORY_ARCHIVE_MAX_SAMPLES);
  const byteLimit = boundedLimit(maxBytes, HISTORY_ARCHIVE_MAX_BYTES);
  const perBucketLimit = boundedLimit(maxSamplesPerBucket, MAX_SAMPLES_PER_BUCKET);
  const grouped = /** @type {Map<string, ArchiveSample[]>} */ (new Map());
  for (const sample of normalizeArchiveSamples(samples, { strict: false })) {
    const bucketSamples = grouped.get(sample.bucketId);
    if (bucketSamples) bucketSamples.push(sample);
    else grouped.set(sample.bucketId, [sample]);
  }

  let compacted = [];
  for (const bucketSamples of grouped.values()) {
    compacted.push(...selectEvenly(bucketSamples, perBucketLimit));
  }
  compacted = trimArchiveSamples(compacted, sampleLimit, byteLimit);
  return compacted.sort(compareSamples);
}

/** @param {unknown} value @returns {number} */
export function archiveByteSize(value) {
  try {
    const text = JSON.stringify(value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
    return text.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** @param {unknown} archive @returns {{sampleCount: number, bucketCount: number, oldestISO: string|null, newestISO: string|null, byteCount: number, maxBytes: number}} */
export function historyArchiveStats(archive) {
  const parsed = parseHistoryArchive(archive);
  return {
    sampleCount: parsed.freshness.sampleCount,
    bucketCount: parsed.freshness.bucketCount,
    oldestISO: parsed.freshness.oldestISO,
    newestISO: parsed.freshness.newestISO,
    byteCount: archiveByteSize(parsed),
    maxBytes: HISTORY_ARCHIVE_MAX_BYTES,
  };
}

/** @param {HistoryArchive} archive @param {{maxBytes: number}} options @returns {HistoryArchive} */
function fitArchiveBudget(archive, { maxBytes }) {
  let samples = [...archive.samples];
  while (archiveByteSize(assembleArchive(samples, archive)) > maxBytes && samples.length > 0) {
    const next = trimArchiveSamples(samples, samples.length - 1, 0);
    if (next.length >= samples.length) break;
    samples = next;
  }
  const fitted = assembleArchive(samples, archive);
  if (archiveByteSize(fitted) > maxBytes) throw new Error('History archive metadata exceeds the byte safety limit');
  return fitted;
}

/** @param {ArchiveSample[]} samples @param {number} sampleLimit @param {number} byteLimit @returns {ArchiveSample[]} */
function trimArchiveSamples(samples, sampleLimit, byteLimit) {
  let result = [...samples].sort(compareSamples);
  const limit = Math.max(1, Math.floor(sampleLimit));
  while (result.length > limit || (byteLimit > 0 && archiveByteSize(result) > byteLimit)) {
    if (result.length <= 1) break;
    const protectedIndexes = endpointIndexes(result);
    const candidates = result
      .map((sample, index) => ({ sample, index }))
      .filter(({ index }) => !protectedIndexes.has(index))
      .sort((a, b) => {
        const redundant = Number(isRedundant(result, b.index)) - Number(isRedundant(result, a.index));
        return redundant || compareSamples(a.sample, b.sample) || a.index - b.index;
      });
    const remove = candidates[0]?.index;
    if (remove == null) {
      // More buckets than the global limit: keep the newest deterministic
      // points rather than allowing the archive to exceed its hard bound.
      result = result
        .sort((a, b) => b.ts - a.ts || a.bucketId.localeCompare(b.bucketId))
        .slice(0, Math.max(1, limit))
        .sort(compareSamples);
      continue;
    }
    result.splice(remove, 1);
  }
  return result;
}

/** @param {ArchiveSample[]} samples @param {number} limit @returns {ArchiveSample[]} */
function selectEvenly(samples, limit) {
  const sorted = [...samples].sort(compareSamples);
  if (sorted.length <= limit) return sorted;
  if (limit <= 2) return /** @type {ArchiveSample[]} */ ([sorted[0], sorted.at(-1)].slice(0, limit));
  const step = (sorted.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => /** @type {ArchiveSample} */ (sorted[Math.round(index * step)]));
}

/** @param {ArchiveSample[]} samples @returns {Set<number>} */
function endpointIndexes(samples) {
  const indexes = new Set();
  const byBucket = /** @type {Map<string, number[]>} */ (new Map());
  samples.forEach((sample, index) => {
    const bucketIndexes = byBucket.get(sample.bucketId);
    if (bucketIndexes) bucketIndexes.push(index);
    else byBucket.set(sample.bucketId, [index]);
  });
  for (const bucketIndexes of byBucket.values()) {
    indexes.add(bucketIndexes[0]);
    indexes.add(bucketIndexes.at(-1));
  }
  return indexes;
}

/** @param {ArchiveSample[]} samples @param {number} index @returns {boolean} */
function isRedundant(samples, index) {
  const current = samples[index];
  const previous = samples[index - 1];
  const next = samples[index + 1];
  return previous?.bucketId === current.bucketId
    && next?.bucketId === current.bucketId
    && previous.percentUsed === current.percentUsed
    && next.percentUsed === current.percentUsed;
}

/** @param {unknown[]} samples @param {{strict: boolean}} options @returns {ArchiveSample[]} */
function normalizeArchiveSamples(samples, { strict }) {
  const normalized = [];
  for (const [index, sample] of samples.entries()) {
    const parsed = normalizeArchiveSample(sample, { strict });
    if (!parsed) {
      if (strict) throw new Error('History archive sample ' + (index + 1) + ' is invalid');
      continue;
    }
    normalized.push(parsed);
  }
  normalized.sort(compareSamples);
  const deduped = [];
  let previousKey = null;
  for (const sample of normalized) {
    const key = sample.ts + '\u0000' + sample.bucketId;
    if (key === previousKey) {
      if (strict) throw new Error('History archive contains duplicate samples');
      continue;
    }
    deduped.push(sample);
    previousKey = key;
  }
  return deduped;
}

/** @param {unknown} sample @param {{strict?: boolean}} [options={}] @returns {ArchiveSample|null} */
function normalizeArchiveSample(sample, { strict = false } = {}) {
  if (!isRecord(sample)) return null;
  if (strict && (typeof sample.ts !== 'number'
      || typeof sample.bucketId !== 'string'
      || typeof sample.percentUsed !== 'number')) return null;
  const ts = Number(sample.ts);
  const bucketId = typeof sample.bucketId === 'string' ? sample.bucketId.trim() : '';
  const percentUsed = Number(sample.percentUsed);
  if (!Number.isSafeInteger(ts) || ts <= 0
    || !bucketId || bucketId.length > HISTORY_ARCHIVE_MAX_BUCKET_ID_LENGTH
    || /[\u0000-\u001f\u007f]/.test(bucketId)
    || !Number.isFinite(percentUsed) || percentUsed < 0 || percentUsed > 100) return null;
  const out = /** @type {ArchiveSample} */ ({ ts, bucketId, percentUsed });
  if (sample.provider != null) {
    if (strict && typeof sample.provider !== 'string') return null;
    const provider = String(sample.provider).trim();
    if (!boundedToken(provider, 64)) return null;
    out.provider = provider;
  }
  if (sample.source != null) {
    if (strict && typeof sample.source !== 'string') return null;
    const source = String(sample.source).trim();
    if (!boundedToken(source, 64)) return null;
    out.source = source;
  }
  if (sample.freshness != null) {
    if (strict && typeof sample.freshness !== 'string') return null;
    const freshness = String(sample.freshness);
    if (!HISTORY_ARCHIVE_SAMPLE_FRESHNESS.includes(freshness)) return null;
    out.freshness = freshness;
  }
  if (Object.keys(sample).some((key) => !SAMPLE_FIELDS.includes(key))) return null;
  return out;
}

/** @param {ArchiveSample[]} samples @param {{exportedAtISO: string, source: ArchiveSource}} options @returns {HistoryArchive} */
function assembleArchive(samples, { exportedAtISO, source }) {
  const sorted = [...samples].sort(compareSamples);
  return {
    schema: HISTORY_ARCHIVE_SCHEMA,
    schemaVersion: HISTORY_ARCHIVE_VERSION,
    exportedAtISO,
    source: {
      kind: 'local-history',
      channel: normalizeChannel(source?.channel),
      redacted: true,
    },
    freshness: computeFreshness(sorted, exportedAtISO),
    samples: sorted,
  };
}

/** @param {ArchiveSample[]} samples @param {string} exportedAtISO @returns {ArchiveFreshness} */
function computeFreshness(samples, exportedAtISO) {
  const oldest = samples[0]?.ts ?? null;
  const newest = samples.at(-1)?.ts ?? null;
  const exportedTs = new Date(exportedAtISO).getTime();
  return {
    oldestISO: oldest == null ? null : new Date(oldest).toISOString(),
    newestISO: newest == null ? null : new Date(newest).toISOString(),
    ageMs: newest == null ? null : Math.max(0, exportedTs - newest),
    coverageDays: oldest == null || newest == null ? 0 : Number(((newest - oldest) / 86_400_000).toFixed(3)),
    sampleCount: samples.length,
    bucketCount: new Set(samples.map((sample) => sample.bucketId)).size,
  };
}

/** @param {unknown} input @returns {Record<string, unknown>} */
function parseArchiveInput(input) {
  let value = input;
  if (typeof value === 'string') {
    if (encodedByteLength(value) > HISTORY_ARCHIVE_MAX_BYTES) {
      throw new Error('History archive exceeds the byte safety limit');
    }
    try { value = JSON.parse(value); } catch { throw new Error('History archive is not valid JSON'); }
  } else if (archiveByteSize(value) > HISTORY_ARCHIVE_MAX_BYTES) {
    throw new Error('History archive exceeds the byte safety limit');
  }
  if (!isRecord(value)) throw new Error('History archive must be a JSON object');
  return value;
}

/** @param {unknown} source @returns {source is ArchiveSource} */
function validateSource(source) {
  if (!isRecord(source)) throw new Error('History archive source metadata is invalid');
  assertExactKeys(source, SOURCE_FIELDS, 'archive.source');
  const candidate = /** @type {{kind?: unknown, channel?: unknown, redacted?: unknown}} */ (source);
  if (candidate.kind !== 'local-history'
      || typeof candidate.channel !== 'string'
      || !HISTORY_ARCHIVE_CHANNELS.includes(candidate.channel)
      || candidate.redacted !== true) {
    throw new Error('History archive source metadata is unsupported');
  }
  return true;
}

/** @param {unknown} freshness @returns {freshness is ArchiveFreshness} */
function validateFreshness(freshness) {
  if (!isRecord(freshness)) throw new Error('History archive freshness metadata is invalid');
  assertExactKeys(freshness, FRESHNESS_FIELDS, 'archive.freshness');
  const candidate = /** @type {{oldestISO?: unknown, newestISO?: unknown, ageMs?: unknown, coverageDays?: unknown, sampleCount?: unknown, bucketCount?: unknown}} */ (freshness);
  if (candidate.oldestISO != null && !validISO(candidate.oldestISO)) throw new Error('History archive oldestISO is invalid');
  if (candidate.newestISO != null && !validISO(candidate.newestISO)) throw new Error('History archive newestISO is invalid');
  if (candidate.ageMs != null && (!Number.isFinite(Number(candidate.ageMs)) || Number(candidate.ageMs) < 0)) throw new Error('History archive ageMs is invalid');
  if (!Number.isFinite(Number(candidate.coverageDays)) || Number(candidate.coverageDays) < 0) throw new Error('History archive coverageDays is invalid');
  if (!Number.isSafeInteger(Number(candidate.sampleCount)) || Number(candidate.sampleCount) < 0) throw new Error('History archive sampleCount is invalid');
  if (!Number.isSafeInteger(Number(candidate.bucketCount)) || Number(candidate.bucketCount) < 0) throw new Error('History archive bucketCount is invalid');
  return true;
}

/** @param {Record<string, unknown>} value @param {readonly string[]} allowed @param {string} label */
function assertExactKeys(value, allowed, label) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || allowed.some((key) => !keys.includes(key))) {
    throw new Error(label + ' contains unsupported or missing fields');
  }
}

/** @param {ArchiveSample} a @param {ArchiveSample} b @returns {number} */
function compareSamples(a, b) {
  return a.ts - b.ts
    || a.bucketId.localeCompare(b.bucketId)
    || a.percentUsed - b.percentUsed
    || String(a.provider || '').localeCompare(String(b.provider || ''))
    || String(a.source || '').localeCompare(String(b.source || ''))
    || String(a.freshness || '').localeCompare(String(b.freshness || ''));
}

/** @param {unknown} value @param {number} fallback @returns {number} */
function boundedLimit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.floor(number));
}

/** @param {unknown} value @returns {string} */
function normalizeChannel(value) {
  return HISTORY_ARCHIVE_CHANNELS.includes(String(value)) ? String(value) : 'unknown';
}

/** @param {unknown} value @param {number} max @returns {boolean} */
function boundedToken(value, max) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= max
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value.trim());
}

/** @param {unknown} value @returns {boolean} */
function validISO(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(new Date(value).getTime());
}

/** @param {unknown} value @returns {string|null} */
function toISO(value) {
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' ? value : String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** @param {unknown} value @returns {number} */
function encodedByteLength(value) {
  const text = String(value ?? '');
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
  return text.length;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
