// Shared contract for opt-in API-key providers. API providers return the same
// snapshot shape as the web providers, but use `kind: 'api'` buckets with a
// metric payload instead of pretending token counts are quota percentages.

export const API_PROVIDER_IDS = Object.freeze(['anthropic-api', 'openai-api', 'github-copilot', 'cursor', 'gemini', 'openrouter']);

export const API_REQUEST_TIMEOUT_MS = 15_000;
export const API_MAX_REQUEST_TIMEOUT_MS = 60_000;
export const API_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const API_MAX_TOTAL_RESPONSE_BYTES = 8 * 1024 * 1024;
export const API_MAX_PAGES = 64;
export const API_MAX_ITEMS = 10_000;

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

export async function readJSONResponse(fetchImpl, url, options, provider, errorPrefix = 'usage', {
  timeoutMs = API_REQUEST_TIMEOUT_MS,
  maxResponseBytes = API_MAX_RESPONSE_BYTES,
} = {}) {
  const requestBudget = createRequestBudget(options, timeoutMs);
  let response = null;
  try {
    const fetchPromise = Promise.resolve().then(() => fetchImpl(url, requestBudget.options));
    response = requestBudget.controller
      ? await fetchPromise
      : await Promise.race([fetchPromise, requestTimeout(requestBudget)]);
    if (!response?.ok) {
      return apiFailure(provider, `${errorPrefix}.http`, `http-${response?.status || 'unknown'}`, {
        status: Number(response?.status) || null,
      });
    }
    const body = await readJSONBody(response, maxResponseBytes);
    return { ok: true, data: body.data, bytes: body.bytes };
  } catch (error) {
    // Never include request options in an error: they contain the credential.
    if (requestBudget.timedOut) {
      return apiFailure(provider, `${errorPrefix}.timeout`, 'request-timeout');
    }
    if (requestBudget.callerAborted) {
      return apiFailure(provider, `${errorPrefix}.aborted`, 'request-aborted');
    }
    if (error?.code === 'response-too-large') {
      return apiFailure(provider, `${errorPrefix}.response-too-large`, 'response-too-large', {
        status: Number(response?.status) || null,
      });
    }
    if (error?.code === 'invalid-json') {
      return apiFailure(provider, `${errorPrefix}.invalid-json`, 'invalid-json', {
        status: Number(response?.status) || null,
      });
    }
    if (error?.code === 'response-body-unavailable') {
      return apiFailure(provider, `${errorPrefix}.body-unavailable`, 'response-body-unavailable', {
        status: Number(response?.status) || null,
      });
    }
    return apiFailure(provider, `${errorPrefix}.fetch-failed`, 'fetch-failed');
  } finally {
    requestBudget.cleanup();
  }
}

export async function readJSONPages(fetchImpl, initialUrl, options, provider, errorPrefix = 'usage', {
  maxPages = API_MAX_PAGES,
  maxItems = API_MAX_ITEMS,
  maxResponseBytes = API_MAX_RESPONSE_BYTES,
  maxTotalResponseBytes = API_MAX_TOTAL_RESPONSE_BYTES,
  timeoutMs = API_REQUEST_TIMEOUT_MS,
} = {}) {
  const pages = [];
  let nextUrl = initialUrl;
  let truncated = false;
  let totalBytes = 0;
  let totalItems = 0;
  const pageLimit = boundedInteger(maxPages, API_MAX_PAGES, 1, API_MAX_PAGES);
  const itemLimit = boundedInteger(maxItems, API_MAX_ITEMS, 1, API_MAX_ITEMS);
  const responseLimit = boundedInteger(maxResponseBytes, API_MAX_RESPONSE_BYTES, 1, API_MAX_RESPONSE_BYTES);
  const totalResponseLimit = boundedInteger(
    maxTotalResponseBytes,
    API_MAX_TOTAL_RESPONSE_BYTES,
    1,
    API_MAX_TOTAL_RESPONSE_BYTES,
  );

  for (let pageIndex = 0; pageIndex < pageLimit && nextUrl; pageIndex += 1) {
    const response = await readJSONResponse(fetchImpl, nextUrl, options, provider, errorPrefix, {
      timeoutMs,
      maxResponseBytes: responseLimit,
    });
    if (!response.ok) return response;
    pages.push(response.data);
    totalBytes += Number(response.bytes) || 0;
    if (totalBytes > totalResponseLimit) {
      return apiFailure(provider, `${errorPrefix}.total-response-too-large`, 'total-response-too-large');
    }
    const pageItems = Array.isArray(response.data?.data) ? response.data.data.length : 0;
    totalItems += pageItems;
    if (totalItems > itemLimit) {
      return apiFailure(provider, `${errorPrefix}.response-items-too-many`, 'response-items-too-many');
    }
    const nextPage = response.data?.has_more === true ? String(response.data.next_page || '') : '';
    if (!nextPage) break;
    if (pageIndex === pageLimit - 1) {
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
    totalBytes,
    totalItems,
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function createRequestBudget(options, timeoutMs) {
  const requestOptions = options && typeof options === 'object' ? options : {};
  const timeout = boundedInteger(timeoutMs, API_REQUEST_TIMEOUT_MS, 1, API_MAX_REQUEST_TIMEOUT_MS);
  const callerSignal = requestOptions.signal;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timedOut = false;
  let callerAborted = Boolean(callerSignal?.aborted);
  let timer = null;
  let removeAbortListener = () => {};

  if (controller) {
    const abortFromCaller = () => {
      callerAborted = true;
      controller.abort(callerSignal?.reason);
    };
    if (callerSignal?.aborted) controller.abort(callerSignal.reason);
    else if (typeof callerSignal?.addEventListener === 'function') {
      callerSignal.addEventListener('abort', abortFromCaller, { once: true });
      removeAbortListener = () => callerSignal.removeEventListener('abort', abortFromCaller);
    }
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    return {
      controller,
      options: { ...requestOptions, signal: controller.signal },
      get timedOut() { return timedOut; },
      get callerAborted() { return callerAborted; },
      cleanup() {
        if (timer != null) clearTimeout(timer);
        removeAbortListener();
      },
    };
  }

  return {
    controller: null,
    options: requestOptions,
    timeout,
    get timedOut() { return timedOut; },
    get callerAborted() { return callerAborted; },
    markTimedOut() { timedOut = true; },
    cleanup() {},
  };
}

function requestTimeout(requestBudget) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      requestBudget.markTimedOut();
      reject(new Error('request-timeout'));
    }, requestBudget.timeout);
  });
}

async function readJSONBody(response, maxResponseBytes) {
  const limit = boundedInteger(maxResponseBytes, API_MAX_RESPONSE_BYTES, 1, API_MAX_RESPONSE_BYTES);
  const declaredBytes = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > limit) throw codedError('response-too-large');

  if (response?.body?.getReader && typeof TextDecoder === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const value = chunk.value;
        bytes += Number(value?.byteLength) || 0;
        if (bytes > limit) {
          await reader.cancel().catch(() => {});
          throw codedError('response-too-large');
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock?.();
    }
    return { data: parseJSONText(text), bytes };
  }

  if (typeof response?.arrayBuffer === 'function' && typeof TextDecoder === 'function') {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > limit) throw codedError('response-too-large');
    return { data: parseJSONText(new TextDecoder().decode(buffer)), bytes: buffer.byteLength };
  }

  if (typeof response?.text === 'function') {
    const text = await response.text();
    const bytes = encodedByteLength(text);
    if (bytes > limit) throw codedError('response-too-large');
    return { data: parseJSONText(text), bytes };
  }

  if (typeof response?.json === 'function') {
    const data = await response.json();
    const bytes = encodedByteLength(JSON.stringify(data));
    if (bytes > limit) throw codedError('response-too-large');
    return { data, bytes };
  }

  throw codedError('response-body-unavailable');
}

function parseJSONText(text) {
  try {
    return JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    throw codedError('invalid-json');
  }
}

function encodedByteLength(value) {
  const text = String(value ?? '');
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
  return text.length;
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
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
