import {
  apiFailure,
  readJSONResponse,
  resolveFetch,
} from './api-contract.js';

export const GITHUB_COPILOT_API_VERSION = '2026-03-10';
export const GITHUB_COPILOT_SEAT_URL = 'https://api.github.com/orgs';

export async function fetchGitHubCopilotData({
  apiKey,
  organization,
  username,
  fetchImpl = null,
} = {}) {
  if (!String(apiKey || '').trim()) {
    return apiFailure('github-copilot', 'credentials.missing', 'credential-not-configured');
  }
  const org = safePathSegment(organization);
  const user = safePathSegment(username);
  if (!org || !user) {
    return apiFailure('github-copilot', 'configuration.missing', 'organization-and-username-required');
  }
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) return apiFailure('github-copilot', 'fetch.unavailable', 'fetch-unavailable');

  const url = `${GITHUB_COPILOT_SEAT_URL}/${encodeURIComponent(org)}/members/${encodeURIComponent(user)}/copilot`;
  const response = await readJSONResponse(doFetch, url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${String(apiKey).trim()}`,
      'X-GitHub-Api-Version': GITHUB_COPILOT_API_VERSION,
    },
  }, 'github-copilot', 'seat');
  if (!response.ok) return response;
  return {
    ok: true,
    provider: 'github-copilot',
    data: response.data,
    meta: { organization: org, username: user },
  };
}

export async function fetchGitHubCopilotUsage({
  apiKey,
  organization,
  username,
  fetchImpl = null,
} = {}) {
  const fetched = await fetchGitHubCopilotData({ apiKey, organization, username, fetchImpl });
  if (!fetched.ok) return fetched;
  return parseGitHubCopilotUsage(fetched.data, fetched.meta);
}

export function parseGitHubCopilotUsage(data, { organization = '', username = '' } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return apiFailure('github-copilot', 'seat.schema-invalid', 'seat-schema-invalid');
  }
  const hasSeatFields = ['plan_type', 'last_activity_at', 'last_authenticated_at', 'assignee']
    .some((key) => data[key] != null);
  if (!hasSeatFields) return apiFailure('github-copilot', 'seat.schema-empty', 'seat-schema-empty');
  const planType = typeof data.plan_type === 'string' && data.plan_type.trim()
    ? data.plan_type.trim() : 'unknown';
  const lastActivityISO = validISO(data.last_activity_at);
  const editor = typeof data.last_activity_editor === 'string'
    ? data.last_activity_editor.slice(0, 160) : null;
  const assignee = typeof data.assignee?.login === 'string' && data.assignee.login.trim()
    ? data.assignee.login.trim() : username;
  const label = `Copilot ${titleCase(planType)} seat`;

  return {
    ok: true,
    provider: 'github-copilot',
    source: 'api-key',
    plan: `Copilot ${titleCase(planType)}`,
    accountId: assignee,
    orgId: organization || null,
    seat: {
      lastActivityISO,
      lastAuthenticatedISO: validISO(data.last_authenticated_at),
      editor,
      pendingCancellationDate: validISO(data.pending_cancellation_date),
    },
    buckets: [{
      id: 'github-copilot-seat',
      label,
      kind: 'api',
      model: null,
      percentUsed: 0,
      resetISO: null,
      rawResetText: lastActivityISO
        ? `Last activity ${new Date(lastActivityISO).toISOString()}`
        : 'No Copilot activity reported',
      metric: {
        kind: 'activity',
        active: !!lastActivityISO,
        lastActivityISO,
        lastActivityEditor: editor,
      },
      dimensions: { organization, username: assignee, planType },
    }],
  };
}

function safePathSegment(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(text) ? text : '';
}

function validISO(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function titleCase(value) {
  return String(value || 'unknown')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Unknown';
}
