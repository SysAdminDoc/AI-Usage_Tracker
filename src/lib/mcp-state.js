export const MCP_STATE_SCHEMA = 'ai-usage-tracker.mcp-state';
export const MCP_STATE_VERSION = 1;

const SAFE_TOTAL_KEYS = [
  'costUSD', 'officialCostUSD', 'estimatedCostUSD', 'spendUSD', 'usageUSD',
  'totalUsageUSD', 'totalCreditsUSD', 'totalTokens', 'inputTokens', 'outputTokens',
  'requests', 'premiumRequests', 'activeDays', 'memberCount',
];
const SAFE_METRIC_KEYS = [
  'kind', 'costUSD', 'costSource', 'pricingVersion', 'totalTokens', 'inputTokens',
  'outputTokens', 'cachedInputTokens', 'cacheReadTokens', 'cacheCreationTokens',
  'requests', 'activeDays', 'subscriptionIncludedReqs', 'usageBasedReqs', 'apiKeyReqs',
  'limitUSD', 'remainingUSD', 'usageDailyUSD', 'usageWeeklyUSD', 'totalCreditsUSD',
  'remainingCreditsUSD',
];
const SAFE_DIMENSION_KEYS = ['model', 'workspaceId', 'projectId', 'apiKeyId', 'lineItem', 'scope'];

/**
 * Build the intentionally narrow state contract consumed by the local MCP
 * server. It is an explicit export boundary, not a second storage adapter.
 */
export function exportMcpState(state = {}, { now = new Date() } = {}) {
  const snapshot = state?.snapshot || {};
  return {
    schema: MCP_STATE_SCHEMA,
    version: MCP_STATE_VERSION,
    exportedAtISO: validISO(now) || new Date().toISOString(),
    snapshot: {
      fetchedAtISO: validISO(snapshot.fetchedAtISO),
      providers: Object.fromEntries(Object.entries(snapshot.providers || {}).map(([provider, value]) => [
        provider,
        sanitizeProvider(provider, value),
      ])),
    },
    redaction: {
      credentials: 'omitted',
      history: 'omitted',
      settings: 'omitted',
      prompts: 'omitted',
      code: 'omitted',
      identifiers: 'shortened',
    },
  };
}

export function normalizeMcpState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('MCP state must be a JSON object');
  }
  if (raw.schema !== MCP_STATE_SCHEMA || raw.version !== MCP_STATE_VERSION) {
    throw new Error(`Unsupported MCP state schema: ${String(raw.schema || 'missing')}`);
  }
  if (!raw.snapshot || typeof raw.snapshot !== 'object' || Array.isArray(raw.snapshot)) {
    throw new Error('MCP state is missing its snapshot');
  }
  return {
    schema: MCP_STATE_SCHEMA,
    version: MCP_STATE_VERSION,
    exportedAtISO: validISO(raw.exportedAtISO),
    snapshot: {
      fetchedAtISO: validISO(raw.snapshot.fetchedAtISO),
      providers: raw.snapshot.providers && typeof raw.snapshot.providers === 'object'
        ? raw.snapshot.providers : {},
    },
    redaction: raw.redaction && typeof raw.redaction === 'object' ? raw.redaction : {},
  };
}

function sanitizeProvider(provider, snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  return {
    ok: snapshot.ok === true,
    provider: safeText(provider),
    source: safeText(snapshot.lastSuccessSource || snapshot.source),
    stale: snapshot.stale === true,
    lastSuccessISO: validISO(snapshot.lastSuccessISO),
    plan: safeText(snapshot.plan),
    range: {
      startISO: validISO(snapshot.range?.startISO),
      endISO: validISO(snapshot.range?.endISO),
    },
    totals: pickNumbers(snapshot.totals),
    buckets: Array.isArray(snapshot.buckets)
      ? snapshot.buckets.map((bucket, index) => sanitizeBucket(bucket, index)).filter(Boolean)
      : [],
  };
}

function sanitizeBucket(bucket, index) {
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return null;
  const metric = pickMetric(bucket.metric);
  return {
    id: shortenIdentifier(bucket.id || `bucket-${index + 1}`),
    label: `bucket ${index + 1}`,
    kind: safeText(bucket.kind || metric?.kind || 'unknown'),
    model: safeText(bucket.model),
    percentUsed: finitePercent(bucket.percentUsed),
    resetISO: validISO(bucket.resetISO),
    rawResetText: null,
    metric,
    dimensions: pickDimensions(bucket.dimensions),
  };
}

function pickNumbers(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(SAFE_TOTAL_KEYS
    .filter((key) => finiteNumber(input[key]) != null)
    .map((key) => [key, finiteNumber(input[key])]));
}

function pickMetric(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const key of SAFE_METRIC_KEYS) {
    if (key === 'costSource' && (input[key] === 'official' || input[key] === 'pricing-table')) out[key] = input[key];
    else if (key === 'pricingVersion' && /^\d{4}-\d{2}-\d{2}$/.test(String(input[key] || ''))) out[key] = input[key];
    else if (key === 'kind' && typeof input[key] === 'string') out[key] = safeText(input[key]);
    else if (!['costSource', 'pricingVersion', 'kind'].includes(key) && finiteNumber(input[key]) != null) out[key] = finiteNumber(input[key]);
  }
  return Object.keys(out).length ? out : null;
}

function pickDimensions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(SAFE_DIMENSION_KEYS
    .filter((key) => input[key] != null && input[key] !== '')
    .map((key) => [key, key === 'model' || key === 'lineItem' || key === 'scope'
      ? safeText(input[key]) : shortenIdentifier(input[key])]));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finitePercent(value) {
  const number = finiteNumber(value);
  return number == null ? null : Math.max(0, Math.min(100, number));
}

function safeText(value) {
  return value == null ? null : String(value).replace(/[\r\n]/g, ' ').slice(0, 160);
}

function shortenIdentifier(value) {
  const text = safeText(value);
  if (!text) return null;
  if (text.length <= 4) return '•••';
  return `${text.slice(0, 2)}…${text.slice(-2)}`;
}

function validISO(value) {
  if (!(value instanceof Date) && (typeof value !== 'string' || !value.trim())) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
