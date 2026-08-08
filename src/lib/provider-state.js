import { staleReasonFor } from './schema-sentinel.js';

/**
 * Merge one provider result without allowing a failed or drifted refresh to
 * replace its last valid buckets. The caller owns persistence and retry
 * scheduling; this helper only owns provider freshness semantics.
 */
export function mergeProviderResult(previous, next, { now = new Date(), source = null } = {}) {
  const nowISO = now.toISOString();
  if (next?.ok) {
    return {
      ...next,
      lastSuccessISO: nowISO,
      lastSuccessSource: source || next.source || 'unknown',
      lastErrorISO: previous?.lastErrorISO || null,
      lastErrorDetail: previous?.lastErrorDetail || null,
      lastErrorCode: previous?.lastErrorCode || null,
      lastErrorSchemaVersion: previous?.lastErrorSchemaVersion || null,
      lastErrorSchemaFingerprint: previous?.lastErrorSchemaFingerprint || null,
      staleReason: null,
      stale: false,
    };
  }

  const failure = {
    lastErrorISO: nowISO,
    lastErrorDetail: next?.error || 'unknown',
    lastErrorCode: next?.errorCode || null,
    lastErrorSchemaVersion: next?.schemaVersion || null,
    lastErrorSchemaFingerprint: next?.schemaFingerprint || null,
    staleReason: staleReasonFor(next),
    stale: true,
  };
  if (previous?.ok) return { ...previous, ...failure };
  return { ...next, ...failure };
}
