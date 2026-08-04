import { API_PROVIDER_IDS } from '../providers/api-contract.js';

export const BUDGET_LEDGER_VERSION = 1;
export const MAX_BUDGET_CAP_USD = 1_000_000;

export function normalizeBudgetCap(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.min(MAX_BUDGET_CAP_USD, Math.round(amount * 100) / 100);
}

export function localBudgetDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function defaultBudgetLedger(now = new Date()) {
  return {
    version: BUDGET_LEDGER_VERSION,
    sessionStartedISO: now.toISOString(),
    sessionSpentUSD: 0,
    dailyKey: localBudgetDayKey(now),
    dailySpentUSD: 0,
    lastTotals: {},
  };
}

export function normalizeBudgetLedger(raw, now = new Date()) {
  const fallback = defaultBudgetLedger(now);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const sessionStartedISO = validISO(raw.sessionStartedISO) || fallback.sessionStartedISO;
  const dailyKey = typeof raw.dailyKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dailyKey)
    ? raw.dailyKey : fallback.dailyKey;
  const lastTotals = {};
  for (const [provider, value] of Object.entries(raw.lastTotals || {})) {
    const amountUSD = finiteAmount(value?.amountUSD);
    if (amountUSD == null || !API_PROVIDER_IDS.includes(provider)) continue;
    lastTotals[provider] = {
      amountUSD,
      source: value?.source === 'official' ? 'official' : 'estimated',
    };
  }
  return {
    version: BUDGET_LEDGER_VERSION,
    sessionStartedISO,
    sessionSpentUSD: finiteAmount(raw.sessionSpentUSD) || 0,
    dailyKey,
    dailySpentUSD: finiteAmount(raw.dailySpentUSD) || 0,
    lastTotals,
  };
}

/**
 * Extract cumulative spend from API provider snapshots. Provider-specific
 * totals are preferred; bucket costs are a safe fallback for future plugins.
 */
export function collectApiSpend(snapshot) {
  const out = {};
  for (const provider of API_PROVIDER_IDS) {
    const providerState = snapshot?.providers?.[provider];
    if (!providerState?.ok) continue;
    const total = providerTotal(providerState);
    if (total == null) continue;
    out[provider] = {
      amountUSD: total,
      source: providerSpendSource(providerState),
    };
  }
  return out;
}

/**
 * Add only newly observed cumulative spend to the session and local-day
 * ledger. First observations establish a baseline so existing month-to-date
 * spend is not retroactively charged against a newly enabled cap.
 */
export function updateBudgetLedger(raw, snapshot, { now = new Date() } = {}) {
  const current = normalizeBudgetLedger(raw, now);
  const dayKey = localBudgetDayKey(now);
  const next = dayKey === current.dailyKey
    ? current
    : { ...current, dailyKey: dayKey, dailySpentUSD: 0 };
  const totals = collectApiSpend(snapshot);
  let deltaUSD = 0;
  const providerDeltas = {};
  const lastTotals = { ...next.lastTotals };

  for (const [provider, observed] of Object.entries(totals)) {
    const previous = next.lastTotals[provider];
    let delta = 0;
    if (previous && previous.source === observed.source) {
      delta = observed.amountUSD >= previous.amountUSD
        ? observed.amountUSD - previous.amountUSD
        : observed.amountUSD;
    }
    if (delta > 0) {
      deltaUSD += delta;
      providerDeltas[provider] = roundUSD(delta);
    }
    lastTotals[provider] = observed;
  }

  return {
    ledger: {
      ...next,
      sessionSpentUSD: roundUSD(next.sessionSpentUSD + deltaUSD),
      dailySpentUSD: roundUSD(next.dailySpentUSD + deltaUSD),
      lastTotals,
    },
    deltaUSD: roundUSD(deltaUSD),
    providerDeltas,
  };
}

/** Forget a provider's cumulative baseline after its credential is removed. */
export function forgetApiProvider(raw, provider, now = new Date()) {
  const next = normalizeBudgetLedger(raw, now);
  const lastTotals = { ...next.lastTotals };
  delete lastTotals[provider];
  return { ...next, lastTotals };
}

/** Reset the session counter while baselining current provider totals. */
export function resetSessionBudget(raw, snapshot, { now = new Date() } = {}) {
  const next = normalizeBudgetLedger(raw, now);
  const totals = collectApiSpend(snapshot);
  return {
    ...next,
    sessionStartedISO: now.toISOString(),
    sessionSpentUSD: 0,
    lastTotals: totals,
  };
}

function providerTotal(providerState) {
  const totals = providerState.totals || {};
  for (const key of ['costUSD', 'spendUSD', 'usageUSD']) {
    const value = finiteAmount(totals[key]);
    if (value != null) return value;
  }
  const bucketTotal = (providerState.buckets || []).reduce((sum, bucket) => {
    const amount = finiteAmount(bucket?.metric?.costUSD);
    return amount == null ? sum : sum + amount;
  }, 0);
  return bucketTotal > 0 ? roundUSD(bucketTotal) : null;
}

function providerSpendSource(providerState) {
  if (providerState.totals?.officialCostUSD != null) return 'official';
  if (providerState.totals?.costUSD != null && (providerState.buckets || [])
    .some((bucket) => bucket?.metric?.costSource === 'official')) return 'official';
  if (providerState.totals?.spendUSD != null || providerState.totals?.usageUSD != null) return 'official';
  return (providerState.buckets || []).some((bucket) => bucket?.metric?.costSource === 'official')
    ? 'official' : 'estimated';
}

function finiteAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? roundUSD(amount) : null;
}

function roundUSD(value) {
  return Math.round(Number(value) * 100) / 100;
}

function validISO(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
