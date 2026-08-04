import { API_PROVIDER_META } from '../providers/api-contract.js';

export const PLAN_RECOMMENDATION_MIN_COVERAGE_DAYS = 7;

/**
 * Build conservative plan guidance from provider-reported limits and usage.
 * There is intentionally no plan catalog here: provider names, prices, and
 * entitlements change independently of the usage APIs. Recommendations are
 * therefore review prompts, never claims that a named plan is cheaper.
 */
export function buildPlanRecommendations(snapshot, forecast, {
  minCoverageDays = PLAN_RECOMMENDATION_MIN_COVERAGE_DAYS,
} = {}) {
  const requiredDays = Math.max(1, Number(minCoverageDays) || PLAN_RECOMMENDATION_MIN_COVERAGE_DAYS);
  const entries = Array.isArray(forecast?.providers) ? forecast.providers : [];
  const ready = entries.filter((entry) => entry?.projectedUSD != null
    && Number(entry.observedDays) >= requiredDays
    && entry.stale !== true);
  const recommendations = [];

  for (const entry of ready) {
    const providerSnapshot = snapshot?.providers?.[entry.provider];
    const limit = providerLimitSignal(providerSnapshot);
    if (limit && Number(entry.projectedUSD) >= limit.limitUSD * 0.9) {
      recommendations.push(makeRecommendation(entry, {
        id: `${entry.provider}-higher-cap`,
        type: 'higher-cap',
        title: `${entry.label}: review a higher-cap plan or limit`,
        detail: `Projected month-end spend is ${formatUSD(entry.projectedUSD)} against the reported ${formatUSD(limit.limitUSD)} limit.`,
        reason: 'The current run rate is close to or above the reported provider limit.',
        signal: `Reported limit ${formatUSD(limit.limitUSD)}`,
      }));
    } else if (limit && Number(entry.observedUSD) > 0 && Number(entry.projectedUSD) <= limit.limitUSD * 0.25) {
      recommendations.push(makeRecommendation(entry, {
        id: `${entry.provider}-lower-cost`,
        type: 'lower-cost',
        title: `${entry.label}: review a lower-cost plan or limit`,
        detail: `Projected month-end spend is ${formatUSD(entry.projectedUSD)} against the reported ${formatUSD(limit.limitUSD)} limit.`,
        reason: 'Observed spend is well below the reported provider limit.',
        signal: `Reported limit ${formatUSD(limit.limitUSD)}`,
      }));
    }

    const usage = usageBasedSignal(providerSnapshot);
    if (usage && usage.usageBasedShare >= 0.2 && !recommendations.some((item) => item.provider === entry.provider)) {
      recommendations.push(makeRecommendation(entry, {
        id: `${entry.provider}-higher-cap-seat`,
        type: 'higher-cap',
        title: `${entry.label}: review a higher-cap seat or plan`,
        detail: `${formatPercent(usage.usageBasedShare)} of reported requests are usage-based (${formatCount(usage.usageBasedReqs)} requests).`,
        reason: 'Usage-based requests indicate the current included allowance may not fit the observed run rate.',
        signal: 'Reported subscription and usage-based request mix',
      }));
    }
  }

  return {
    version: 1,
    status: entries.length === 0
      ? 'no-data'
      : ready.length === 0
        ? 'insufficient-coverage'
        : recommendations.length ? 'ready' : 'no-action',
    requiredDays,
    readyProviderCount: ready.length,
    providerCount: entries.length,
    recommendations,
    assumptions: [
      `Guidance requires at least ${formatDays(requiredDays)} of fresh cost coverage.`,
      'Provider-reported limits and request mix are treated as signals, not a plan catalog.',
      'Verify current provider pricing, entitlements, and terms before changing a plan or routing policy.',
    ],
  };
}

export function providerLimitSignal(providerSnapshot) {
  if (!providerSnapshot || typeof providerSnapshot !== 'object') return null;
  const direct = finiteAmount(providerSnapshot.limitUSD);
  if (direct != null && direct > 0) return { limitUSD: direct, source: 'provider' };
  const buckets = Array.isArray(providerSnapshot.buckets) ? providerSnapshot.buckets : [];
  for (const bucket of buckets) {
    const limitUSD = finiteAmount(bucket?.metric?.limitUSD);
    if (limitUSD != null && limitUSD > 0) return { limitUSD, source: 'bucket' };
  }
  return null;
}

export function usageBasedSignal(providerSnapshot) {
  const buckets = Array.isArray(providerSnapshot?.buckets) ? providerSnapshot.buckets : [];
  const requestMetrics = buckets
    .map((bucket) => bucket?.metric)
    .filter((metric) => metric?.kind === 'requests');
  if (!requestMetrics.length) return null;
  const usageBasedReqs = requestMetrics.reduce((sum, metric) => sum + Math.max(0, Number(metric.usageBasedReqs) || 0), 0);
  const includedReqs = requestMetrics.reduce((sum, metric) => sum + Math.max(0, Number(metric.subscriptionIncludedReqs) || 0), 0);
  const total = usageBasedReqs + includedReqs;
  if (!usageBasedReqs || !total) return null;
  return {
    usageBasedReqs,
    includedReqs,
    usageBasedShare: usageBasedReqs / total,
  };
}

function makeRecommendation(entry, fields) {
  return {
    provider: entry.provider,
    providerLabel: API_PROVIDER_META[entry.provider]?.label || entry.label || entry.provider,
    confidence: entry.confidence || 'low',
    confidenceLabel: entry.confidenceLabel || 'Low',
    observedDays: Number(entry.observedDays) || 0,
    source: entry.source || 'unknown',
    uncertainty: 'Plan names and prices are not available in this local usage payload.',
    ...fields,
  };
}

function finiteAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function formatUSD(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
    .format(Number(value) || 0);
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatPercent(value) {
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatDays(value) {
  const days = Number(value);
  return days === 1 ? '1 day' : `${days} days`;
}
