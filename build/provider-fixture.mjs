import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROVIDER_PLUGIN_API_VERSION,
  validateProviderMeta,
} from '../src/providers/plugin-api.js';

export const PROVIDER_FIXTURE_SCHEMA = 'ai-usage-tracker.provider-fixture';
export const PROVIDER_FIXTURE_VERSION = 1;
export const MAX_PROVIDER_FIXTURE_BYTES = 512 * 1024;

const MAX_DEPTH = 8;
const MAX_NODES = 4_000;
const MAX_BUCKETS = 256;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,159}$/;
const SECRET_KEY = /(api[-_]?key|access[-_]?token|authorization|cookie|password|secret|credential|prompt|message[-_]?content)/i;
const SECRET_VALUE = /(?:\b(?:sk|ghp|ya29)[-_][a-z0-9._-]{6,}|bearer\s+[a-z0-9._-]{8,}|-----begin\s+(?:private\s+)?key)/i;

/**
 * Validate a local, redacted fixture without importing provider code or
 * performing network access.
 *
 * @param {unknown} fixture
 * @returns {{ ok: true, fixture: object } | { ok: false, errors: string[] }}
 */
export function validateProviderFixture(fixture) {
  const errors = [];
  if (!isRecord(fixture)) return invalid(['fixture must be an object']);
  if (fixture.schema !== PROVIDER_FIXTURE_SCHEMA) {
    errors.push('fixture.schema must be ' + PROVIDER_FIXTURE_SCHEMA);
  }
  if (fixture.schemaVersion !== PROVIDER_FIXTURE_VERSION) {
    errors.push('fixture.schemaVersion must be ' + PROVIDER_FIXTURE_VERSION);
  }

  const descriptor = fixture.provider;
  if (!isRecord(descriptor)) {
    errors.push('fixture.provider must be an object');
  } else {
    if (typeof descriptor.id !== 'string' || !SAFE_ID.test(descriptor.id)) {
      errors.push('fixture.provider.id must be a lowercase hyphenated identifier');
    }
    if (descriptor.apiVersion !== PROVIDER_PLUGIN_API_VERSION) {
      errors.push('fixture.provider.apiVersion must be ' + PROVIDER_PLUGIN_API_VERSION);
    }
    const metadata = validateProviderMeta(descriptor.meta);
    if (!metadata.ok) errors.push('fixture.provider.meta: ' + metadata.errorCode);
  }

  if (!isRecord(fixture.payload) && !Array.isArray(fixture.payload)) {
    errors.push('fixture.payload must be an object or array');
  } else {
    validateSafeValue(fixture.payload, 'fixture.payload', errors);
  }

  validateSnapshot(fixture.snapshot, descriptor?.id, errors);
  return errors.length ? invalid(errors) : { ok: true, fixture };
}

/**
 * Read and validate one fixture file. The size limit is checked before JSON
 * parsing so malformed or oversized files remain bounded.
 *
 * @param {string} filePath
 */
export async function readProviderFixture(filePath) {
  const absolute = path.resolve(filePath);
  const raw = await fs.readFile(absolute);
  if (raw.byteLength > MAX_PROVIDER_FIXTURE_BYTES) {
    throw new Error(filePath + ': fixture exceeds ' + MAX_PROVIDER_FIXTURE_BYTES + ' bytes');
  }
  let fixture;
  try {
    fixture = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error(filePath + ': fixture is not valid JSON');
  }
  const result = validateProviderFixture(fixture);
  if (!result.ok) throw new Error(filePath + ':\n- ' + result.errors.join('\n- '));
  return result.fixture;
}

function validateSnapshot(snapshot, providerId, errors) {
  if (!isRecord(snapshot)) {
    errors.push('fixture.snapshot must be an object');
    return;
  }
  if (snapshot.ok !== true) errors.push('fixture.snapshot.ok must be true');
  if (snapshot.provider !== providerId) errors.push('fixture.snapshot.provider must match fixture.provider.id');
  if (typeof snapshot.source !== 'string' || !snapshot.source.trim()) {
    errors.push('fixture.snapshot.source must be a non-empty string');
  }
  if (!Number.isInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1) {
    errors.push('fixture.snapshot.schemaVersion must be a positive integer');
  }
  if (typeof snapshot.schemaFingerprint !== 'string' || snapshot.schemaFingerprint.length > 240) {
    errors.push('fixture.snapshot.schemaFingerprint must be a bounded string');
  }
  if (!Array.isArray(snapshot.buckets) || snapshot.buckets.length < 1 || snapshot.buckets.length > MAX_BUCKETS) {
    errors.push('fixture.snapshot.buckets must contain 1-' + MAX_BUCKETS + ' entries');
  } else {
    snapshot.buckets.forEach((bucket, index) => validateBucket(bucket, 'fixture.snapshot.buckets[' + index + ']', errors));
  }
  if (snapshot.range != null) {
    if (!isRecord(snapshot.range)) errors.push('fixture.snapshot.range must be an object');
    else {
      for (const field of ['startISO', 'endISO']) {
        if (snapshot.range[field] != null && !validISO(snapshot.range[field])) {
          errors.push('fixture.snapshot.range.' + field + ' must be an ISO date');
        }
      }
    }
  }
  validateSafeValue(snapshot, 'fixture.snapshot', errors);
}

function validateBucket(bucket, pathLabel, errors) {
  if (!isRecord(bucket)) {
    errors.push(pathLabel + ' must be an object');
    return;
  }
  if (typeof bucket.id !== 'string' || !SAFE_ID.test(bucket.id)) {
    errors.push(pathLabel + '.id must be a lowercase hyphenated identifier');
  }
  if (typeof bucket.label !== 'string' || !bounded(bucket.label, 240)) {
    errors.push(pathLabel + '.label must be a bounded string');
  }
  if (typeof bucket.kind !== 'string' || !bounded(bucket.kind, 64)) {
    errors.push(pathLabel + '.kind must be a bounded string');
  }
  if (bucket.model != null && (typeof bucket.model !== 'string' || !bounded(bucket.model, 160))) {
    errors.push(pathLabel + '.model must be null or a bounded string');
  }
  if (!Number.isFinite(Number(bucket.percentUsed))
    || Number(bucket.percentUsed) < 0
    || Number(bucket.percentUsed) > 100) {
    errors.push(pathLabel + '.percentUsed must be between 0 and 100');
  }
  if (bucket.resetISO != null && !validISO(bucket.resetISO)) {
    errors.push(pathLabel + '.resetISO must be null or an ISO date');
  }
  if (bucket.rawResetText != null && (typeof bucket.rawResetText !== 'string' || !bounded(bucket.rawResetText, 240))) {
    errors.push(pathLabel + '.rawResetText must be null or a bounded string');
  }
  if (!isRecord(bucket.metric)) errors.push(pathLabel + '.metric must be an object');
  if (bucket.dimensions != null && !isRecord(bucket.dimensions)) {
    errors.push(pathLabel + '.dimensions must be an object when present');
  }
}

function validateSafeValue(value, pathLabel, errors, depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > MAX_NODES) {
    errors.push(pathLabel + ' exceeds the ' + MAX_NODES + '-node fixture limit');
    return;
  }
  if (depth > MAX_DEPTH) {
    errors.push(pathLabel + ' exceeds the ' + MAX_DEPTH + '-level fixture depth limit');
    return;
  }
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) errors.push(pathLabel + ' contains a secret-like value');
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) errors.push(pathLabel + '.' + key + ' must be redacted');
    validateSafeValue(child, pathLabel + '.' + key, errors, depth + 1, state);
  }
}

function validISO(value) {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function bounded(value, max) {
  return String(value).trim().length > 0 && String(value).trim().length <= max;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function invalid(errors) {
  return { ok: false, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) files.push(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'provider-sample.json'));
  for (const file of files) {
    await readProviderFixture(file);
    console.log('provider fixture valid: ' + file);
  }
}
