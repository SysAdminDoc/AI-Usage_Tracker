import {
  apiFailure,
  currentMonthRange,
  numberValue,
  readJSONResponse,
  resolveFetch,
} from './api-contract.js';

export const CURSOR_API_BASE_URL = 'https://api.cursor.com';
export const CURSOR_DAILY_USAGE_URL = `${CURSOR_API_BASE_URL}/teams/daily-usage-data`;
export const CURSOR_SPEND_URL = `${CURSOR_API_BASE_URL}/teams/spend`;

export async function fetchCursorUsage({ apiKey, now = new Date(), fetchImpl = null } = {}) {
  const token = String(apiKey || '').trim();
  if (!token) return apiFailure('cursor', 'credentials.missing', 'credential-not-configured');
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return apiFailure('cursor', 'fetch.unavailable', 'fetch-unavailable');

  const range = currentMonthRange(now);
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Basic ${encodeBasicCredential(token)}`,
  };
  const [dailyUsage, spend] = await Promise.all([
    readJSONResponse(doFetch, CURSOR_DAILY_USAGE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        startDate: range.start.getTime(),
        endDate: range.end.getTime(),
      }),
    }, 'cursor', 'daily-usage'),
    readJSONResponse(doFetch, CURSOR_SPEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ page: 1, pageSize: 100 }),
    }, 'cursor', 'spend'),
  ]);

  if (!dailyUsage.ok && !spend.ok) {
    return apiFailure('cursor', 'usage-and-spend.failed', 'usage-and-spend-failed', {
      status: dailyUsage.status || spend.status || null,
      dailyUsageErrorCode: dailyUsage.errorCode || null,
      spendErrorCode: spend.errorCode || null,
    });
  }

  const parsed = parseCursorUsage({
    daily: dailyUsage.ok ? dailyUsage.data : null,
    spend: spend.ok ? spend.data : null,
  }, { range });
  if (!parsed.ok) return parsed;
  const warnings = [];
  if (!dailyUsage.ok) warnings.push(dailyUsage.errorCode || 'cursor.daily-usage.failed');
  if (!spend.ok) warnings.push(spend.errorCode || 'cursor.spend.failed');
  if (warnings.length) {
    parsed.warningCode = warnings[0];
    parsed.warningCodes = warnings;
  }
  return parsed;
}

export function parseCursorUsage({ daily = null, spend = null } = {}, { range = currentMonthRange() } = {}) {
  const dailyRows = Array.isArray(daily?.data) ? daily.data : [];
  const spendRows = Array.isArray(spend?.teamMemberSpend) ? spend.teamMemberSpend : [];
  const hasSpendCycle = Number.isFinite(Number(spend?.subscriptionCycleStart));
  const hasDailyShape = dailyRows.some((row) => row && typeof row === 'object' && [
    'subscriptionIncludedReqs', 'apiKeyReqs', 'usageBasedReqs', 'agentRequests',
    'chatRequests', 'date', 'isActive',
  ].some((key) => Object.prototype.hasOwnProperty.call(row, key)));
  const hasSpendShape = spendRows.some((row) => row && typeof row === 'object'
    && ['spendCents', 'fastPremiumRequests', 'name', 'email'].some((key) => Object.prototype.hasOwnProperty.call(row, key)));
  if (!hasDailyShape && !hasSpendShape && !hasSpendCycle) {
    return apiFailure('cursor', 'usage.schema-empty', 'usage-schema-empty');
  }

  const usage = {
    subscriptionIncludedReqs: 0,
    apiKeyReqs: 0,
    usageBasedReqs: 0,
    totalRequests: 0,
    activeDays: 0,
    lastActivityISO: null,
    models: new Set(),
    dates: new Set(),
  };
  for (const row of dailyRows) {
    const included = numberValue(row?.subscriptionIncludedReqs);
    const apiKey = numberValue(row?.apiKeyReqs);
    const usageBased = numberValue(row?.usageBasedReqs);
    usage.subscriptionIncludedReqs += included;
    usage.apiKeyReqs += apiKey;
    usage.usageBasedReqs += usageBased;
    const categoryTotal = included + apiKey + usageBased;
    const fallbackTotal = numberValue(row?.agentRequests)
      + numberValue(row?.chatRequests)
      + numberValue(row?.composerRequests);
    usage.totalRequests += categoryTotal || fallbackTotal;

    const dateISO = epochToISO(row?.date);
    if (dateISO) {
      const dateKey = dateISO.slice(0, 10);
      if (row?.isActive === true || categoryTotal > 0 || fallbackTotal > 0) usage.dates.add(dateKey);
      if (!usage.lastActivityISO || dateISO > usage.lastActivityISO) usage.lastActivityISO = dateISO;
    }
    if (row?.mostUsedModel) usage.models.add(String(row.mostUsedModel).slice(0, 120));
  }
  usage.activeDays = usage.dates.size;

  let spendCents = 0;
  let premiumRequests = 0;
  for (const row of spendRows) {
    spendCents += Math.max(0, numberValue(row?.spendCents));
    premiumRequests += Math.max(0, numberValue(row?.fastPremiumRequests));
  }

  const cycleStartISO = epochToISO(spend?.subscriptionCycleStart);
  const resetISO = cycleStartISO ? addMonth(cycleStartISO) : null;
  const buckets = [];
  if (hasDailyShape) {
    buckets.push({
      id: 'cursor-requests',
      label: 'Team usage requests',
      kind: 'api',
      model: null,
      percentUsed: 0,
      resetISO,
      rawResetText: resetISO
        ? `Billing cycle resets ${resetISO.slice(0, 10)}`
        : `Daily usage through ${range.endISO.slice(0, 10)}`,
      metric: {
        kind: 'requests',
        requests: usage.totalRequests,
        subscriptionIncludedReqs: usage.subscriptionIncludedReqs,
        usageBasedReqs: usage.usageBasedReqs,
        apiKeyReqs: usage.apiKeyReqs,
        activeDays: usage.activeDays,
        lastActivityISO: usage.lastActivityISO,
      },
      dimensions: {
        scope: 'team',
        models: [...usage.models].slice(0, 8).join(', '),
      },
    });
  }
  if (hasSpendShape || hasSpendCycle) {
    buckets.push({
      id: 'cursor-spend',
      label: 'Team spend',
      kind: 'api',
      model: null,
      percentUsed: 0,
      resetISO,
      rawResetText: resetISO
        ? `Billing cycle resets ${resetISO.slice(0, 10)}`
        : 'Current Cursor billing cycle',
      metric: {
        kind: 'currency',
        costUSD: spendCents / 100,
        costSource: 'official',
        requests: premiumRequests,
        memberCount: spendRows.length,
      },
      dimensions: {
        scope: 'team',
        memberCount: String(spendRows.length),
      },
    });
  }
  if (!buckets.length) return apiFailure('cursor', 'usage.schema-empty', 'usage-schema-empty');

  return {
    ok: true,
    provider: 'cursor',
    source: 'api-key',
    plan: 'Cursor team',
    range: { startISO: range.startISO, endISO: range.endISO },
    totals: {
      spendUSD: spendCents / 100,
      premiumRequests,
      activeDays: usage.activeDays,
      memberCount: spendRows.length,
    },
    buckets,
  };
}

function encodeBasicCredential(token) {
  const value = `${token}:`;
  if (typeof btoa === 'function') return btoa(value);
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'utf8').toString('base64');
  return '';
}

function epochToISO(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const date = new Date(n);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addMonth(iso) {
  const source = new Date(iso);
  if (Number.isNaN(source.getTime())) return null;
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month + 1,
    Math.min(day, lastDay),
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  )).toISOString();
}
