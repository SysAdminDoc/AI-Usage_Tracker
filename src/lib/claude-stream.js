const INSTALL_FLAG = '__autClaudeStreamInterceptorInstalled';

export function installClaudeMessageLimitInterceptor({ target = globalThis, emit } = {}) {
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
      inspectClaudeStreamResponse(args[0], response, emit);
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

function inspectClaudeStreamResponse(input, response, emit) {
  if (!response || !isClaudeCompletionUrl(requestUrl(input))) return;
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

function extractMessageLimit(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.message_limit && typeof payload.message_limit === 'object') return payload.message_limit;
  if (payload.type === 'message_limit' && payload.data?.message_limit) return payload.data.message_limit;
  if (payload.type === 'message_limit' && payload.data) return payload.data;
  return null;
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
