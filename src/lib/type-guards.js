// @ts-check

/** @typedef {import('../types.js').HistorySample} HistorySample */
/** @typedef {import('../types.js').QuotaBucket} QuotaBucket */
/** @typedef {import('../types.js').TrackerState} TrackerState */

/** @param {unknown} value @returns {value is HistorySample} */
export function isHistorySample(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = /** @type {{ts?: unknown, bucketId?: unknown, percentUsed?: unknown}} */ (value);
  return Number.isFinite(Number(candidate.ts))
    && typeof candidate.bucketId === 'string'
    && Number.isFinite(Number(candidate.percentUsed));
}

/** @param {unknown} value @returns {value is QuotaBucket} */
export function isQuotaBucket(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = /** @type {{id?: unknown, label?: unknown, percentUsed?: unknown, resetISO?: unknown}} */ (value);
  return typeof candidate.id === 'string'
    && typeof candidate.label === 'string'
    && Number.isFinite(Number(candidate.percentUsed))
    && (candidate.resetISO == null || typeof candidate.resetISO === 'string');
}

/** @param {unknown} value @returns {value is TrackerState} */
export function isTrackerState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = /** @type {{snapshot?: unknown}} */ (value);
  if (!candidate.snapshot || typeof candidate.snapshot !== 'object' || Array.isArray(candidate.snapshot)) return false;
  const snapshot = /** @type {{providers?: unknown}} */ (candidate.snapshot);
  return !!snapshot.providers && typeof snapshot.providers === 'object' && !Array.isArray(snapshot.providers);
}

/** @param {unknown} value */
export function assertTrackerState(value) {
  if (!isTrackerState(value)) throw new TypeError('Invalid tracker state shape');
}
