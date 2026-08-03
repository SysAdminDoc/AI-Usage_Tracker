// Rolling history of bucket samples + simple burn-rate forecast.
// Storage is a flat array (timestamp + bucketId + percentUsed). Forecast
// is linear regression over the last `windowMs` of samples for one bucket.

export const DEFAULT_RETENTION_DAYS = 30;
export const HISTORY_RETENTION_OPTIONS = [7, 14, 30, 60, 90];

export function recordSnapshot(history, snapshot, {
  now = new Date(),
  retentionDays = DEFAULT_RETENTION_DAYS,
} = {}) {
  const ts = now.getTime();
  const next = pruneHistory(history, { now, retentionDays });
  for (const provider of Object.keys(snapshot.providers || {})) {
    const ps = snapshot.providers[provider];
    if (!ps || !ps.ok) continue;
    for (const bucket of ps.buckets) {
      // API providers expose token/cost metrics, not a bounded quota
      // percentage. Keep those metrics in the snapshot without creating
      // misleading burn-rate history samples.
      if (!bucket?.id || bucket.kind === 'api' || bucket.metric) continue;
      next.push({ ts, bucketId: bucket.id, percentUsed: clampPercent(bucket.percentUsed) });
    }
  }
  return next;
}

export function pruneHistory(history = [], { now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  const ts = now.getTime();
  const cutoff = ts - retentionMs(retentionDays);
  return history
    .filter((sample) => Number.isFinite(sample?.ts)
      && sample.ts >= cutoff
      && sample.ts <= ts
      && sample.bucketId)
    .map((sample) => ({
      ts: sample.ts,
      bucketId: String(sample.bucketId),
      percentUsed: clampPercent(sample.percentUsed),
    }));
}

export function compactHistory(history = [], {
  now = new Date(),
  retentionDays = DEFAULT_RETENTION_DAYS,
  maxSamplesPerBucket = 200,
} = {}) {
  const retained = pruneHistory(history, { now, retentionDays });
  const limit = Math.max(2, Math.floor(Number(maxSamplesPerBucket) || 200));
  const byBucket = new Map();
  for (const sample of retained) {
    if (!byBucket.has(sample.bucketId)) byBucket.set(sample.bucketId, []);
    byBucket.get(sample.bucketId).push(sample);
  }

  const compacted = [];
  for (const samples of byBucket.values()) {
    if (samples.length <= limit) {
      compacted.push(...samples);
      continue;
    }
    const step = (samples.length - 1) / (limit - 1);
    for (let i = 0; i < limit; i++) compacted.push(samples[Math.round(i * step)]);
  }
  return compacted.sort((a, b) => a.ts - b.ts || a.bucketId.localeCompare(b.bucketId));
}

export function historyStats(history = []) {
  const samples = history.filter((sample) => Number.isFinite(sample?.ts));
  const timestamps = samples.map((sample) => sample.ts);
  return {
    sampleCount: samples.length,
    bucketCount: new Set(samples.map((sample) => sample.bucketId)).size,
    oldestTs: timestamps.length ? Math.min(...timestamps) : null,
    newestTs: timestamps.length ? Math.max(...timestamps) : null,
  };
}

export function historyToCSV(history = []) {
  const rows = ['timestampISO,bucketId,percentUsed'];
  const sorted = [...history]
    .filter((sample) => Number.isFinite(sample?.ts) && sample.bucketId)
    .sort((a, b) => a.ts - b.ts || String(a.bucketId).localeCompare(String(b.bucketId)));
  for (const sample of sorted) {
    rows.push([
      new Date(sample.ts).toISOString(),
      csvCell(sample.bucketId),
      clampPercent(sample.percentUsed).toFixed(2),
    ].join(','));
  }
  return `${rows.join('\r\n')}\r\n`;
}

// Linear regression to predict when percentUsed hits 100 for a bucket.
// Returns the predicted ETA (Date) or null if we can't predict yet.
export function forecastExhaustion(history, bucketId, { now = new Date(), windowMs = 48 * 60 * 60 * 1000 } = {}) {
  const samples = history
    .filter((h) => h.bucketId === bucketId && now.getTime() - h.ts <= windowMs)
    .sort((a, b) => a.ts - b.ts);

  if (samples.length < 3) return null;

  // Look at deltas. If usage went down (reset), use only post-reset window.
  let firstIdx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].percentUsed < samples[i - 1].percentUsed - 5) firstIdx = i;
  }
  const window = samples.slice(firstIdx);
  if (window.length < 3) return null;

  const xMean = window.reduce((s, p) => s + p.ts, 0) / window.length;
  const yMean = window.reduce((s, p) => s + p.percentUsed, 0) / window.length;

  let num = 0, den = 0;
  for (const p of window) {
    num += (p.ts - xMean) * (p.percentUsed - yMean);
    den += (p.ts - xMean) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;             // percentUsed per ms
  if (slope <= 0) return null;         // not burning down
  const intercept = yMean - slope * xMean;
  const tsAt100 = (100 - intercept) / slope;
  if (!Number.isFinite(tsAt100)) return null;
  if (tsAt100 <= now.getTime()) return null;
  return new Date(tsAt100);
}

// Per-bucket sparkline: returns up to `n` points spaced ~evenly over last
// RETAIN_MS, normalized to [0..100] for easy SVG plotting.
export function sparklineFor(history, bucketId, { n = 24 } = {}) {
  return sparklineSamplesFor(history, bucketId, { n }).map((s) => s.percentUsed);
}

export function sparklineSamplesFor(history, bucketId, { n = 24 } = {}) {
  const samples = history.filter((h) => h.bucketId === bucketId).sort((a, b) => a.ts - b.ts);
  if (samples.length === 0) return [];
  if (samples.length <= n) return samples.map(normalizeSample);
  const step = samples.length / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(normalizeSample(samples[Math.floor(i * step)]));
  }
  return out;
}

function normalizeSample(sample) {
  return {
    ts: sample.ts,
    bucketId: sample.bucketId,
    percentUsed: clampPercent(sample.percentUsed),
  };
}

function retentionMs(retentionDays) {
  const days = Math.max(1, Math.min(365, Number(retentionDays) || DEFAULT_RETENTION_DAYS));
  return days * 24 * 60 * 60 * 1000;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
