// Provider parser schema sentinels. These markers deliberately describe the
// contract surface, never the payload values. Unknown shapes fail closed so a
// provider change cannot silently turn missing windows into valid zeros.

export const PROVIDER_SCHEMA_VERSION = 1;

export function supportedSchema(provider, source, variant = 'default') {
  const id = schemaId(provider, source);
  const safeVariant = normalizeToken(variant) || 'default';
  return {
    schemaVersion: PROVIDER_SCHEMA_VERSION,
    schemaFingerprint: `${id}.v${PROVIDER_SCHEMA_VERSION}.${safeVariant}`,
  };
}

export function unsupportedSchema(provider, source, reason, observed = null, extra = {}) {
  return {
    ok: false,
    provider,
    source,
    buckets: [],
    error: 'unsupported-schema',
    errorCode: `${schemaId(provider, source)}.schema-unsupported`,
    ...schemaFailureFields(provider, source, reason, observed),
    ...extra,
  };
}

export function schemaFailureFields(provider, source, reason, observed = null) {
  const expected = supportedSchema(provider, source);
  return {
    schemaVersion: expected.schemaVersion,
    schemaFingerprint: shapeFingerprint(observed),
    schemaExpectedFingerprint: expected.schemaFingerprint,
    schemaReason: boundedReason(reason),
  };
}

export function shapeFingerprint(value) {
  return `shape-${fnv1a(shapeOf(value))}`;
}

export function isSchemaDrift(result) {
  return result?.error === 'unsupported-schema'
    || /\.schema-unsupported$/.test(String(result?.errorCode || ''))
    || result?.staleReason === 'schema-drift';
}

export function staleReasonFor(result) {
  if (result?.staleReason === 'source-disagreement'
    || /source-disagreement/.test(String(result?.errorCode || ''))) {
    return 'source-disagreement';
  }
  if (isSchemaDrift(result)) return 'schema-drift';
  return 'refresh-failed';
}

export function sourceDisagreement(provider, apiResult, pageResult) {
  return unsupportedSchema(provider, 'reconcile', 'web-api-disagreement', {
    api: {
      ok: apiResult?.ok === true,
      errorCode: apiResult?.errorCode || null,
      schemaFingerprint: apiResult?.schemaFingerprint || null,
    },
    page: {
      ok: pageResult?.ok === true,
      errorCode: pageResult?.errorCode || null,
      schemaFingerprint: pageResult?.schemaFingerprint || null,
    },
  }, {
    staleReason: 'source-disagreement',
    apiErrorCode: apiResult?.errorCode || null,
    pageSource: pageResult?.source || 'html',
  });
}

function schemaId(provider, source) {
  return `${normalizeToken(provider) || 'unknown'}.${normalizeToken(source) || 'unknown'}`;
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

function boundedReason(value) {
  return String(value || 'unsupported-schema').trim().slice(0, 120) || 'unsupported-schema';
}

function shapeOf(value, depth = 0, seen = new WeakSet()) {
  if (depth > 3) return typeof value;
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array[]';
    return `array[${shapeOf(value[0], depth + 1, seen)}]`;
  }
  if (typeof value !== 'object') return typeof value;
  if (seen.has(value)) return 'cycle';
  seen.add(value);
  const shape = Object.keys(value).sort().slice(0, 48).map((key) => (
    `${key.slice(0, 64)}:${shapeOf(value[key], depth + 1, seen)}`
  )).join(',');
  seen.delete(value);
  return `{${shape}}`;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
