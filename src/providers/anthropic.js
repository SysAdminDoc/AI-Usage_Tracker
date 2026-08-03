import {
  addNumbers,
  apiFailure,
  currentMonthRange,
  numberValue,
  readJSONResponse,
  resolveFetch,
  slug,
} from './api-contract.js';

export const ANTHROPIC_API_USAGE_URL = 'https://api.anthropic.com/v1/organizations/usage_report/messages';

export async function fetchAnthropicUsage({ apiKey, now = new Date(), fetchImpl = null } = {}) {
  if (!String(apiKey || '').trim()) return apiFailure('anthropic-api', 'credentials.missing', 'credential-not-configured');
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return apiFailure('anthropic-api', 'fetch.unavailable', 'fetch-unavailable');

  const range = currentMonthRange(now);
  const url = new URL(ANTHROPIC_API_USAGE_URL);
  url.searchParams.set('starting_at', range.startISO);
  url.searchParams.set('ending_at', range.endISO);
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('limit', '31');
  url.searchParams.append('group_by[]', 'model');
  url.searchParams.append('group_by[]', 'workspace_id');

  const response = await readJSONResponse(doFetch, url.toString(), {
    headers: {
      Accept: 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': String(apiKey).trim(),
    },
  }, 'anthropic-api', 'usage');
  if (!response.ok) return response;

  return parseAnthropicUsage(response.data, { range });
}

export function parseAnthropicUsage(data, { range = currentMonthRange() } = {}) {
  const groups = new Map();
  const buckets = Array.isArray(data?.data) ? data.data : [];

  for (const timeBucket of buckets) {
    for (const result of Array.isArray(timeBucket?.results) ? timeBucket.results : []) {
      const model = result?.model || 'all';
      const workspaceId = result?.workspace_id || 'default';
      const key = `${model}\u0000${workspaceId}`;
      if (!groups.has(key)) groups.set(key, {
        model,
        workspaceId: workspaceId === 'default' ? null : workspaceId,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        webSearchRequests: 0,
      });
      const group = groups.get(key);
      addNumbers(group, 'inputTokens', result?.uncached_input_tokens);
      addNumbers(group, 'outputTokens', result?.output_tokens);
      addNumbers(group, 'cacheReadTokens', result?.cache_read_input_tokens);
      addNumbers(group, 'cacheCreationTokens', result?.cache_creation?.ephemeral_5m_input_tokens);
      addNumbers(group, 'cacheCreationTokens', result?.cache_creation?.ephemeral_1h_input_tokens);
      addNumbers(group, 'webSearchRequests', result?.server_tool_use?.web_search_requests);
    }
  }

  if (!groups.size) return apiFailure('anthropic-api', 'usage.schema-empty', 'usage-schema-empty');

  const output = [...groups.values()].map((group) => {
    const totalTokens = group.inputTokens + group.outputTokens + group.cacheReadTokens + group.cacheCreationTokens;
    const modelLabel = group.model === 'all' ? 'All models' : group.model;
    const workspaceLabel = group.workspaceId ? ` · workspace ${shortIdentifier(group.workspaceId)}` : '';
    return {
      id: `anthropic-api-${slug(group.model)}${group.workspaceId ? `-${slug(group.workspaceId)}` : ''}`,
      label: `${modelLabel}${workspaceLabel}`,
      kind: 'api',
      model: group.model,
      percentUsed: 0,
      resetISO: null,
      rawResetText: `Month to date · ${formatCount(totalTokens)} tokens`,
      metric: {
        kind: 'tokens',
        inputTokens: group.inputTokens,
        outputTokens: group.outputTokens,
        cacheReadTokens: group.cacheReadTokens,
        cacheCreationTokens: group.cacheCreationTokens,
        totalTokens,
        webSearchRequests: group.webSearchRequests,
      },
      dimensions: { model: group.model, workspaceId: group.workspaceId },
    };
  });

  return {
    ok: true,
    provider: 'anthropic-api',
    source: 'api-key',
    range: { startISO: range.startISO, endISO: range.endISO },
    buckets: output.sort((a, b) => b.metric.totalTokens - a.metric.totalTokens),
  };
}

function shortIdentifier(value) {
  const text = String(value);
  return text.length > 10 ? `${text.slice(0, 4)}…${text.slice(-4)}` : text;
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(numberValue(value));
}
