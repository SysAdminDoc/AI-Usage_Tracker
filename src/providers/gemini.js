import {
  apiFailure,
  currentMonthRange,
  numberValue,
  readJSONResponse,
  resolveFetch,
} from './api-contract.js';

export const GEMINI_MONITORING_BASE_URL = 'https://monitoring.googleapis.com/v3/projects';
export const GEMINI_OUTPUT_TOKEN_METRIC = 'generativelanguage.googleapis.com/generate_content_usage_output_token_count';
export const GEMINI_REQUEST_USAGE_METRIC = 'generativelanguage.googleapis.com/quota/generate_requests_per_model/usage';

export async function fetchGeminiData({ apiKey, projectId, now = new Date(), fetchImpl = null } = {}) {
  const token = String(apiKey || '').trim();
  if (!token) return apiFailure('gemini', 'credentials.missing', 'credential-not-configured');
  const project = normalizeProjectId(projectId);
  if (!project) return apiFailure('gemini', 'configuration.missing', 'project-id-required');
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return apiFailure('gemini', 'fetch.unavailable', 'fetch-unavailable');

  const range = currentMonthRange(now);
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const [output, requests] = await Promise.all([
    readJSONResponse(doFetch, buildMetricUrl(project, GEMINI_OUTPUT_TOKEN_METRIC, range), { headers }, 'gemini', 'output'),
    readJSONResponse(doFetch, buildMetricUrl(project, GEMINI_REQUEST_USAGE_METRIC, range), { headers }, 'gemini', 'requests'),
  ]);
  if (!output.ok && !requests.ok) {
    return apiFailure('gemini', 'usage.failed', 'usage-fetch-failed', {
      status: output.status || requests.status || null,
      outputErrorCode: output.errorCode || null,
      requestsErrorCode: requests.errorCode || null,
    });
  }

  return {
    ok: true,
    provider: 'gemini',
    data: {
      output: output.ok ? output.data : null,
      requests: requests.ok ? requests.data : null,
    },
    meta: {
      range,
      projectId: project,
      outputOk: output.ok,
      requestsOk: requests.ok,
      outputErrorCode: output.errorCode || null,
      requestsErrorCode: requests.errorCode || null,
    },
  };
}

export function parseGeminiResponse(data, { range = currentMonthRange(), projectId = '', outputOk = true,
  requestsOk = true, outputErrorCode = null, requestsErrorCode = null } = {}) {
  const parsed = parseGeminiUsage(data || {}, { range, projectId });
  if (!parsed.ok) return parsed;
  const warnings = [];
  if (!outputOk) warnings.push(outputErrorCode || 'gemini.output.failed');
  if (!requestsOk) warnings.push(requestsErrorCode || 'gemini.requests.failed');
  if (warnings.length) {
    parsed.warningCode = warnings[0];
    parsed.warningCodes = warnings;
  }
  return parsed;
}

export async function fetchGeminiUsage({ apiKey, projectId, now = new Date(), fetchImpl = null } = {}) {
  const fetched = await fetchGeminiData({ apiKey, projectId, now, fetchImpl });
  if (!fetched.ok) return fetched;
  return parseGeminiResponse(fetched.data, fetched.meta);
}

export function parseGeminiUsage({ output = null, requests = null } = {}, {
  range = currentMonthRange(),
  projectId = '',
} = {}) {
  if (!output && !requests) return apiFailure('gemini', 'usage.schema-empty', 'usage-schema-empty');
  const outputUsage = summarizeTimeSeries(output);
  const requestUsage = summarizeTimeSeries(requests);
  if (!outputUsage.hasShape && !requestUsage.hasShape) {
    return apiFailure('gemini', 'usage.schema-empty', 'usage-schema-empty');
  }

  const models = new Set([...outputUsage.models, ...requestUsage.models]);
  const outputTokens = outputUsage.total;
  const requestCount = requestUsage.total;
  const latestISO = latestISOValue(outputUsage.latestISO, requestUsage.latestISO);
  return {
    ok: true,
    provider: 'gemini',
    source: 'api-key',
    plan: 'Gemini API',
    range: { startISO: range.startISO, endISO: range.endISO },
    totals: { outputTokens, requests: requestCount, totalTokens: outputTokens },
    buckets: [{
      id: 'gemini-token-usage',
      label: 'Gemini token usage',
      kind: 'api',
      model: null,
      percentUsed: 0,
      resetISO: null,
      rawResetText: latestISO
        ? `Month to date · through ${latestISO.slice(0, 10)}`
        : `Month to date · ${range.startISO.slice(0, 10)} onward`,
      metric: {
        kind: 'tokens',
        outputTokens,
        totalTokens: outputTokens,
        requests: requestCount,
        latestUsageISO: latestISO,
      },
      dimensions: {
        projectId: normalizeProjectId(projectId) || null,
        models: [...models].slice(0, 12).join(', '),
      },
    }],
  };
}

function buildMetricUrl(projectId, metric, range) {
  const url = new URL(`${GEMINI_MONITORING_BASE_URL}/${encodeURIComponent(projectId)}/timeSeries`);
  url.searchParams.set('filter', `metric.type = "${metric}"`);
  url.searchParams.set('interval.startTime', range.startISO);
  url.searchParams.set('interval.endTime', range.endISO);
  url.searchParams.set('view', 'FULL');
  url.searchParams.set('pageSize', '100');
  url.searchParams.set('aggregation.alignmentPeriod', '86400s');
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
  url.searchParams.set('aggregation.crossSeriesReducer', 'REDUCE_SUM');
  return url.toString();
}

function summarizeTimeSeries(data) {
  const series = Array.isArray(data?.timeSeries) ? data.timeSeries : [];
  const summary = { total: 0, latestISO: null, models: new Set(), hasShape: Array.isArray(data?.timeSeries) };
  for (const timeSeries of series) {
    const model = timeSeries?.metric?.labels?.model;
    if (model) summary.models.add(String(model).slice(0, 120));
    for (const point of Array.isArray(timeSeries?.points) ? timeSeries.points : []) {
      summary.total += pointValue(point?.value);
      const iso = timestampISO(point?.interval?.endTime || point?.interval?.startTime);
      if (iso && (!summary.latestISO || iso > summary.latestISO)) summary.latestISO = iso;
    }
  }
  return summary;
}

function pointValue(value) {
  if (!value || typeof value !== 'object') return 0;
  return numberValue(value.int64Value ?? value.doubleValue ?? value.distributionValue);
}

function timestampISO(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latestISOValue(...values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function normalizeProjectId(value) {
  const project = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ? project : '';
}
