import {
  addNumbers,
  apiFailure,
  currentMonthRange,
  numberValue,
  readJSONResponse,
  resolveFetch,
  slug,
} from './api-contract.js';

export const OPENAI_USAGE_URL = 'https://api.openai.com/v1/organization/usage/completions';
export const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs';

export async function fetchOpenAIUsage({ apiKey, now = new Date(), fetchImpl = null } = {}) {
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
    readJSONResponse(doFetch, usageUrl, { headers }, 'openai-api', 'usage'),
    readJSONResponse(doFetch, costsUrl, { headers }, 'openai-api', 'costs'),
  ]);

  if (!usage.ok && !costs.ok) {
    return apiFailure('openai-api', 'usage-and-costs.failed', 'usage-and-costs-failed', {
      status: usage.status || costs.status || null,
      usageErrorCode: usage.errorCode || null,
      costsErrorCode: costs.errorCode || null,
    });
  }

  const parsed = parseOpenAIUsage(usage.ok ? usage.data : { data: [] }, {
    costs: costs.ok ? costs.data : null,
    range,
  });
  if (!parsed.ok && costs.ok) return parseOpenAICostsOnly(costs.data, { range });
  if (!parsed.ok) return {
    ...parsed,
    usageErrorCode: usage.errorCode || null,
    costsErrorCode: costs.errorCode || null,
  };
  if (!usage.ok) parsed.warningCode = usage.errorCode || 'openai-api.usage.failed';
  if (!costs.ok) parsed.warningCode = costs.errorCode || 'openai-api.costs.failed';
  return parsed;
}

export function parseOpenAIUsage(data, { costs = null, range = currentMonthRange() } = {}) {
  const groups = new Map();
  for (const bucket of Array.isArray(data?.data) ? data.data : []) {
    for (const result of Array.isArray(bucket?.results) ? bucket.results : []) {
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
  if (!groups.size) return apiFailure('openai-api', 'usage.schema-empty', 'usage-schema-empty');
  return buildOpenAISnapshot([...groups.values()], { range, costs: costGroups });
}

function parseOpenAICostsOnly(data, { range }) {
  const costs = parseCostGroups(data);
  if (!costs.total && !costs.groups.size) return apiFailure('openai-api', 'costs.schema-empty', 'costs-schema-empty');
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
    return {
      id: `openai-api-${slug(group.model)}-${slug(group.projectId || 'all')}-${slug(group.apiKeyId || 'all')}`,
      label,
      kind: 'api',
      model: group.model,
      percentUsed: 0,
      resetISO: null,
      rawResetText: `Month to date · ${formatCount(totalTokens)} tokens`,
      metric: {
        kind: 'tokens',
        inputTokens: group.inputTokens,
        outputTokens: group.outputTokens,
        cachedInputTokens: group.cachedInputTokens,
        totalTokens,
        requests: group.requests,
        costUSD: 0,
      },
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
      metric: { kind: 'currency', costUSD: group.costUSD },
      dimensions: { projectId: group.projectId, apiKeyId: group.apiKeyId, lineItem: group.lineItem },
    };
  });
  const buckets = [...usageBuckets, ...costBuckets];
  return {
    ok: true,
    provider: 'openai-api',
    source: 'api-key',
    range: { startISO: range.startISO, endISO: range.endISO },
    totals: { costUSD: numberValue(costs?.total) },
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
      const key = `${result?.project_id || ''}\u0000${result?.api_key_id || ''}`;
      const existing = groups.get(key) || {
        projectId: result?.project_id || null,
        apiKeyId: result?.api_key_id || null,
        lineItem: result?.line_item || null,
        costUSD: 0,
      };
      if (!existing.lineItem && result?.line_item) existing.lineItem = result.line_item;
      existing.costUSD += value;
      groups.set(key, existing);
    }
  }
  return { groups, total };
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
