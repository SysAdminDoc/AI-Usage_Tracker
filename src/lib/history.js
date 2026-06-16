// 30-day rolling history of bucket samples + simple burn-rate forecast.
// Storage is a flat array (timestamp + bucketId + percentUsed). Forecast
// is linear regression over the last `windowMs` of samples for one bucket.

const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

export function recordSnapshot(history, snapshot, { now = new Date() } = {}) {
  const ts = now.getTime();
  const next = history.filter((h) => ts - h.ts <= RETAIN_MS);
  for (const provider of Object.keys(snapshot.providers || {})) {
    const ps = snapshot.providers[provider];
    if (!ps || !ps.ok) continue;
    for (const bucket of ps.buckets) {
      next.push({ ts, bucketId: bucket.id, percentUsed: bucket.percentUsed });
    }
  }
  return next;
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
    percentUsed: Math.max(0, Math.min(100, Number(sample.percentUsed) || 0)),
  };
}
