import {
  addNumbers,
  apiFailure,
  apiSchemaFailure,
  currentMonthRange,
  numberValue,
  readJSONPages,
  resolveFetch,
  slug,
} from './api-contract.js';
import { estimateTokenCost } from '../lib/pricing.js';
import { supportedSchema } from '../lib/schema-sentinel.js';

export const OPENAI_USAGE_URL = 'https://api.openai.com/v1/organization/usage/completions';
export const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs';

export async function fetchOpenAIData({ apiKey, now = new Date(), fetchImpl = null } = {}) {
  if (!String(apiKey || '').trim()) return apiFailure('openai-api', 'credentials.missing', 'credential-not-configured');
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return apiFailure('openai-api', 'fetch.unavailable', 'fetch-unavailable');

  const range = currentMonthRange(now);
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${String(apiKey).trim()}`,
  };
  const usageUrl = buildOpenAIUrl(OPENAI_USAGE_URL, range, [
    ['group_by[]', 'model'],
    ['group_by[]', 'project_id'],
    ['group_by[]', 'api_key_id'],
  ]);
  const costsUrl = buildOpenAIUrl(OPENAI_COSTS_URL, range, [
    ['group_by[]', 'line_item'],
    ['group_by[]', 'project_id'],
    ['group_by[]', 'api_key_id'],
  ]);

  const [usage, costs] = await Promise.all([
    readJSONPages(doFetch, usageUrl, { headers }, 'openai-api', 'usage'),
    readJSONPages(doFetch, costsUrl, { headers }, 'openai-api', 'costs'),
  ]);

  if (!usage.ok && !costs.ok) {
    return apiFailure('openai-api', 'usage-and-costs.failed', 'usage-and-costs-failed', {
      status: usage.status || costs.status || null,
      retryAfterMs: Math.max(usage.retryAfterMs || 0, costs.retryAfterMs || 0),
      usageErrorCode: usage.errorCode || null,
      costsErrorCode: costs.errorCode || null,
    });
  }

  return {
    ok: true,
    provider: 'openai-api',
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

export function parseOpenAIResponse(data, { range = currentMonthRange(), usageOk = true, costsOk = true,
  usageErrorCode = null, costsErrorCode = null, usageTruncated = false, costsTruncated = false } = {}) {
  if (usageTruncated || costsTruncated) {
    return apiSchemaFailure('openai-api', 'pagination', 'pagination-truncated', {
      usageTruncated,
      costsTruncated,
    });
  }
  const parsed = parseOpenAIUsage(data?.usage || { data: [] }, {
    costs: data?.costs || null,
    range,
  });
  if (!parsed.ok && data?.costs) return parseOpenAICostsOnly(data.costs, { range });
  if (!parsed.ok) return {
    ...parsed,
    usageErrorCode,
    costsErrorCode,
  };
  if (!usageOk) parsed.warningCode = usageErrorCode || 'openai-api.usage.failed';
  if (!costsOk) parsed.warningCode = costsErrorCode || 'openai-api.costs.failed';
  const paginationWarnings = [];
  if (usageTruncated) paginationWarnings.push('openai-api.usage.pagination-truncated');
  if (costsTruncated) paginationWarnings.push('openai-api.costs.pagination-truncated');
  if (paginationWarnings.length) {
    parsed.warningCode = parsed.warningCode || paginationWarnings[0];
    parsed.warningCodes = [...(parsed.warningCodes || []), ...paginationWarnings];
  }
  return parsed;
}

export async function fetchOpenAIUsage({ apiKey, now = new Date(), fetchImpl = null } = {}) {
  const fetched = await fetchOpenAIData({ apiKey, now, fetchImpl });
  if (!fetched.ok) return fetched;
  return parseOpenAIResponse(fetched.data, fetched.meta);
}

export function parseOpenAIUsage(data, { costs = null, range = currentMonthRange() } = {}) {
  const groups = new Map();
  for (const bucket of Array.isArray(data?.data) ? data.data : []) {
    for (const result of Array.isArray(bucket?.results) ? bucket.results : []) {
      if (!hasSupportedOpenAIResult(result)) continue;
      const model = result?.model || 'all';
      const projectId = result?.project_id || null;
      const apiKeyId = result?.api_key_id || null;
      const key = `${model}\u0000${projectId || ''}\u0000${apiKeyId || ''}`;
      if (!groups.has(key)) groups.set(key, {
        model,
        projectId,
        apiKeyId,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        requests: 0,
        costUSD: 0,
      });
      const group = groups.get(key);
      addNumbers(group, 'inputTokens', result?.input_tokens);
      addNumbers(group, 'outputTokens', result?.output_tokens);
      addNumbers(group, 'cachedInputTokens', result?.input_cached_tokens);
      addNumbers(group, 'requests', result?.num_model_requests);
    }
  }

  const costGroups = parseCostGroups(costs);
  if (!groups.size) {
    return apiSchemaFailure('openai-api', 'usage', 'missing-supported-usage-shape', {
      usage: data,
      costs,
    });
  }
  return buildOpenAISnapshot([...groups.values()], { range, costs: costGroups });
}

function hasSupportedOpenAIResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  return [
    'input_tokens', 'output_tokens', 'input_cached_tokens', 'num_model_requests',
  ].some((key) => Number.isFinite(Number(result[key])));
}

function parseOpenAICostsOnly(data, { range }) {
  const costs = parseCostGroups(data);
  if (!costs.total && !costs.groups.size) {
    return apiSchemaFailure('openai-api', 'costs', 'missing-supported-cost-shape', data);
  }
  return buildOpenAISnapshot([{
    model: 'all', projectId: null, apiKeyId: null, inputTokens: 0, outputTokens: 0,
    cachedInputTokens: 0, requests: 0,
  }], { range, costs });
}

function buildOpenAISnapshot(groups, { range, costs }) {
  const usageBuckets = groups.map((group) => {
    const parts = [];
    if (group.model && group.model !== 'all') parts.push(group.model);
    if (group.projectId) parts.push(`project ${shortIdentifier(group.projectId)}`);
    if (group.apiKeyId) parts.push(`key ${shortIdentifier(group.apiKeyId)}`);
    const label = parts.join(' · ') || 'All API usage';
    const totalTokens = group.inputTokens + group.outputTokens;
    const estimate = estimateTokenCost('openai-api', group.model, {
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
      cachedInputTokens: group.cachedInputTokens,
    });
    const metric = {
      kind: 'tokens',
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
      cachedInputTokens: group.cachedInputTokens,
      totalTokens,
      requests: group.requests,
    };
    if (estimate) Object.assign(metric, estimate);
    return {
      id: `openai-api-${slug(group.model)}-${slug(group.projectId || 'all')}-${slug(group.apiKeyId || 'all')}`,
      label,
      kind: 'api',
      model: group.model,
      percentUsed: 0,
      resetISO: null,
      rawResetText: `Month to date · ${formatCount(totalTokens)} tokens`,
      metric,
      dimensions: {
        model: group.model,
        projectId: group.projectId,
        apiKeyId: group.apiKeyId,
      },
    };
  });
  const costBuckets = [...(costs?.groups?.values() || [])].map((group) => {
    const dimensions = [];
    if (group.projectId) dimensions.push(`project ${shortIdentifier(group.projectId)}`);
    if (group.apiKeyId) dimensions.push(`key ${shortIdentifier(group.apiKeyId)}`);
    if (group.lineItem) dimensions.push(group.lineItem);
    return {
      id: `openai-api-cost-${slug(group.projectId || 'all')}-${slug(group.apiKeyId || 'all')}-${slug(group.lineItem || 'all')}`,
      label: `Cost${dimensions.length ? ` · ${dimensions.join(' · ')}` : ''}`,
      kind: 'api',
      model: null,
      percentUsed: 0,
      resetISO: null,
      rawResetText: `Month to date · ${formatCurrency(group.costUSD)}`,
      metric: { kind: 'currency', costUSD: group.costUSD, costSource: 'official' },
      dimensions: { projectId: group.projectId, apiKeyId: group.apiKeyId, lineItem: group.lineItem },
    };
  });
  const buckets = [...usageBuckets, ...costBuckets];
  const estimatedCostUSD = usageBuckets.reduce((sum, bucket) => (
    bucket.metric.costSource === 'pricing-table' ? sum + numberValue(bucket.metric.costUSD) : sum
  ), 0);
  return {
    ok: true,
    provider: 'openai-api',
    source: 'api-key',
    ...supportedSchema('openai-api', 'usage', 'usage-and-costs'),
    schemaSources: ['usage', 'costs'],
    range: { startISO: range.startISO, endISO: range.endISO },
    totals: {
      costUSD: costs?.hasData ? numberValue(costs.total) : estimatedCostUSD,
      officialCostUSD: costs?.hasData ? numberValue(costs.total) : null,
      estimatedCostUSD,
      pricedModelCount: usageBuckets.filter((bucket) => bucket.metric.costSource === 'pricing-table').length,
      unpricedModelCount: usageBuckets.filter((bucket) => !bucket.metric.costSource).length,
    },
    buckets: buckets.sort((a, b) => (b.metric.costUSD || 0) - (a.metric.costUSD || 0)
      || (b.metric.totalTokens || 0) - (a.metric.totalTokens || 0)),
  };
}

function parseCostGroups(data) {
  const groups = new Map();
  let total = 0;
  for (const bucket of Array.isArray(data?.data) ? data.data : []) {
    for (const result of Array.isArray(bucket?.results) ? bucket.results : []) {
      const value = numberValue(result?.amount?.value ?? result?.amount);
      total += value;
      const lineItem = result?.line_item || null;
      const key = `${result?.project_id || ''}\u0000${result?.api_key_id || ''}\u0000${lineItem || ''}`;
      const existing = groups.get(key) || {
        projectId: result?.project_id || null,
        apiKeyId: result?.api_key_id || null,
        lineItem,
        costUSD: 0,
      };
      if (!existing.lineItem && result?.line_item) existing.lineItem = result.line_item;
      existing.costUSD += value;
      groups.set(key, existing);
    }
  }
  return { groups, total, hasData: groups.size > 0 };
}

function buildOpenAIUrl(endpoint, range, extra = []) {
  const url = new URL(endpoint);
  url.searchParams.set('start_time', String(Math.floor(range.start.getTime() / 1000)));
  url.searchParams.set('end_time', String(Math.floor(range.end.getTime() / 1000)));
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('limit', '31');
  for (const [key, value] of extra) url.searchParams.append(key, value);
  return url.toString();
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
