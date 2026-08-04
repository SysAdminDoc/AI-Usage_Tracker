import {
  apiFailure,
  numberValue,
  readJSONResponse,
  resolveFetch,
} from './api-contract.js';

export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

export async function fetchOpenRouterData({ apiKey, now = new Date(), fetchImpl = null } = {}) {
  const token = String(apiKey || '').trim();
  if (!token) return apiFailure('openrouter', 'credentials.missing', 'credential-not-configured');
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return apiFailure('openrouter', 'fetch.unavailable', 'fetch-unavailable');

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const [key, credits] = await Promise.all([
    readJSONResponse(doFetch, OPENROUTER_KEY_URL, { headers }, 'openrouter', 'key'),
    readJSONResponse(doFetch, OPENROUTER_CREDITS_URL, { headers }, 'openrouter', 'credits'),
  ]);
  if (!key.ok && !credits.ok) {
    return apiFailure('openrouter', 'usage-and-credits.failed', 'usage-and-credits-failed', {
      status: key.status || credits.status || null,
      keyErrorCode: key.errorCode || null,
      creditsErrorCode: credits.errorCode || null,
    });
  }

  return {
    ok: true,
    provider: 'openrouter',
    data: {
      key: key.ok ? key.data : null,
      credits: credits.ok ? credits.data : null,
    },
    meta: {
      keyOk: key.ok,
      creditsOk: credits.ok,
      keyErrorCode: key.errorCode || null,
      creditsErrorCode: credits.errorCode || null,
      now,
    },
  };
}

export function parseOpenRouterResponse(data, { now = new Date(), keyOk = true, creditsOk = true,
  keyErrorCode = null, creditsErrorCode = null } = {}) {
  const parsed = parseOpenRouterUsage(data || {}, { now });
  if (!parsed.ok) return parsed;
  const warnings = [];
  if (!keyOk) warnings.push(keyErrorCode || 'openrouter.key.failed');
  if (!creditsOk) warnings.push(creditsErrorCode || 'openrouter.credits.failed');
  if (warnings.length) {
    parsed.warningCode = warnings[0];
    parsed.warningCodes = warnings;
  }
  return parsed;
}

export async function fetchOpenRouterUsage({ apiKey, now = new Date(), fetchImpl = null } = {}) {
  const fetched = await fetchOpenRouterData({ apiKey, now, fetchImpl });
  if (!fetched.ok) return fetched;
  return parseOpenRouterResponse(fetched.data, fetched.meta);
}

export function parseOpenRouterUsage({ key = null, credits = null } = {}, { now = new Date() } = {}) {
  const keyData = key?.data && typeof key.data === 'object' ? key.data : null;
  const creditData = credits?.data && typeof credits.data === 'object' ? credits.data : null;
  const hasKeyShape = !!keyData && [
    'usage', 'usage_monthly', 'limit', 'limit_remaining', 'limit_reset',
  ].some((field) => Object.prototype.hasOwnProperty.call(keyData, field));
  const hasCreditShape = !!creditData && [
    'total_credits', 'total_usage',
  ].some((field) => Object.prototype.hasOwnProperty.call(creditData, field));
  if (!hasKeyShape && !hasCreditShape) {
    return apiFailure('openrouter', 'usage.schema-empty', 'usage-schema-empty');
  }

  const monthlyUsage = numberValue(keyData?.usage_monthly ?? keyData?.usage);
  const limitUSD = finiteOrNull(keyData?.limit);
  const remainingUSD = finiteOrNull(keyData?.limit_remaining);
  const percentUsed = limitUSD && limitUSD > 0
    ? Math.max(0, Math.min(100, monthlyUsage / limitUSD * 100))
    : 0;
  const resetType = normalizeResetType(keyData?.limit_reset);
  const resetISO = resetType ? nextResetISO(resetType, now) : null;
  const buckets = [];
  if (hasKeyShape) {
    buckets.push({
      id: 'openrouter-key-usage',
      label: 'API key usage',
      kind: 'api',
      model: null,
      percentUsed,
      resetISO,
      rawResetText: resetType
        ? `${capitalize(resetType)} usage · resets ${resetISO.slice(0, 10)}`
        : 'Usage reset not published',
      metric: {
        kind: 'currency',
        costUSD: monthlyUsage,
        costSource: 'official',
        limitUSD,
        remainingUSD,
        usageDailyUSD: finiteOrNull(keyData?.usage_daily),
        usageWeeklyUSD: finiteOrNull(keyData?.usage_weekly),
      },
      dimensions: { reset: resetType },
    });
  }
  if (hasCreditShape) {
    const totalCreditsUSD = numberValue(creditData.total_credits);
    const totalUsageUSD = numberValue(creditData.total_usage);
    buckets.push({
      id: 'openrouter-credits',
      label: 'Account credits',
      kind: 'api',
      model: null,
      percentUsed: totalCreditsUSD > 0
        ? Math.max(0, Math.min(100, totalUsageUSD / totalCreditsUSD * 100))
        : 0,
      resetISO: null,
      rawResetText: 'Lifetime credits and usage',
      metric: {
        kind: 'currency',
        costUSD: totalUsageUSD,
        costSource: 'official',
        totalCreditsUSD,
        remainingCreditsUSD: Math.max(0, totalCreditsUSD - totalUsageUSD),
      },
      dimensions: { scope: 'account' },
    });
  }

  return {
    ok: true,
    provider: 'openrouter',
    source: 'api-key',
    plan: 'OpenRouter',
    totals: {
      usageUSD: monthlyUsage,
      totalCreditsUSD: numberValue(creditData?.total_credits),
      totalUsageUSD: numberValue(creditData?.total_usage),
    },
    buckets,
  };
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeResetType(value) {
  const reset = String(value || '').trim().toLowerCase();
  return ['daily', 'weekly', 'monthly'].includes(reset) ? reset : null;
}

function nextResetISO(type, now) {
  const date = new Date(now);
  if (type === 'daily') date.setUTCDate(date.getUTCDate() + 1);
  if (type === 'weekly') {
    const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
    date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  }
  if (type === 'monthly') {
    date.setUTCMonth(date.getUTCMonth() + 1, 1);
  }
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
