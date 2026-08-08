const INSTALL_FLAG = '__autClaudeStreamInterceptorInstalled';

export function installClaudeMessageLimitInterceptor({ target = globalThis, emit, emitRateLimit } = {}) {
  if (!target || typeof emit !== 'function') return false;
  if (target[INSTALL_FLAG]) return false;
  if (typeof target.fetch !== 'function') return false;

  const originalFetch = target.fetch;
  Object.defineProperty(target, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
  });

  target.fetch = async function autClaudeFetchInterceptor(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      inspectClaudeResponse(args[0], response, { emit, emitRateLimit });
    } catch {
      // Stream monitoring must never affect the page's own request.
    }
    return response;
  };
  return true;
}

export function collectClaudeMessageLimitsFromSseText(text) {
  const found = [];
  const state = { buffer: '' };
  consumeClaudeSseText(text, state, (messageLimit) => found.push(messageLimit));
  return found;
}

function inspectClaudeResponse(input, response, { emit, emitRateLimit }) {
  if (!response) return;
  const headerSnapshot = extractClaudeRateLimitHeaders(response.headers);
  if (headerSnapshot && typeof emitRateLimit === 'function') emitRateLimit(headerSnapshot);

  if (!isClaudeCompletionUrl(requestUrl(input))) return;
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType && !/text\/event-stream|application\/x-ndjson|text\/plain/i.test(contentType)) return;
  if (!response.body || typeof response.clone !== 'function') return;

  const clone = response.clone();
  void readClaudeStream(clone, emit);
}

async function readClaudeStream(response, emit) {
  const reader = response.body?.getReader?.();
  if (!reader || typeof TextDecoder === 'undefined') return;

  const decoder = new TextDecoder();
  const state = { buffer: '' };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      consumeClaudeSseText(decoder.decode(value, { stream: true }), state, emit);
    }
    const tail = decoder.decode();
    if (tail) consumeClaudeSseText(tail, state, emit);
  } catch {
    // The page owns the request. A clone-reader failure should stay invisible.
  }
}

export function consumeClaudeSseText(chunk, state, emit) {
  if (!chunk || !state || typeof emit !== 'function') return;
  state.buffer = `${state.buffer || ''}${chunk}`;
  const lines = state.buffer.split(/\r?\n/);
  state.buffer = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payloadText = trimmed.slice(5).trim();
    if (!payloadText || payloadText === '[DONE]') continue;
    try {
      const payload = JSON.parse(payloadText);
      const messageLimit = extractMessageLimit(payload);
      if (messageLimit) emit(messageLimit);
    } catch {
      // Ignore non-JSON stream frames.
    }
  }
}

export function extractClaudeRateLimitHeaders(headers) {
  if (!headers || typeof headers.forEach !== 'function') return null;
  const windows = {};

  headers.forEach((value, rawName) => {
    const name = String(rawName || '').toLowerCase();
    const match = /^anthropic-ratelimit-unified-([a-z0-9_-]+)-(utilization|reset|status)$/.exec(name);
    if (!match) return;

    const key = normalizeRateLimitClaim(match[1]);
    windows[key] = windows[key] || {};
    if (match[2] === 'utilization') {
      const n = Number(value);
      if (Number.isFinite(n)) windows[key].utilization = n;
    } else if (match[2] === 'reset') {
      windows[key].reset_at = value;
    } else if (match[2] === 'status') {
      windows[key].status = value;
    }
  });

  for (const key of Object.keys(windows)) {
    // A reset/status header can arrive before the utilization header. Do not
    // emit a partial window that downstream code could mistake for usage.
    if (windows[key].utilization == null) delete windows[key];
  }
  return Object.keys(windows).length ? { windows } : null;
}

function extractMessageLimit(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.message_limit && typeof payload.message_limit === 'object') return payload.message_limit;
  if (payload.type === 'message_limit' && payload.data?.message_limit) return payload.data.message_limit;
  if (payload.type === 'message_limit' && payload.data) return payload.data;
  return null;
}

function normalizeRateLimitClaim(claim) {
  const normalized = String(claim || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (/^(5h|five_hour|session)$/.test(normalized)) return '5h';
  if (/^(7d|seven_day|weekly|week)$/.test(normalized)) return 'seven_day';
  return normalized || 'unknown';
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return '';
}

function isClaudeCompletionUrl(url) {
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url, location.origin);
  } catch {
    return false;
  }
  return /(^|\.)claude\.ai$/.test(parsed.hostname)
    && /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion\b/.test(parsed.pathname);
}
