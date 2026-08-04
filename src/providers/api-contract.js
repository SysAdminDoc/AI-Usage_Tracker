// Shared contract for opt-in API-key providers. API providers return the same
// snapshot shape as the web providers, but use `kind: 'api'` buckets with a
// metric payload instead of pretending token counts are quota percentages.

export const API_PROVIDER_IDS = Object.freeze(['anthropic-api', 'openai-api', 'github-copilot', 'cursor', 'gemini', 'openrouter']);

export const API_PROVIDER_META = Object.freeze({
  'anthropic-api': Object.freeze({
    label: 'Anthropic API',
    credentialLabel: 'Anthropic admin key',
    placeholder: 'sk-ant-admin...',
    hint: 'Requires an Anthropic organization admin key with usage-report access.',
    costHint: 'Per-model USD costs use Anthropic Cost Report data; the bundled table is only a fallback.',
    docsUrl: 'https://platform.claude.com/docs/en/api/admin/usage_report/retrieve_messages',
  }),
  'openai-api': Object.freeze({
    label: 'OpenAI API',
    credentialLabel: 'OpenAI admin key',
    placeholder: 'sk-admin...',
    hint: 'Requires an OpenAI organization admin key for Usage and Costs.',
    costHint: 'Per-model USD costs use the bundled pricing table; official Costs remains the reconciliation total.',
    docsUrl: 'https://platform.openai.com/docs/api-reference/usage',
  }),
  'github-copilot': Object.freeze({
    label: 'GitHub Copilot',
    credentialLabel: 'GitHub token',
    placeholder: 'github_pat_...',
    hint: 'Requires a local GitHub token with read access to Copilot seat details, plus your organization and username below.',
    costHint: 'Seat activity only; no API cost is inferred.',
    docsUrl: 'https://docs.github.com/en/rest/copilot/copilot-user-management',
  }),
  cursor: Object.freeze({
    label: 'Cursor',
    credentialLabel: 'Cursor Admin API key',
    placeholder: 'key_...',
    hint: 'Requires a Cursor team administrator API key for read-only team usage and spend data.',
    costHint: 'Official spend is team-level; Cursor does not return per-model costs here.',
    docsUrl: 'https://docs.cursor.com/en/account/teams/admin-api',
  }),
  gemini: Object.freeze({
    label: 'Gemini',
    credentialLabel: 'Google Cloud monitoring token',
    placeholder: 'ya29....',
    hint: 'Requires a local Google Cloud OAuth token with monitoring.read access and the Gemini project ID below.',
    costHint: 'Monitoring exposes token and request usage; no billing cost is inferred.',
    docsUrl: 'https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list',
  }),
  openrouter: Object.freeze({
    label: 'OpenRouter',
    credentialLabel: 'OpenRouter API key',
    placeholder: 'sk-or-v1-...',
    hint: 'Requires an OpenRouter key; the tracker reads the official key usage and credits endpoints only.',
    costHint: 'Official key usage and credits are shown; per-model cost history is not published by this endpoint.',
    docsUrl: 'https://openrouter.ai/docs/api/api-reference/credits/get-credits',
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

export async function readJSONPages(fetchImpl, initialUrl, options, provider, errorPrefix = 'usage', {
  maxPages = 64,
} = {}) {
  const pages = [];
  let nextUrl = initialUrl;
  let truncated = false;

  for (let pageIndex = 0; pageIndex < maxPages && nextUrl; pageIndex += 1) {
    const response = await readJSONResponse(fetchImpl, nextUrl, options, provider, errorPrefix);
    if (!response.ok) return response;
    pages.push(response.data);
    const nextPage = response.data?.has_more === true ? String(response.data.next_page || '') : '';
    if (!nextPage) break;
    if (pageIndex === maxPages - 1) {
      truncated = true;
      break;
    }
    const pageUrl = new URL(initialUrl);
    pageUrl.searchParams.set('page', nextPage);
    nextUrl = pageUrl.toString();
  }

  return {
    ok: true,
    data: mergePagedJSON(pages),
    truncated,
  };
}

function mergePagedJSON(pages) {
  const first = pages[0] && typeof pages[0] === 'object' ? pages[0] : {};
  const data = pages.flatMap((page) => Array.isArray(page?.data) ? page.data : []);
  return {
    ...first,
    ...(data.length || pages.some((page) => Array.isArray(page?.data)) ? { data } : {}),
    has_more: false,
    next_page: null,
  };
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
