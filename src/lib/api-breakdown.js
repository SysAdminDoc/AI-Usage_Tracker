import { API_PROVIDER_IDS, API_PROVIDER_META } from '../providers/api-contract.js';

export const API_BREAKDOWN_SCHEMA = 'ai-usage-tracker.api-breakdown';
export const API_BREAKDOWN_VERSION = 1;

/**
 * Convert normalized API-provider rows into a portable, credential-free
 * breakdown. Provider dimensions are retained only as shortened identifiers;
 * API credentials live in a separate storage record and never reach here.
 */
export function buildApiBreakdown(snapshot = {}) {
  const rows = [];
  for (const provider of API_PROVIDER_IDS) {
    const providerSnapshot = snapshot?.providers?.[provider];
    if (!providerSnapshot?.ok) continue;
    const buckets = Array.isArray(providerSnapshot.buckets) ? providerSnapshot.buckets : [];
    for (const bucket of buckets) {
      const metric = bucket?.metric;
      if (!metric || typeof metric !== 'object' || Array.isArray(metric)) continue;
      const dimensions = safeDimensions(bucket.dimensions);
      const row = {
        provider,
        providerLabel: API_PROVIDER_META[provider]?.label || provider,
        group: groupLabel(dimensions),
        model: safeText(dimensions.model),
        workspace: redactIdentifier(dimensions.workspaceId),
        project: redactIdentifier(dimensions.projectId),
        apiKey: redactIdentifier(dimensions.apiKeyId),
        lineItem: safeText(dimensions.lineItem),
        costUSD: finiteNumber(metric.costUSD),
        totalTokens: finiteNumber(metric.totalTokens),
        requests: finiteNumber(metric.requests),
        costSource: metric.costSource === 'official' || metric.costSource === 'pricing-table'
          ? metric.costSource : null,
      };
      if (hasBreakdownValue(row)) rows.push(row);
    }
  }
  return {
    schema: API_BREAKDOWN_SCHEMA,
    version: API_BREAKDOWN_VERSION,
    rows,
  };
}

export function apiBreakdownToCSV(breakdown = {}) {
  const rows = Array.isArray(breakdown.rows) ? breakdown.rows : [];
  const output = ['provider,providerLabel,group,model,workspace,project,apiKey,lineItem,costUSD,totalTokens,requests,costSource'];
  for (const row of rows) {
    output.push([
      row.provider,
      row.providerLabel,
      row.group,
      row.model || '',
      row.workspace || '',
      row.project || '',
      row.apiKey || '',
      row.lineItem || '',
      row.costUSD == null ? '' : row.costUSD,
      row.totalTokens == null ? '' : row.totalTokens,
      row.requests == null ? '' : row.requests,
      row.costSource || '',
    ].map(csvCell).join(','));
  }
  return `${output.join('\r\n')}\r\n`;
}

function safeDimensions(dimensions) {
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) return {};
  return Object.fromEntries(Object.entries(dimensions)
    .filter(([key]) => ['model', 'workspaceId', 'projectId', 'apiKeyId', 'lineItem'].includes(key))
    .map(([key, value]) => [key, safeText(value)]));
}

function groupLabel(dimensions) {
  const groups = [];
  if (dimensions.workspaceId) groups.push(`workspace ${redactIdentifier(dimensions.workspaceId)}`);
  if (dimensions.projectId) groups.push(`project ${redactIdentifier(dimensions.projectId)}`);
  if (dimensions.apiKeyId) groups.push(`key ${redactIdentifier(dimensions.apiKeyId)}`);
  if (dimensions.model && dimensions.model !== 'all') groups.push(`model ${dimensions.model}`);
  if (dimensions.lineItem) groups.push(dimensions.lineItem);
  return groups.join(' · ') || 'Provider total';
}

function hasBreakdownValue(row) {
  return !!row.group
    || row.costUSD != null
    || row.totalTokens != null
    || row.requests != null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeText(value) {
  return value == null ? '' : String(value).replace(/[\r\n]/g, ' ').slice(0, 160);
}

function redactIdentifier(value) {
  const text = safeText(value);
  if (!text) return '';
  if (text.length <= 4) return '•••';
  return `${text.slice(0, 2)}…${text.slice(-2)}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
