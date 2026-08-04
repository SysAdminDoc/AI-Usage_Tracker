import {
  addNumbers,
  apiFailure,
  currentMonthRange,
  numberValue,
  readJSONPages,
  resolveFetch,
  slug,
} from './api-contract.js';
import { estimateTokenCost } from '../lib/pricing.js';

export const ANTHROPIC_API_USAGE_URL = 'https://api.anthropic.com/v1/organizations/usage_report/messages';
export const ANTHROPIC_API_COST_URL = 'https://api.anthropic.com/v1/organizations/cost_report';

export async function fetchAnthropicData({ apiKey, now = new Date(), fetchImpl = null } = {}) {
  if (!String(apiKey || '').trim()) return apiFailure('anthropic-api', 'credentials.missing', 'credential-not-configured');
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return apiFailure('anthropic-api', 'fetch.unavailable', 'fetch-unavailable');

  const range = currentMonthRange(now);
  const headers = {
    Accept: 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': String(apiKey).trim(),
  };
  const usageUrl = new URL(ANTHROPIC_API_USAGE_URL);
  usageUrl.searchParams.set('starting_at', range.startISO);
  usageUrl.searchParams.set('ending_at', range.endISO);
  usageUrl.searchParams.set('bucket_width', '1d');
  usageUrl.searchParams.set('limit', '31');
  usageUrl.searchParams.append('group_by[]', 'model');
  usageUrl.searchParams.append('group_by[]', 'workspace_id');

  const costUrl = new URL(ANTHROPIC_API_COST_URL);
  costUrl.searchParams.set('starting_at', range.startISO);
  costUrl.searchParams.set('ending_at', range.endISO);
  costUrl.searchParams.set('bucket_width', '1d');
  costUrl.searchParams.set('limit', '31');
  costUrl.searchParams.append('group_by[]', 'workspace_id');
  costUrl.searchParams.append('group_by[]', 'description');

  const [usage, costs] = await Promise.all([
    readJSONPages(doFetch, usageUrl.toString(), { headers }, 'anthropic-api', 'usage'),
    readJSONPages(doFetch, costUrl.toString(), { headers }, 'anthropic-api', 'costs'),
  ]);

  if (!usage.ok && !costs.ok) {
    return apiFailure('anthropic-api', 'usage-and-costs.failed', 'usage-and-costs-failed', {
      status: usage.status || costs.status || null,
      usageErrorCode: usage.errorCode || null,
      costsErrorCode: costs.errorCode || null,
    });
  }

  return {
    ok: true,
    provider: 'anthropic-api',
    data: {
      usage: usage.ok ? usage.data : { data: [] },
      costs: costs.ok ? costs.data : null,
    },
    meta: {
      range,
      usageOk: usage.ok,
      costsOk: costs.ok,
      usageErrorCode: usage.errorCode || null,
      costsErrorCode: costs.errorCode || null,
      usageTruncated: usage.truncated === true,
      costsTruncated: costs.truncated === true,
    },
  };
}

export function parseAnthropicResponse(data, { range = currentMonthRange(), usageOk = true, costsOk = true,
  usageErrorCode = null, costsErrorCode = null, usageTruncated = false, costsTruncated = false } = {}) {
  let parsed = parseAnthropicUsage(data?.usage || { data: [] }, {
    costs: data?.costs || null,
    range,
  });
  if (!parsed.ok && data?.costs) parsed = parseAnthropicCostsOnly(data.costs, { range });
  if (!parsed.ok) {
    return {
      ...parsed,
      usageErrorCode,
      costsErrorCode,
    };
  }

  const warnings = [];
  if (!usageOk) warnings.push(usageErrorCode || 'anthropic-api.usage.failed');
  if (!costsOk) warnings.push(costsErrorCode || 'anthropic-api.costs.failed');
  if (usageTruncated) warnings.push('anthropic-api.usage.pagination-truncated');
  if (costsTruncated) warnings.push('anthropic-api.costs.pagination-truncated');
  if (warnings.length) {
    parsed.warningCode = warnings[0];
    parsed.warningCodes = warnings;
  }
  return parsed;
}

export async function fetchAnthropicUsage({ apiKey, now = new Date(), fetchImpl = null } = {}) {
  const fetched = await fetchAnthropicData({ apiKey, now, fetchImpl });
  if (!fetched.ok) return fetched;
  return parseAnthropicResponse(fetched.data, fetched.meta);
}

export function parseAnthropicUsage(data, {
  costs = null,
  range = currentMonthRange(),
} = {}) {
  const groups = new Map();
  const buckets = Array.isArray(data?.data) ? data.data : [];

  for (const timeBucket of buckets) {
    for (const result of Array.isArray(timeBucket?.results) ? timeBucket.results : []) {
      const model = result?.model || 'all';
      const workspaceId = result?.workspace_id || null;
      const key = anthropicGroupKey(model, workspaceId);
      if (!groups.has(key)) groups.set(key, {
        model,
        workspaceId,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        webSearchRequests: 0,
      });
      const group = groups.get(key);
      addNumbers(group, 'inputTokens', result?.uncached_input_tokens);
      addNumbers(group, 'outputTokens', result?.output_tokens);
      addNumbers(group, 'cacheReadTokens', result?.cache_read_input_tokens);
      addNumbers(group, 'cacheCreation5mTokens', result?.cache_creation?.ephemeral_5m_input_tokens);
      addNumbers(group, 'cacheCreation1hTokens', result?.cache_creation?.ephemeral_1h_input_tokens);
      addNumbers(group, 'cacheCreationTokens', result?.cache_creation?.ephemeral_5m_input_tokens);
      addNumbers(group, 'cacheCreationTokens', result?.cache_creation?.ephemeral_1h_input_tokens);
      addNumbers(group, 'webSearchRequests', result?.server_tool_use?.web_search_requests);
    }
  }

  const costGroups = parseAnthropicCosts(costs);
  if (!groups.size && !costGroups.groups.size) {
    return apiFailure('anthropic-api', 'usage.schema-empty', 'usage-schema-empty');
  }
  return buildAnthropicSnapshot([...groups.values()], { range, costs: costGroups });
}

function parseAnthropicCostsOnly(data, { range }) {
  const costs = parseAnthropicCosts(data);
  if (!costs.groups.size) return apiFailure('anthropic-api', 'costs.schema-empty', 'costs-schema-empty');
  return buildAnthropicSnapshot([], { range, costs });
}

function buildAnthropicSnapshot(usageGroups, { range, costs }) {
  const usageKeys = new Set(usageGroups.map((group) => anthropicGroupKey(group.model, group.workspaceId)));
  const usageBuckets = usageGroups.map((group) => {
    const key = anthropicGroupKey(group.model, group.workspaceId);
    const official = costs.groups.get(key);
    const estimate = official ? null : estimateTokenCost('anthropic-api', group.model, {
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
      cacheReadTokens: group.cacheReadTokens,
      cacheCreation5mTokens: group.cacheCreation5mTokens,
      cacheCreation1hTokens: group.cacheCreation1hTokens,
    });
    const cost = official || estimate;
    const totalTokens = group.inputTokens + group.outputTokens + group.cacheReadTokens + group.cacheCreationTokens;
    const modelLabel = group.model === 'all' ? 'All models' : group.model;
    const workspaceLabel = group.workspaceId ? ` · workspace ${shortIdentifier(group.workspaceId)}` : '';
    const metric = {
      kind: 'tokens',
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
      cacheReadTokens: group.cacheReadTokens,
      cacheCreationTokens: group.cacheCreationTokens,
      totalTokens,
      webSearchRequests: group.webSearchRequests,
    };
    if (cost) Object.assign(metric, cost);
    return {
      id: `anthropic-api-${slug(group.model)}${group.workspaceId ? `-${slug(group.workspaceId)}` : ''}`,
      label: `${modelLabel}${workspaceLabel}`,
      kind: 'api',
      model: group.model,
      percentUsed: 0,
      resetISO: null,
      rawResetText: `Month to date · ${formatCount(totalTokens)} tokens`,
      metric,
      dimensions: { model: group.model, workspaceId: group.workspaceId },
    };
  });

  const costOnlyBuckets = [...costs.groups.values()]
    .filter((group) => !usageKeys.has(anthropicGroupKey(group.model, group.workspaceId)))
    .map((group) => costBucket(group));
  const buckets = [...usageBuckets, ...costOnlyBuckets];
  const estimatedCostUSD = usageBuckets.reduce((sum, bucket) => (
    bucket.metric.costSource === 'pricing-table' ? sum + numberValue(bucket.metric.costUSD) : sum
  ), 0);
  const costUSD = costs.hasData
    ? costs.total
    : usageBuckets.reduce((sum, bucket) => sum + numberValue(bucket.metric.costUSD), 0);

  return {
    ok: true,
    provider: 'anthropic-api',
    source: 'api-key',
    range: { startISO: range.startISO, endISO: range.endISO },
    totals: {
      costUSD,
      estimatedCostUSD,
      pricedModelCount: usageBuckets.filter((bucket) => bucket.metric.costSource === 'pricing-table').length,
      reportedModelCount: usageBuckets.filter((bucket) => bucket.metric.costSource === 'official').length,
    },
    buckets: buckets.sort((a, b) => (b.metric.costUSD || 0) - (a.metric.costUSD || 0)
      || (b.metric.totalTokens || 0) - (a.metric.totalTokens || 0)),
  };
}

function costBucket(group) {
  const modelLabel = group.model === 'all' ? 'All models' : group.model;
  const workspaceLabel = group.workspaceId ? ` · workspace ${shortIdentifier(group.workspaceId)}` : '';
  return {
    id: `anthropic-api-cost-${slug(group.model)}${group.workspaceId ? `-${slug(group.workspaceId)}` : ''}`,
    label: `Cost · ${modelLabel}${workspaceLabel}`,
    kind: 'api',
    model: group.model === 'all' ? null : group.model,
    percentUsed: 0,
    resetISO: null,
    rawResetText: `Month to date · ${formatCurrency(group.costUSD)}`,
    metric: {
      kind: 'currency',
      costUSD: group.costUSD,
      costSource: 'official',
    },
    dimensions: { model: group.model, workspaceId: group.workspaceId },
  };
}

function parseAnthropicCosts(data) {
  const groups = new Map();
  let total = 0;
  for (const timeBucket of Array.isArray(data?.data) ? data.data : []) {
    for (const result of Array.isArray(timeBucket?.results) ? timeBucket.results : []) {
      const currency = String(result?.currency || 'USD').toUpperCase();
      if (currency !== 'USD') continue;
      const model = result?.model || modelFromDescription(result?.description) || 'all';
      const workspaceId = result?.workspace_id || null;
      const amountUSD = anthropicCostUSD(result?.amount);
      const key = anthropicGroupKey(model, workspaceId);
      const group = groups.get(key) || { model, workspaceId, costUSD: 0, costSource: 'official' };
      group.costUSD += amountUSD;
      groups.set(key, group);
      total += amountUSD;
    }
  }
  return { groups, total, hasData: groups.size > 0 };
}

function anthropicCostUSD(amount) {
  const raw = amount && typeof amount === 'object' ? amount.value : amount;
  return Math.max(0, numberValue(raw) / 100);
}

function modelFromDescription(description) {
  const match = String(description || '').match(/\b(claude-[a-z0-9.-]+)\b/i);
  return match ? match[1] : null;
}

function anthropicGroupKey(model, workspaceId) {
  return `${model || 'all'}\u0000${workspaceId || ''}`;
}

function shortIdentifier(value) {
  const text = String(value);
  return text.length > 10 ? `${text.slice(0, 4)}…${text.slice(-4)}` : text;
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(numberValue(value));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(numberValue(value));
}
