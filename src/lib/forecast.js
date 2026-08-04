import { API_PROVIDER_IDS, API_PROVIDER_META } from '../providers/api-contract.js';

export const FORECAST_MIN_COVERAGE_DAYS = 1;
export const FORECAST_MAX_STALE_MS = 48 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIDENCE_RANK = Object.freeze({ low: 1, medium: 2, high: 3 });

/**
 * Project month-to-date API spend to the end of the current UTC month.
 * The provider APIs queried by this project use UTC month ranges, so the
 * forecast deliberately follows that same boundary. It never invents a
 * projection for providers that expose usage without cost data.
 */
export function forecastMonthEnd(snapshot, {
  now = new Date(),
  minCoverageDays = FORECAST_MIN_COVERAGE_DAYS,
  maxStaleMs = FORECAST_MAX_STALE_MS,
} = {}) {
  const nowDate = asDate(now);
  if (!nowDate) return emptyForecast();

  const monthStart = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 1));
  const monthEnd = new Date(nextMonthStart.getTime() - 1);
  const daysInMonth = (nextMonthStart.getTime() - monthStart.getTime()) / DAY_MS;
  const providers = [];

  for (const provider of API_PROVIDER_IDS) {
    const entry = forecastProvider(snapshot?.providers?.[provider], {
      provider,
      nowDate,
      monthStart,
      nextMonthStart,
      daysInMonth,
      minCoverageDays: Math.max(0.25, Number(minCoverageDays) || FORECAST_MIN_COVERAGE_DAYS),
      maxStaleMs: Math.max(0, Number(maxStaleMs) || FORECAST_MAX_STALE_MS),
    });
    if (entry) providers.push(entry);
  }

  const eligible = providers.filter((entry) => entry.projectedUSD != null);
  const observedUSD = roundUSD(providers.reduce((sum, entry) => sum + entry.observedUSD, 0));
  const projectedUSD = roundUSD(eligible.reduce((sum, entry) => sum + entry.projectedUSD, 0));
  const confidence = eligible.length ? lowestConfidence(eligible) : null;

  return {
    version: 1,
    asOfISO: nowDate.toISOString(),
    monthStartISO: monthStart.toISOString(),
    monthEndISO: monthEnd.toISOString(),
    daysInMonth,
    providers,
    total: {
      observedUSD,
      projectedUSD: eligible.length ? projectedUSD : null,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      providerCount: providers.length,
      eligibleProviderCount: eligible.length,
    },
    assumptions: [
      'Uses month-to-date provider cost totals and a straight-line daily run rate.',
      'The current run rate is assumed to continue through the end of the UTC month.',
      'Official provider totals are preferred; pricing-table estimates are labelled and lower confidence.',
    ],
  };
}

/** Extract a cost-bearing total without exposing provider credentials. */
export function extractProviderCost(providerSnapshot) {
  if (!providerSnapshot?.ok || typeof providerSnapshot !== 'object') return null;

  const totals = providerSnapshot.totals && typeof providerSnapshot.totals === 'object'
    ? providerSnapshot.totals : {};
  if (finiteAmount(totals.officialCostUSD) != null) {
    return { amountUSD: roundUSD(totals.officialCostUSD), source: 'official' };
  }
  if (finiteAmount(totals.costUSD) != null) {
    return {
      amountUSD: roundUSD(totals.costUSD),
      source: totalCostSource(providerSnapshot, totals),
    };
  }
  for (const key of ['spendUSD', 'usageUSD']) {
    if (finiteAmount(totals[key]) != null) {
      return { amountUSD: roundUSD(totals[key]), source: 'official' };
    }
  }

  const buckets = Array.isArray(providerSnapshot.buckets) ? providerSnapshot.buckets : [];
  const currencyBuckets = buckets.filter((bucket) => bucket?.metric?.kind === 'currency');
  const candidates = currencyBuckets.length
    ? currencyBuckets
    : buckets.filter((bucket) => bucket?.metric?.costUSD != null);
  if (!candidates.length) return null;
  const amountUSD = candidates.reduce((sum, bucket) => sum + (finiteAmount(bucket.metric.costUSD) || 0), 0);
  if (!candidates.some((bucket) => finiteAmount(bucket?.metric?.costUSD) != null)) return null;
  return {
    amountUSD: roundUSD(amountUSD),
    source: costSourceFromBuckets(candidates) || 'estimated',
  };
}

function forecastProvider(providerSnapshot, {
  provider,
  nowDate,
  monthStart,
  nextMonthStart,
  daysInMonth,
  minCoverageDays,
  maxStaleMs,
}) {
  const cost = extractProviderCost(providerSnapshot);
  if (!cost) return null;

  const rangeStart = asDate(providerSnapshot.range?.startISO);
  const observationStart = rangeStart && rangeStart > monthStart && rangeStart < nowDate
    ? rangeStart : monthStart;
  const observedDays = Math.max(0, (nowDate.getTime() - observationStart.getTime()) / DAY_MS);
  const stale = isStale(providerSnapshot, nowDate, maxStaleMs);
  const eligible = observedDays >= minCoverageDays;
  const projectedUSD = eligible
    ? roundUSD(cost.amountUSD * daysInMonth / Math.max(observedDays, minCoverageDays))
    : null;
  const confidence = confidenceFor(cost.source, observedDays, stale, eligible);
  const assumptions = [
    cost.source === 'official'
      ? 'Provider-reported month-to-date cost.'
      : 'Pricing-table month-to-date estimate.',
    'Current daily run rate continues through month end.',
  ];
  if (stale) assumptions.push('The latest provider snapshot is stale.');
  if (!eligible) assumptions.push(`At least ${formatDays(minCoverageDays)} of coverage is required.`);

  return {
    provider,
    label: API_PROVIDER_META[provider]?.label || provider,
    observedUSD: cost.amountUSD,
    projectedUSD,
    source: cost.source,
    sourceLabel: cost.source === 'official' ? 'Official cost' : 'Pricing-table estimate',
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    stale,
    eligible,
    observedDays: roundNumber(observedDays),
    coveragePercent: roundNumber(Math.min(100, observedDays / daysInMonth * 100)),
    assumptions,
    rangeStartISO: observationStart.toISOString(),
    asOfISO: nowDate.toISOString(),
    monthEndISO: new Date(nextMonthStart.getTime() - 1).toISOString(),
  };
}

function totalCostSource(providerSnapshot, totals) {
  if (Number(totals.reportedModelCount) > 0 || finiteAmount(totals.officialCostUSD) != null) return 'official';
  if (Number(totals.pricedModelCount) > 0 || Number(totals.estimatedCostUSD) > 0) return 'estimated';
  return costSourceFromBuckets(providerSnapshot.buckets || []) || 'estimated';
}

function costSourceFromBuckets(buckets) {
  if (buckets.some((bucket) => bucket?.metric?.costSource === 'official')) return 'official';
  if (buckets.some((bucket) => bucket?.metric?.costSource === 'pricing-table')) return 'estimated';
  return null;
}

function confidenceFor(source, observedDays, stale, eligible) {
  if (!eligible || stale) return 'low';
  if (source === 'estimated') return observedDays >= 14 ? 'medium' : 'low';
  if (observedDays >= 14) return 'high';
  if (observedDays >= 3) return 'medium';
  return 'low';
}

function lowestConfidence(entries) {
  return entries.reduce((lowest, entry) => (
    CONFIDENCE_RANK[entry.confidence] < CONFIDENCE_RANK[lowest] ? entry.confidence : lowest
  ), 'high');
}

function confidenceLabel(confidence) {
  if (confidence === 'high') return 'High';
  if (confidence === 'medium') return 'Medium';
  if (confidence === 'low') return 'Low';
  return 'Unavailable';
}

function isStale(providerSnapshot, nowDate, maxStaleMs) {
  if (providerSnapshot.stale === true) return true;
  const lastSuccess = asDate(providerSnapshot.lastSuccessISO);
  return !!lastSuccess && nowDate.getTime() - lastSuccess.getTime() > maxStaleMs;
}

function emptyForecast() {
  return {
    version: 1,
    asOfISO: null,
    monthStartISO: null,
    monthEndISO: null,
    daysInMonth: 0,
    providers: [],
    total: {
      observedUSD: 0,
      projectedUSD: null,
      confidence: null,
      confidenceLabel: 'Unavailable',
      providerCount: 0,
      eligibleProviderCount: 0,
    },
    assumptions: [],
  };
}

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function finiteAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function roundUSD(value) {
  return Math.round(Number(value) * 100) / 100;
}

function roundNumber(value) {
  return Math.round(Number(value) * 100) / 100;
}

function formatDays(value) {
  const days = Number(value);
  return `${days === 1 ? '1 day' : `${days} days`}`;
}
