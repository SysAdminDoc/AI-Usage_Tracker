// Shared contract for opt-in API-key providers. API providers return the same
// snapshot shape as the web providers, but use `kind: 'api'` buckets with a
// metric payload instead of pretending token counts are quota percentages.

export const API_PROVIDER_IDS = Object.freeze(['anthropic-api', 'openai-api', 'github-copilot']);

export const API_PROVIDER_META = Object.freeze({
  'anthropic-api': Object.freeze({
    label: 'Anthropic API',
    credentialLabel: 'Anthropic admin key',
    placeholder: 'sk-ant-admin...',
    hint: 'Requires an Anthropic organization admin key with usage-report access.',
    docsUrl: 'https://platform.claude.com/docs/en/api/admin/usage_report/retrieve_messages',
  }),
  'openai-api': Object.freeze({
    label: 'OpenAI API',
    credentialLabel: 'OpenAI admin key',
    placeholder: 'sk-admin...',
    hint: 'Requires an OpenAI organization admin key for Usage and Costs.',
    docsUrl: 'https://platform.openai.com/docs/api-reference/usage',
  }),
  'github-copilot': Object.freeze({
    label: 'GitHub Copilot',
    credentialLabel: 'GitHub token',
    placeholder: 'github_pat_...',
    hint: 'Requires a local GitHub token with read access to Copilot seat details, plus your organization and username below.',
    docsUrl: 'https://docs.github.com/en/rest/copilot/copilot-user-management',
  }),
});

export function apiProviderLabel(provider) {
  return API_PROVIDER_META[provider]?.label || String(provider);
}

export function apiFailure(provider, code, error, extra = {}) {
  return {
    ok: false,
    provider,
    source: 'api-key',
    buckets: [],
    error: String(error || 'api-provider-failed'),
    errorCode: `${provider}.${code}`,
    ...extra,
  };
}

export function resolveFetch(fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  return null;
}

export function currentMonthRange(now = new Date()) {
  const end = new Date(now);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return { start, end, startISO: start.toISOString(), endISO: end.toISOString() };
}

export async function readJSONResponse(fetchImpl, url, options, provider, errorPrefix = 'usage') {
  try {
    const response = await fetchImpl(url, options);
    if (!response?.ok) {
      return apiFailure(provider, `${errorPrefix}.http`, `http-${response?.status || 'unknown'}`, {
        status: Number(response?.status) || null,
      });
    }
    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    // Never include request options in an error: they contain the credential.
    return apiFailure(provider, `${errorPrefix}.fetch-failed`, 'fetch-failed');
  }
}

export function numberValue(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function slug(value, fallback = 'all') {
  const text = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return text || fallback;
}

export function addNumbers(target, key, value) {
  target[key] = numberValue(target[key]) + numberValue(value);
}
