const CLAUDE_HOST_RE = /(^|\.)claude\.ai$/;
const MIN_VISIBLE_CHARS = 12;
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_DEBOUNCE_MS = 1_200;

export const CLAUDE_CONTEXT_WINDOW_TOKENS = 200_000;

// Local o200k_base-style estimator for a compact approximate meter. Shipping
// the full BPE rank table would dwarf the extension for little widget value.
const MESSAGE_SELECTORS = [
  '[data-testid*="message" i]',
  '[data-testid*="conversation-turn" i]',
  '[data-testid*="chat-message" i]',
  '[data-is-streaming]',
  '[data-message-author-role]',
  '[class*="font-claude-message"]',
];

const SKIP_TEXT_SELECTOR = [
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'nav',
  'aside',
  'header',
  'footer',
  'button',
  'select',
  'option',
  'input',
  'textarea',
  '[contenteditable="true"]',
  '[aria-hidden="true"]',
  '#aut-host',
].join(',');

export function isClaudeContextHost(locationLike = globalThis.location) {
  return CLAUDE_HOST_RE.test(locationLike?.hostname || '');
}

export function readClaudeContextSnapshot(doc = globalThis.document, { now = new Date(), location = globalThis.location } = {}) {
  if (!doc || !isClaudeContextHost(location)) return null;

  const messageTexts = collectMessageTexts(doc);
  const fallbackText = messageTexts.length ? '' : collectMainText(doc);
  const draftText = collectDraftText(doc);
  const conversationText = messageTexts.length ? messageTexts.join('\n\n') : fallbackText;

  const conversationTokens = estimateO200kTokens(conversationText);
  const draftTokens = estimateO200kTokens(draftText);
  const tokenEstimate = conversationTokens + draftTokens;
  const percentUsed = Math.min(100, (tokenEstimate / CLAUDE_CONTEXT_WINDOW_TOKENS) * 100);

  return {
    provider: 'claude',
    maxTokens: CLAUDE_CONTEXT_WINDOW_TOKENS,
    tokenEstimate,
    conversationTokens,
    draftTokens,
    percentUsed,
    messageCount: messageTexts.length,
    source: messageTexts.length ? 'message-dom' : fallbackText ? 'main-dom' : 'empty',
    path: location?.pathname || '/',
    sampledAtISO: now.toISOString(),
  };
}

export function estimateO200kTokens(input) {
  const raw = String(input || '');
  const text = normalizeText(raw);
  if (!text) return 0;

  const parts = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[A-Za-z0-9]+(?:[._'/-][A-Za-z0-9]+)*|[^\s]/gu) || [];
  let tokens = 0;
  for (const part of parts) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(part)) {
      tokens += 1;
    } else if (/^[A-Za-z0-9]/.test(part)) {
      tokens += estimateWordTokens(part);
    } else {
      tokens += 1;
    }
  }

  const structureBonus = (raw.match(/\n+/g) || []).length * 0.25;
  return Math.max(0, Math.ceil(tokens + structureBonus));
}

export function mergeContextSnapshot(state, snapshot) {
  if (!snapshot) return state;
  return {
    ...state,
    context: {
      ...(state?.context || {}),
      [snapshot.provider]: snapshot,
    },
  };
}

export function contextSnapshotsEqual(a, b) {
  if (!a || !b) return false;
  return a.provider === b.provider
    && a.path === b.path
    && a.tokenEstimate === b.tokenEstimate
    && a.conversationTokens === b.conversationTokens
    && a.draftTokens === b.draftTokens
    && a.messageCount === b.messageCount
    && a.source === b.source;
}

export function startClaudeContextCounter({
  readState,
  writeState,
  onChange,
  doc = globalThis.document,
  win = globalThis.window,
  intervalMs = DEFAULT_INTERVAL_MS,
  debounceMs = DEFAULT_DEBOUNCE_MS,
} = {}) {
  if (!doc || !win || !isClaudeContextHost(win.location)) return () => {};
  if (typeof readState !== 'function' || typeof writeState !== 'function') return () => {};

  let stopped = false;
  let timer = null;
  let debounceTimer = null;
  let running = false;
  let rerun = false;

  const run = async () => {
    if (stopped) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      const snapshot = readClaudeContextSnapshot(doc, { now: new Date(), location: win.location });
      if (snapshot) {
        const state = await readState();
        const previous = state?.context?.claude;
        if (!contextSnapshotsEqual(previous, snapshot)) {
          const next = mergeContextSnapshot(state || {}, snapshot);
          await writeState(next);
          if (typeof onChange === 'function') await onChange(snapshot, next);
        }
      }
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        scheduleSoon();
      }
    }
  };

  const scheduleSoon = () => {
    if (stopped) return;
    if (debounceTimer) win.clearTimeout(debounceTimer);
    debounceTimer = win.setTimeout(run, debounceMs);
  };

  run();
  timer = win.setInterval(run, intervalMs);

  const observer = createObserver(win, scheduleSoon);
  if (observer) {
    observer.observe(doc.body || doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  return () => {
    stopped = true;
    if (timer) win.clearInterval(timer);
    if (debounceTimer) win.clearTimeout(debounceTimer);
    if (observer) observer.disconnect();
  };
}

function estimateWordTokens(word) {
  const text = String(word || '');
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Math.max(1, Math.ceil(text.length / 3));
  if (/[A-Z]{4,}|[_/-]/.test(text)) return Math.max(1, Math.ceil(text.length / 3.4));
  return Math.max(1, Math.ceil(text.length / 4));
}

function collectMessageTexts(doc) {
  const out = [];
  const seenElements = new Set();
  const seenText = new Set();

  for (const selector of MESSAGE_SELECTORS) {
    let nodes = [];
    try {
      nodes = [...doc.querySelectorAll(selector)];
    } catch {
      nodes = [];
    }
    for (const node of nodes) {
      if (!node || seenElements.has(node) || isInsideSeenElement(node, seenElements)) continue;
      if (!isVisibleElement(node)) continue;
      const text = collectVisibleText(node);
      if (text.length < MIN_VISIBLE_CHARS || seenText.has(text)) continue;
      seenElements.add(node);
      seenText.add(text);
      out.push(text);
    }
  }

  return out;
}

function collectMainText(doc) {
  const main = doc.querySelector('main') || doc.querySelector('[role="main"]');
  if (!main || !isVisibleElement(main)) return '';
  return collectVisibleText(main);
}

function collectDraftText(doc) {
  const parts = [];
  const nodes = [
    ...doc.querySelectorAll('textarea'),
    ...doc.querySelectorAll('[contenteditable="true"]'),
  ];
  for (const node of nodes) {
    if (!isVisibleElement(node)) continue;
    const text = normalizeText(node.value || node.textContent || '');
    if (text.length >= MIN_VISIBLE_CHARS) parts.push(text);
  }
  return parts.join('\n\n');
}

function collectVisibleText(root) {
  const doc = root?.ownerDocument;
  const nodeFilter = doc?.defaultView?.NodeFilter || globalThis.NodeFilter;
  if (!doc || !doc.createTreeWalker || !nodeFilter) {
    return normalizeText(root?.textContent || '');
  }

  const parts = [];
  const walker = doc.createTreeWalker(root, nodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || isSkippedTextParent(parent) || !isVisibleElement(parent)) {
        return nodeFilter.FILTER_REJECT;
      }
      const text = normalizeText(node.nodeValue || '');
      return text ? nodeFilter.FILTER_ACCEPT : nodeFilter.FILTER_REJECT;
    },
  });

  while (walker.nextNode()) {
    parts.push(walker.currentNode.nodeValue || '');
  }
  return normalizeText(parts.join(' '));
}

function isSkippedTextParent(element) {
  try {
    return !!element.closest(SKIP_TEXT_SELECTOR);
  } catch {
    return false;
  }
}

function isInsideSeenElement(node, seenElements) {
  for (const seen of seenElements) {
    if (seen !== node && seen.contains(node)) return true;
  }
  return false;
}

function isVisibleElement(element) {
  if (!element) return false;
  const win = element.ownerDocument?.defaultView;
  if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) {
    return false;
  }
  if (win?.getComputedStyle) {
    const style = win.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
  }
  return true;
}

function createObserver(win, callback) {
  const Observer = win.MutationObserver || globalThis.MutationObserver;
  if (!Observer) return null;
  return new Observer(callback);
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}
